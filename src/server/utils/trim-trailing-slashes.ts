/**
 * @fileoverview Pure trailing-slash trimmer for endpoint URLs.
 *
 * Deliberately regex-free. The obvious form — `value.replace(/\/+$/, '')` — is
 * linear when the slashes really are at the end, which is the expected input, and
 * quadratic when they are not: on a long run of slashes followed by any other
 * character the anchor can never be satisfied, so the engine retries `\/+` from
 * every position in the run. Measured on V8, doubling the run length quadruples
 * the time — 57 ms at 12.5k slashes, 3.4 s at 100k.
 *
 * The inputs here are deployment configuration rather than request data, so that
 * shape is not attacker-reachable today. A single reverse index scan is O(n) on
 * every input, has no backtracking to reason about, and removes the finding
 * instead of arguing about its reachability.
 * @layer server/utils
 */

/** The separator stripped from the end of an endpoint URL. */
const SLASH = '/'

/**
 * Removes every trailing slash from `value`.
 *
 * Used when composing a public base URL from a configured endpoint plus a bucket
 * name, so the join produces exactly one separator regardless of whether the
 * consumer supplied a trailing slash.
 *
 * @param value - The endpoint URL, with or without trailing slashes.
 * @returns `value` with all trailing slashes removed; `''` when it is all slashes.
 * @example
 * ```ts
 * trimTrailingSlashes('https://s3.example.com/')   // 'https://s3.example.com'
 * trimTrailingSlashes('https://s3.example.com///') // 'https://s3.example.com'
 * trimTrailingSlashes('https://s3.example.com')    // 'https://s3.example.com'
 * ```
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length
  // No index bound: at `end === 0` the read is `value[-1]`, which is undefined and not a slash, so
  // the character test ends the loop on its own. A `end > 0` guard here would be dead weight that
  // no test could distinguish — and suppressing its mutants would take the character comparison's
  // with them, since a line-level directive cannot separate two operators on one line.
  while (value[end - 1] === SLASH) {
    end -= 1
  }
  // Stryker disable next-line ConditionalExpression: equivalent in value — `slice(0, length)` returns the same string; the guard returns the original reference instead of a copy, which no caller can observe
  return end === value.length ? value : value.slice(0, end)
}
