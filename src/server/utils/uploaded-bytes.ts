/**
 * @fileoverview The bytes an upload really sent, kept beside its result without becoming part of it: the result
 * the caller receives is unchanged, and the observer reads the count for the upload counter.
 * @layer server/utils
 */
import type { UploadResult } from '../../shared/types/storage-types'

const SENT = new WeakMap<UploadResult, number>()

/**
 * Remembers how many bytes a multipart upload sent.
 *
 * @param result - The result returned to the caller.
 * @param bytes - The bytes the uploader reported as sent.
 * @returns The same result.
 */
export function rememberUploadedBytes(result: UploadResult, bytes: number): UploadResult {
  SENT.set(result, bytes)
  return result
}

/**
 * The bytes an upload sent: the count remembered for a multipart upload, else the size of the result, which a
 * single-shot upload sets from the body it sent. A result answered from the idempotency cache sent nothing.
 *
 * @param result - The result of an upload.
 * @returns The bytes sent, or `undefined` when there is no count.
 */
export function uploadedBytesOf(result: UploadResult): number | undefined {
  return result.fromIdempotencyCache ? undefined : (SENT.get(result) ?? result.size)
}
