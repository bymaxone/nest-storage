/**
 * @fileoverview The `@Global()` dynamic module. `forRoot()` resolves options
 * synchronously; `forRootAsync()` resolves them from injected dependencies
 * (`useFactory`/`useClass`/`useExisting`). Both wire the identical provider and
 * export surface — the S3 client lifecycle, key resolver, the public facades, and
 * the internal validation/scanner services — so the module behaves the same way
 * regardless of how it was configured.
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
import type {
  BymaxStorageModuleAsyncOptions,
  BymaxStorageModuleOptions,
  BymaxStorageModuleOptionsFactory,
} from './interfaces/storage-module-options.interface'
import { validateOptions } from './config/validate-options'
import { applyDefaults } from './config/apply-defaults'
import type { ResolvedBymaxStorageOptions } from './config/resolved-options'
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

/** Validates raw options and materializes the fully-resolved options shape. */
function resolveAsyncOptions(options: BymaxStorageModuleOptions): ResolvedBymaxStorageOptions {
  validateOptions(options)
  return applyDefaults(options)
}

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
    const resolved = resolveAsyncOptions(options)
    const providers: Provider[] = [
      { provide: BYMAX_STORAGE_OPTIONS, useValue: resolved },
      {
        provide: BYMAX_STORAGE_UPLOAD_VALIDATORS,
        useValue: resolved.validation?.customValidators ?? [],
      },
      { provide: BYMAX_STORAGE_FILE_SCANNER, useValue: resolved.scanner?.impl ?? null },
      ...BymaxStorageModule.buildCoreProviders(),
    ]
    return {
      module: BymaxStorageModule,
      providers,
      exports: BymaxStorageModule.buildExports(),
    }
  }

  /**
   * Asynchronous configuration (the canonical NestJS pattern). Resolves the
   * options from injected dependencies via `useFactory` (+ `inject`), `useClass`,
   * or `useExisting`, running `validateOptions` + `applyDefaults` inside the
   * factory. Replicates every provider and export of {@link forRoot}.
   *
   * @param asyncOptions - The async options descriptor.
   * @returns The configured `DynamicModule`.
   * @throws Error when none of `useFactory`/`useClass`/`useExisting` is provided.
   *
   * @example
   *   BymaxStorageModule.forRootAsync({
   *     imports: [ConfigModule],
   *     inject: [ConfigService],
   *     useFactory: (config: ConfigService) => ({
   *       endpoint: config.getOrThrow('S3_ENDPOINT'),
   *       region: config.getOrThrow('S3_REGION'),
   *       bucket: config.getOrThrow('S3_BUCKET'),
   *       credentials: {
   *         accessKeyId: config.getOrThrow('S3_ACCESS_KEY_ID'),
   *         secretAccessKey: config.getOrThrow('S3_SECRET_ACCESS_KEY'),
   *       },
   *     }),
   *   })
   */
  static forRootAsync(asyncOptions: BymaxStorageModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = [
      ...BymaxStorageModule.buildAsyncOptionsProviders(asyncOptions),
      {
        provide: BYMAX_STORAGE_UPLOAD_VALIDATORS,
        useFactory: (resolved: ResolvedBymaxStorageOptions) =>
          resolved.validation?.customValidators ?? [],
        inject: [BYMAX_STORAGE_OPTIONS],
      },
      {
        provide: BYMAX_STORAGE_FILE_SCANNER,
        useFactory: (resolved: ResolvedBymaxStorageOptions) => resolved.scanner?.impl ?? null,
        inject: [BYMAX_STORAGE_OPTIONS],
      },
      ...BymaxStorageModule.buildCoreProviders(),
    ]
    return {
      module: BymaxStorageModule,
      imports: asyncOptions.imports ?? [],
      providers,
      exports: BymaxStorageModule.buildExports(),
    }
  }

  /** Providers shared by both configuration paths (options-agnostic). */
  private static buildCoreProviders(): Provider[] {
    return [
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
  }

  /**
   * Public DI surface: the facades, the resolved options, the raw-client token,
   * and the user-supplied validators + scanner tokens. Internal services and the
   * idempotency cache are intentionally not exported.
   */
  private static buildExports(): (Provider | symbol)[] {
    return [
      StorageService,
      SignedUrlService,
      BYMAX_STORAGE_OPTIONS,
      BYMAX_STORAGE_S3_CLIENT,
      BYMAX_STORAGE_UPLOAD_VALIDATORS,
      BYMAX_STORAGE_FILE_SCANNER,
    ]
  }

  /**
   * Builds the options provider plus, for `useClass`, the factory-class provider
   * that must be registered so Nest can instantiate and inject it.
   */
  private static buildAsyncOptionsProviders(
    asyncOptions: BymaxStorageModuleAsyncOptions,
  ): Provider[] {
    const optionsProvider = BymaxStorageModule.createAsyncOptionsProvider(asyncOptions)
    if (asyncOptions.useClass) {
      return [optionsProvider, { provide: asyncOptions.useClass, useClass: asyncOptions.useClass }]
    }
    return [optionsProvider]
  }

  /** Builds the `BYMAX_STORAGE_OPTIONS` provider from the async descriptor. */
  private static createAsyncOptionsProvider(
    asyncOptions: BymaxStorageModuleAsyncOptions,
  ): Provider {
    const { useFactory, useClass, useExisting } = asyncOptions
    if (useFactory) {
      return {
        provide: BYMAX_STORAGE_OPTIONS,
        useFactory: async (...args: unknown[]) => resolveAsyncOptions(await useFactory(...args)),
        inject: [...(asyncOptions.inject ?? [])],
      }
    }
    const factoryToken = useClass ?? useExisting
    if (factoryToken) {
      return {
        provide: BYMAX_STORAGE_OPTIONS,
        useFactory: async (factory: BymaxStorageModuleOptionsFactory) =>
          resolveAsyncOptions(await factory.createStorageOptions()),
        inject: [factoryToken],
      }
    }
    throw new Error(
      'BymaxStorageModule.forRootAsync requires useFactory, useClass, or useExisting',
    )
  }
}
