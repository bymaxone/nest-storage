/**
 * @fileoverview End-to-end bucket lifecycle suite against a live MinIO-compatible
 * container: an empty read, applying a rule once, keeping an unrelated rule
 * (including one with a tag filter) through every change, replacing a rule by
 * id, and ending with the configuration deleted when the last rule is removed.
 * @layer test/e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { PutBucketLifecycleConfigurationCommand, type S3Client } from '@aws-sdk/client-s3'
import {
  BYMAX_STORAGE_S3_CLIENT,
  BucketLifecycleService,
  providerRecipes,
  BymaxStorageModule,
} from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — bucket lifecycle', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let lifecycle: BucketLifecycleService
  let rawClient: S3Client

  beforeAll(async () => {
    minio = await startMinio()
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot(
          providerRecipes.minio({
            endpoint: minio.endpoint,
            bucket: minio.bucket,
            accessKeyId: minio.accessKeyId,
            secretAccessKey: minio.secretAccessKey,
          }),
        ),
      ],
    }).compile()
    await moduleRef.init()
    lifecycle = moduleRef.get(BucketLifecycleService)
    rawClient = moduleRef.get<S3Client>(BYMAX_STORAGE_S3_CLIENT)
  }, 60_000)

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('reads an empty set from a bucket with no lifecycle configuration', async () => {
    // NoSuchLifecycleConfiguration from the real server is an empty set, not an error.
    await expect(lifecycle.get()).resolves.toEqual([])
  })

  it('applies the rule once and keeps unrelated rules through upsert and remove', async () => {
    // Seed two rules this library did not write, one of them filtered by tag, through the raw client.
    await rawClient.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: minio.bucket,
        LifecycleConfiguration: {
          Rules: [
            { ID: 'keep-reports', Status: 'Enabled', Filter: { Prefix: 'reports/' }, Expiration: { Days: 365 } },
            {
              ID: 'keep-tagged',
              Status: 'Enabled',
              Filter: { Tag: { Key: 'tier', Value: 'tmp' } },
              Expiration: { Days: 30 },
            },
          ],
        },
      }),
    )
    const seeded = await lifecycle.get()
    expect(seeded.map((r) => r.ID).sort()).toEqual(['keep-reports', 'keep-tagged'])

    // Apply the owned rule twice: the second call replaces, never duplicates.
    const owned = { id: 'expire-tmp', prefix: 'expiring/', expirationDays: 7 }
    await lifecycle.upsert(owned)
    await lifecycle.upsert(owned)
    const afterUpsert = await lifecycle.get()
    expect(afterUpsert.map((r) => r.ID).sort()).toEqual(['expire-tmp', 'keep-reports', 'keep-tagged'])
    for (const rule of seeded) {
      expect(afterUpsert.find((r) => r.ID === rule.ID)).toEqual(rule)
    }
    expect(afterUpsert.find((r) => r.ID === 'expire-tmp')).toMatchObject({
      Status: 'Enabled',
      Expiration: { Days: 7 },
    })

    // Changing the days replaces the same rule.
    await lifecycle.upsert({ ...owned, expirationDays: 14 })
    const changed = (await lifecycle.get()).find((r) => r.ID === 'expire-tmp')
    expect(changed).toMatchObject({ Expiration: { Days: 14 } })

    // Remove only the owned rule; the two unrelated ones are unchanged.
    await expect(lifecycle.remove('expire-tmp')).resolves.toBe(true)
    const afterRemove = await lifecycle.get()
    expect(afterRemove).toEqual(seeded)
    await expect(lifecycle.remove('expire-tmp')).resolves.toBe(false)
  })

  it('deletes the configuration when the last rule is removed', async () => {
    // Remove the two seeded rules through the service: the final removal must be a delete, not an empty put.
    await expect(lifecycle.remove('keep-reports')).resolves.toBe(true)
    await expect(lifecycle.remove('keep-tagged')).resolves.toBe(true)
    await expect(lifecycle.get()).resolves.toEqual([])
  })

  it('answers a multipart-abort rule with the typed rejection MinIO documents, and changes nothing', async () => {
    // MinIO does not accept AbortIncompleteMultipartUpload through PutBucketLifecycleConfiguration;
    // the rule reaches the server, which refuses it, and the rules already there stay as they were.
    await lifecycle.upsert({ id: 'expire-kept', prefix: 'expiring/', expirationDays: 5 })
    const before = await lifecycle.get()

    const error: unknown = await lifecycle
      .upsert({ id: 'abort-stale', prefix: 'uploads/', abortIncompleteMultipartDays: 7 })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_LIFECYCLE_REJECTED', status: 422 })
    expect(JSON.stringify((error as { getResponse(): unknown }).getResponse())).toContain('InvalidArgument')
    await expect(lifecycle.get()).resolves.toEqual(before)
    await lifecycle.remove('expire-kept')
  })

  it('rejects an invalid rule before reaching the server', async () => {
    await expect(
      lifecycle.upsert({ id: 'bad', prefix: 'p/', expirationDays: 0 }),
    ).rejects.toMatchObject({ code: 'STORAGE_LIFECYCLE_RULE_INVALID' })
  })
})
