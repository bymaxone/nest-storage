/**
 * @fileoverview Public contracts for `BucketLifecycleService`: the rule shape
 * the library owns, the per-call bucket override, and the provider rule type.
 * @layer server/interfaces
 */
import type { LifecycleRule } from '@aws-sdk/client-s3'

/**
 * A lifecycle rule exactly as the provider stores it. Reads return every rule in
 * the bucket, including ones this library did not write (transitions, tag
 * filters, multipart aborts), and writes send them back unchanged.
 */
export type BucketLifecycleRule = LifecycleRule

/**
 * A rule as `get()` returns it. `isOutsideKeyPrefix` is set (to `true`) only on a rule
 * that is not confined to the module's `keyPrefix` — written by another application, or
 * by hand — and `upsert()` / `remove()` refuse to change such a rule.
 */
export type BucketLifecycleRuleView = BucketLifecycleRule & { isOutsideKeyPrefix?: true }

/** Per-call override of the target bucket. */
export interface LifecycleBucketOptions {
  /** Defaults to the module's configured bucket. */
  bucket?: string
}

/** A rule `BucketLifecycleService.upsert()` writes: expire a prefix after N days. */
export interface ExpirationRuleInput {
  /** Unique rule id, 1 to 255 characters (the AWS limit). */
  id: string
  /** Key prefix the rule applies to. Relative to the module's `keyPrefix`, like every other key. */
  prefix: string
  /** Days after creation until an object under the prefix expires. A positive integer. */
  expirationDays: number
  /** A rule is an expiration or an abort rule, never both. */
  abortIncompleteMultipartDays?: never
}

/**
 * A rule `BucketLifecycleService.upsert()` writes: abort multipart uploads that were not completed
 * within N days of starting, which frees the parts they hold.
 */
export interface AbortMultipartRuleInput {
  /** Unique rule id, 1 to 255 characters (the AWS limit). */
  id: string
  /**
   * Key prefix the rule applies to, relative to the module's `keyPrefix`. May be empty, which means
   * every upload in the module's namespace: unlike expiration, aborting a stale upload deletes no object.
   */
  prefix: string
  /** Days after an upload starts until it is aborted. A positive integer. */
  abortIncompleteMultipartDays: number
  /** A rule is an expiration or an abort rule, never both. */
  expirationDays?: never
}

/** Either rule shape `BucketLifecycleService.upsert()` accepts. */
export type LifecycleRuleInput = ExpirationRuleInput | AbortMultipartRuleInput
