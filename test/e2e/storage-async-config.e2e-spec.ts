/**
 * @fileoverview End-to-end suite proving `forRootAsync()` against live MinIO: a
 * stub ConfigService feeds the async factory, and a real upload + head round-trip
 * confirms the async-bootstrapped `StorageService` is fully wired.
 * @layer test/e2e
 */
import { type DynamicModule, Injectable, Module } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, StorageService } from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

/** Minimal ConfigService stand-in backed by the started container. */
@Injectable()
class StubConfigService {
  constructor(private readonly values: Record<string, string>) {}

  get(key: string): string {
    return this.values[key] ?? ''
  }
}

/** Hosts a pre-populated `StubConfigService` for the async factory to inject. */
@Module({})
class StubConfigModule {
  static register(config: StubConfigService): DynamicModule {
    return {
      module: StubConfigModule,
      providers: [{ provide: StubConfigService, useValue: config }],
      exports: [StubConfigService],
    }
  }
}

describe('Storage E2E — forRootAsync config', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let storage: StorageService

  beforeAll(async () => {
    minio = await startMinio()
    const config = new StubConfigService({
      endpoint: minio.endpoint,
      bucket: minio.bucket,
      accessKeyId: minio.accessKeyId,
      secretAccessKey: minio.secretAccessKey,
    })
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRootAsync({
          imports: [StubConfigModule.register(config)],
          inject: [StubConfigService],
          useFactory: (...args: unknown[]) => {
            const cfg = args[0] as StubConfigService
            return {
              endpoint: cfg.get('endpoint'),
              region: 'us-east-1',
              bucket: cfg.get('bucket'),
              credentials: {
                accessKeyId: cfg.get('accessKeyId'),
                secretAccessKey: cfg.get('secretAccessKey'),
              },
              forcePathStyle: true,
              requestChecksumCalculation: 'WHEN_REQUIRED',
              responseChecksumValidation: 'WHEN_REQUIRED',
            }
          },
        }),
      ],
    }).compile()
    await moduleRef.init()
    storage = moduleRef.get(StorageService)
  }, 60_000)

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('bootstraps StorageService from async config and round-trips an upload', async () => {
    // The async-resolved options fully wire StorageService against MinIO.
    const body = Buffer.from('async-config', 'utf-8')
    await storage.upload({ key: 'e2e/async.txt', body, contentType: 'text/plain' })
    const head = await storage.head('e2e/async.txt')
    expect(head.size).toBe(body.byteLength)
  })
})
