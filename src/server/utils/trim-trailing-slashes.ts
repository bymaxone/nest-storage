/**
 * @fileoverview Pure trailing-slash trimmer for endpoint URLs.
 *
 * Deliberately regex-free. The obvious form — `value.replace(/\/+$/, '')` — is a
 * polynomial-backtracking pattern: on a string ending in many slashes that never
 * satisfies the anchor, the engine retries `\/+` from every position, making the
 * scan quadratic in the run length. The inputs here are deployment configuration
 * rather than request data, so it is not reachable by an attacker today, but a
 * single reverse index scan is O(n), has no backtracking to reason about, and
 * removes the finding instead of arguing about its reachability.
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
  while (end > 0 && value[end - 1] === SLASH) {
    end -= 1
  }
  return end === value.length ? value : value.slice(0, end)
}
