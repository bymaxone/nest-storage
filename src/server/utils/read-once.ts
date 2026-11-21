/**
 * @fileoverview One read of the fields of a caller's request. A request is the caller's object: a getter or a
 * Proxy can answer differently each time it is read, so a value that is checked and then used again can pass
 * the check as one thing and be used as another. Reading each field once, and using only that copy, leaves
 * nothing to read twice.
 * @layer server/utils
 */

import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'

/**
 * Copies the named fields of `request` into a plain object, reading each field exactly once.
 *
 * @param request - The caller's request, whatever its fields are.
 * @param keys - The fields to read.
 * @returns A plain object with the named fields that are set; a field that is `undefined` is left out.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when reading a field throws; the error that was thrown is
 *   the `cause` and none of its text is in the response.
 * @example
 *   const { contentType, metadata } = readOnce(request, ['contentType', 'metadata'])
 */
export function readOnce<T extends object, K extends keyof T>(
  request: T,
  keys: readonly K[],
): Pick<T, K> {
  const copy = {} as Pick<T, K>
  try {
    for (const key of keys) {
      const value = request[key]
      if (value !== undefined) copy[key] = value
    }
  } catch (error) {
    throw new StorageException(
      STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED,
      undefined,
      { reason: 'the request could not be read' },
      undefined,
      error,
    )
  }
  return copy
}

/**
 * Copies the own enumerable fields of a caller's request into `into`, reading each once and storing each as it is
 * read, so what was read before a field that throws is still in `into` for the caller to release.
 *
 * @param request - The caller's request.
 * @param into - Where the fields are stored as they are read; a fresh object by default.
 * @returns `into`, holding a plain copy of the request's own enumerable fields.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when reading a field throws; the error that was thrown is
 *   the `cause` and none of its text is in the response.
 */
export function copyRequest<T extends object>(request: T, into: Partial<T> = {}): T {
  try {
    for (const key of Object.keys(request) as (keyof T & string)[]) {
      into[key] = request[key]
    }
  } catch (error) {
    throw new StorageException(
      STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED,
      undefined,
      { reason: 'the request could not be read' },
      undefined,
      error,
    )
  }
  return into as T
}
