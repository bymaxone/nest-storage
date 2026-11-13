/**
 * @fileoverview The size bound of `downloadBuffer`: a limit that is validated before any request,
 * checked against the object's `Content-Length` before its body is read, and counted while the body
 * is read, because a `Content-Length` can be missing or wrong.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { sizeLimitException } from '../errors/size-limit-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { ObjectMetadata } from '../../shared/types/storage-types'
import { destroyStream, readStream, readStreamUpTo } from './stream-utils'

/**
 * Refuses a `maxBytes` that is not an integer of at least 1, before any request is made.
 *
 * @param maxBytes - The caller's limit, if any.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` naming `maxBytes`.
 */
export function assertMaxBytes(maxBytes: number | undefined): void {
  if (maxBytes !== undefined && (typeof maxBytes !== 'number' || !Number.isInteger(maxBytes) || maxBytes < 1)) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      reason: 'maxBytes must be an integer >= 1',
    })
  }
}

/**
 * Reads a download body into one `Buffer`, holding at most `maxBytes` of it when a limit is given.
 * The body is released whenever the limit is crossed.
 *
 * @param stream - The (idle-guarded) download body.
 * @param metadata - The object's metadata, whose size is the `Content-Length` when there was one.
 * @param maxBytes - The most bytes to hold; `undefined` buffers the whole body.
 * @returns The body.
 * @throws StorageException `STORAGE_SIZE_EXCEEDED` when the object, by its header or by its bytes,
 *   is larger than `maxBytes`.
 */
export async function readDownloadBody(
  stream: NodeJS.ReadableStream,
  metadata: ObjectMetadata,
  maxBytes: number | undefined,
): Promise<Buffer> {
  if (maxBytes === undefined) {
    return readStream(stream)
  }
  const context = { key: metadata.key, bucket: metadata.bucket }
  if (metadata.size > maxBytes) {
    destroyStream(stream)
    throw sizeLimitException(maxBytes, 'max', { ...context, contentLength: metadata.size })
  }
  const buffer = await readStreamUpTo(stream, maxBytes)
  if (buffer === undefined) {
    throw sizeLimitException(maxBytes, 'max', context)
  }
  return buffer
}
