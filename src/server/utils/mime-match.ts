/**
 * @fileoverview Pure MIME-type whitelist matching with wildcard support. Strips
 * RFC 2045 parameters (`; key=value`) before comparison and matches
 * case-insensitively. Security boundary: every upload MIME check flows through
 * this function, so it carries a mutation-100% gate.
 * @layer server/utils
 */

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
 * comparison. An input with no `/` is treated as an invalid MIME type and
 * never matches.
 *
 * @param mime - The content type to test. Parameters are stripped internally.
 * @param whitelist - The list of allowed patterns. Whitespace around each
 *   pattern is ignored.
 * @returns `true` when any pattern in the whitelist matches.
 */
export function mimeMatches(mime: string, whitelist: readonly string[]): boolean {
  if (typeof mime !== 'string') {
    return false
  }
  // Strip RFC 2045 parameters (text after the first semicolon) without optional chaining
  const mimeBase = mime.includes(';') ? mime.slice(0, mime.indexOf(';')) : mime
  const normalized = mimeBase.trim().toLowerCase()
  if (normalized.length === 0 || !normalized.includes('/')) {
    return false
  }
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
    const patSlash = pattern.indexOf('/')
    if (patSlash !== -1) {
      const patType = pattern.slice(0, patSlash)
      const patSubtype = pattern.slice(patSlash + 1)
      // Subtype wildcard: same type, any subtype
      if (patSubtype === '*' && patType === type) {
        return true
      }
    }
  }
  return false
}
