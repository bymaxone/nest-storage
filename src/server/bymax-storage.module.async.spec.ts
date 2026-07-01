/**
 * @fileoverview Unit tests for `BymaxStorageModule.forRootAsync` — the
 * `useFactory` (+ inject), `useClass`, and `useExisting` paths, the
 * missing-descriptor guard, in-factory validate/resolve, and replication of the
 * `forRoot` provider surface (StorageService injectable after async bootstrap).
 * @layer server/module
 */
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxStorageModule } from './bymax-storage.module'
import {
  BYMAX_STORAGE_FILE_SCANNER,
  BYMAX_STORAGE_OPTIONS,
  BYMAX_STORAGE_UPLOAD_VALIDATORS,
} from './bymax-storage.constants'
import { StorageService } from './services/storage.service'
import { StorageException } from './errors/storage-exception'
import type { ResolvedBymaxStorageOptions } from './config/resolved-options'
import type { BymaxStorageModuleOptions, BymaxStorageModuleOptionsFactory } from './interfaces/storage-module-options.interface'
import type { IFileScanner } from './interfaces/file-scanner.interface'
import type { IUploadValidator } from './interfaces/upload-validator.interface'

const base: BymaxStorageModuleOptions = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

/** Minimal ConfigService stand-in feeding the async factory. */
class StubConfig {
  get(key: string): string {
    return key === 'bucket' ? base.bucket : base.endpoint
  }
}

@Module({ providers: [StubConfig], exports: [StubConfig] })
class StubConfigModule {}

/** Options factory used for both `useClass` and `useExisting`. */
class OptionsFactory implements BymaxStorageModuleOptionsFactory {
  createStorageOptions(): BymaxStorageModuleOptions {
    return base
  }
}

@Module({ providers: [OptionsFactory], exports: [OptionsFactory] })
class ExistingFactoryModule {}

describe('BymaxStorageModule.forRootAsync', () => {
  it('resolves options from injected dependencies via useFactory', async () => {
    // useFactory + inject reads the stub config; validation/scanner branches hit.
    const validator: IUploadValidator = { name: 'v', validate: () => Promise.resolve({ ok: true }) }
    const scanner: IFileScanner = { scan: () => Promise.resolve({ status: 'clean', engine: 'noop' }) }
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRootAsync({
          imports: [StubConfigModule],
          inject: [StubConfig],
          useFactory: (...args: unknown[]) => {
            const config = args[0] as StubConfig
            return {
              endpoint: config.get('endpoint'),
              region: 'us-east-1',
              bucket: config.get('bucket'),
              credentials: { accessKeyId: 'k', secretAccessKey: 's' },
              validation: { customValidators: [validator] },
              scanner: { impl: scanner },
            }
          },
        }),
      ],
    }).compile()
    const resolved = moduleRef.get<ResolvedBymaxStorageOptions>(BYMAX_STORAGE_OPTIONS)
    expect(resolved.bucket).toBe('b')
    // applyDefaults ran inside the factory (a defaulted field is present).
    expect(typeof resolved.maxAttempts).toBe('number')
    expect(moduleRef.get(StorageService)).toBeInstanceOf(StorageService)
    expect(moduleRef.get(BYMAX_STORAGE_UPLOAD_VALIDATORS)).toEqual([validator])
    expect(moduleRef.get(BYMAX_STORAGE_FILE_SCANNER)).toBe(scanner)
    await moduleRef.close()
  })

  it('instantiates the factory via useClass and applies default token branches', async () => {
    // useClass registers + instantiates the factory; no validation/scanner → defaults.
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxStorageModule.forRootAsync({ useClass: OptionsFactory })],
    }).compile()
    expect(moduleRef.get<ResolvedBymaxStorageOptions>(BYMAX_STORAGE_OPTIONS).bucket).toBe('b')
    expect(moduleRef.get(StorageService)).toBeInstanceOf(StorageService)
    expect(moduleRef.get(BYMAX_STORAGE_UPLOAD_VALIDATORS)).toEqual([])
    expect(moduleRef.get(BYMAX_STORAGE_FILE_SCANNER)).toBeNull()
    await moduleRef.close()
  })

  it('reuses an existing factory instance via useExisting', async () => {
    // useExisting injects the already-provided factory from an imported module.
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRootAsync({ imports: [ExistingFactoryModule], useExisting: OptionsFactory }),
      ],
    }).compile()
    expect(moduleRef.get<ResolvedBymaxStorageOptions>(BYMAX_STORAGE_OPTIONS).bucket).toBe('b')
    expect(moduleRef.get(StorageService)).toBeInstanceOf(StorageService)
    await moduleRef.close()
  })

  it('throws when none of useFactory/useClass/useExisting is provided', () => {
    // The missing-descriptor guard fails fast at module construction.
    expect(() => BymaxStorageModule.forRootAsync({})).toThrow(
      'BymaxStorageModule.forRootAsync requires useFactory, useClass, or useExisting',
    )
  })

  it('runs validateOptions inside the factory (rejecting invalid options)', async () => {
    // Invalid options surface as a StorageException while the module boots.
    await expect(
      Test.createTestingModule({
        imports: [BymaxStorageModule.forRootAsync({ useFactory: () => ({ ...base, endpoint: '' }) })],
      }).compile(),
    ).rejects.toThrow(StorageException)
  })
})
