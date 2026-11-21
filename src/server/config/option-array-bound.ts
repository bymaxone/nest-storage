/**
 * @fileoverview The bound on an option array. A MIME whitelist or a validator list longer than this is
 * already a mistake, and a sparse array that claims billions of entries would stall the copy of the options
 * that runs before validation, so the length is checked before any entry is read.
 * @layer server/config
 */

/** The most entries an option array may hold. */
export const MAX_OPTION_ARRAY_LENGTH = 1000

/**
 * What the copy of the options holds in place of an array that is longer than the bound, or whose length is
 * not a count: the array itself is never kept, so validation cannot read its length a second time and get
 * another answer. Validation refuses it by name.
 */
export const OVERSIZED_ARRAY: object = Object.freeze({})

/**
 * Whether `length` is a count an option array may have.
 *
 * @param length - The `length` an array reports, which a Proxy of an array may set to anything.
 * @returns `true` for a non-negative integer no larger than {@link MAX_OPTION_ARRAY_LENGTH}.
 */
export function isBoundedLength(length: unknown): boolean {
  return (
    typeof length === 'number' &&
    Number.isInteger(length) &&
    length >= 0 &&
    length <= MAX_OPTION_ARRAY_LENGTH
  )
}
