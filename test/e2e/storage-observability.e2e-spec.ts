/**
 * @fileoverview The metrics and the readiness check against a live MinIO: what a real upload, a missing object, a
 * download, a delete and a rejected scan add to a scrape, a bucket that answers is `up` and one that does not
 * exist is `down` with no detail.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { Registry } from 'prom-client'
import {
  BymaxStorageModule,
  StorageMetricsTally,
  StorageService,
  providerRecipes,
} from '@bymax-one/nest-storage'
import { StorageHealthIndicator, StorageMetrics } from '../../src/observability'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — observability', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let storage: StorageService
  const registry = new Registry()

  /** A module over the live bucket, or over `bucket` when given, with the observability providers. */
  async function moduleFor(bucket: string, scan = true): Promise<TestingModule> {
    const built = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          ...providerRecipes.minio({
            endpoint: minio.endpoint,
            bucket,
            accessKeyId: minio.accessKeyId,
            secretAccessKey: minio.secretAccessKey,
          }),
          ...(scan
            ? {
                scanner: {
                  mode: 'pre-upload',
                  impl: {
                    scan: ({ key }) =>
                      Promise.resolve(
                        key.startsWith('virus')
                          ? { status: 'infected' as const, engine: 'test', threat: 'EICAR' }
                          : { status: 'clean' as const, engine: 'test' },
                      ),
                  },
                },
              }
            : {}),
        }),
      ],
      providers: [StorageMetrics, StorageHealthIndicator],
    }).compile()
    await built.init()
    return built
  }

  beforeAll(async () => {
    minio = await startMinio()
    moduleRef = await moduleFor(minio.bucket)
    storage = moduleRef.get(StorageService)
    moduleRef.get(StorageMetrics).registerMetrics(registry)
  }, 60_000)

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('counts what really happened, and the scrape shows it', async () => {
    await storage.upload({
      key: 'obs/a.txt',
      body: Buffer.from('hello'),
      contentType: 'text/plain',
    })
    await storage.head('obs/missing.txt').catch(() => undefined)
    await storage.downloadBuffer({ key: 'obs/a.txt' })
    await storage.delete('obs/a.txt')
    await storage
      .upload({
        key: 'virus/x.bin',
        body: Buffer.from('x'),
        contentType: 'application/octet-stream',
      })
      .catch(() => undefined)

    const text = await registry.metrics()

    expect(text).toContain('bymax_storage_operations_total{operation="upload",outcome="success"} 1')
    expect(text).toContain('bymax_storage_operations_total{operation="upload",outcome="error"} 1')
    expect(text).toContain('bymax_storage_operations_total{operation="head",outcome="not_found"} 1')
    expect(text).toContain(
      'bymax_storage_operations_total{operation="download",outcome="success"} 1',
    )
    expect(text).toContain('bymax_storage_operations_total{operation="delete",outcome="success"} 1')
    expect(text).toContain('bymax_storage_bytes_uploaded_total 5')
    expect(text).toContain('bymax_storage_scans_total{verdict="clean"} 1')
    expect(text).toContain('bymax_storage_scans_total{verdict="infected"} 1')
    expect(text).toMatch(/bymax_storage_operation_duration_seconds_count\{operation="upload"\} 2/)
    expect(text).not.toContain('obs/a.txt')
    expect(text).not.toContain('virus')
  })

  it('reports a bucket that answers as up, and one that does not exist as down with no detail', async () => {
    const up = await moduleRef.get(StorageHealthIndicator).check()
    const missing = await moduleFor('no-such-bucket')
    const down = await missing.get(StorageHealthIndicator).check()
    await missing.close()

    expect(up).toEqual({ status: 'up' })
    expect(down).toEqual({ status: 'down' })
  })

  it('counts the bytes a stream without a declared size really sent, small and multipart', async () => {
    const plain = await moduleFor(minio.bucket, false)
    const plainStorage = plain.get(StorageService)
    const MIB = 1024 * 1024

    await plainStorage.upload({
      key: 'obs/small.bin',
      body: Readable.from([Buffer.alloc(500)]),
      contentType: 'x/y',
    })
    await plainStorage.upload({
      key: 'obs/big.bin',
      body: Readable.from([Buffer.alloc(7 * MIB)]),
      contentType: 'x/y',
    })
    await plainStorage.upload({
      key: 'obs/direct.bin',
      body: Buffer.alloc(1000),
      contentType: 'x/y',
    })

    const counted = plain.get(StorageMetricsTally).snapshot().bytesUploaded
    const stored =
      (await plainStorage.head('obs/small.bin')).size +
      (await plainStorage.head('obs/big.bin')).size +
      (await plainStorage.head('obs/direct.bin')).size
    await plain.close()
    expect(stored).toBe(500 + 7 * MIB + 1000)
    expect(counted).toBe(stored)
  })
})
