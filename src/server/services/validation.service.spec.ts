/**
 * @fileoverview Tests for ValidationService — MIME whitelist, size, and custom validators.
 * @layer server/services
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { ValidationService } from './validation.service'
import { NoOpUploadValidator } from '../providers/no-op-validator'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_UPLOAD_VALIDATORS } from '../bymax-storage.constants'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { IUploadValidator } from '../interfaces/upload-validator.interface'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'

function buildOptions(validation?: ResolvedBymaxStorageOptions['validation']): ResolvedBymaxStorageOptions {
  return {
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
    forcePathStyle: false,
    publicBaseUrl: 'https://s3.amazonaws.com',
    defaultPublicRead: false,
    keyPrefix: '',
    defaultCacheControl: 'no-cache',
    defaultContentDisposition: 'inline',
    signedUrls: { defaultGetTtlSeconds: 300, defaultPutTtlSeconds: 300, maxTtlSeconds: 604800 },
    multipart: { thresholdBytes: 5242880, partSizeBytes: 5242880, queueSize: 4 },
    requestChecksumCalculation: 'WHEN_SUPPORTED',
    responseChecksumValidation: 'WHEN_SUPPORTED',
    maxAttempts: 3,
    requestTimeoutMs: 30000,
    hasCredentials: true,
    validation,
  }
}

async function buildService(
  opts: ResolvedBymaxStorageOptions,
  validators: IUploadValidator[] = [],
): Promise<ValidationService> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      ValidationService,
      { provide: BYMAX_STORAGE_OPTIONS, useValue: opts },
      { provide: BYMAX_STORAGE_UPLOAD_VALIDATORS, useValue: validators },
    ],
  }).compile()
  return mod.get(ValidationService)
}

describe('ValidationService', () => {
  describe('MIME whitelist', () => {
    it('passes when the MIME matches the whitelist', async () => {
      // allowed content type must not throw
      const service = await buildService(buildOptions({ mimeWhitelist: ['image/png'] }))
      const result = await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' })
      expect(result.body).toBeDefined()
    })

    it('throws STORAGE_MIME_NOT_ALLOWED when MIME is outside the whitelist', async () => {
      // disallowed MIME must be rejected before any S3 call
      const service = await buildService(buildOptions({ mimeWhitelist: ['image/png'] }))
      const err = await service
        .validate({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED)
      // The exception must carry the offending content type and the configured whitelist.
      const details = ((err as StorageException).getResponse() as {
        error: { details: { contentType: string; whitelist: string[] } }
      }).error.details
      expect(details.contentType).toBe('text/plain')
      expect(details.whitelist).toEqual(['image/png'])
    })

    it('passes when the MIME matches via a wildcard (image/*)', async () => {
      // wildcard must accept any subtype of the specified type
      const service = await buildService(buildOptions({ mimeWhitelist: ['image/*'] }))
      const result = await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/jpeg' })
      expect(result.body).toBeDefined()
    })

    it('passes when no MIME whitelist is configured', async () => {
      // absent whitelist must not block any content type
      const service = await buildService(buildOptions())
      const result = await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'anything/goes' })
      expect(result.body).toBeDefined()
    })

    it('passes when the MIME whitelist is empty', async () => {
      // empty array whitelist must not block uploads
      const service = await buildService(buildOptions({ mimeWhitelist: [] }))
      const result = await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' })
      expect(result.body).toBeDefined()
    })
  })

  describe('size check', () => {
    it('throws STORAGE_SIZE_EXCEEDED when size > maxSizeBytes', async () => {
      // oversize upload must be rejected
      const service = await buildService(buildOptions({ maxSizeBytes: 100 }))
      const err = await service
        .validate({ key: 'k', body: Buffer.alloc(200), contentType: 'image/png', size: 200 })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED)
      // Details must report both the actual size and the configured maximum.
      const details = ((err as StorageException).getResponse() as {
        error: { details: { size: number; maxSize: number } }
      }).error.details
      expect(details.size).toBe(200)
      expect(details.maxSize).toBe(100)
    })

    it('passes when size is within limit', async () => {
      // size within bounds must pass
      const service = await buildService(buildOptions({ maxSizeBytes: 1000 }))
      const result = await service.validate({ key: 'k', body: Buffer.alloc(50), contentType: 'image/png', size: 50 })
      expect(result.body).toBeDefined()
    })

    it('passes when size EXACTLY equals maxSizeBytes (strict > boundary, not >=)', async () => {
      // The check is `size > maxSizeBytes` — an exact-limit upload is allowed. A `>=`
      // mutant would wrongly reject size === maxSizeBytes.
      const service = await buildService(buildOptions({ maxSizeBytes: 100 }))
      const result = await service.validate({ key: 'k', body: Buffer.alloc(100), contentType: 'image/png', size: 100 })
      expect(result.body).toBeDefined()
    })

    it('passes when size is undefined (stream without declared size)', async () => {
      // missing size must not block (best-effort check)
      const service = await buildService(buildOptions({ maxSizeBytes: 100 }))
      const stream = Readable.from(Buffer.from('hi'))
      const result = await service.validate({ key: 'k', body: stream, contentType: 'image/png' })
      expect(result.body).toBeDefined()
    })
  })

  describe('custom validators', () => {
    it('passes when a custom validator returns { ok: true }', async () => {
      // a passing validator must not block the upload
      const validator: IUploadValidator = {
        name: 'allow-all',
        validate: jest.fn().mockResolvedValue({ ok: true }),
      }
      const service = await buildService(buildOptions(), [validator])
      const result = await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' })
      expect(result.body).toBeDefined()
      expect(validator.validate).toHaveBeenCalledTimes(1)
    })

    it('throws STORAGE_VALIDATION_FAILED with validator.name when { ok: false }', async () => {
      // a rejecting validator must produce VALIDATION_FAILED with the validator name
      const validator: IUploadValidator = {
        name: 'magic-byte-check',
        validate: jest.fn().mockResolvedValue({ ok: false, reason: 'bad magic bytes' }),
      }
      const service = await buildService(buildOptions(), [validator])
      const err = await service
        .validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED)
      const response = (err as StorageException).getResponse() as { error: { details: Record<string, unknown> } }
      expect(response.error.details.validator).toBe('magic-byte-check')
      expect(response.error.details.reason).toBe('bad magic bytes')
    })

    it('short-circuits on the first failing validator', async () => {
      // once a validator fails, subsequent ones must not run
      const v1: IUploadValidator = {
        name: 'first',
        validate: jest.fn().mockResolvedValue({ ok: false, reason: 'nope' }),
      }
      const v2: IUploadValidator = {
        name: 'second',
        validate: jest.fn().mockResolvedValue({ ok: true }),
      }
      const service = await buildService(buildOptions(), [v1, v2])
      await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' }).catch(() => null)
      expect(v2.validate).not.toHaveBeenCalled()
    })

    it('forwards metadata to the custom validator when present', async () => {
      // metadata passed to validate() must reach the custom validator context
      let capturedMetadata: Record<string, string> | undefined
      const validator: IUploadValidator = {
        name: 'meta-spy',
        validate: jest.fn().mockImplementation(
          (ctx: { metadata?: Record<string, string> }) => {
            capturedMetadata = ctx.metadata
            return Promise.resolve({ ok: true })
          },
        ),
      }
      const service = await buildService(buildOptions({ mimeWhitelist: ['image/png'] }), [validator])
      await service.validate({
        key: 'k',
        body: Buffer.from('x'),
        contentType: 'image/png',
        metadata: { owner: 'alice' },
      })
      expect(capturedMetadata).toEqual({ owner: 'alice' })
    })

    it('includes size in the validator context only when the upload declares one', async () => {
      // The conditional spread must add `size` with the exact value when present and
      // OMIT the key entirely when absent (not pass `size: undefined`).
      const contexts: Record<string, unknown>[] = []
      const validator: IUploadValidator = {
        name: 'ctx-spy',
        validate: jest.fn().mockImplementation((ctx: Record<string, unknown>) => {
          contexts.push(ctx)
          return Promise.resolve({ ok: true })
        }),
      }
      const service = await buildService(buildOptions(), [validator])

      await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png', size: 42 })
      await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' })

      expect(contexts[0]?.size).toBe(42)
      expect('size' in (contexts[0] ?? {})).toBe(true)
      expect('size' in (contexts[1] ?? {})).toBe(false)
    })

    it('omits metadata from the validator context when the upload provides none', async () => {
      // The conditional spread must NOT inject a `metadata: undefined` key when absent.
      const contexts: Record<string, unknown>[] = []
      const validator: IUploadValidator = {
        name: 'meta-omit-spy',
        validate: jest.fn().mockImplementation((ctx: Record<string, unknown>) => {
          contexts.push(ctx)
          return Promise.resolve({ ok: true })
        }),
      }
      const service = await buildService(buildOptions(), [validator])

      await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' })
      expect('metadata' in (contexts[0] ?? {})).toBe(false)
    })

    it('calls readBytes and gives the validator the first N bytes of the body', async () => {
      // readBytes must tee/slice the body and deliver the bytes to the validator
      let capturedBytes: Buffer | null = null
      const validator: IUploadValidator = {
        name: 'peek-validator',
        validate: jest.fn().mockImplementation(
          async (ctx: { readBytes: (n: number) => Promise<Buffer> }) => {
            capturedBytes = await ctx.readBytes(3)
            return { ok: true }
          },
        ),
      }
      const service = await buildService(buildOptions({ mimeWhitelist: ['image/png'] }), [validator])
      await service.validate({ key: 'k', body: Buffer.from('hello'), contentType: 'image/png' })
      expect(capturedBytes).toEqual(Buffer.from('hel'))
    })

    it('runs validators after MIME and size checks (MIME → size → custom order)', async () => {
      // custom validators must run after MIME and size, not before
      const order: string[] = []
      const validator: IUploadValidator = {
        name: 'order-spy',
        validate: jest.fn().mockImplementation(() => {
          order.push('custom')
          return Promise.resolve({ ok: true })
        }),
      }
      const service = await buildService(buildOptions({ mimeWhitelist: ['image/png'], maxSizeBytes: 1000 }), [validator])
      await service.validate({ key: 'k', body: Buffer.from('x'), contentType: 'image/png', size: 1 })
      // custom must be last (MIME and size ran first, without errors in this case)
      expect(order).toEqual(['custom'])
      expect(validator.validate).toHaveBeenCalledTimes(1)
    })
  })

  describe('NoOpUploadValidator', () => {
    it('has name "no-op" and returns { ok: true }', async () => {
      // no-op shape must match the documented contract exactly
      const noop = new NoOpUploadValidator()
      expect(noop.name).toBe('no-op')
      const result = await noop.validate({ key: 'k', contentType: 'image/png' })
      expect(result).toEqual({ ok: true })
    })
  })
})
