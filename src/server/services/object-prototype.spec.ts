/**
 * @fileoverview A key planted on `Object.prototype` is found by an ordinary read of any plain object that lacks
 * it. None of the module options, and none of the fields of an upload, a presigned upload or a multipart upload,
 * may come from there: the ACL that is sent, the bucket that is written to and the options that are resolved are
 * the ones the caller and the module configuration set.
 * @layer server/services
 */
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }))

import type {
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Test } from '@nestjs/testing'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { BucketLifecycleService } from './bucket-lifecycle.service'
import { SignedUrlService } from './signed-url.service'
import { StorageService } from './storage.service'

const BASE = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'configured-bucket',
  credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
}

function plant(values: Record<string, unknown>): () => void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(Object.prototype, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    })
  }
  return () => {
    for (const key of Object.keys(values)) Reflect.deleteProperty(Object.prototype, key)
  }
}

async function resolve(options: Record<string, unknown>): Promise<ResolvedBymaxStorageOptions> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxStorageModule.forRoot(options as unknown as BymaxStorageModuleOptions)],
  })
    // The client provider refuses a planted root before it builds a client; this spec reads the resolved options.
    .overrideProvider(S3ClientProvider)
    .useValue({ isConfigured: () => true, getClient: () => ({}), getClientOrNull: () => null })
    .compile()
  return moduleRef.get<ResolvedBymaxStorageOptions>(BYMAX_STORAGE_OPTIONS)
}

async function services(extra: Record<string, unknown> = {}): Promise<{
  storage: StorageService
  signed: SignedUrlService
  lifecycle: BucketLifecycleService
  send: jest.Mock<Promise<unknown>, [unknown]>
}> {
  const send = jest
    .fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({ ETag: '"e"', UploadId: 'u' })
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxStorageModule.forRoot({ ...BASE, ...extra })],
  })
    .overrideProvider(S3ClientProvider)
    .useValue({
      isConfigured: () => true,
      getClient: () => ({ send }) as unknown as S3Client,
      getClientOrNull: () => null,
    })
    .compile()
  return {
    storage: moduleRef.get(StorageService),
    signed: moduleRef.get(SignedUrlService),
    lifecycle: moduleRef.get(BucketLifecycleService),
    send,
  }
}

describe('a key planted on Object.prototype', () => {
  let unplant: () => void = () => undefined

  beforeEach(() => {
    jest.mocked(getSignedUrl).mockResolvedValue('https://s3.example.com/x?X-Amz-Signature=s')
  })

  afterEach(() => {
    unplant()
    unplant = () => undefined
  })

  describe('as a module option', () => {
    it('does not turn on defaultPublicRead', async () => {
      unplant = plant({ defaultPublicRead: true })

      expect((await resolve(BASE)).defaultPublicRead).toBe(false)
    })

    it('does not supply a validation group that allows every type and any size', async () => {
      unplant = plant({ validation: { mimeWhitelist: ['*/*'], maxSizeBytes: 1e12 } })

      const resolved = await resolve(BASE)

      // Own keys only: reading `resolved.validation` would itself find the planted value.
      expect(Object.hasOwn(resolved, 'validation')).toBe(false)
    })

    it.each([
      ['mimeWhitelist', ['*/*']],
      ['maxSizeBytes', 1e15],
    ])('does not supply %s to a validation group that does not set it', async (key, value) => {
      unplant = plant({ [key]: value })

      const resolved = await resolve({ ...BASE, validation: { customValidators: [] } })

      expect(Object.keys(resolved.validation ?? {})).toStrictEqual(['customValidators'])
      expect(Object.hasOwn(resolved.validation ?? {}, key)).toBe(false)
    })

    it('does not supply a bucket', async () => {
      unplant = plant({ bucket: 'evil-bucket' })
      const { bucket: _omitted, ...withoutBucket } = BASE

      await expect(resolve(withoutBucket)).rejects.toThrow()
    })

    it('does not supply credentials', async () => {
      unplant = plant({ credentials: { accessKeyId: 'EVIL', secretAccessKey: 'EVIL' } })
      const { credentials: _omitted, ...withoutCredentials } = BASE

      await expect(resolve(withoutCredentials)).rejects.toThrow()
    })

    it.each(['accessKeyId', 'secretAccessKey'])(
      'does not supply %s to the credentials',
      async (key) => {
        unplant = plant({ [key]: 'EVIL' })

        const resolved = await resolve({ ...BASE, credentials: {} })

        expect(resolved.hasCredentials).toBe(false)
        expect(resolved.credentials.accessKeyId).not.toBe('EVIL')
        expect(resolved.credentials.secretAccessKey).not.toBe('EVIL')
      },
    )

    it('does not apply a planted validation key to a group that does not set it, in the services', async () => {
      // `maxSizeBytes: 1` would refuse every upload; `mimeWhitelist: ['image/png']` every type but one.
      unplant = plant({ maxSizeBytes: 1, mimeWhitelist: ['image/png'] })
      const { storage, send } = await services({ validation: { customValidators: [] } })

      await storage.upload({
        key: 'a',
        body: Buffer.from('twelve bytes'),
        contentType: 'text/plain',
      })

      expect(send).toHaveBeenCalledTimes(1)
    })

    it('does not apply a planted scanner, cdnBaseUrl or encryption key to options that do not set them', async () => {
      const scan = jest.fn().mockResolvedValue({ status: 'clean' })
      unplant = plant({
        scanner: { impl: { scan } },
        cdnBaseUrl: 'https://evil.example',
        serverSideEncryption: 'aws:kms',
        kmsKeyId: 'evil-key',
      })
      const { storage, send } = await services()

      await storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' })

      const input = (send.mock.calls[0]?.[0] as PutObjectCommand).input
      expect(scan).not.toHaveBeenCalled()
      expect(input.ServerSideEncryption).toBeUndefined()
      expect(input.SSEKMSKeyId).toBeUndefined()
      expect(storage.getPublicUrl('a')).not.toContain('evil.example')
    })

    it('does not mark storage configured on credential keys that only the prototype supplies', async () => {
      unplant = plant({ accessKeyId: 'EVIL', secretAccessKey: 'EVIL' })

      const resolved = await resolve({ ...BASE, credentials: {} })

      expect(resolved.hasCredentials).toBe(false)
    })

    it('still reads an option a class instance supplies on its own prototype', async () => {
      class Configured {
        get bucket(): string {
          return ['from', 'class'].join('-')
        }
        readonly endpoint = BASE.endpoint
        readonly region = BASE.region
        readonly credentials = BASE.credentials
      }

      expect((await resolve(new Configured() as unknown as Record<string, unknown>)).bucket).toBe(
        'from-class',
      )
    })
  })

  describe('as a field of a request', () => {
    it('does not publish an upload', async () => {
      unplant = plant({ publicRead: true })
      const { storage, send } = await services()

      await storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' })

      const input = (send.mock.calls[0]?.[0] as PutObjectCommand).input
      expect(input.ACL).toBeUndefined()
    })

    it('does not move an upload to another bucket', async () => {
      unplant = plant({ bucket: 'evil-bucket' })
      const { storage, send } = await services()

      await storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' })

      expect((send.mock.calls[0]?.[0] as PutObjectCommand).input.Bucket).toBe('configured-bucket')
    })

    it('does not publish, or move, a presigned upload', async () => {
      unplant = plant({ publicRead: true, bucket: 'evil-bucket' })
      const { signed } = await services()

      await signed.getUploadUrl({ key: 'a', contentType: 'text/plain' })

      const input = (jest.mocked(getSignedUrl).mock.calls[0]?.[1] as PutObjectCommand).input
      expect(input.ACL).toBeUndefined()
      expect(input.Bucket).toBe('configured-bucket')
    })

    it('does not publish, or move, a multipart upload', async () => {
      unplant = plant({ publicRead: true, bucket: 'evil-bucket' })
      const { signed, send } = await services()

      await signed.getMultipartUploadUrls({ key: 'a', contentType: 'text/plain', parts: 2 })

      const create = send.mock.calls[0]?.[0] as CreateMultipartUploadCommand
      expect(create.input.ACL).toBeUndefined()
      expect(create.input.Bucket).toBe('configured-bucket')
    })

    describe('on a method that takes options', () => {
      /** The input of the command the call sent, whether or not the call resolved. */
      async function sentBy<T extends object = Record<string, unknown>>(
        call: (storage: StorageService) => unknown,
      ): Promise<T> {
        unplant = plant({
          publicRead: true,
          bucket: 'evil-bucket',
          sourceBucket: 'evil-bucket',
          destinationBucket: 'evil-bucket',
        })
        const { storage, send } = await services()
        await Promise.resolve(call(storage)).catch(() => undefined)
        return (send.mock.calls[0]?.[0] as { input: T }).input
      }

      it.each([
        ['head', (s: StorageService) => s.head('a')],
        ['exists', (s: StorageService) => s.exists('a')],
        ['delete', (s: StorageService) => s.delete('a')],
        ['deleteMany', (s: StorageService) => s.deleteMany(['a'])],
        ['checkBucket', (s: StorageService) => s.checkBucket()],
        ['list', (s: StorageService) => s.list({})],
        ['download', (s: StorageService) => s.download({ key: 'a' })],
        ['downloadBuffer', (s: StorageService) => s.downloadBuffer({ key: 'a' })],
      ])('%s uses the configured bucket', async (_name, call) => {
        const input = await sentBy(call)

        expect(input.Bucket).toBe('configured-bucket')
      })

      it('getPublicUrl uses the configured bucket', async () => {
        unplant = plant({ bucket: 'evil-bucket' })
        const { storage } = await services()

        expect(storage.getPublicUrl('a')).not.toContain('evil-bucket')
      })

      it('copy uses the configured buckets and does not publish', async () => {
        const input = await sentBy<CopyObjectCommand['input']>((s) =>
          s.copy({ sourceKey: 'a', destinationKey: 'b' }),
        )

        expect(input.Bucket).toBe('configured-bucket')
        expect(input.CopySource).toContain('configured-bucket')
        expect(input.CopySource).not.toContain('evil-bucket')
        expect(input.ACL).toBeUndefined()
      })

      it('still reads a field the caller set, and a per-call bucket', async () => {
        unplant = plant({ bucket: 'evil-bucket' })
        const { storage, send } = await services()

        await storage.head('a', { bucket: 'mine' }).catch(() => undefined)
        await storage
          .copy({ sourceKey: 'a', destinationKey: 'b', publicRead: true })
          .catch(() => undefined)

        expect((send.mock.calls[0]?.[0] as { input: { Bucket: string } }).input.Bucket).toBe('mine')
        expect((send.mock.calls[1]?.[0] as CopyObjectCommand).input.ACL).toBe('public-read')
      })
    })

    describe('on what a host supplies', () => {
      it('does not read a validator that only the prototype makes one, or one that only it makes pass', async () => {
        unplant = plant({ validate: () => ({ ok: true }), ok: true })

        // An entry without its own `validate` is refused at boot, not taken for the planted one.
        await expect(
          resolve({ ...BASE, validation: { customValidators: [{ name: 'v' }] } }),
        ).rejects.toThrow()

        // A result without its own `ok` is not ok.
        const { storage } = await services({
          validation: { customValidators: [{ name: 'v', validate: () => ({}) }] },
        })
        await expect(
          storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' }),
        ).rejects.toMatchObject({ response: { error: { code: 'STORAGE_VALIDATION_FAILED' } } })
      })

      it('does not take a scan that only the prototype supplies for a scanner', async () => {
        unplant = plant({ scan: () => Promise.resolve({ status: 'clean' }) })

        await expect(resolve({ ...BASE, scanner: { impl: {} } })).rejects.toThrow()
      })

      it.each([undefined, null])(
        'refuses a validator that answers %s with the library error',
        async (answer) => {
          const { storage, send } = await services({
            validation: { customValidators: [{ name: 'v', validate: () => answer }] },
          })

          await expect(
            storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' }),
          ).rejects.toMatchObject({ response: { error: { code: 'STORAGE_VALIDATION_FAILED' } } })
          expect(send).not.toHaveBeenCalled()
        },
      )

      it('reads a field of an upload that a class supplies, and one an inherited object supplies', async () => {
        const { storage, send } = await services()
        class Request {
          readonly key = 'a'
          readonly body = Buffer.from('x')
          get contentType(): string {
            return ['text', 'plain'].join('/')
          }
        }
        const inherited: Record<string, unknown> = Object.create({
          cacheControl: 'no-store',
        }) as Record<string, unknown>
        Object.assign(inherited, { key: 'b', body: Buffer.from('y'), contentType: 'text/plain' })

        await storage.upload(new Request())
        await storage.upload(inherited as never)

        const inputs = send.mock.calls.map((call) => (call[0] as PutObjectCommand).input)
        expect(inputs[0]).toMatchObject({ ContentType: 'text/plain' })
        expect(inputs[1]).toMatchObject({ CacheControl: 'no-store' })
      })

      it('does not read a scan status that only the prototype supplies', async () => {
        unplant = plant({ status: 'clean' })
        const { storage, send } = await services({
          scanner: { impl: { scan: () => Promise.resolve({}) } },
        })

        await expect(
          storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' }),
        ).rejects.toMatchObject({ response: { error: { code: 'STORAGE_SCAN_INCONCLUSIVE' } } })
        expect(send).not.toHaveBeenCalled()
      })

      it('does not read a lifecycle rule field or a bucket that only the prototype supplies', async () => {
        unplant = plant({ abortIncompleteMultipartDays: 3, bucket: 'evil-bucket' })
        const { lifecycle, send } = await services()
        send.mockResolvedValue({ Rules: [] })

        await lifecycle.upsert({ id: 'r', prefix: 'tmp/', expirationDays: 7 })
        await lifecycle.get()
        await lifecycle.remove('r')

        const inputs = send.mock.calls.map(
          (call) => (call[0] as { input: Record<string, unknown> }).input,
        )
        expect(inputs.every((input) => input.Bucket === 'configured-bucket')).toBe(true)
        const written = inputs.find((input) => 'LifecycleConfiguration' in input) as {
          LifecycleConfiguration: { Rules: { Expiration?: { Days: number } }[] }
        }
        expect(written.LifecycleConfiguration.Rules[0]?.Expiration).toStrictEqual({ Days: 7 })
      })
    })

    it('does not move a presigned download', async () => {
      unplant = plant({ bucket: 'evil-bucket' })
      const { signed } = await services()

      await signed.getDownloadUrl({ key: 'a' })

      const input = (jest.mocked(getSignedUrl).mock.calls[0]?.[1] as { input: { Bucket?: string } })
        .input
      expect(input.Bucket).toBe('configured-bucket')
    })
  })
})
