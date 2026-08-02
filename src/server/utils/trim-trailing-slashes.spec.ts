/**
 * @fileoverview Tests for the trimTrailingSlashes endpoint-URL utility.
 * @layer server/utils
 */
import { trimTrailingSlashes } from './trim-trailing-slashes'

describe('trimTrailingSlashes', () => {
  it('returns the value unchanged when there is no trailing slash', () => {
    // the early-return branch: nothing to trim, same reference back
    expect(trimTrailingSlashes('https://s3.example.com')).toBe('https://s3.example.com')
  })

  it('removes a single trailing slash', () => {
    // the common consumer typo
    expect(trimTrailingSlashes('https://s3.example.com/')).toBe('https://s3.example.com')
  })

  it('removes a run of trailing slashes', () => {
    // the loop must consume every trailing separator, not just the last one
    expect(trimTrailingSlashes('https://s3.example.com///')).toBe('https://s3.example.com')
  })

  it('preserves interior slashes', () => {
    // only the tail is trimmed; a path segment must survive intact
    expect(trimTrailingSlashes('https://s3.example.com/base//path/')).toBe(
      'https://s3.example.com/base//path',
    )
  })

  it('returns an empty string when the input is only slashes', () => {
    // exercises the `end > 0` loop guard, which stops at the start of the string
    expect(trimTrailingSlashes('////')).toBe('')
  })

  it('returns an empty string unchanged', () => {
    // zero-length input must not underflow the reverse scan
    expect(trimTrailingSlashes('')).toBe('')
  })

  it('scans a long slash run in linear time', () => {
    // the reason this helper exists: the regex form backtracks quadratically here
    const input = `https://s3.example.com${'/'.repeat(50_000)}`
    expect(trimTrailingSlashes(input)).toBe('https://s3.example.com')
  })
})
