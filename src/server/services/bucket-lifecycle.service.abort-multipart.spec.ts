/**
 * @fileoverview Unit tests for `BucketLifecycleService.upsert` with rules that abort incomplete
 * multipart uploads. The S3 client is a `send` spy.
 * @layer server/services
 */
import { type LifecycleRule, type S3Client } from '@aws-sdk/client-s3'
import { BucketLifecycleService } from './bucket-lifecycle.service'
import type { LifecycleRuleInput } from '../interfaces/lifecycle-options.interface'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { applyDefaults } from '../config/apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

interface Harness {
  service: BucketLifecycleService
  send: jest.Mock
}

function makeService(
  overrides: Partial<BymaxStorageModuleOptions> = {},
  configured = true,
): Harness {
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
  return {
    service: new BucketLifecycleService(resolved, s3Provider, new KeyResolverService(resolved)),
    send,
  }
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
      Filter: {
        And: {
          Prefix: 'scratch/',
          Tags: [{ Key: 'tier', Value: 'tmp' }],
          ObjectSizeGreaterThan: 10,
        },
      },
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
  return (send.mock.calls as [{ input: Record<string, unknown> }][]).map(
    ([command]) => command.input,
  )
}

/** The `details` object of a thrown `StorageException`. */
function detailsOf(error: unknown): Record<string, unknown> {
  return (error as { getResponse(): { error: { details: Record<string, unknown> } } }).getResponse()
    .error.details
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to reject')
}

function putRules(send: jest.Mock, callIndex = 1): LifecycleRule[] {
  const put = inputs(send)[callIndex] as { LifecycleConfiguration: { Rules: LifecycleRule[] } }
  return put.LifecycleConfiguration.Rules
}

describe('BucketLifecycleService.upsert, multipart-abort rules', () => {
  const abort = { id: 'abort-stale', prefix: 'uploads/', abortIncompleteMultipartDays: 7 }

  it('writes an AbortIncompleteMultipartUpload rule and no expiration', async () => {
    const { service, send } = makeService()
    send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})

    await service.upsert(abort)

    expect(putRules(send)).toEqual([
      {
        ID: 'abort-stale',
        Status: 'Enabled',
        Filter: { Prefix: 'uploads/' },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
      },
    ])
  })

  it('keeps every other rule field for field, and replaces an expiration rule that has the same id', async () => {
    const { service, send } = makeService()
    const existing = [
      ...foreignRules(),
      { ID: 'abort-stale', Status: 'Enabled', Filter: { Prefix: 'old/' }, Expiration: { Days: 3 } },
    ]
    send.mockResolvedValueOnce({ Rules: existing }).mockResolvedValueOnce({})

    await service.upsert(abort)

    const written = putRules(send)
    expect(written.slice(0, 3)).toEqual(foreignRules())
    expect(written[3]).toEqual({
      ID: 'abort-stale',
      Status: 'Enabled',
      Filter: { Prefix: 'uploads/' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
    })
    expect(written[3]).not.toHaveProperty('Expiration')
  })

  it('preserves an existing multipart-abort rule when an expiration rule is added', async () => {
    const { service, send } = makeService()
    const stored: LifecycleRule = {
      ID: 'theirs',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
    }
    send.mockResolvedValueOnce({ Rules: [stored] }).mockResolvedValueOnce({})

    await service.upsert({ id: 'expire-tmp', prefix: 'expiring/', expirationDays: 7 })

    expect(putRules(send)[0]).toEqual(stored)
  })

  it('accepts an empty prefix, which means the whole bucket without a keyPrefix', async () => {
    // Aborting stale uploads deletes no object, so the whole-bucket form AWS documents is allowed.
    const { service, send } = makeService()
    send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})

    await service.upsert({ ...abort, prefix: '' })

    expect(putRules(send)[0]).toMatchObject({ Filter: { Prefix: '' } })
  })

  it('maps an empty prefix to the keyPrefix namespace, and prefixes a non-empty one', async () => {
    const { service, send } = makeService({ keyPrefix: 'tenant-a' })
    send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})
    await service.upsert({ ...abort, prefix: '' })
    expect(putRules(send)[0]).toMatchObject({ Filter: { Prefix: 'tenant-a/' } })

    const second = makeService({ keyPrefix: 'tenant-a' })
    second.send.mockRejectedValueOnce(noSuchLifecycle()).mockResolvedValueOnce({})
    await second.service.upsert(abort)
    expect(putRules(second.send)[0]).toMatchObject({ Filter: { Prefix: 'tenant-a/uploads/' } })
  })

  it.each([
    [
      'zero days',
      { ...abort, abortIncompleteMultipartDays: 0 },
      'abortIncompleteMultipartDays must be an integer of at least 1',
    ],
    [
      'fractional days',
      { ...abort, abortIncompleteMultipartDays: 1.5 },
      'abortIncompleteMultipartDays must be an integer of at least 1',
    ],
    [
      'string days',
      { ...abort, abortIncompleteMultipartDays: '7' as unknown as number },
      'abortIncompleteMultipartDays must be an integer of at least 1',
    ],
    [
      'a non-string prefix',
      { ...abort, prefix: 5 as unknown as string },
      'Prefix must be a string',
    ],
    [
      'both day counts',
      { ...abort, expirationDays: 3 } as unknown as LifecycleRuleInput,
      'Give exactly one of expirationDays and abortIncompleteMultipartDays',
    ],
    ['an empty id', { ...abort, id: '' }, 'Rule id must be a non-empty string'],
  ])('rejects %s before touching S3', async (_label, input, reason) => {
    const { service, send } = makeService()

    const error = await rejection(service.upsert(input))

    expect(error).toMatchObject({ code: 'STORAGE_LIFECYCLE_RULE_INVALID' })
    expect(detailsOf(error)).toEqual({ reason })
    expect(send).not.toHaveBeenCalled()
  })

  it('still rejects an expiration rule with an empty prefix and with no day count', async () => {
    const { service, send } = makeService()

    const empty = await rejection(service.upsert({ id: 'x', prefix: '', expirationDays: 7 }))
    const none = await rejection(
      service.upsert({ id: 'x', prefix: 'p/' } as unknown as LifecycleRuleInput),
    )

    expect(detailsOf(empty)).toEqual({ reason: 'Prefix must be a non-empty string' })
    expect(detailsOf(none)).toEqual({ reason: 'expirationDays must be an integer of at least 1' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses to replace an abort rule that keyPrefix does not confine', async () => {
    const { service, send } = makeService({ keyPrefix: 'tenant-a' })
    send.mockResolvedValueOnce({
      Rules: [
        {
          ID: 'abort-stale',
          Status: 'Enabled',
          Filter: { Prefix: 'tenant-b/' },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        },
      ],
    })

    const error = await rejection(service.upsert(abort))

    expect(error).toMatchObject({ code: 'STORAGE_LIFECYCLE_RULE_INVALID' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('removes an abort rule by id like any other rule', async () => {
    const { service, send } = makeService()
    send
      .mockResolvedValueOnce({
        Rules: [
          ...foreignRules(),
          {
            ID: 'abort-stale',
            Status: 'Enabled',
            Filter: { Prefix: 'uploads/' },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          },
        ],
      })
      .mockResolvedValueOnce({})

    await expect(service.remove('abort-stale')).resolves.toBe(true)

    expect(putRules(send)).toEqual(foreignRules())
  })
})
