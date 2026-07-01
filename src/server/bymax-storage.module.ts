/**
 * @fileoverview The `@Global()` dynamic module. `forRoot()` validates and
 * resolves options, then wires the internal providers (S3 client lifecycle, key
 * resolver) and the public DI surface (resolved options + the raw-client token).
 * @layer server/module
 */
import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common'
import { S3Client } from '@aws-sdk/client-s3'
import {
  BYMAX_STORAGE_FILE_SCANNER,
  BYMAX_STORAGE_IDEMPOTENCY_CACHE,
  BYMAX_STORAGE_OPTIONS,
  BYMAX_STORAGE_S3_CLIENT,
  BYMAX_STORAGE_UPLOAD_VALIDATORS,
} from './bymax-storage.constants'
import type { BymaxStorageModuleOptions } from './interfaces/storage-module-options.interface'
import { validateOptions } from './config/validate-options'
import { applyDefaults } from './config/apply-defaults'
import {
  DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES,
  DEFAULT_IDEMPOTENCY_CACHE_TTL_MS,
} from './constants/default-options.constants'
import { S3ClientProvider } from './providers/s3-client.provider'
import { KeyResolverService } from './services/key-resolver.service'
import { StorageService } from './services/storage.service'
import { SignedUrlService } from './services/signed-url.service'
import { ValidationService } from './services/validation.service'
import { FileScannerService } from './services/file-scanner.service'
import { IdempotencyCache } from './utils/idempotency-cache'

@Global()
@Module({})
export class BymaxStorageModule {
  /**
   * Synchronous configuration. Validates and resolves the options, then returns
   * the wired dynamic module.
   *
   * @param options - The storage module options.
   * @returns The configured `DynamicModule`.
   * @throws StorageException with code `STORAGE_INVALID_CONFIG` on invalid options.
   *
   * @example
   *   BymaxStorageModule.forRoot({
   *     endpoint: 'https://s3.us-east-1.amazonaws.com',
   *     region: 'us-east-1',
   *     bucket: 'my-bucket',
   *     credentials: { accessKeyId, secretAccessKey },
   *   })
   */
  static forRoot(options: BymaxStorageModuleOptions): DynamicModule {
    validateOptions(options)
    const resolved = applyDefaults(options)

    const providers: Provider[] = [
      { provide: BYMAX_STORAGE_OPTIONS, useValue: resolved },
      {
        provide: BYMAX_STORAGE_UPLOAD_VALIDATORS,
        useValue: resolved.validation?.customValidators ?? [],
      },
      {
        provide: BYMAX_STORAGE_FILE_SCANNER,
        useValue: resolved.scanner?.impl ?? null,
      },
      S3ClientProvider,
      KeyResolverService,
      {
        // Per-instance idempotency cache for deduplicating uploads within the TTL.
        provide: BYMAX_STORAGE_IDEMPOTENCY_CACHE,
        useFactory: (): IdempotencyCache =>
          new IdempotencyCache(
            DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES,
            DEFAULT_IDEMPOTENCY_CACHE_TTL_MS,
          ),
      },
      StorageService,
      SignedUrlService,
      // ValidationService and FileScannerService are internal — consumed via
      // StorageService.upload() only, not exported from the module.
      ValidationService,
      FileScannerService,
      {
        // Public raw-client token. Null-tolerant so the module still registers
        // without credentials (resolves to null until configured).
        provide: BYMAX_STORAGE_S3_CLIENT,
        useFactory: (provider: S3ClientProvider): S3Client | null => provider.getClientOrNull(),
        inject: [S3ClientProvider],
      },
    ]

    return {
      module: BymaxStorageModule,
      providers,
      // Public DI surface: StorageService + SignedUrlService facades, the resolved
      // options, the raw-client token, and the user-supplied upload-validators +
      // file-scanner tokens — all injectable by consumers via @Global().
      // S3ClientProvider, KeyResolverService, ValidationService, FileScannerService,
      // and the idempotency cache are internal and intentionally not exported.
      exports: [
        StorageService,
        SignedUrlService,
        BYMAX_STORAGE_OPTIONS,
        BYMAX_STORAGE_S3_CLIENT,
        BYMAX_STORAGE_UPLOAD_VALIDATORS,
        BYMAX_STORAGE_FILE_SCANNER,
      ],
    }
  }
}
