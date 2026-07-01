/**
 * @fileoverview In-memory LRU + TTL cache that deduplicates uploads keyed by a
 * caller-provided idempotency key. Hand-rolled on a `Map` (insertion order is
 * the LRU backbone) so the package keeps zero runtime dependencies.
 * @layer server/utils
 */
import { createHash } from 'node:crypto'
import type { UploadResult } from '../../shared/types/storage-types'

/** A cached upload result with its absolute expiry instant. */
interface CacheEntry {
  value: UploadResult
  /** Epoch milliseconds at which the entry is considered expired. */
  expiresAt: number
}

/**
 * In-memory LRU cache for idempotent upload deduplication.
 *
 * A `Map` preserves insertion order, which is the basis of the LRU: a hit
 * deletes-and-reinserts the entry (moving it to the newest position) and
 * eviction removes the oldest insertion (the first key in iteration order).
 *
 * Trade-off: the cache is per-instance. In multi-replica deployments two pods
 * may double-upload the same idempotency key within the TTL window because they
 * do not share state. A cross-instance store is intentionally out of scope for
 * this version.
 */
export class IdempotencyCache {
  private readonly entries = new Map<string, CacheEntry>()

  /**
   * @param maxEntries - Hard cap; the oldest entries are evicted beyond it.
   * @param ttlMs - Lifetime of each entry in milliseconds.
   * @param now - Injectable clock for deterministic tests; defaults to `Date.now`.
   */
  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Derives a deterministic cache key by hashing the idempotency key together
   * with the final object key. Hashing avoids storing the raw idempotency key as
   * a `Map` key, where it could be inspected during debugging.
   *
   * The two components are hashed through a structured JSON encoding so their
   * boundary is unambiguous: without it, pairs such as `('a', 'b:c')` and
   * `('a:b', 'c')` would flatten to the same preimage and collide.
   *
   * @param idempotencyKey - The caller-provided idempotency key.
   * @param finalKey - The normalized, prefixed object key.
   * @returns A hex-encoded sha256 digest.
   */
  computeKey(idempotencyKey: string, finalKey: string): string {
    const preimage = JSON.stringify([idempotencyKey, finalKey])
    return createHash('sha256').update(preimage).digest('hex')
  }

  /**
   * Looks up a cached result. Expired entries are dropped and reported as a miss.
   * A live hit is touched (moved to the newest position) to preserve LRU order.
   *
   * @param cacheKey - The key returned by {@link computeKey}.
   * @returns The cached result, or `undefined` on a miss or expiry.
   */
  get(cacheKey: string): UploadResult | undefined {
    const entry = this.entries.get(cacheKey)
    if (entry === undefined) {
      return undefined
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(cacheKey)
      return undefined
    }
    // LRU touch — re-insert to move the entry to the newest position.
    this.entries.delete(cacheKey)
    this.entries.set(cacheKey, entry)
    return entry.value
  }

  /**
   * Stores a result under `cacheKey`, refreshing its position, then evicts the
   * oldest entries while the cache is over capacity.
   *
   * @param cacheKey - The key returned by {@link computeKey}.
   * @param value - The upload result to cache.
   */
  set(cacheKey: string, value: UploadResult): void {
    this.entries.delete(cacheKey)
    this.entries.set(cacheKey, { value, expiresAt: this.now() + this.ttlMs })

    // Evict oldest-first while over capacity. The first key in iteration order
    // is the oldest insertion; a single-step loop reads it without an
    // iterator-undefined cast.
    while (this.entries.size > this.maxEntries) {
      for (const oldestKey of this.entries.keys()) {
        this.entries.delete(oldestKey)
        break
      }
    }
  }

  /**
   * Reports the current number of cached entries.
   *
   * @returns The entry count.
   */
  size(): number {
    return this.entries.size
  }

  /** Removes every cached entry. */
  clear(): void {
    this.entries.clear()
  }
}
