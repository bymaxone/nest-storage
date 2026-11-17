/**
 * @fileoverview Tests for the clampTtl presign-TTL utility.
 * @layer server/utils
 */
import { clampTtl } from './ttl-clamp'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'

const DEFAULT_TTL = 300
const MAX_TTL = 604800 // 7 days

describe('clampTtl', () => {
  it('returns the default when ttlSeconds is undefined', () => {
    // undefined input must resolve to the default
    expect(clampTtl(undefined, DEFAULT_TTL, MAX_TTL)).toBe(DEFAULT_TTL)
  })

  it('returns the value as-is when below the maximum', () => {
    // values within range must pass through unchanged
    expect(clampTtl(60, DEFAULT_TTL, MAX_TTL)).toBe(60)
  })

  it('silently clamps values above the maximum to maxTtl', () => {
    // consumer-friendly: no throw, just clamp
    expect(clampTtl(999999, DEFAULT_TTL, MAX_TTL)).toBe(MAX_TTL)
  })

  it('throws STORAGE_SIGNED_URL_TTL_INVALID for ttl === 0', () => {
    // zero is not a valid TTL
    expect(() => clampTtl(0, DEFAULT_TTL, MAX_TTL)).toThrow(StorageException)
    try {
      clampTtl(0, DEFAULT_TTL, MAX_TTL)
    } catch (err) {
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID)
      // The exception must carry the exact reason and the offending value in details.
      const details = ((err as StorageException).getResponse() as {
        error: { details: { reason: string; provided: number } }
      }).error.details
      expect(details.reason).toBe('TTL must be > 0')
      expect(details.provided).toBe(0)
    }
  })

  it('throws STORAGE_SIGNED_URL_TTL_INVALID for negative ttl', () => {
    // negative values are not valid
    expect(() => clampTtl(-10, DEFAULT_TTL, MAX_TTL)).toThrow(StorageException)
    try {
      clampTtl(-10, DEFAULT_TTL, MAX_TTL)
    } catch (err) {
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID)
      // Details must reflect the exact rejected TTL, not a blank object.
      const details = ((err as StorageException).getResponse() as {
        error: { details: { reason: string; provided: number } }
      }).error.details
      expect(details.reason).toBe('TTL must be > 0')
      expect(details.provided).toBe(-10)
    }
  })

  it('returns maxTtl exactly when ttl equals maxTtl (no off-by-one)', () => {
    // boundary: ttl === maxTtl must return maxTtl without throwing
    expect(clampTtl(MAX_TTL, DEFAULT_TTL, MAX_TTL)).toBe(MAX_TTL)
  })

  it('returns maxTtl when defaultTtl equals maxTtl and input is undefined', () => {
    // boundary: default === max, undefined input uses default which equals max
    expect(clampTtl(undefined, MAX_TTL, MAX_TTL)).toBe(MAX_TTL)
  })

  it('returns 1 when ttl is 1 (minimum positive value)', () => {
    // smallest valid positive TTL must not be rejected
    expect(clampTtl(1, DEFAULT_TTL, MAX_TTL)).toBe(1)
  })

  it.each([Number.NaN, Infinity, -Infinity, 1.5, '3'])(
    'throws STORAGE_SIGNED_URL_TTL_INVALID for %p',
    (value) => {
      // `NaN <= 0` is false, so a check on the sign alone let NaN through to `X-Amz-Expires=NaN`.
      const call = (): number => clampTtl(value as number, DEFAULT_TTL, MAX_TTL)

      expect(call).toThrow(StorageException)
      let thrown: unknown
      try {
        call()
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({ code: STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID })
    },
  )

  it('checks the default TTL as well, so a NaN default is refused at the call', () => {
    expect(() => clampTtl(undefined, Number.NaN, MAX_TTL)).toThrow(StorageException)
  })

  it('says why: a non-whole TTL is not reported as non-positive, and a non-positive one keeps its reason', () => {
    const reasonOf = (value: number): string => {
      try {
        clampTtl(value, DEFAULT_TTL, MAX_TTL)
      } catch (error) {
        return ((error as StorageException).getResponse() as { error: { details: { reason: string } } }).error.details.reason
      }
      return ''
    }

    expect(reasonOf(Number.NaN)).toBe('TTL must be a whole number of seconds greater than 0')
    expect(reasonOf(1.5)).toBe('TTL must be a whole number of seconds greater than 0')
    expect(reasonOf(-1.5)).toBe('TTL must be > 0')
    expect(reasonOf(0)).toBe('TTL must be > 0')
  })
})
