/**
 * @fileoverview The details an error carries about the call that failed. Only what the caller supplied in
 * this request is repeated (the key, the per-call bucket, the list prefix), as text of at most 1024
 * characters (S3's key limit); anything longer, or not a string, is left out. A value the host supplied as
 * configuration (the option bucket, the key prefix) is never repeated, so a caller that sees the error learns
 * nothing about how the module was set up.
 * @layer server/utils
 */

/** The longest identifier an error repeats: S3's limit for a key. */
export const MAX_CALLER_TEXT_LENGTH = 1024

/**
 * The caller's own identifiers, as the fields an error repeats.
 *
 * @param given - The caller's identifiers by field; a field that is not a string of at most 1024
 *   characters (including one the caller did not give) is left out.
 * @returns The fields that are kept.
 */
export function callerFields(given: Readonly<Record<string, unknown>>): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [field, value] of Object.entries(given)) {
    if (typeof value === 'string' && value.length <= MAX_CALLER_TEXT_LENGTH) fields[field] = value
  }
  return fields
}

/**
 * Builds the details of a failed call from the identifiers the caller gave.
 *
 * @param op - The operation's name.
 * @param given - The caller's identifiers by field (see `callerFields`).
 * @param extra - More details to carry as they are, such as the outcome of an abort.
 * @returns The details object.
 */
export function callDetails(
  op: string,
  given: Readonly<Record<string, unknown>>,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { ...callerFields(given), op, ...extra }
}
