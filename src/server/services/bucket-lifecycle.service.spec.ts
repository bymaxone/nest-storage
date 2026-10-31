/**
 * @fileoverview Unit tests for `BucketLifecycleService`: the empty read, the
 * read-modify-write of `upsert` / `remove`, the last-rule delete, byte-for-byte
 * preservation of rules the service does not own, input validation and the typed
 * provider errors. The S3 client is a `send` spy.
 * @layer server/services
 */
import {
  DeleteBucketLifecycleCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule,
  type S3Client,
} from '@aws-sdk/client-s3'
import { BucketLifecycleService } from './bucket-lifecycle.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { applyDefaults } from '../config/apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

interface Harness {
  service: BucketLifecycleService
  send: jest.Mock
}

function makeService(overrides: Partial<BymaxStorageModuleOptions> = {}, configured = true): Harness {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    ...overrides,
  })
  const send = jest.fn()
  const s3Provider = {
    isConfigured: (): boolean => configured,
    getClient: (): S3Client => ({ send }) as unknown as S3Client,
  } as unknown as S3ClientProvider
  return { service: new BucketLifecycleService(resolved, s3Provider, new KeyResolverService(resolved)), send }
}

/** Rules the service does not own: every one carries an action or filter it never writes. */
function foreignRules(): LifecycleRule[] {
  return [
    {
      ID: 'archive-reports',
      Status: 'Enabled',
      Filter: { Prefix: 'reports/' },
      Transitions: [{ Days: 30, StorageClass: 'GLACIER' }],
      Expiration: { Days: 365 },
    },
    {
      ID: 'abort-stale-uploads',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 3 },
    },
    {
      ID: 'tagged-scratch',
      Status: 'Disabled',
      Filter: { And: { Prefix: 'scratch/', Tags: [{ Key: 'tier', Value: 'tmp' }], ObjectSizeGreaterThan: 10 } },
      NoncurrentVersionExpiration: { NoncurrentDays: 5, NewerNoncurrentVersions: 2 },
    },
  ]
}

/** Makes the next S3 call return `value`, or throw it when it is an Error. */
function noSuchLifecycle(): Error {
  return Object.assign(new Error('The lifecycle configuration does not exist'), {
    name: 'NoSuchLifecycleConfiguration',
    $metadata: { httpStatusCode: 404 },
  })
}

function inputs(send: jest.Mock): Record<string, unknown>[] {
  return (send.mock.calls as [{ input: Record<string, unknown> }][]).map(([command]) => command.input)
}

function commandTypes(send: jest.Mock): unknown[] {
  return (send.mock.calls as [object][]).map(([command]) => command.constructor)
}

function putRules(send: jest.Mock, callIndex = 1): LifecycleRule[] {
  const put = inputs(send)[callIndex] as { LifecycleConfiguration: { Rules: LifecycleRule[] } }
  return put.LifecycleConfiguration.Rules
}

describe('BucketLifecycleService.get', () => {
  it('returns the rules exactly as the provider reports them', async () => {
    // The read is a passthrough; nothing is filtered, reordered or re-shaped.
    const { service, send } = makeService()
    send.mockResolvedValueOnce({ Rules: foreignRules() })
    await expect(service.get()).resolves.toEqual(foreignRules())
    expect(commandTypes(send)).toEqual([GetBucketLifecycleConfigurationCommand])
    expect(inputs(send)[0]).toEqual({ Bucket: 'test-bucket' })
  })

  it('returns an empty set when the bucket has no lifecycle configuration', async () => {
    // NoSuchLifecycleConfiguration is the documented "none yet" answer, not a failure.
    const { service, send } = makeService()
    send.mockRejectedValueOnce(noSuchLifecycle())
    await expect(service.get()).resolves.toEqual([])
  })

  it('returns an empty set when the response carries no Rules field', async () => {
    // Some providers answer 200 with an empty body for an unconfigured bucket.
    const { service, send } = makeService()
    send.mockResolvedValueOnce({})
    await expect(service.get()).resolves.toEqual([])
  })

  it('returns prefixes relative to keyPrefix so a read value round-trips through upsert without doubling', async () => {
    // list() strips keyPrefix off the keys it returns; get() does the same for filter prefixes. Writing the
    // value back must reproduce the stored prefix exactly, not 'tenant-a/tenant-a/...'.
    const { service, send } = makeService({ keyPrefix: 'tenant-a' })
    const stored: LifecycleRule = {
      ID: 'expire-tmp',
      Status: 'Enabled',
      Filter: { Prefix: 'tenant-a/expiring/' },
      Expiration: { Days: 7 },
    }
    send.mockResolvedValueOnce({ Rules: [stored] })
    const [read] = await service.get()
    expect(read).toMatchObject({ Filter: { Prefix: 'expiring/' } })
    send.mockResolvedValueOnce({ Rules: [stored] }).mockResolvedValueOnce({})
    await service.upsert({ id: 'expire-tmp', prefix: read!.Filter!.Prefix!, expirationDays: 7 })
    expect(putRules(send, 2)).toEqual([stored])
  })

  it('strips keyPrefix from the two filter prefixes this service writes and flags every rule outside it', async () => {
    // A rule not confined to keyPrefix keeps its stored prefix and carries isOutsideKeyPrefix, so a caller
    // cannot mistake its prefix for a relative one.
    const { service, send } = makeService({ keyPrefix: 'tenant-a' })
    send.mockResolvedValueOnce({
      Rules: [
        { ID: 'simple', Status: 'Enabled', Filter: { Prefix: 'tenant-a/x/' } },
        { ID: 'and', Status: 'Enabled', Filter: { And: { Prefix: 'tenant-a/y/', ObjectSizeGreaterThan: 5 } } },
        { ID: 'outside', Status: 'Enabled', Filter: { Prefix: 'tenant-b/x/' } },
        { ID: 'whole-bucket', Status: 'Enabled', Filter: { Prefix: '' } },
        { ID: 'tag-only', Status: 'Enabled', Filter: { Tag: { Key: 'k', Value: 'v' } } },
        { ID: 'no-filter', Status: 'Enabled', Prefix: 'tenant-a/z/' },
      ],
    })
    await expect(service.get()).resolves.toEqual([
      { ID: 'simple', Status: 'Enabled', Filter: { Prefix: 'x/' } },
      { ID: 'and', Status: 'Enabled', Filter: { And: { Prefix: 'y/', ObjectSizeGreaterThan: 5 } } },
      { ID: 'outside', Status: 'Enabled', Filter: { Prefix: 'tenant-b/x/' }, isOutsideKeyPrefix: true },
      { ID: 'whole-bucket', Status: 'Enabled', Filter: { Prefix: '' }, isOutsideKeyPrefix: true },
      { ID: 'tag-only', Status: 'Enabled', Filter: { Tag: { Key: 'k', Value: 'v' } }, isOutsideKeyPrefix: true },
      { ID: 'no-filter', Status: 'Enabled', Prefix: 'tenant-a/z/', isOutsideKeyPrefix: true },
    ])
  })

  it('never flags a rule when no keyPrefix is configured', async () => {
    const { service, send } = makeService()
    const bare: LifecycleRule[] = [
      { ID: 'no-filter', Status: 'Enabled' },
      { ID: 'tag-only', Status: 'Enabled', Filter: { Tag: { Key: 'k', Value: 'v' } } },
      { ID: 'and-no-prefix', Status: 'Enabled', Filter: { And: { ObjectSizeLessThan: 9 } } },
    ]
    send.mockResolvedValueOnce({ Rules: [...foreignRules(), ...bare] })
    const rules = await service.get()
    expect(rules).toEqual([...foreignRules(), ...bare])
    expect(rules.some((r) => 'isOutsideKeyPrefix' in r)).toBe(false)
  })

  it('does not alter the rules a later write sends back (the stored shape is untouched)', async () => {
    // The de-prefixed view is for callers only; upsert must write other rules with their stored prefixes.
    const { service, send } = makeService({ keyPrefix: 'tenant-a' })
    const stored: LifecycleRule = { ID: 'keep', Status: 'Enabled', Filter: { Prefix: 'tenant-a/keep/' }, Expiration: { Days: 9 } }
    send.mockResolvedValueOnce({ Rules: [stored] }).mockResolvedValueOnce({})
    await service.upsert({ id: 'new', prefix: 'n/', expirationDays: 1 })
    expect(putRules(send, 1)[0]).toEqual(stored)
  })

  it('honours a per-call bucket', async () => {
    const { service, send } = makeService()
    send.mockResolvedValueOnce({ Rules: [] })
    await service.get({ bucket: 'other' })
    expect(inputs(send)[0]).toEqual({ Bucket: 'other' })
  })

  it('throws STORAGE_BUCKET_UNDEFINED when no bucket is configured or passed', async () => {
    const { service, send } = makeService({ bucket: '' })
    await expect(service.get()).rejects.toMatchObject({ code: 'STORAGE_BUCKET_UNDEFINED' })
    expect(send).not.toHaveBeenCalled()
  })

  it('throws STORAGE_NOT_CONFIGURED without credentials', async () => {
    const { service, send } = makeService({}, false)
    await expect(service.get()).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
    expect(send).not.toHaveBeenCalled()
  })

  it('maps a provider that does not implement the API to STORAGE_LIFECYCLE_UNSUPPORTED', async () => {
    const { service, send } = makeService()
    send.mockRejectedValueOnce(
      Object.assign(new Error('not implemented'), { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } }),
    )
    await expect(service.get()).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_UNSUPPORTED', status: 501 })
  })

  it('maps any other read failure to STORAGE_PROVIDER_ERROR', async () => {
    const { service, send } = makeService()
    send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
    await expect(service.get()).rejects.toMatchObject({ code: 'STORAGE_PROVIDER_ERROR' })
  })
})

describe('BucketLifecycleService.upsert', () => {
  const rule = { id: 'expire-tmp', prefix: 'expiring/', expirationDays: 7 }

  it('writes a single rule to a bucket that had no configuration', async () => {
    const { service, send } = makeService()
    send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})
    await service.upsert(rule)
    expect(commandTypes(send)).toEqual([GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand])
    expect(inputs(send)[1]).toEqual({
      Bucket: 'test-bucket',
      LifecycleConfiguration: {
        Rules: [{ ID: 'expire-tmp', Status: 'Enabled', Filter: { Prefix: 'expiring/' }, Expiration: { Days: 7 } }],
      },
    })
  })

  it('keeps every unrelated rule field for field and appends the new one last', async () => {
    // The trap this guards: a put replaces the whole set, so anything dropped on the way back is deleted.
    const { service, send } = makeService()
    const before = foreignRules()
    send.mockResolvedValueOnce({ Rules: before }).mockResolvedValueOnce({})
    await service.upsert(rule)
    const written = putRules(send)
    expect(written.slice(0, 3)).toEqual(foreignRules())
    expect(written).toHaveLength(4)
    expect(written[3]).toMatchObject({ ID: 'expire-tmp' })
  })

  it('replaces the rule with the same id in place and leaves its neighbours alone', async () => {
    const { service, send } = makeService()
    const existing = foreignRules()
    existing.splice(1, 0, {
      ID: 'expire-tmp',
      Status: 'Disabled',
      Filter: { Prefix: 'old/' },
      Expiration: { Days: 1 },
    })
    send.mockResolvedValueOnce({ Rules: existing }).mockResolvedValueOnce({})
    await service.upsert(rule)
    const written = putRules(send)
    expect(written.map((r) => r.ID)).toEqual(['archive-reports', 'expire-tmp', 'abort-stale-uploads', 'tagged-scratch'])
    expect(written[1]).toEqual({
      ID: 'expire-tmp',
      Status: 'Enabled',
      Filter: { Prefix: 'expiring/' },
      Expiration: { Days: 7 },
    })
    expect(written[0]).toEqual(foreignRules()[0])
    expect(written[2]).toEqual(foreignRules()[1])
    expect(written[3]).toEqual(foreignRules()[2])
  })

  it('does not mutate the array the provider returned', async () => {
    const { service, send } = makeService()
    const rules = foreignRules()
    send.mockResolvedValueOnce({ Rules: rules }).mockResolvedValueOnce({})
    await service.upsert(rule)
    expect(rules).toEqual(foreignRules())
  })

  it('echoes back the default-minimum-object-size setting it read', async () => {
    // Omitting it on put would reset transition behaviour for rules this service does not own.
    const { service, send } = makeService()
    send
      .mockResolvedValueOnce({ Rules: foreignRules(), TransitionDefaultMinimumObjectSize: 'varies_by_storage_class' })
      .mockResolvedValueOnce({})
    await service.upsert(rule)
    expect(inputs(send)[1]).toMatchObject({ TransitionDefaultMinimumObjectSize: 'varies_by_storage_class' })
  })

  it('sends no default-minimum-object-size setting when the provider reported none', async () => {
    const { service, send } = makeService()
    send.mockResolvedValueOnce({ Rules: foreignRules() }).mockResolvedValueOnce({})
    await service.upsert(rule)
    expect(inputs(send)[1]).not.toHaveProperty('TransitionDefaultMinimumObjectSize')
  })

  it('applies the module keyPrefix to the rule prefix, like every other key', async () => {
    const { service, send } = makeService({ keyPrefix: 'tenant-a' })
    send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})
    await service.upsert(rule)
    expect(putRules(send)[0]).toMatchObject({ Filter: { Prefix: 'tenant-a/expiring/' } })
  })

  it('honours a per-call bucket on both calls', async () => {
    const { service, send } = makeService()
    send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})
    await service.upsert(rule, { bucket: 'other' })
    expect(inputs(send).map((i) => i.Bucket)).toEqual(['other', 'other'])
  })

  it('maps a configuration the provider refuses to STORAGE_LIFECYCLE_REJECTED', async () => {
    const { service, send } = makeService()
    send
      .mockResolvedValueOnce({ Rules: [] })
      .mockRejectedValueOnce(
        Object.assign(new Error('The XML you provided was not well-formed'), {
          name: 'MalformedXML',
          $metadata: { httpStatusCode: 400, requestId: 'req-9' },
        }),
      )
    await expect(service.upsert(rule)).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_REJECTED', status: 422 })
  })

  it('maps a write to a provider without the API to STORAGE_LIFECYCLE_UNSUPPORTED', async () => {
    const { service, send } = makeService()
    send
      .mockResolvedValueOnce({ Rules: [] })
      .mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } }))
    await expect(service.upsert(rule)).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_UNSUPPORTED' })
  })

  it('does not write anything when the read fails', async () => {
    const { service, send } = makeService()
    send.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } }))
    await expect(service.upsert(rule)).rejects.toMatchObject({ code: 'STORAGE_PROVIDER_ERROR' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('throws STORAGE_NOT_CONFIGURED before validating or calling S3', async () => {
    const { service, send } = makeService({}, false)
    await expect(service.upsert(rule)).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
    expect(send).not.toHaveBeenCalled()
  })

  it('throws STORAGE_BUCKET_UNDEFINED when no bucket is available', async () => {
    const { service, send } = makeService({ bucket: '' })
    await expect(service.upsert(rule)).rejects.toMatchObject({ code: 'STORAGE_BUCKET_UNDEFINED' })
    expect(send).not.toHaveBeenCalled()
  })

  describe('rules outside keyPrefix', () => {
    const outside: LifecycleRule = {
      ID: 'expire-tmp',
      Status: 'Enabled',
      Filter: { Prefix: 'tenant-b/expiring/' },
      Expiration: { Days: 3 },
    }

    it('refuses to replace a rule with the same id that keyPrefix does not confine, and writes nothing', async () => {
      // Otherwise a rule another application owns would be overwritten with a rule for this tenant.
      const { service, send } = makeService({ keyPrefix: 'tenant-a' })
      send.mockResolvedValueOnce({ Rules: [outside] })
      await expect(service.upsert(rule)).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_RULE_INVALID' })
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('still adds a rule with a new id and sends the outside rule back exactly as stored', async () => {
      const { service, send } = makeService({ keyPrefix: 'tenant-a' })
      send.mockResolvedValueOnce({ Rules: [{ ...outside, ID: 'theirs' }] }).mockResolvedValueOnce({})
      await service.upsert(rule)
      expect(putRules(send)[0]).toEqual({ ...outside, ID: 'theirs' })
      expect(putRules(send)[1]).toMatchObject({ ID: 'expire-tmp', Filter: { Prefix: 'tenant-a/expiring/' } })
    })
  })

  describe('input validation', () => {
    it.each([
      ['an empty id', { ...rule, id: '' }],
      ['an id longer than 255 characters', { ...rule, id: 'x'.repeat(256) }],
      ['a non-string id', { ...rule, id: 7 as unknown as string }],
      ['an empty prefix', { ...rule, prefix: '' }],
      ['a non-string prefix', { ...rule, prefix: 12 as unknown as string }],
      ['zero days', { ...rule, expirationDays: 0 }],
      ['negative days', { ...rule, expirationDays: -3 }],
      ['fractional days', { ...rule, expirationDays: 1.5 }],
      ['NaN days', { ...rule, expirationDays: Number.NaN }],
      ['Infinity days', { ...rule, expirationDays: Number.POSITIVE_INFINITY }],
      ['string days', { ...rule, expirationDays: '7' as unknown as number }],
    ])('rejects %s with STORAGE_LIFECYCLE_RULE_INVALID before touching S3', async (_label, input) => {
      const { service, send } = makeService()
      await expect(service.upsert(input)).rejects.toMatchObject({
        code: 'STORAGE_LIFECYCLE_RULE_INVALID',
        status: 400,
      })
      expect(send).not.toHaveBeenCalled()
    })

    it('accepts a 255-character id and a one-day expiration', async () => {
      // The inclusive boundaries of both limits.
      const { service, send } = makeService()
      send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})
      await service.upsert({ id: 'x'.repeat(255), prefix: 'p/', expirationDays: 1 })
      expect(putRules(send)[0]).toMatchObject({ ID: 'x'.repeat(255), Expiration: { Days: 1 } })
    })

    it.each([
      ['a leading slash', '/expiring/'],
      ['a parent segment', '../expiring/'],
      ['a null byte', 'exp\0iring/'],
    ])('runs the prefix through the key guard and rejects %s', async (_label, prefix) => {
      const { service, send } = makeService()
      await expect(service.upsert({ ...rule, prefix })).rejects.toMatchObject({ code: 'STORAGE_KEY_INVALID' })
      expect(send).not.toHaveBeenCalled()
    })
  })
})

describe('BucketLifecycleService.remove', () => {
  it('removes only the rule with that id and keeps the rest field for field', async () => {
    const { service, send } = makeService()
    const withOwned = [...foreignRules(), { ID: 'expire-tmp', Status: 'Enabled', Filter: { Prefix: 'expiring/' }, Expiration: { Days: 7 } }]
    send.mockResolvedValueOnce({ Rules: withOwned }).mockResolvedValueOnce({})
    await expect(service.remove('expire-tmp')).resolves.toBe(true)
    expect(commandTypes(send)).toEqual([GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand])
    expect(putRules(send)).toEqual(foreignRules())
  })

  it('deletes the configuration instead of putting an empty rule set when the last rule goes', async () => {
    // PutBucketLifecycleConfiguration with zero rules is invalid; DeleteBucketLifecycle is the only way to end up empty.
    const { service, send } = makeService()
    send
      .mockResolvedValueOnce({ Rules: [{ ID: 'expire-tmp', Status: 'Enabled', Filter: { Prefix: 'expiring/' }, Expiration: { Days: 7 } }] })
      .mockResolvedValueOnce({})
    await expect(service.remove('expire-tmp')).resolves.toBe(true)
    expect(commandTypes(send)).toEqual([GetBucketLifecycleConfigurationCommand, DeleteBucketLifecycleCommand])
    expect(inputs(send)[1]).toEqual({ Bucket: 'test-bucket' })
  })

  it('refuses to remove a rule that keyPrefix does not confine, and writes nothing', async () => {
    const { service, send } = makeService({ keyPrefix: 'tenant-a' })
    send.mockResolvedValueOnce({
      Rules: [{ ID: 'theirs', Status: 'Enabled', Filter: { Prefix: 'tenant-b/' }, Expiration: { Days: 3 } }],
    })
    await expect(service.remove('theirs')).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_RULE_INVALID' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('changes nothing and reports false for an unknown id', async () => {
    const { service, send } = makeService()
    send.mockResolvedValueOnce({ Rules: foreignRules() })
    await expect(service.remove('missing')).resolves.toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports false on a bucket with no configuration, without writing', async () => {
    const { service, send } = makeService()
    send.mockRejectedValueOnce(noSuchLifecycle())
    await expect(service.remove('expire-tmp')).resolves.toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('echoes back the default-minimum-object-size setting on the put', async () => {
    const { service, send } = makeService()
    send
      .mockResolvedValueOnce({ Rules: [...foreignRules(), { ID: 'gone', Status: 'Enabled', Filter: { Prefix: 'g/' }, Expiration: { Days: 2 } }], TransitionDefaultMinimumObjectSize: 'all_storage_classes_128K' })
      .mockResolvedValueOnce({})
    await service.remove('gone')
    expect(inputs(send)[1]).toMatchObject({ TransitionDefaultMinimumObjectSize: 'all_storage_classes_128K' })
  })

  it('maps a failed delete to a typed error', async () => {
    const { service, send } = makeService()
    send
      .mockResolvedValueOnce({ Rules: [{ ID: 'only', Status: 'Enabled', Filter: { Prefix: 'o/' }, Expiration: { Days: 2 } }] })
      .mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'MethodNotAllowed', $metadata: { httpStatusCode: 405 } }))
    await expect(service.remove('only')).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_UNSUPPORTED' })
  })

  it('honours a per-call bucket', async () => {
    const { service, send } = makeService()
    send.mockResolvedValueOnce({ Rules: [{ ID: 'a', Status: 'Enabled' }] }).mockResolvedValueOnce({})
    await service.remove('a', { bucket: 'other' })
    expect(inputs(send).map((i) => i.Bucket)).toEqual(['other', 'other'])
  })

  it.each([
    ['an empty id', ''],
    ['a non-string id', 5 as unknown as string],
    ['an id longer than 255 characters', 'x'.repeat(256)],
  ])('rejects %s with STORAGE_LIFECYCLE_RULE_INVALID before touching S3', async (_label, id) => {
    const { service, send } = makeService()
    await expect(service.remove(id)).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_RULE_INVALID' })
    expect(send).not.toHaveBeenCalled()
  })

  it('throws STORAGE_NOT_CONFIGURED without credentials', async () => {
    const { service, send } = makeService({}, false)
    await expect(service.remove('a')).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
    expect(send).not.toHaveBeenCalled()
  })
})
