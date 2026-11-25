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
    uploadIdleTimeoutMs: 30000,
    bodyIdleTimeoutMs: 30000,
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

/** Extracts the `error.details` map from a thrown StorageException. */
function detailsOf(err: unknown): Record<string, unknown> {
  return (
    ((err as StorageException).getResponse() as { error: { details?: Record<string, unknown> } }).error
      .details ?? {}
  )
}

describe('SignedUrlService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetSignedUrl.mockResolvedValue(MOCK_URL)
  })

  describe('getDownloadUrl', () => {
    it.each([
      ['responseContentDisposition', 'inline', 'attachment\r\nx-evil: 1', 'ResponseContentDisposition'],
      ['responseContentType', 'text/plain', 'text/html', 'ResponseContentType'],
    ])(
      'signs the %s it checked, even when the request answers differently on a later read',
      async (field, first, later, input) => {
        // A getter that answers a safe value for the check and another for the signature must not be signed.
        const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())
        let reads = 0
        const request = { key: KEY }
        Object.defineProperty(request, field, {
          enumerable: true,
          get: () => {
            reads += 1
            return reads === 1 ? first : later
          },
        })

        await service.getDownloadUrl(request)

        const command = mockedGetSignedUrl.mock.calls[0]?.[1] as GetObjectCommand
        expect(command.input[input as 'ResponseContentType']).toBe(first)
      },
    )

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
      // The presigner must receive the effective TTL as its expiresIn option.
      expect(mockedGetSignedUrl.mock.calls[0]?.[2]).toEqual({ expiresIn: ttlSeconds })
    })

    it('omits ResponseContentDisposition and ResponseContentType from the command when not provided', async () => {
      // The conditional spreads must OMIT these keys entirely (not set them to undefined)
      // so they never become part of the signed request.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getDownloadUrl({ key: KEY })

      const input = (mockedGetSignedUrl.mock.calls[0]?.[1] as GetObjectCommand).input
      expect('ResponseContentDisposition' in input).toBe(false)
      expect('ResponseContentType' in input).toBe(false)
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
      // The mapped error must carry the non-sensitive operation context in details.
      const details = detailsOf(err)
      expect(details.op).toBe('getDownloadUrl')
      expect(details.key).toBe(KEY)
      expect(details).not.toHaveProperty('bucket')
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

      const before = Date.now()
      const result = await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      expect(result.requiredHeaders['Content-Type']).toBe('image/png')
      expect(result.method).toBe('PUT')
      // expiresAt = Date.now() + ttl * 1000 (default PUT TTL 300s): must be ~5min ahead,
      // never in the past (a `-` mutant) and never a millisecond offset (a `/` mutant).
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 300 * 1000 - 100)
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300 * 1000 + 100)
      // The presigner receives the effective TTL, and Metadata is omitted when absent.
      expect(mockedGetSignedUrl.mock.calls[0]?.[2]).toEqual({
        expiresIn: 300,
        signableHeaders: new Set(['content-type']),
      })
      const input = (mockedGetSignedUrl.mock.calls[0]?.[1] as PutObjectCommand).input
      expect('Metadata' in input).toBe(false)
    })

    it('binds the approved Content-Type into the signature', async () => {
      // The presigner leaves content-type unsigned unless it is named, which would let the URL
      // holder store any type; the PUT must name it, and a GET or a part URL must not need it.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      const opts = mockedGetSignedUrl.mock.calls[0]?.[2] as { signableHeaders?: Set<string> }
      expect([...(opts.signableHeaders ?? [])]).toEqual(['content-type'])
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

    it('refuses a publicRead that is not a boolean, and signs nothing', async () => {
      // `'false'` is truthy: it would sign a public-read upload.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await expect(
        service.getUploadUrl({ key: KEY, contentType: 'image/png', publicRead: 'false' as never }),
      ).rejects.toMatchObject({
        response: { error: { code: 'STORAGE_VALIDATION_FAILED', details: { field: 'publicRead' } } },
      })
      expect(mockedGetSignedUrl).not.toHaveBeenCalled()
    })

    it('signs the metadata values it checked, even when a value answers differently on a later read', async () => {
      // A value that is plain text on the first read and a header-splitting line afterwards must not pass the check and be signed.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())
      let reads = 0
      const metadata: Record<string, string> = {}
      Object.defineProperty(metadata, 'owner', {
        enumerable: true,
        get: () => {
          reads += 1
          return reads === 1 ? 'alice' : 'alice\r\nx-amz-acl: public-read'
        },
      })

      await service.getUploadUrl({ key: KEY, contentType: 'image/png', metadata })

      const input = (mockedGetSignedUrl.mock.calls[0]?.[1] as PutObjectCommand).input
      expect(input.Metadata).toStrictEqual({ owner: 'alice' })
    })

    it('refuses a Map as metadata, which has no pairs to sign', async () => {
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await expect(
        service.getUploadUrl({
          key: KEY,
          contentType: 'image/png',
          metadata: new Map([['owner', 'alice']]) as never,
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'STORAGE_VALIDATION_FAILED', details: { field: 'metadata' } } },
      })
      expect(mockedGetSignedUrl).not.toHaveBeenCalled()
    })

    it('wraps a request field that throws when read, with the host error as the cause', async () => {
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())
      const failure = new Error('SENTINEL request getter ran')
      const request = { key: KEY }
      Object.defineProperty(request, 'contentType', {
        enumerable: true,
        get: () => {
          throw failure
        },
      })

      const thrown = await service.getUploadUrl(request as never).catch((error: unknown) => error)

      expect(thrown).toMatchObject({
        response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
        cause: failure,
      })
      expect(JSON.stringify((thrown as { response: unknown }).response)).not.toContain('SENTINEL')
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

    it('passes x-amz-acl to the presigner as a signable and an unhoistable header when an ACL is set', async () => {
      // The caller is told to send x-amz-acl, so it must be signed as a header; hoisted into the query
      // it would be unsigned as a header and the provider would refuse the request that follows the list.
      // The presigner is mocked here, so this row pins the options it receives; the e2e row checks the URL.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getUploadUrl({ key: KEY, contentType: 'image/png', publicRead: true })

      const opts = mockedGetSignedUrl.mock.calls[0]?.[2] as {
        signableHeaders?: Set<string>
        unhoistableHeaders?: Set<string>
      }
      expect([...(opts.signableHeaders ?? [])].sort()).toEqual(['content-type', 'x-amz-acl'])
      expect([...(opts.unhoistableHeaders ?? [])]).toEqual(['x-amz-acl'])
    })

    it('names no unhoistable header when no ACL is set', async () => {
      // Without an ACL, content-type is the only signed header and no unhoistable header is needed.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      const opts = mockedGetSignedUrl.mock.calls[0]?.[2] as object
      expect(opts).not.toHaveProperty('unhoistableHeaders')
    })

    it('omits x-amz-acl from requiredHeaders when no ACL is signed', async () => {
      // without publicRead (and no module default) no ACL header is part of the signature
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const result = await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      expect(result.requiredHeaders).not.toHaveProperty('x-amz-acl')
    })

    it('sends the metadata on the command and lists no x-amz-meta-<key> entry in requiredHeaders', async () => {
      // The real presigner hoists each x-amz-meta-* into the query string (measured on 3.1171), and a provider
      // refuses a client that sends the same pair as a header too; the presigner is mocked here.
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const result = await service.getUploadUrl({
        key: KEY,
        contentType: 'image/png',
        metadata: { a: 'b' },
      })

      const input = (mockedGetSignedUrl.mock.calls[0]?.[1] as PutObjectCommand).input
      expect(input.Metadata).toStrictEqual({ a: 'b' })
      expect(Object.keys(result.requiredHeaders)).toStrictEqual(['Content-Type'])
    })

    it('maps a non-StorageException error from getSignedUrl to STORAGE_PROVIDER_ERROR', async () => {
      // AWS SDK errors from the presigner must be mapped to typed provider errors
      mockedGetSignedUrl.mockRejectedValue({ name: 'RequestError', message: 'network', $metadata: {} })
      const service = await buildService(buildOptions(), buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getUploadUrl({ key: KEY, contentType: 'image/png' }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
      // Mapped error must carry the getUploadUrl operation context.
      const details = detailsOf(err)
      expect(details.op).toBe('getUploadUrl')
      expect(details.key).toBe(KEY)
      expect(details).not.toHaveProperty('bucket')
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

  describe('mimeWhitelist', () => {
    const whitelisted = (): ResolvedBymaxStorageOptions => ({
      ...buildOptions(),
      validation: { mimeWhitelist: ['image/png', 'application/*'] },
    })

    it('refuses to presign an upload whose contentType is outside the whitelist', async () => {
      // A client-chosen type passed straight through must not get a URL for a type the host forbids.
      const service = await buildService(whitelisted(), buildMockS3Provider(), buildMockKeyResolver())

      const err = await service.getUploadUrl({ key: KEY, contentType: 'text/html' }).catch((e: unknown) => e)

      expect(err).toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
      expect((err as StorageException).getResponse()).toMatchObject({
        error: { details: { contentType: 'text/html' } },
      })
      expect(mockedGetSignedUrl).not.toHaveBeenCalled()
    })

    it.each([
      ['image/png;,text/html', ['image/png']],
      ['image/png; charset=x, text/html', ['image/png']],
      ['image/png,text/html', ['image/*']],
    ])('refuses to presign %j, which a browser would read as its last type', async (contentType, mimeWhitelist) => {
      // The signed value is stored verbatim, so a list that passes on its first type must not get a URL.
      const service = await buildService(
        { ...buildOptions(), validation: { mimeWhitelist } },
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      const err = await service.getUploadUrl({ key: KEY, contentType }).catch((e: unknown) => e)

      expect(err).toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
      expect(mockedGetSignedUrl).not.toHaveBeenCalled()
    })

    it('presigns an upload whose contentType matches an exact entry or a wildcard', async () => {
      const service = await buildService(whitelisted(), buildMockS3Provider(), buildMockKeyResolver())

      await service.getUploadUrl({ key: KEY, contentType: 'image/png' })
      await service.getUploadUrl({ key: KEY, contentType: 'application/pdf' })

      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(2)
    })

    it('signs the content type the whitelist approved, even when the request answers differently on a later read', async () => {
      // A getter that says text/plain once and text/html afterwards must not pass the check and sign the other value.
      const service = await buildService(whitelisted(), buildMockS3Provider(), buildMockKeyResolver())
      let reads = 0
      const request = { key: KEY }
      Object.defineProperty(request, 'contentType', {
        enumerable: true,
        get: () => {
          reads += 1
          return reads === 1 ? 'image/png' : 'text/html'
        },
      })

      const result = await service.getUploadUrl(request as never)

      const input = (mockedGetSignedUrl.mock.calls[0]?.[1] as PutObjectCommand).input
      expect(input.ContentType).toBe('image/png')
      expect(result.requiredHeaders['Content-Type']).toBe('image/png')
    })

    it('creates the multipart upload with the content type the whitelist approved, even when the request answers differently on a later read', async () => {
      const s3Provider = buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID })
      const service = await buildService(whitelisted(), s3Provider, buildMockKeyResolver())
      let reads = 0
      const request = { key: KEY, parts: 2 }
      Object.defineProperty(request, 'contentType', {
        enumerable: true,
        get: () => {
          reads += 1
          return reads === 1 ? 'image/png' : 'text/html'
        },
      })

      await service.getMultipartUploadUrls(request as never)

      const send = (s3Provider.getClient() as unknown as { send: jest.Mock<unknown, [unknown]> }).send
      expect((send.mock.calls[0]?.[0] as CreateMultipartUploadCommand).input.ContentType).toBe('image/png')
    })

    it('presigns any contentType when no whitelist is configured, or it is empty', async () => {
      const empty = { ...buildOptions(), validation: { mimeWhitelist: [] } }
      for (const options of [buildOptions(), empty]) {
        const service = await buildService(options, buildMockS3Provider(), buildMockKeyResolver())
        await service.getUploadUrl({ key: KEY, contentType: 'text/html' })
      }

      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(2)
    })

    it('refuses a multipart presign outside the whitelist before the upload is created', async () => {
      // CreateMultipartUpload opens an upload on the provider, so the check has to come first.
      const s3Provider = buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID })
      const service = await buildService(whitelisted(), s3Provider, buildMockKeyResolver())

      const err = await service
        .getMultipartUploadUrls({ key: KEY, contentType: 'text/html', parts: 2 })
        .catch((e: unknown) => e)

      expect(err).toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
      expect((s3Provider.getClient() as unknown as { send: jest.Mock }).send).not.toHaveBeenCalled()
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
      // Every part/complete presign must pass the effective TTL as expiresIn.
      expect(mockedGetSignedUrl.mock.calls[0]?.[2]).toEqual({ expiresIn: 300 })
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
      // Details must state the exact reason and echo the offending part count.
      const details = detailsOf(err)
      expect(details.reason).toBe('parts must be an integer from 1 to 10000')
      expect(details.provided).toBe(0)
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

    it.each([
      ['a fraction', 1.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['one more than the S3 maximum', 10_001],
    ])('throws STORAGE_INVALID_PART_COUNT for %s, before any S3 call', async (_label, parts) => {
      // S3 numbers parts 1 to 10 000; anything else could never complete, and a huge count
      // would presign that many URLs for nothing.
      const s3Provider = buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID })
      const service = await buildService(buildOptions(), s3Provider, buildMockKeyResolver())

      const err = await service
        .getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts })
        .catch((e: unknown) => e)

      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_INVALID_PART_COUNT)
      expect(detailsOf(err).reason).toBe('parts must be an integer from 1 to 10000')
    })

    it('accepts a single part', async () => {
      // the lower boundary is valid
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID }),
        buildMockKeyResolver(),
      )

      const result = await service.getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts: 1 })

      expect(result.partUrls.map((p) => p.partNumber)).toEqual([1])
    })

    it('accepts the S3 maximum of 10 000 parts', async () => {
      // the boundary itself is valid: one URL per part plus the completion URL
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(true, { UploadId: MOCK_UPLOAD_ID }),
        buildMockKeyResolver(),
      )

      const result = await service.getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts: 10_000 })

      expect(result.partUrls).toHaveLength(10_000)
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
      // This inner StorageException must be re-thrown as-is (the `instanceof` guard), so
      // it keeps its explanatory reason/key/bucket rather than being re-wrapped by
      // mapAwsError (which would drop `reason` and add an `op`).
      const details = detailsOf(err)
      expect(details.reason).toBe('CreateMultipartUpload returned no UploadId')
      expect(details.key).toBe(KEY)
      expect(details).not.toHaveProperty('bucket')
      expect('op' in details).toBe(false)
    })

    it('maps a non-StorageException error thrown by send() to STORAGE_PROVIDER_ERROR', async () => {
      // S3 SDK errors during CreateMultipartUpload must be mapped to provider errors
      const s3Provider = buildMockS3Provider()
      const sendMock = (s3Provider.getClient() as unknown as { send: jest.Mock }).send
      sendMock.mockRejectedValue({ name: 'ServiceUnavailable', message: 'try again', $metadata: {} })
      const service = await buildService(buildOptions(), s3Provider, buildMockKeyResolver())

      const err = await service
        .getMultipartUploadUrls({ key: KEY, contentType: 'image/png', parts: 2, bucket: 'asked-bucket' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR)
      // A genuine SDK error IS mapped, carrying the multipart operation context.
      expect(detailsOf(err).op).toBe('getMultipartUploadUrls')
      expect(detailsOf(err)).toMatchObject({ key: KEY, bucket: 'asked-bucket' })
    })
  })
})
