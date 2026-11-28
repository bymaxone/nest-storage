/**
 * @fileoverview Unit tests for `SignedUrlService.getUploadUrl` (presigned PUT).
 * @layer server/services
 */

// Mock the presigner BEFORE importing the service so that ts-jest picks up the mock.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}))

import { Test, type TestingModule } from '@nestjs/testing'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { SignedUrlService } from './signed-url.service'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'

const MOCK_URL = 'https://s3.example.com/bucket/key?X-Amz-Signature=abc&X-Amz-Expires=300'
const BUCKET = 'test-bucket'
const KEY = 'test/file.png'

function buildOptions(
  overrides?: Partial<ResolvedBymaxStorageOptions['signedUrls']>,
): ResolvedBymaxStorageOptions {
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

function buildMockS3Provider(
  configured = true,
  sendResult: Record<string, unknown> = {},
): S3ClientProvider {
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
    ((err as StorageException).getResponse() as { error: { details?: Record<string, unknown> } })
      .error.details ?? {}
  )
}

describe('SignedUrlService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetSignedUrl.mockResolvedValue(MOCK_URL)
  })

  describe('getUploadUrl', () => {
    it("returns requiredHeaders['Content-Type'] matching options.contentType", async () => {
      // the client must send exactly this Content-Type (part of the signature)
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

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
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      const opts = mockedGetSignedUrl.mock.calls[0]?.[2] as { signableHeaders?: Set<string> }
      expect([...(opts.signableHeaders ?? [])]).toEqual(['content-type'])
    })

    it('applies ACL public-read when publicRead: true', async () => {
      // publicRead must add ACL: public-read to the PutObject command
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      await service.getUploadUrl({ key: KEY, contentType: 'image/png', publicRead: true })

      const cmdArg = mockedGetSignedUrl.mock.calls[0]?.[1]
      expect(cmdArg).toBeInstanceOf(PutObjectCommand)
      const input = (cmdArg as PutObjectCommand).input
      expect(input.ACL).toBe('public-read')
    })

    it('refuses a publicRead that is not a boolean, and signs nothing', async () => {
      // `'false'` is truthy: it would sign a public-read upload.
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      await expect(
        service.getUploadUrl({ key: KEY, contentType: 'image/png', publicRead: 'false' as never }),
      ).rejects.toMatchObject({
        response: {
          error: { code: 'STORAGE_VALIDATION_FAILED', details: { field: 'publicRead' } },
        },
      })
      expect(mockedGetSignedUrl).not.toHaveBeenCalled()
    })

    it('signs the metadata values it checked, even when a value answers differently on a later read', async () => {
      // A value that is plain text on the first read and a header-splitting line afterwards must not pass the check and be signed.
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )
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
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

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
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )
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
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

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
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      await service.getUploadUrl({ key: KEY, contentType: 'image/png', maxSizeBytes: 1024 })

      const cmdArg = mockedGetSignedUrl.mock.calls[0]?.[1]
      const input = (cmdArg as PutObjectCommand).input
      expect(input.ContentLength).toBeUndefined()
    })

    it('includes x-amz-acl in requiredHeaders when publicRead is set', async () => {
      // publicRead signs an x-amz-acl header, so the client must be told to send it
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      const result = await service.getUploadUrl({
        key: KEY,
        contentType: 'image/png',
        publicRead: true,
      })

      expect(result.requiredHeaders['x-amz-acl']).toBe('public-read')
    })

    it('passes x-amz-acl to the presigner as a signable and an unhoistable header when an ACL is set', async () => {
      // The caller is told to send x-amz-acl, so it must be signed as a header; hoisted into the query
      // it would be unsigned as a header and the provider would refuse the request that follows the list.
      // The presigner is mocked here, so this row pins the options it receives; the e2e row checks the URL.
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

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
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      const opts = mockedGetSignedUrl.mock.calls[0]?.[2] as object
      expect(opts).not.toHaveProperty('unhoistableHeaders')
    })

    it('omits x-amz-acl from requiredHeaders when no ACL is signed', async () => {
      // without publicRead (and no module default) no ACL header is part of the signature
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      const result = await service.getUploadUrl({ key: KEY, contentType: 'image/png' })

      expect(result.requiredHeaders).not.toHaveProperty('x-amz-acl')
    })

    it('sends the metadata on the command and lists no x-amz-meta-<key> entry in requiredHeaders', async () => {
      // The real presigner hoists each x-amz-meta-* into the query string (measured on 3.1171), and a provider
      // refuses a client that sends the same pair as a header too; the presigner is mocked here.
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

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
      mockedGetSignedUrl.mockRejectedValue({
        name: 'RequestError',
        message: 'network',
        $metadata: {},
      })
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      const err = await service
        .getUploadUrl({ key: KEY, contentType: 'image/png' })
        .catch((e: unknown) => e)
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
      const service = await buildService(
        buildOptions(),
        buildMockS3Provider(),
        buildMockKeyResolver(),
      )

      const err = await service
        .getUploadUrl({ key: KEY, contentType: 'image/png' })
        .catch((e: unknown) => e)
      expect(err).toBe(original)
    })
  })
})
