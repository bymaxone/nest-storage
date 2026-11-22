/**
 * @fileoverview One read of the fields of a caller's request. A request is the caller's object: a getter or a
 * Proxy can answer differently each time it is read, so a value that is checked and then used again can pass
 * the check as one thing and be used as another. Reading each field once, and using only that copy, leaves
 * nothing to read twice.
 * @layer server/utils
 */

import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'

// Taken when the module loads, so that replacing `Object.prototype.hasOwnProperty` (or any property of the root
// prototype) later changes nothing here: finding where a field lives reads no property of the root.
const hasOwn = Object.hasOwn
const getPrototypeOf = Object.getPrototypeOf as (value: object) => object | null

/**
 * Reads one field of a caller's object, leaving out a value that only the realm's root prototype supplies.
 *
 * A key planted on `Object.prototype` is found by an ordinary read of any plain object that lacks it, so a
 * field the caller never set could arrive as the planter's value. A field the object owns, or one a class
 * supplies on its own prototype (a getter, for instance), is still read; a field found only on the last
 * prototype of the chain, which has no prototype of its own, is not. That is decided by the shape of the chain and
 * not by comparing with this realm's `Object.prototype`, so it holds for an object of another realm and for a root
 * whose `constructor` was overwritten. The trade-off: a field supplied only by a host's own `Object.create(null)`
 * parent object is not read either, because it cannot be told from a planted root.
 *
 * @param source - The caller's object.
 * @param key - The field to read.
 * @returns The field's value, or `undefined` when it is not set or is supplied only by the root prototype.
 */
export function readField(source: object, key: string): unknown {
  let holder: object | null = source
  while (holder !== null && !hasOwn(holder, key)) {
    holder = getPrototypeOf(holder)
  }
  if (holder === null) return undefined
  if (holder !== source && getPrototypeOf(holder) === null) return undefined
  return (source as Record<string, unknown>)[key]
}

/**
 * Copies the named fields of `request` into a prototype-less object, reading each field exactly once.
 *
 * @param request - The caller's request, whatever its fields are.
 * @param keys - The fields to read.
 * @returns An object with no prototype holding the named fields that are set; a field that is `undefined` is left out.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when reading a field throws; the error that was thrown is
 *   the `cause` and none of its text is in the response.
 * @example
 *   const { contentType, metadata } = readOnce(request, ['contentType', 'metadata'])
 */
export function readOnce<T extends object, K extends keyof T>(
  request: T,
  keys: readonly K[],
): Pick<T, K> {
  const copy = Object.create(null) as Pick<T, K>
  try {
    for (const key of keys) {
      const value = readField(request, key as string)
      if (value !== undefined) copy[key] = value as T[K]
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
 * @returns `into`, holding a copy of the request's own enumerable fields.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when reading a field throws; the error that was thrown is
 *   the `cause` and none of its text is in the response.
 */
export function copyRequest<T extends object>(request: T, into: Partial<T> = Object.create(null) as Partial<T>): T {
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

/**
 * A copy of `request` with `fields` set over it, still without a prototype: a spread into an object literal
 * would give the copy `Object.prototype` again, and with it any key planted there.
 *
 * @param request - A request as {@link readOnce} or {@link copyRequest} returned it.
 * @param fields - The fields to set over the copy.
 * @returns A new object with no prototype holding the fields of `request` and then `fields`.
 */
export function withFields<T extends object>(request: T, fields: Partial<T>): T {
  return Object.assign(Object.create(null) as T, request, fields)
}
