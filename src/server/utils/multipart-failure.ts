/**
 * @fileoverview Cleans up after a failed multipart upload and throws the original failure with the
 * outcome of the cleanup.
 * @layer server/utils
 */
import type { S3Client } from '@aws-sdk/client-s3'
import type { Logger } from '@nestjs/common'
import { mapMultipartError } from '../errors/multipart-error-mapper'
import { CLEANUP_DEADLINE_MS, requestAborted, within } from './abort-support'
import { isRootRefusal } from './prototype-guard'
import { abortFailureLogger, closeMultipartUpload, closeWhenCreated } from './multipart-abort'

/** The object a multipart upload was writing, and what the caller reported about the call. */
export interface MultipartTarget {
  readonly finalKey: string
  readonly bucket: string
  readonly caller: Record<string, unknown>
}

/** What the failed upload knew when it failed. */
export interface FailedMultipart {
  readonly uploadId: string | undefined
  readonly signal: AbortSignal | undefined
  readonly createdUploadId: (() => Promise<string | undefined>) | undefined
}

/**
 * Aborts the multipart upload that failed, then throws the original failure with the outcome. Whether
 * the failure is an abort is decided first: a signal that fires during the cleanup does not turn a
 * real failure into one. An upload id the provider answered late is waited for, within the cleanup
 * deadline, so that an abort during `CreateMultipartUpload` still aborts the upload it created.
 *
 * @param client - The S3 client.
 * @param logger - Receives a failure of the cleanup itself.
 * @param err - The failure that ended the upload.
 * @param target - The object being written.
 * @param upload - What the upload knew when it failed.
 * @returns Never: it always throws.
 * @throws StorageException the abort, or the mapped failure, with the cleanup outcome in its details.
 */
export async function failMultipartUpload(
  client: S3Client,
  logger: Logger,
  err: unknown,
  target: MultipartTarget,
  upload: FailedMultipart,
): Promise<never> {
  // Decided before the cleanup, which can take a while: a signal that fires during it must not turn
  // a real failure into an abort.
  const abortedBy = upload.signal?.aborted === true ? upload.signal : undefined
  const lookup = abortedBy ? upload.createdUploadId?.() : undefined
  let uploadId = upload.uploadId
  // Stryker disable next-line ConditionalExpression: when the uploader already holds an id it is the one the create answered, so waiting for the created id again yields the same value (equivalent).
  if (uploadId === undefined && lookup) {
    uploadId = await within(lookup, CLEANUP_DEADLINE_MS)
    // The caller does not wait longer, but an id that arrives later is still aborted.
    if (uploadId === undefined) {
      closeWhenCreated(client, target.bucket, target.finalKey, lookup, abortFailureLogger(logger))
    }
  }
  const abort = await closeMultipartUpload(
    client,
    target.bucket,
    target.finalKey,
    uploadId,
    abortFailureLogger(logger),
  )
  // A refusal of the runtime check is not a failure of the upload: it keeps its own code, after the cleanup.
  if (isRootRefusal(err)) {
    throw err
  }
  const context = { ...target.caller, op: 'upload-multipart', ...abort }
  throw abortedBy ? requestAborted(abortedBy, context) : mapMultipartError(err, context)
}
