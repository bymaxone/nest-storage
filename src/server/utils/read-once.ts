/**
 * @fileoverview One read of the fields of a caller's request. A request is the caller's object: a getter or a
 * Proxy can answer differently each time it is read, so a value that is checked and then used again can pass
 * the check as one thing and be used as another. Reading each field once, and using only that copy, leaves
 * nothing to read twice.
 * @layer server/utils
 */

/**
 * Copies the named fields of `request` into a plain object, reading each field exactly once.
 *
 * @param request - The caller's request, whatever its fields are.
 * @param keys - The fields to read.
 * @returns A plain object with the named fields; a field the request does not have is `undefined`.
 * @example
 *   const { contentType, metadata } = readOnce(request, ['contentType', 'metadata'])
 */
export function readOnce<T extends object, K extends keyof T>(
  request: T,
  keys: readonly K[],
): Pick<T, K> {
  const copy = {} as Pick<T, K>
  for (const key of keys) copy[key] = request[key]
  return copy
}
