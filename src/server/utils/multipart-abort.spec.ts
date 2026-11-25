/**
 * @fileoverview Closing a failed multipart upload and reporting the outcome.
 * @layer server/utils
 */
import { AbortMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3'
import type { LogSink } from './log-event'
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
    // The outcome says only that the abort failed; what it threw goes to `onFailure`, for the caller's
    // logs.
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

  it('closeWhenCreated reports a runtime refusal to onFailure and leaves no unhandled rejection', async () => {
    const send = jest.fn().mockResolvedValue({})
    const onFailure = jest.fn()
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    let release: (id: string) => void = () => undefined
    const created = new Promise<string | undefined>((resolve) => {
      release = resolve
    })

    closeWhenCreated(clientThatAnswers(send), 'b', 'k', created, onFailure)
    Object.defineProperty(Object.prototype, 'plantedBeforeTheIdAnswers', {
      value: 1,
      configurable: true,
    })
    try {
      release('u1')
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
    } finally {
      Reflect.deleteProperty(Object.prototype, 'plantedBeforeTheIdAnswers')
      process.off('unhandledRejection', listener)
    }

    expect(unhandled).toEqual([])
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('closeWhenCreated survives an onFailure that throws while reporting a refusal', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    const onFailure = jest.fn(() => {
      throw new Error('sink down')
    })

    closeWhenCreated(
      clientThatAnswers(jest.fn().mockRejectedValue(new Error('refused'))),
      'b',
      'k',
      Promise.resolve('u1'),
      onFailure,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', listener)

    expect(unhandled).toEqual([])
  })
})

describe('abortFailureLogger', () => {
  const sink = (): { [K in keyof LogSink]: jest.Mock<unknown, [unknown]> } => ({
    debug: jest.fn<unknown, [unknown]>(),
    log: jest.fn<unknown, [unknown]>(),
    warn: jest.fn<unknown, [unknown]>(),
    error: jest.fn<unknown, [unknown]>(),
  })

  it('warns with the event, library text and what the abort threw under err, and no key', () => {
    const logger = sink()

    abortFailureLogger(logger)(
      Object.assign(new Error('SENTINEL-PROVIDER-TEXT'), { name: 'ServiceUnavailable' }),
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const entry = logger.warn.mock.calls[0]?.[0] as Record<string, unknown> & { err: Error }
    expect(entry).toMatchObject({
      event: 'STORAGE_MULTIPART_ABORT_FAILED',
      message: 'Multipart abort failed, the upload stays open on the provider',
    })
    expect(entry.err.message).toBe('SENTINEL-PROVIDER-TEXT')
    expect(entry.err.name).toBe('ServiceUnavailable')
    expect(JSON.stringify({ ...entry, err: undefined })).not.toContain('SENTINEL-PROVIDER-TEXT')
    expect(entry).not.toHaveProperty('key')
  })

  it('escapes control characters in what the abort threw, so a log line cannot be forged', () => {
    const logger = sink()

    abortFailureLogger(logger)(new Error('x\ny'))

    expect((logger.warn.mock.calls[0]?.[0] as { err: Error }).err.message).toBe('x\\ny')
  })

  it('is not broken by a logger that throws', () => {
    const logger = sink()
    logger.warn.mockImplementation(() => {
      throw new Error('host logger')
    })

    expect(() => {
      abortFailureLogger(logger)(new Error('x'))
    }).not.toThrow()
  })
})
