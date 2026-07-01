/**
 * @fileoverview Tests for SignedUrlService (GET, PUT, multipart presigning).
 * @layer server/services
 */

// Mock the presigner BEFORE importing the service so that ts-jest picks up the mock.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}))

import { Test, type TestingModule } from '@nestjs/testing'
import {
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { SignedUrlService } from './signed-url.service'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'

const MOCK_URL = 'https://s3.example.com/bucket/key?X-Amz-Signature=abc&X-Amz-Expires=300'
const MOCK_UPLOAD_ID = 'test-upload-id-xyz'
const BUCKET = 'test-bucket'
const KEY = 'test/file.png'

function buildOptions(overrides?: Partial<ResolvedBymaxStorageOptions['signedUrls']>): ResolvedBymaxStorageOptions {
  return {
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: BUCKET,
    credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
    forcePathStyle: false,
    publicBaseUrl: 'https://s3.amazonaws.com',
    defaultPublicRead: false,
    keyPrefix: '',
    defaultCacheControl: 'no-cache',
    defaultContentDisposition: 'inline',
    signedUrls: {
      defaultGetTtlSeconds: 300,
      defaultPutTtlSeconds: 300,
      maxTtlSeconds: 604800,
      ...overrides,
    },
    multipart: { thresholdBytes: 5242880, partSizeBytes: 5242880, queueSize: 4 },
    requestChecksumCalculation: 'WHEN_SUPPORTED',
    responseChecksumValidation: 'WHEN_SUPPORTED',
    maxAttempts: 3,
    requestTimeoutMs: 30000,
    hasCredentials: true,
  }
}

function buildMockS3Provider(configured = true, sendResult: Record<string, unknown> = {}): S3ClientProvider {
  const mockSend = jest.fn().mockResolvedValue(sendResult)
  const mockClient = { send: mockSend } as unknown as ReturnType<S3ClientProvider['getClient']>
  return {
    isConfigured: jest.fn().mockReturnValue(configured),
    getClient: jest.fn().mockReturnValue(mockClient),
  } as unknown as S3ClientProvider
}

function buildMockKeyResolver(): KeyResolverService {
  return {
    normalize: jest.fn((k: string) => k),
  } as unknown as KeyResolverService
}

async function buildService(
  opts: ResolvedBymaxStorageOptions,
  s3Provider: S3ClientProvider,
  keyResolver: KeyResolverService,
): Promise<SignedUrlService> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      SignedUrlService,
      { provide: BYMAX_STORAGE_OPTIONS, useValue: opts },
      { provide: S3ClientProvider, useValue: s3Provider },
      { provide: KeyResolverService, useValue: keyResolver },
    ],
  }).compile()
  return mod.get(SignedUrlService)
}

const mockedGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>

describe('SignedUrlService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetSignedUrl.mockResolvedValue(MOCK_URL)
  })

  describe('getDownloadUrl', () => {
    it('returns a URL with expiresAt calculated from the effective TTL', async () => {
      // happy path: returns the presigned URL and a correct expiresAt
      const ttlSeconds = 300
      const before = Date.now()
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const result = await service.getDownloadUrl({ key: KEY, ttlSeconds })

      expect(result.url).toBe(MOCK_URL)
      expect(result.method).toBe('GET')
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlSeconds * 1000 - 100)
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + ttlSeconds * 1000 + 100)
    })

    it('silently clamps TTL above maxTtlSeconds', async () => {
      // TTL above the max must use the max without throwing
      const service = await buildService(
        buildOptions({ maxTtlSeconds: 600 }),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      const result = await service.getDownloadUrl({ key: KEY, ttlSeconds: 9999 })

      expect(result.url).toBe(MOCK_URL)
      const expectedExpiry = Date.now() + 600 * 1000
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 200)
    })

    it('throws STORAGE_SIGNED_URL_TTL_INVALID for TTL <= 0', async () => {
      // non-positive TTL must be rejected
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getDownloadUrl({ key: KEY, ttlSeconds: 0 }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID)
    })

    it('throws STORAGE_NOT_CONFIGURED when the client is not configured', async () => {
      // calls assertConfigured before any S3 interaction
      const service = await buildService(buildOptions(), buildMockS3Provider(false), buildMockKeyResolver())

      const err = await service.getDownloadUrl({ key: KEY }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED)
    })

    it('forwards ResponseContentDisposition when provided', async () => {
      // per-call content disposition must be forwarded to the command
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getDownloadUrl({ key: KEY, responseContentDisposition: 'attachment; filename="x.pdf"' })

      const cmdArg = mockedGetSignedUrl.mock.calls[0]?.[1]
      expect(cmdArg).toBeInstanceOf(GetObjectCommand)
      const input = (cmdArg as GetObjectCommand).input
      expect(input.ResponseContentDisposition).toBe('attachment; filename="x.pdf"')
    })

    it('forwards ResponseContentType when provided', async () => {
      // per-call content type override must be forwarded
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getDownloadUrl({ key: KEY, responseContentType: 'application/pdf' })

      const cmdArg = mockedGetSignedUrl.mock.calls[0]?.[1]
      const input = (cmdArg as GetObjectCommand).input
      expect(input.ResponseContentType).toBe('application/pdf')
    })

    it('maps a non-StorageException error from getSignedUrl to STORAGE_PROVIDER_ERROR', async () => {
      // AWS SDK errors from the presigner must be mapped to typed provider errors
      mockedGetSignedUrl.mockRejectedValue({ name: 'RequestError', message: 'network', $metadata: {} })
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getDownloadUrl({ key: KEY }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
    })

    it('re-throws a StorageException from getSignedUrl without double-wrapping', async () => {
      // a StorageException thrown from within the try block must propagate as-is
      const original = new StorageException(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
      mockedGetSignedUrl.mockRejectedValue(original)
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getDownloadUrl({ key: KEY }).catch((e: unknown) => e)
      expect(err).toBe(original)
    })

    it('throws STORAGE_BUCKET_UNDEFINED when no bucket is configured', async () => {
      // without a default bucket and no per-call override, bucket resolution must fail
      // Use an empty-string bucket, which is falsy and triggers the undefined guard
      const optsNoBucket = { ...buildOptions(), bucket: '' }
      const service = await buildService(optsNoBucket, buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getDownloadUrl({ key: KEY }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED)
    })
  })

  describe('getUploadUrl', () => {
    it("returns requiredHeaders['Content-Type'] matching options.contentType", async () => {
      // the client must send exactly this Content-Type (part of the signature)
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const result = await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      expect(result.requiredHeaders['Content-Type']).toBe('image/png')
    })

    it('applies ACL public-read when publicRead: true', async () => {
      // publicRead must add ACL: public-read to the PutObject command
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getUploadUrl({ key: KEY, contentType: 'image/png', publicRead: true })

      const cmdArg = mockedGetSignedUrl.mock.calls[0]?.[1]
      expect(cmdArg).toBeInstanceOf(PutObjectCommand)
      const input = (cmdArg as PutObjectCommand).input
      expect(input.ACL).toBe('public-read')
    })

    it('forwards Metadata when provided', async () => {
      // metadata must be forwarded to the PutObject command
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getUploadUrl({
        key: KEY,
        contentType: 'image/png',
        metadata: { owner: 'alice' },
      })

      const cmdArg = mockedGetSignedUrl.mock.calls[0]?.[1]
      const input = (cmdArg as PutObjectCommand).input
      expect(input.Metadata).toEqual({ owner: 'alice' })
    })

    it('does not pin an exact ContentLength even when maxSizeBytes is provided', async () => {
      // A SigV4 PUT ContentLength is exact, not a max — binding it would reject
      // valid smaller uploads, so maxSizeBytes must never reach the command.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getUploadUrl({ key: KEY, contentType: 'image/png', maxSizeBytes: 1024 })

      const cmdArg = mockedGetSignedUrl.mock.calls[0]?.[1]
      const input = (cmdArg as PutObjectCommand).input
      expect(input.ContentLength).toBeUndefined()
    })

    it('includes x-amz-acl in requiredHeaders when publicRead is set', async () => {
      // publicRead signs an x-amz-acl header, so the client must be told to send it
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const result = await service.getUploadUrl({ key: KEY, contentType: 'image/png', publicRead: true })

      expect(result.requiredHeaders['x-amz-acl']).toBe('public-read')
    })

    it('omits x-amz-acl from requiredHeaders when no ACL is signed', async () => {
      // without publicRead (and no module default) no ACL header is part of the signature
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const result = await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      expect(result.requiredHeaders).not.toHaveProperty('x-amz-acl')
    })

    it('includes an x-amz-meta-<key> entry in requiredHeaders per metadata pair', async () => {
      // signed metadata headers must be echoed to the client or the signature breaks
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const result = await service.getUploadUrl({
        key: KEY,
        contentType: 'image/png',
        metadata: { a: 'b' },
      })

      expect(result.requiredHeaders['x-amz-meta-a']).toBe('b')
    })

    it('maps a non-StorageException error from getSignedUrl to STORAGE_PROVIDER_ERROR', async () => {
      // AWS SDK errors from the presigner must be mapped to typed provider errors
      mockedGetSignedUrl.mockRejectedValue({ name: 'RequestError', message: 'network', $metadata: {} })
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getUploadUrl({ key: KEY, contentType: 'image/png' }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
    })

    it('re-throws a StorageException from getSignedUrl without double-wrapping', async () => {
      // a StorageException thrown from within the try block must propagate as-is
      const original = new StorageException(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
      mockedGetSignedUrl.mockRejectedValue(original)
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getUploadUrl({ key: KEY, contentType: 'image/png' }).catch((e: unknown) => e)
      expect(err).toBe(original)
    })
  })

  describe('getMultipartUploadUrls', () => {
    it('calls CreateMultipartUploadCommand first and returns uploadId', async () => {
      // multipart presign must start with CreateMultipartUpload to get an UploadId
      const s3Provider = buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID })
      const service = await buildService(buildOptions(), s3Provider, buildMockKeyResolver())

      const result = await service.getMultipartUploadUrls({
        key: KEY,
        contentType: 'image/png',
        parts: 3,
      })

      expect((s3Provider.getClient() as unknown as { send: jest.Mock }).send).toHaveBeenCalledWith(
        expect.any(CreateMultipartUploadCommand),
      )
      expect(result.uploadId).toBe(MOCK_UPLOAD_ID)
    })

    it('returns N partUrls with partNumbers 1..N', async () => {
      // each part must get a presigned URL with the correct 1-based part number
      const s3Provider = buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID })
      const service = await buildService(buildOptions(), s3Provider, buildMockKeyResolver())

      const result = await service.getMultipartUploadUrls({
        key: KEY,
        contentType: 'image/png',
        parts: 3,
      })

      expect(result.partUrls).toHaveLength(3)
      expect(result.partUrls[0]?.partNumber).toBe(1)
      expect(result.partUrls[1]?.partNumber).toBe(2)
      expect(result.partUrls[2]?.partNumber).toBe(3)
    })

    it('returns a completeUrl', async () => {
      // the completeUrl must be a non-empty presigned string
      const s3Provider = buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID })
      const service = await buildService(buildOptions(), s3Provider, buildMockKeyResolver())

      const result = await service.getMultipartUploadUrls({
        key: KEY,
        contentType: 'image/png',
        parts: 2,
      })

      expect(typeof result.completeUrl).toBe('string')
      expect(result.completeUrl.length).toBeGreaterThan(0)
    })

    it('throws STORAGE_INVALID_PART_COUNT when parts is 0', async () => {
      // zero is an invalid part COUNT, not a too-small part SIZE — must throw the
      // dedicated invalid-count error before any S3 call
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID }),
        buildMockKeyResolver(),
      )

      const err = await service
        .getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts: 0 })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_INVALID_PART_COUNT)
    })

    it('throws STORAGE_INVALID_PART_COUNT when parts is negative', async () => {
      // a negative part count is likewise invalid
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID }),
        buildMockKeyResolver(),
      )

      const err = await service
        .getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts: -1 })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_INVALID_PART_COUNT)
    })

    it('throws STORAGE_PROVIDER_ERROR when CreateMultipartUpload returns no UploadId', async () => {
      // missing UploadId must surface as a provider error
      const s3Provider = buildMockS3Provider(true, { UploadId: undefined })
      const service = await buildService(buildOptions(), s3Provider, buildMockKeyResolver())

      const err = await service
        .getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts: 2 })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
    })

    it('maps a non-StorageException error thrown by send() to STORAGE_PROVIDER_ERROR', async () => {
      // S3 SDK errors during CreateMultipartUpload must be mapped to provider errors
      const s3Provider = buildMockS3Provider()
      const sendMock = (s3Provider.getClient() as unknown as { send: jest.Mock }).send
      sendMock.mockRejectedValue({ name: 'ServiceUnavailable', message: 'try again', $metadata: {} })
      const service = await buildService(buildOptions(), s3Provider, buildMockKeyResolver())

      const err = await service
        .getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts: 2 })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
    })
  })
})
