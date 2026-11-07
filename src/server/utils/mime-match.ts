/**
 * @fileoverview Pure MIME-type whitelist matching with wildcard support. Strips
 * RFC 2045 parameters (`; key=value`) before comparison and matches
 * case-insensitively. Security boundary: every upload MIME check flows through
 * this function, so it carries a mutation-100% gate.
 * @layer server/utils
 */

/**
 * One media type: `type/subtype` (RFC 9110 token characters), then optionally `;` and parameters
 * made of tab, space and printable ASCII except the comma, which is what a header value can hold
 * without a control or non-ASCII character that makes the request unusable. A comma makes the value a list, and a browser reading a list
 * takes the last valid type, so a value that matches on its first type would be served as another.
 * Such a value is not a type to compare, whatever the whitelist holds.
 */
const SINGLE_MEDIA_TYPE =
  /^[ \t]*[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+[ \t]*(?:;[\t \x21-\x2B\x2D-\x7E]*)?$/

/**
 * Returns `true` when `mime` matches at least one pattern in `whitelist`.
 *
 * Three match modes are supported:
 * 1. **Exact** — case-insensitive string equality (e.g. `'image/jpeg'`).
 * 2. **Subtype wildcard** — type followed by a `/*` suffix matches any subtype
 *    of that type (e.g. `'image/*'` matches `'image/png'`).
 * 3. **Full wildcard** — the `*`/`*` pattern matches any valid `type/subtype`
 *    pair.
 *
 * RFC 2045 parameters after `;` (e.g. `charset=utf-8`) are stripped before
 * comparison. An input that is not a single well-formed `type/subtype` never matches.
 *
 * @param mime - The content type to test. Parameters are stripped internally. A value that is
 *   not a single `type/subtype` (a comma-separated list, a missing part, a character outside the
 *   token set) never matches.
 * @param whitelist - The list of allowed patterns. Whitespace around each
 *   pattern is ignored.
 * @returns `true` when any pattern in the whitelist matches.
 */
export function mimeMatches(mime: string, whitelist: readonly string[]): boolean {
  if (typeof mime !== 'string' || !SINGLE_MEDIA_TYPE.test(mime)) {
    return false
  }
  // Strip RFC 2045 parameters (text after the first semicolon) without optional chaining
  // The pattern above guarantees a '/' with a non-empty type and subtype before any ';'.
  const mimeBase = mime.includes(';') ? mime.slice(0, mime.indexOf(';')) : mime
  const normalized = mimeBase.trim().toLowerCase()
  const slashIdx = normalized.indexOf('/')
  const type = normalized.slice(0, slashIdx)

  for (const rawPattern of whitelist) {
    const pattern = rawPattern.trim().toLowerCase()
    if (pattern === normalized) {
      return true
    }
    // Full wildcard: matches any valid type/subtype
    if (pattern === '*/*') {
      return true
    }
    // Subtype wildcard: same type, any subtype
    if (pattern.endsWith('/*') && pattern.slice(0, -2) === type) {
      return true
    }
  }
  return false
}
