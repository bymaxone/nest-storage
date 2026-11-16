/**
 * @fileoverview Closing a failed multipart upload and reporting the outcome.
 * @layer server/utils
 */
import { AbortMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3'
import type { Logger } from '@nestjs/common'
import { abortFailureLogger, closeMultipartUpload, closeWhenCreated } from './multipart-abort'

function clientThatAnswers(send: jest.Mock): S3Client {
  return { send } as unknown as S3Client
}

describe('closeMultipartUpload', () => {
  it('reports nothing when no upload was created', async () => {
    const send = jest.fn()

    expect(await closeMultipartUpload(clientThatAnswers(send), 'b', 'k', undefined)).toEqual({})
    expect(send).not.toHaveBeenCalled()
  })

  it('aborts the upload by id and reports it completed', async () => {
    const send = jest.fn().mockResolvedValue({})

    const outcome = await closeMultipartUpload(clientThatAnswers(send), 'b', 'prefix/k', 'u1')

    expect(outcome).toEqual({ abort: 'completed' })
    const command = (send.mock.calls[0] as [AbortMultipartUploadCommand])[0]
    expect(command).toBeInstanceOf(AbortMultipartUploadCommand)
    expect(command.input).toEqual({ Bucket: 'b', Key: 'prefix/k', UploadId: 'u1' })
  })

  it('treats an upload the provider no longer knows as closed', async () => {
    const send = jest.fn().mockRejectedValue({ name: 'NoSuchUpload' })

    expect(await closeMultipartUpload(clientThatAnswers(send), 'b', 'k', 'u1')).toEqual({
      abort: 'completed',
    })
  })

  it('reports a failed abort, hands the failure to the caller, and does not throw', async () => {
    // Triage: the outcome held the failure's text as `abortError`; it now holds only that the abort
    // failed, and what it threw goes to `onFailure`, for the caller's logs.
    const failure = new Error('provider down')
    const send = jest.fn().mockRejectedValue(failure)
    const onFailure = jest.fn()

    const outcome = await closeMultipartUpload(clientThatAnswers(send), 'b', 'k', 'u1', onFailure)

    expect(outcome).toEqual({ abort: 'failed' })
    expect(onFailure).toHaveBeenCalledWith(failure)
  })

  it('reports a failed abort when no one is listening for the failure', async () => {
    const send = jest.fn().mockRejectedValue(new Error('provider down'))

    expect(await closeMultipartUpload(clientThatAnswers(send), 'b', 'k', 'u1')).toEqual({
      abort: 'failed',
    })
  })

  it.each([null, undefined, Object.create(null) as object])(
    'reports a failed abort for a rejection value with no message (%p)',
    async (value) => {
      const send = jest.fn().mockRejectedValue(value)
      const onFailure = jest.fn()

      const outcome = await closeMultipartUpload(clientThatAnswers(send), 'b', 'k', 'u1', onFailure)

      expect(outcome).toEqual({ abort: 'failed' })
      expect(onFailure).toHaveBeenCalledWith(value)
    },
  )

  it('does not call onFailure for an upload the provider no longer knows', async () => {
    const onFailure = jest.fn()

    await closeMultipartUpload(
      clientThatAnswers(jest.fn().mockRejectedValue({ name: 'NoSuchUpload' })),
      'b',
      'k',
      'u1',
      onFailure,
    )

    expect(onFailure).not.toHaveBeenCalled()
  })

  it('closeWhenCreated hands a failed late abort to onFailure', async () => {
    const failure = new Error('late abort refused')
    const onFailure = jest.fn()

    closeWhenCreated(
      clientThatAnswers(jest.fn().mockRejectedValue(failure)),
      'b',
      'k',
      Promise.resolve('u1'),
      onFailure,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(onFailure).toHaveBeenCalledWith(failure)
  })
})

describe('abortFailureLogger', () => {
  it('warns with the key and what the abort threw, for the logs', () => {
    const logger = { warn: jest.fn() } as unknown as Logger

    abortFailureLogger(logger, 'tenant/a.bin')(new Error('provider down'))

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Multipart abort failed'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('tenant/a.bin'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('provider down'))
  })

  it('escapes control characters in the key and in the failure, so a log line cannot be forged', () => {
    const warn = jest.fn<undefined, [string]>()
    const logger = { warn } as unknown as Logger

    abortFailureLogger(logger, 'a\nFORGED')(new Error('x\ny'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).not.toContain('\n')
  })
})
