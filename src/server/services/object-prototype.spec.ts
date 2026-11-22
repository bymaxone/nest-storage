/**
 * @fileoverview A key planted on `Object.prototype` is found by an ordinary read of any plain object that lacks
 * it. None of the module options, and none of the fields of an upload, a presigned upload or a multipart upload,
 * may come from there: the ACL that is sent, the bucket that is written to and the options that are resolved are
 * the ones the caller and the module configuration set.
 * @layer server/services
 */
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }))

import type {
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
  }).compile()
  return moduleRef.get<ResolvedBymaxStorageOptions>(BYMAX_STORAGE_OPTIONS)
}

async function services(): Promise<{
  storage: StorageService
  signed: SignedUrlService
  send: jest.Mock<Promise<unknown>, [unknown]>
}> {
  const send = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ ETag: '"e"', UploadId: 'u' })
  const moduleRef = await Test.createTestingModule({ imports: [BymaxStorageModule.forRoot(BASE)] })
    .overrideProvider(S3ClientProvider)
    .useValue({
      isConfigured: () => true,
      getClient: () => ({ send }) as unknown as S3Client,
      getClientOrNull: () => null,
    })
    .compile()
  return { storage: moduleRef.get(StorageService), signed: moduleRef.get(SignedUrlService), send }
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

    it.each(['accessKeyId', 'secretAccessKey'])('does not supply %s to the credentials', async (key) => {
      unplant = plant({ [key]: 'EVIL' })

      const resolved = await resolve({ ...BASE, credentials: {} })

      expect(resolved.hasCredentials).toBe(false)
      expect(resolved.credentials.accessKeyId).not.toBe('EVIL')
      expect(resolved.credentials.secretAccessKey).not.toBe('EVIL')
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

    it('does not move a presigned download', async () => {
      unplant = plant({ bucket: 'evil-bucket' })
      const { signed } = await services()

      await signed.getDownloadUrl({ key: 'a' })

      const input = (jest.mocked(getSignedUrl).mock.calls[0]?.[1] as { input: { Bucket?: string } }).input
      expect(input.Bucket).toBe('configured-bucket')
    })
  })
})
