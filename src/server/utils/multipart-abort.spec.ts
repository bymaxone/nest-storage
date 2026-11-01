/**
 * @fileoverview Closing a failed multipart upload and reporting the outcome.
 * @layer server/utils
 */
import { AbortMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3'
import { closeMultipartUpload } from './multipart-abort'

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

  it('reports a failed abort with its reason and does not throw', async () => {
    const send = jest.fn().mockRejectedValue(new Error('provider down'))

    expect(await closeMultipartUpload(clientThatAnswers(send), 'b', 'k', 'u1')).toEqual({
      abort: 'failed',
      abortError: 'provider down',
    })
  })

  it.each([null, undefined, Object.create(null) as object])(
    'reports a failed abort for a rejection value with no message (%p)',
    async (value) => {
      const send = jest.fn().mockRejectedValue(value)

      const outcome = await closeMultipartUpload(clientThatAnswers(send), 'b', 'k', 'u1')

      expect(outcome.abort).toBe('failed')
      expect(typeof outcome.abortError).toBe('string')
    },
  )
})
