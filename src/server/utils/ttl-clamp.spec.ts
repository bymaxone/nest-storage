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
    }
  })

  it('throws STORAGE_SIGNED_URL_TTL_INVALID for negative ttl', () => {
    // negative values are not valid
    expect(() => clampTtl(-10, DEFAULT_TTL, MAX_TTL)).toThrow(StorageException)
    try {
      clampTtl(-10, DEFAULT_TTL, MAX_TTL)
    } catch (err) {
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID)
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
})
