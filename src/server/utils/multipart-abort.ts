/**
 * @fileoverview Closes a multipart upload that failed, and reports whether that worked.
 * @layer server/utils
 */
import { AbortMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3'
import { CLEANUP_DEADLINE_MS } from './abort-support'
import { emit, type LogSink } from './log-event'
import { STORAGE_LOG_EVENTS } from './log-events'
import { failureError } from './provider-failure-log'

/**
 * What happened to the multipart upload after a failure; empty when none had been created. It names no
 * driver or provider text: a failed abort is reported to the caller's `onFailure`, for its logs.
 */
export interface AbortOutcome {
  abort?: 'completed' | 'failed'
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
 * @param onFailure - Told what the failed abort threw, for the caller's logs; the outcome itself holds
 *   none of it.
 * @returns Details for the error the caller receives; never throws.
 */
export async function closeMultipartUpload(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string | undefined,
  onFailure?: (err: unknown) => void,
): Promise<AbortOutcome> {
  if (uploadId === undefined) {
    return {}
  }
  try {
    // A deadline of its own, never the caller's signal: that one may be what ended the upload, and an
    // aborted signal would cancel this request and leave the parts stored.
    await client.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
      { abortSignal: AbortSignal.timeout(CLEANUP_DEADLINE_MS) },
    )
    return { abort: 'completed' }
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'NoSuchUpload') {
      return { abort: 'completed' }
    }
    onFailure?.(err)
    return { abort: 'failed' }
  }
}

/**
 * Aborts the upload that a `CreateMultipartUpload` still in flight creates, once it answers. For a
 * caller that gave up waiting for the id: the provider may answer after that and the upload it
 * created would otherwise stay open for ever.
 *
 * @param client - The S3 client.
 * @param bucket - The bucket of the upload.
 * @param key - The final object key.
 * @param created - The id the create answers with, or `undefined` if it fails; it never rejects.
 * @param onFailure - Told what a failed abort threw, for the caller's logs.
 */
export function closeWhenCreated(
  client: S3Client,
  bucket: string,
  key: string,
  created: Promise<string | undefined>,
  onFailure?: (err: unknown) => void,
): void {
  void closeAfter(client, bucket, key, created, onFailure)
}

/** Waits for the id and closes that upload; the id is read by `await`, which a replaced `then` does not reach. */
async function closeAfter(
  client: S3Client,
  bucket: string,
  key: string,
  created: Promise<string | undefined>,
  onFailure: ((err: unknown) => void) | undefined,
): Promise<void> {
  await closeMultipartUpload(client, bucket, key, await created, onFailure)
}

/**
 * Builds the callback that logs what a failed abort threw, so that the error the caller receives names
 * only that the abort failed. The key is not logged: the provider failure and the operation are enough
 * to correlate.
 *
 * @param logger - Where the warning goes.
 * @returns A callback for `closeMultipartUpload`'s `onFailure`.
 */
export function abortFailureLogger(logger: LogSink): (err: unknown) => void {
  return (err) => {
    emit(logger, 'warn', {
      event: STORAGE_LOG_EVENTS.multipartAbortFailed,
      message: 'Multipart abort failed, the upload stays open on the provider',
      err: failureError(err),
    })
  }
}
