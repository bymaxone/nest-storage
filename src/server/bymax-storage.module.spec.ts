/**
 * @fileoverview Unit tests for `BymaxStorageModule.forRoot` — provider wiring,
 * the public DI surface, validator/scanner tokens, and credential tolerance.
 * @layer server/module
 */
import { Test } from '@nestjs/testing'
import { S3Client } from '@aws-sdk/client-s3'
import { BymaxStorageModule } from './bymax-storage.module'
import {
  BYMAX_STORAGE_FILE_SCANNER,
  BYMAX_STORAGE_IDEMPOTENCY_CACHE,
  BYMAX_STORAGE_OPTIONS,
  BYMAX_STORAGE_S3_CLIENT,
  BYMAX_STORAGE_UPLOAD_VALIDATORS,
} from './bymax-storage.constants'
import { S3ClientProvider } from './providers/s3-client.provider'
import { KeyResolverService } from './services/key-resolver.service'
import { StorageService } from './services/storage.service'
import { SignedUrlService } from './services/signed-url.service'
import { IdempotencyCache } from './utils/idempotency-cache'
import { StorageException } from './errors/storage-exception'
import type { ResolvedBymaxStorageOptions } from './config/resolved-options'
import type { IFileScanner } from './interfaces/file-scanner.interface'
import type { IUploadValidator } from './interfaces/upload-validator.interface'
import type { BymaxStorageModuleOptions } from './interfaces/storage-module-options.interface'

const base: BymaxStorageModuleOptions = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

describe('BymaxStorageModule', () => {
  it('should wire the internal providers and the public DI surface when configured', async () => {
    // Configured module — every provider resolves, raw client is live.
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxStorageModule.forRoot(base)],
    }).compile()

    expect(moduleRef.get<ResolvedBymaxStorageOptions>(BYMAX_STORAGE_OPTIONS).bucket).toBe('b')
    expect(moduleRef.get(S3ClientProvider)).toBeInstanceOf(S3ClientProvider)
    expect(moduleRef.get(KeyResolverService)).toBeInstanceOf(KeyResolverService)
    expect(moduleRef.get(BYMAX_STORAGE_S3_CLIENT)).toBeInstanceOf(S3Client)
    expect(moduleRef.get(BYMAX_STORAGE_UPLOAD_VALIDATORS)).toEqual([])
    expect(moduleRef.get(BYMAX_STORAGE_FILE_SCANNER)).toBeNull()
    // The idempotency-cache factory must produce a real IdempotencyCache instance,
    // not undefined — deduplicated uploads depend on it.
    expect(moduleRef.get(BYMAX_STORAGE_IDEMPOTENCY_CACHE)).toBeInstanceOf(IdempotencyCache)

    await moduleRef.close()
  })

  it('should export the public DI surface (facades, options, and consumer tokens)', () => {
    // buildExports must return the full public surface, not an empty array — a consumer
    // importing the module can only inject what is exported.
    const dynamicModule = BymaxStorageModule.forRoot(base)
    expect(dynamicModule.exports).toEqual(
      expect.arrayContaining([
        StorageService,
        SignedUrlService,
        BYMAX_STORAGE_OPTIONS,
        BYMAX_STORAGE_S3_CLIENT,
        BYMAX_STORAGE_UPLOAD_VALIDATORS,
        BYMAX_STORAGE_FILE_SCANNER,
      ]),
    )
  })

  it('should resolve the raw-client token to null when credentials are missing', async () => {
    // Unconfigured module — getClientOrNull null branch.
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          ...base,
          credentials: { accessKeyId: '', secretAccessKey: '' },
        }),
      ],
    }).compile()

    expect(moduleRef.get(BYMAX_STORAGE_S3_CLIENT)).toBeNull()

    await moduleRef.close()
  })

  it('should expose configured validators and the scanner implementation', async () => {
    // Provided branch of the validator/scanner `??` fallbacks.
    const validator: IUploadValidator = { name: 'v', validate: () => Promise.resolve({ ok: true }) }
    const scanner: IFileScanner = {
      scan: () => Promise.resolve({ status: 'clean', engine: 'noop' }),
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          ...base,
          validation: { customValidators: [validator] },
          scanner: { impl: scanner },
        }),
      ],
    }).compile()

    expect(moduleRef.get(BYMAX_STORAGE_UPLOAD_VALIDATORS)).toEqual([validator])
    expect(moduleRef.get(BYMAX_STORAGE_FILE_SCANNER)).toBe(scanner)

    await moduleRef.close()
  })

  it('should throw when the options are invalid', () => {
    // forRoot delegates to validateOptions.
    expect(() => BymaxStorageModule.forRoot({ ...base, endpoint: '' })).toThrow(StorageException)
  })
})
