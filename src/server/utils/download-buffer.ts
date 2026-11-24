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
import { mapBodyReadFailure } from './download-body'
import { destroyStream, readStream, readStreamUpTo } from './stream-utils'
import { verdictOf } from './settle-or-cut'

/**
 * Refuses a `maxBytes` that is not an integer of at least 1, before any request is made.
 *
 * @param maxBytes - The caller's limit, if any.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` naming `maxBytes`.
 */
export function assertMaxBytes(maxBytes: number | undefined): void {
  // `Number.isInteger` is false for every value that is not a number, so no separate type test is needed.
  if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 1)) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      reason: 'maxBytes must be an integer >= 1',
    })
  }
}

/** Reads the body, or rejects with a size-limit error. */
async function readBody(
  stream: NodeJS.ReadableStream,
  metadata: ObjectMetadata,
  maxBytes: number | undefined,
  context: Record<string, unknown>,
): Promise<Buffer> {
  if (maxBytes === undefined) {
    return await verdictOf(readStream(stream))
  }
  if (metadata.size > maxBytes) {
    destroyStream(stream)
    throw sizeLimitException(maxBytes, 'max', { ...context, contentLength: metadata.size })
  }
  const buffer = await verdictOf(readStreamUpTo(stream, maxBytes))
  if (buffer === undefined) {
    throw sizeLimitException(maxBytes, 'max', context)
  }
  return buffer
}

/**
 * Reads a download body into one `Buffer`, holding at most `maxBytes` of it when a limit is given.
 * The body is released whenever the limit is crossed.
 *
 * @param stream - The (idle-guarded) download body.
 * @param metadata - The object's metadata, whose size is the `Content-Length` when there was one.
 * @param maxBytes - The most bytes to hold; `undefined` buffers the whole body.
 * @param signal - The caller's `abortSignal`, to tell a cancelled read from a failed one.
 * @param caller - What the error repeats of the call (see `callDetails`): the caller's own key and bucket only.
 * @returns The body.
 * @throws StorageException `STORAGE_SIZE_EXCEEDED` when the object, by its header or by its bytes,
 *   is larger than `maxBytes`; `STORAGE_REQUEST_ABORTED` when the signal aborted; otherwise a failure of
 *   the body (a reset connection) as a failure of the provider, whether or not the idle guard is on.
 */
export async function readDownloadBody(
  stream: NodeJS.ReadableStream,
  metadata: ObjectMetadata,
  maxBytes: number | undefined,
  signal: AbortSignal | undefined,
  caller: Record<string, unknown>,
): Promise<Buffer> {
  const context = { ...caller, op: 'downloadBuffer' }
  try {
    return await verdictOf(readBody(stream, metadata, maxBytes, context))
  } catch (err) {
    throw mapBodyReadFailure(err, signal, context)
  }
}
