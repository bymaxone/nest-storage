/**
 * @fileoverview Closes a multipart upload that failed, and reports whether that worked.
 * @layer server/utils
 */
import { AbortMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3'
import { describeError } from './describe-error'

/** What happened to the multipart upload after a failure; empty when none had been created. */
export interface AbortOutcome {
  abort?: 'completed' | 'failed'
  abortError?: string
}

/**
 * Sends `AbortMultipartUpload` for an upload that failed. The uploader is told not to abort on its
 * own because its abort runs inside its own failure path: a failing abort replaced the failure that
 * caused it, and a failed `CompleteMultipartUpload` was never followed by one. An upload the provider
 * no longer knows (`NoSuchUpload`) is closed, not failed.
 *
 * @param client - The S3 client.
 * @param bucket - The bucket of the upload.
 * @param key - The final object key.
 * @param uploadId - The upload id, absent when `CreateMultipartUpload` never answered.
 * @returns Details for the error the caller receives; never throws.
 */
export async function closeMultipartUpload(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string | undefined,
): Promise<AbortOutcome> {
  if (uploadId === undefined) {
    return {}
  }
  try {
    await client.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
    )
    return { abort: 'completed' }
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'NoSuchUpload') {
      return { abort: 'completed' }
    }
    return { abort: 'failed', abortError: describeError(err) }
  }
}
