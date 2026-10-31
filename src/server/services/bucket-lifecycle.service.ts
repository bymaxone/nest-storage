/**
 * @fileoverview Bucket lifecycle configuration: read the rules, upsert or remove
 * one expiration or multipart-abort rule by id, and leave every other rule exactly as the provider
 * returned it. S3 replaces the whole configuration on every write, so each
 * change is a read-modify-write.
 * @layer server/services
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  DeleteBucketLifecycleCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type TransitionDefaultMinimumObjectSize,
} from '@aws-sdk/client-s3'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type {
  BucketLifecycleRule,
  BucketLifecycleRuleView,
  LifecycleBucketOptions,
  LifecycleRuleInput,
} from '../interfaces/lifecycle-options.interface'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { StorageException } from '../errors/storage-exception'
import { isNoLifecycleConfiguration, mapLifecycleError } from '../errors/lifecycle-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * The rule-level `Prefix` that AWS deprecated in favour of `Filter`, read by key so the
 * deprecated declaration is not referenced. Rules written before `Filter` existed still carry it.
 */
const LEGACY_PREFIX_KEY = 'Prefix' as string

function legacyPrefix(rule: BucketLifecycleRule): string | undefined {
  const value: unknown = new Map(Object.entries(rule)).get(LEGACY_PREFIX_KEY)
  return typeof value === 'string' ? value : undefined
}

/** The AWS limit on a lifecycle rule id (`LifecycleRule.ID`). */
const MAX_RULE_ID_LENGTH = 255

/** What one read of the bucket returns: the rules and the setting a write must echo back. */
interface LifecycleSnapshot {
  rules: BucketLifecycleRule[]
  transitionDefaultMinimumObjectSize: TransitionDefaultMinimumObjectSize | undefined
}

function ruleInvalid(reason: string): StorageException {
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_LIFECYCLE_RULE_INVALID, undefined, {
    reason,
  })
}

/** A day count must be a positive integer, whichever rule it belongs to. */
function assertDays(field: string, value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw ruleInvalid(`${field} must be an integer of at least 1`)
  }
}

/**
 * Manages the bucket's lifecycle configuration without disturbing rules it did
 * not write.
 *
 * Concurrency: `upsert` and `remove` read the configuration, change it in memory
 * and write all of it back. S3 has no conditional write for lifecycle
 * configuration, so another writer that changes the bucket between the read and
 * the write is overwritten. Serialize lifecycle changes in the caller (one
 * operator command, or a single deployment step) rather than relying on this
 * service to lock.
 */
@Injectable()
export class BucketLifecycleService {
  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    // Explicit token injection: the published bundle carries no decorator metadata.
    @Inject(S3ClientProvider) private readonly s3Provider: S3ClientProvider,
    @Inject(KeyResolverService) private readonly keyResolver: KeyResolverService,
  ) {}

  /**
   * Returns the bucket's lifecycle rules. A bucket with no lifecycle configuration
   * yields an empty array. Key prefixes inside the module's `keyPrefix` come back
   * relative to it, as `list()` returns keys, so a prefix read here can be passed
   * straight to `upsert()` without being prefixed twice. A rule that is not confined
   * to `keyPrefix` is returned exactly as stored, flagged `isOutsideKeyPrefix: true`;
   * everything else about a rule is returned as the provider stores it.
   *
   * @param options - Optional per-call bucket override.
   * @returns Every rule in the bucket.
   * @throws StorageException for missing configuration, an unsupported provider, or a provider error.
   */
  async get(options?: LifecycleBucketOptions): Promise<BucketLifecycleRuleView[]> {
    this.assertConfigured()
    const bucket = this.resolveBucket(options?.bucket)
    return (await this.read(bucket)).rules.map((rule) => this.toView(rule))
  }

  /**
   * Adds the expiration or multipart-abort rule, or replaces the rule with the same id, and writes
   * the full set back. Rules with other ids are sent exactly as they were read.
   *
   * @param rule - The rule id, key prefix and either `expirationDays` or `abortIncompleteMultipartDays`.
   * @param options - Optional per-call bucket override.
   * @throws StorageException `STORAGE_LIFECYCLE_RULE_INVALID` for a bad id, prefix or day count, or an id
   *   that names a rule outside `keyPrefix`;
   *   `STORAGE_LIFECYCLE_UNSUPPORTED` / `STORAGE_LIFECYCLE_REJECTED` from the provider.
   * @example
   *   await lifecycle.upsert({ id: 'expire-tmp', prefix: 'expiring/', expirationDays: 7 })
   */
  async upsert(rule: LifecycleRuleInput, options?: LifecycleBucketOptions): Promise<void> {
    this.assertConfigured()
    const owned = this.toRule(rule)
    const bucket = this.resolveBucket(options?.bucket)
    const snapshot = await this.read(bucket)
    const index = snapshot.rules.findIndex((existing) => existing.ID === owned.ID)
    this.assertOwnable(snapshot.rules[index])
    const rules = [...snapshot.rules]
    if (index === -1) {
      rules.push(owned)
    } else {
      rules[index] = owned
    }
    await this.write(bucket, rules, snapshot, 'upsert')
  }

  /**
   * Removes the rule with this id. When it was the last rule the configuration is
   * deleted, because S3 rejects a write with no rules. An unknown id changes nothing.
   *
   * @param id - The rule id.
   * @param options - Optional per-call bucket override.
   * @returns `true` when a rule was removed, `false` when no rule had that id.
   * @throws StorageException `STORAGE_LIFECYCLE_RULE_INVALID` for a bad id or an id that names a rule
   *   outside `keyPrefix`; a provider failure otherwise.
   */
  async remove(id: string, options?: LifecycleBucketOptions): Promise<boolean> {
    this.assertConfigured()
    this.assertRuleId(id)
    const bucket = this.resolveBucket(options?.bucket)
    const snapshot = await this.read(bucket)
    const target = snapshot.rules.find((existing) => existing.ID === id)
    if (target === undefined) {
      return false
    }
    this.assertOwnable(target)
    const rules = snapshot.rules.filter((existing) => existing.ID !== id)
    await this.write(bucket, rules, snapshot, 'remove')
    return true
  }

  /**
   * Whether the rule is confined to this module's `keyPrefix`: its filter prefix starts
   * with it. Without a `keyPrefix` every rule is in scope. A rule with no prefix at all
   * (tag-only, or the whole bucket) reaches beyond the namespace, so it is not confined.
   */
  private isWithinKeyPrefix(rule: BucketLifecycleRule): boolean {
    const keyPrefix = this.keyResolver.getPrefix()
    if (keyPrefix === '') {
      return true
    }
    const prefix = rule.Filter?.Prefix ?? rule.Filter?.And?.Prefix ?? legacyPrefix(rule)
    return prefix?.startsWith(keyPrefix) === true
  }

  /** The caller's view of a rule: prefixes relative to `keyPrefix`, or as stored and flagged when outside it. */
  private toView(rule: BucketLifecycleRule): BucketLifecycleRuleView {
    if (this.isWithinKeyPrefix(rule)) {
      return this.stripRulePrefixes(rule)
    }
    return { ...rule, isOutsideKeyPrefix: true }
  }

  /** Refuses to replace or remove a rule this module's `keyPrefix` does not confine. */
  private assertOwnable(existing: BucketLifecycleRule | undefined): void {
    if (existing === undefined) {
      return
    }
    if (!this.isWithinKeyPrefix(existing)) {
      throw ruleInvalid('A rule with this id exists outside the module keyPrefix and is not changed')
    }
  }

  /**
   * Returns a copy of the rule with `keyPrefix` removed from each filter prefix that
   * carries it (`Filter.Prefix`, `Filter.And.Prefix` and the deprecated rule-level
   * `Prefix`). Prefixes outside the namespace are left alone. The stored rule is never touched.
   */
  private stripRulePrefixes(rule: BucketLifecycleRule): BucketLifecycleRule {
    const strip = (prefix: string): string => this.keyResolver.stripPrefix(prefix)
    const { Filter: filter, ...rest } = rule
    const legacy = legacyPrefix(rule)
    return {
      ...rest,
      ...(legacy !== undefined ? { [LEGACY_PREFIX_KEY]: strip(legacy) } : {}),
      ...(filter !== undefined
        ? {
            Filter: {
              ...filter,
              ...(filter.Prefix !== undefined ? { Prefix: strip(filter.Prefix) } : {}),
              ...(filter.And?.Prefix !== undefined
                ? { And: { ...filter.And, Prefix: strip(filter.And.Prefix) } }
                : {}),
            },
          }
        : {}),
    }
  }

  /** Reads the configuration; "none yet" is an empty snapshot. */
  private async read(bucket: string): Promise<LifecycleSnapshot> {
    try {
      const response = await this.s3Provider
        .getClient()
        .send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))
      return {
        rules: response.Rules ?? [],
        transitionDefaultMinimumObjectSize: response.TransitionDefaultMinimumObjectSize,
      }
    } catch (err) {
      if (isNoLifecycleConfiguration(err)) {
        return { rules: [], transitionDefaultMinimumObjectSize: undefined }
      }
      throw mapLifecycleError(err, { bucket, op: 'lifecycle.get' })
    }
  }

  /**
   * Writes the rule set. An empty set is a `DeleteBucketLifecycle`, since S3
   * requires at least one rule on a put. The default-minimum-object-size setting
   * read earlier is sent back so a write does not silently change transition behaviour.
   */
  private async write(
    bucket: string,
    rules: BucketLifecycleRule[],
    snapshot: LifecycleSnapshot,
    op: 'upsert' | 'remove',
  ): Promise<void> {
    const client = this.s3Provider.getClient()
    try {
      if (rules.length === 0) {
        await client.send(new DeleteBucketLifecycleCommand({ Bucket: bucket }))
        return
      }
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: { Rules: rules },
          ...(snapshot.transitionDefaultMinimumObjectSize !== undefined
            ? { TransitionDefaultMinimumObjectSize: snapshot.transitionDefaultMinimumObjectSize }
            : {}),
        }),
      )
    } catch (err) {
      throw mapLifecycleError(err, { bucket, op: `lifecycle.${op}` })
    }
  }

  /** Validates the input and builds the rule, an expiration or a multipart-abort rule. */
  private toRule(rule: LifecycleRuleInput): BucketLifecycleRule {
    this.assertRuleId(rule.id)
    if (rule.abortIncompleteMultipartDays !== undefined) {
      assertDays('abortIncompleteMultipartDays', rule.abortIncompleteMultipartDays)
      // Untyped callers can pass both; the types already forbid it.
      if ((rule as { expirationDays?: unknown }).expirationDays !== undefined) {
        throw ruleInvalid('Give exactly one of expirationDays and abortIncompleteMultipartDays')
      }
      if (typeof rule.prefix !== 'string') {
        throw ruleInvalid('Prefix must be a string')
      }
      // An empty abort prefix is the module's whole namespace (aborting a stale upload deletes
      // no object); the key guard itself needs a non-empty key.
      const prefix = rule.prefix === '' ? this.keyResolver.getPrefix() : this.keyResolver.normalize(rule.prefix)
      return {
        ID: rule.id,
        Status: 'Enabled',
        Filter: { Prefix: prefix },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: rule.abortIncompleteMultipartDays },
      }
    }
    if (typeof rule.prefix !== 'string' || rule.prefix.length === 0) {
      throw ruleInvalid('Prefix must be a non-empty string')
    }
    assertDays('expirationDays', rule.expirationDays)
    return {
      ID: rule.id,
      Status: 'Enabled',
      Filter: { Prefix: this.keyResolver.normalize(rule.prefix) },
      Expiration: { Days: rule.expirationDays },
    }
  }

  private assertRuleId(id: unknown): void {
    if (typeof id !== 'string' || id.length === 0) {
      throw ruleInvalid('Rule id must be a non-empty string')
    }
    if (id.length > MAX_RULE_ID_LENGTH) {
      throw ruleInvalid(`Rule id must be at most ${String(MAX_RULE_ID_LENGTH)} characters`)
    }
  }

  private assertConfigured(): void {
    if (!this.s3Provider.isConfigured()) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED)
    }
  }

  private resolveBucket(perCall?: string): string {
    const bucket = perCall ?? this.options.bucket
    if (!bucket) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED)
    }
    return bucket
  }
}
