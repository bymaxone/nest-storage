/**
 * @fileoverview Tests for the mimeMatches MIME-whitelist utility.
 * @layer server/utils
 */
import { mimeMatches } from './mime-match'

describe('mimeMatches', () => {
  it('matches an exact content type', () => {
    // exact string match must return true
    expect(mimeMatches('image/jpeg', ['image/jpeg'])).toBe(true)
  })

  it('matches case-insensitively', () => {
    // MIME types are case-insensitive per RFC 2045
    expect(mimeMatches('IMAGE/JPEG', ['image/jpeg'])).toBe(true)
  })

  it('matches a subtype wildcard (image/*)', () => {
    // subtype wildcard must match any subtype of the same type
    expect(mimeMatches('image/png', ['image/*'])).toBe(true)
  })

  it('does not match a different type via subtype wildcard', () => {
    // video/mp4 must not match image/*
    expect(mimeMatches('video/mp4', ['image/*'])).toBe(false)
  })

  it('strips parameters before matching (charset)', () => {
    // text/plain; charset=utf-8 must match text/plain
    expect(mimeMatches('text/plain; charset=utf-8', ['text/plain'])).toBe(true)
  })

  it('does not match */* when the input lacks a slash', () => {
    // inputs without a slash are not valid MIME types
    expect(mimeMatches('anything', ['*/*'])).toBe(false)
  })

  it('matches */* for a valid MIME type', () => {
    // */* is a full wildcard and matches any valid type/subtype pair
    expect(mimeMatches('image/jpeg', ['*/*'])).toBe(true)
  })

  it('returns false for an empty MIME input', () => {
    // empty string is not a valid MIME type
    expect(mimeMatches('', ['image/*'])).toBe(false)
  })

  it('returns false for an empty whitelist', () => {
    // no patterns → nothing matches
    expect(mimeMatches('image/jpeg', [])).toBe(false)
  })

  it('matches when a later pattern in the whitelist matches', () => {
    // the whole list must be checked, not just the first entry
    expect(mimeMatches('image/png', ['application/pdf', 'image/*'])).toBe(true)
  })

  it('matches a whitespace-padded pattern', () => {
    // leading/trailing whitespace in a pattern must be ignored
    expect(mimeMatches('image/png', [' image/png '])).toBe(true)
  })

  it('matches a mixed-case pattern', () => {
    // patterns are case-insensitive too
    expect(mimeMatches('image/png', ['IMAGE/PNG'])).toBe(true)
  })

  it('returns false when no pattern matches', () => {
    // none of the patterns match video/mp4
    expect(mimeMatches('video/mp4', ['image/jpeg', 'image/png'])).toBe(false)
  })

  it('matches */* for application/pdf', () => {
    // */* must match any valid MIME type
    expect(mimeMatches('application/pdf', ['*/*'])).toBe(true)
  })

  it('handles a non-string input coerced via a type assertion', () => {
    // defensive: a non-string input should return false, not throw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional coercion test
    expect(mimeMatches(null as any as string, ['image/*'])).toBe(false)
  })

  it('returns false when the pattern contains no slash', () => {
    // a pattern without a slash is not a valid MIME pattern and must not match
    expect(mimeMatches('text/plain', ['text'])).toBe(false)
  })

  it('trims surrounding whitespace from the MIME input before matching', () => {
    // the input (not just the pattern) must be trimmed — a padded type still matches
    expect(mimeMatches('  image/jpeg  ', ['image/jpeg'])).toBe(true)
  })

  it('does not match a same-type different-subtype exact pattern', () => {
    // image/jpeg must NOT match the exact pattern image/png (subtype must be checked)
    expect(mimeMatches('image/jpeg', ['image/png'])).toBe(false)
  })

  it('does not treat a slashless "*" pattern as a subtype wildcard', () => {
    // a pattern with no slash must be skipped entirely; "*" alone never matches
    expect(mimeMatches('/png', ['*'])).toBe(false)
  })

  it('matches a subtype wildcard whose slash is at index 1 (single-char type)', () => {
    // the slash-present guard uses -1 as the sentinel, not 1 — a slash at index 1 counts
    expect(mimeMatches('a/b', ['a/*'])).toBe(true)
  })
})
