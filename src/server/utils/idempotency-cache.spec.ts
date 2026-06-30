/**
 * @fileoverview Unit tests for `IdempotencyCache` — round-trip, TTL expiry with
 * an injected clock, capacity eviction, and the LRU-touch ordering.
 * @layer server/utils
 */
import { IdempotencyCache } from './idempotency-cache'
import type { UploadResult } from '../../shared/types/storage-types'

function makeResult(key: string): UploadResult {
  return {
    key,
    bucket: 'b',
    etag: '"etag"',
    contentType: 'text/plain',
    publicUrl: `https://cdn.example.com/${key}`,
    multipart: false,
    fromIdempotencyCache: false,
  }
}

describe('IdempotencyCache', () => {
  describe('computeKey', () => {
    it('should be deterministic for the same inputs', () => {
      // Same idempotencyKey + finalKey must hash to the same value.
      const cache = new IdempotencyCache(10, 1000)
      expect(cache.computeKey('req-1', 'a.txt')).toBe(cache.computeKey('req-1', 'a.txt'))
    })

    it('should produce a 64-char hex sha256 digest (raw key not used directly)', () => {
      // The cache key is a hex sha256, never the raw idempotencyKey.
      const cache = new IdempotencyCache(10, 1000)
      const hash = cache.computeKey('req-1', 'a.txt')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(hash).not.toContain('req-1')
    })

    it('should differ for different inputs', () => {
      // Distinct inputs must not collide.
      const cache = new IdempotencyCache(10, 1000)
      expect(cache.computeKey('req-1', 'a.txt')).not.toBe(cache.computeKey('req-2', 'a.txt'))
    })
  })

  describe('get / set', () => {
    it('should return the value for the same cache key (round-trip)', () => {
      // A live entry is returned on lookup.
      const cache = new IdempotencyCache(10, 1000, () => 0)
      cache.set('k', makeResult('a'))
      expect(cache.get('k')).toEqual(makeResult('a'))
    })

    it('should return undefined for a missing key', () => {
      // A miss yields undefined.
      const cache = new IdempotencyCache(10, 1000, () => 0)
      expect(cache.get('absent')).toBeUndefined()
    })

    it('should return undefined once the TTL has elapsed', () => {
      // expiresAt <= now → expired → dropped.
      let now = 1000
      const cache = new IdempotencyCache(10, 100, () => now)
      cache.set('k', makeResult('a'))
      now = 1100
      expect(cache.get('k')).toBeUndefined()
      expect(cache.size()).toBe(0)
    })

    it('should still return the value before the TTL elapses', () => {
      // expiresAt > now → not expired.
      let now = 1000
      const cache = new IdempotencyCache(10, 100, () => now)
      cache.set('k', makeResult('a'))
      now = 1050
      expect(cache.get('k')).toEqual(makeResult('a'))
    })
  })

  describe('eviction', () => {
    it('should evict the oldest insertion when over capacity', () => {
      // maxEntries=2; inserting a third drops the oldest (A).
      const cache = new IdempotencyCache(2, 1000, () => 0)
      cache.set('A', makeResult('a'))
      cache.set('B', makeResult('b'))
      cache.set('C', makeResult('c'))
      expect(cache.get('A')).toBeUndefined()
      expect(cache.get('B')).toEqual(makeResult('b'))
      expect(cache.get('C')).toEqual(makeResult('c'))
    })

    it('should preserve a touched entry and evict the next-oldest (LRU)', () => {
      // Access A after B,C; exceeding the cap removes B, not A.
      const cache = new IdempotencyCache(3, 1000, () => 0)
      cache.set('A', makeResult('a'))
      cache.set('B', makeResult('b'))
      cache.set('C', makeResult('c'))
      cache.get('A')
      cache.set('D', makeResult('d'))
      expect(cache.get('B')).toBeUndefined()
      expect(cache.get('A')).toEqual(makeResult('a'))
      expect(cache.get('C')).toEqual(makeResult('c'))
      expect(cache.get('D')).toEqual(makeResult('d'))
    })

    it('should refresh an existing key without growing the map', () => {
      // Re-setting the same key replaces it in place.
      const cache = new IdempotencyCache(10, 1000, () => 0)
      cache.set('k', makeResult('a'))
      cache.set('k', makeResult('b'))
      expect(cache.size()).toBe(1)
      expect(cache.get('k')).toEqual(makeResult('b'))
    })
  })

  describe('clear / size', () => {
    it('should report the current size and clear all entries', () => {
      // size() tracks entries; clear() empties the map.
      const cache = new IdempotencyCache(10, 1000, () => 0)
      cache.set('a', makeResult('a'))
      cache.set('b', makeResult('b'))
      expect(cache.size()).toBe(2)
      cache.clear()
      expect(cache.size()).toBe(0)
    })
  })
})
