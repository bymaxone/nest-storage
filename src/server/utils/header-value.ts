/**
 * @fileoverview Guards for caller strings that end up as an HTTP header value, a header name or a
 * signed query value. A control character, a line break or a non-ASCII character in one of them
 * either makes the request unusable or, once a signed value is reflected as a response header, lets
 * the caller split it. Every such value is checked here, whether or not a MIME whitelist is set.
 * @layer server/utils
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'

/** RFC 9110 field-value characters this library accepts: tab, space and printable ASCII. */
const HEADER_VALUE = /^[\t \x21-\x7E]*$/

/** An RFC 9110 token: what a header name is made of, in the lowercase the library sends it. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/

/** Why a value was refused; the value itself is never part of an error. */
const VALUE_REASON = 'must be a string of tab, space and printable ASCII characters'
const KEY_REASON =
  "every key must be a non-empty header name of letters, digits and the characters !#$%&'*+-.^_`|~"

function refuse(field: string, reason: string): never {
  throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
    field,
    reason,
  })
}

/**
 * Returns whether `value` can be sent as a header value or a signed query value: a string of tab,
 * space and printable ASCII only. Control characters (C0, DEL, CR and LF included) and non-ASCII
 * characters are not accepted.
 *
 * @param value - The candidate value.
 * @returns `true` when `value` is such a string.
 */
export function isHeaderValue(value: unknown): value is string {
  return typeof value === 'string' && HEADER_VALUE.test(value)
}

/**
 * Throws `STORAGE_VALIDATION_FAILED` for each named value that is present and is not a header value.
 * An absent value (`undefined`) is skipped. The error carries the field name and the reason only,
 * never the value.
 *
 * @param fields - Field name (as the caller knows it) to the value bound for a header.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` with `details: { field, reason }`.
 * @example
 *   assertHeaderValues({ cacheControl: options.cacheControl, contentDisposition: options.contentDisposition })
 */
export function assertHeaderValues(fields: Readonly<Record<string, string | undefined>>): void {
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined && !isHeaderValue(value)) {
      refuse(field, VALUE_REASON)
    }
  }
}

/**
 * Checks a user-metadata table, whose keys become `x-amz-meta-<key>` header names and whose values
 * become header values: every key must be a non-empty token once lowercased, every value a header
 * value. An absent table is skipped.
 *
 * @param metadata - The caller's metadata.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` with `details: { field: 'metadata', reason }`.
 */
export function assertMetadata(metadata: Readonly<Record<string, string>> | undefined): void {
  if (metadata === undefined) {
    return
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!HEADER_NAME.test(key.toLowerCase())) {
      refuse('metadata', KEY_REASON)
    }
    if (!isHeaderValue(value)) {
      refuse('metadata', VALUE_REASON)
    }
  }
}
