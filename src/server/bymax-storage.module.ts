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
  BYMAX_STORAGE_OPTIONS,
  BYMAX_STORAGE_S3_CLIENT,
  BYMAX_STORAGE_UPLOAD_VALIDATORS,
} from './bymax-storage.constants'
import type { BymaxStorageModuleOptions } from './interfaces/storage-module-options.interface'
import { validateOptions } from './config/validate-options'
import { applyDefaults } from './config/apply-defaults'
import { S3ClientProvider } from './providers/s3-client.provider'
import { KeyResolverService } from './services/key-resolver.service'

@Global()
@Module({})
export class BymaxStorageModule {
  /**
   * Synchronous configuration.
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
      // Public DI surface: the resolved options + the raw-client token.
      // S3ClientProvider and KeyResolverService stay internal.
      exports: [BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_S3_CLIENT],
    }
  }
}
