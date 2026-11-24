/**
 * @fileoverview A failed multipart upload is cleaned up and then reported; a refusal of the runtime check
 * that ended the upload is reported as it was raised.
 * @layer server/utils
 */
import { AbortMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3'
import type { Logger } from '@nestjs/common'
import { failMultipartUpload } from './multipart-failure'
import { assertCleanRoot } from './prototype-guard'

const target = { bucket: 'b', finalKey: 'k', caller: {} }
const logger = { warn: jest.fn() } as unknown as Logger

/** The error `assertCleanRoot` raises while a key is planted on the root prototype. */
function refusal(): unknown {
  const root = Object.prototype as unknown as Record<string, unknown>
  root.planted = 1
  try {
    assertCleanRoot()
  } catch (error) {
    return error
  } finally {
    Reflect.deleteProperty(root, 'planted')
  }
  throw new Error('the guard did not refuse')
}

describe('failMultipartUpload', () => {
  it('maps an ordinary failure to the multipart-aborted code', async () => {
    /* A provider failure ends as STORAGE_MULTIPART_ABORTED, with the upload aborted first. */
    const send = jest.fn().mockResolvedValue({})
    const client = { send } as unknown as S3Client
    await expect(
      failMultipartUpload(client, logger, new Error('boom'), target, {
        uploadId: 'u1',
        signal: undefined,
        createdUploadId: undefined,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_MULTIPART_ABORTED' })
    expect((send.mock.calls[0] as [AbortMultipartUploadCommand])[0]).toBeInstanceOf(
      AbortMultipartUploadCommand,
    )
  })

  it('reports a refusal of the runtime check as the same error, after aborting the upload', async () => {
    /* The refusal is the library's own validation error; it is not turned into an aborted upload. */
    const send = jest.fn().mockResolvedValue({})
    const client = { send } as unknown as S3Client
    const raised = refusal()
    const outcome: unknown = await failMultipartUpload(client, logger, raised, target, {
      uploadId: 'u1',
      signal: undefined,
      createdUploadId: undefined,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(outcome).toBe(raised)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
