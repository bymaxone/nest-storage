/**
 * @fileoverview A sustained-transfer soak against a live MinIO: uploads, full and aborted
 * downloads, aborted multipart uploads and signed URLs in a loop, sampling heap and open sockets
 * every `STORAGE_SOAK_SAMPLE_MS`. It passes only when both are flat after warm-up. Off unless
 * `STORAGE_SOAK_MS` is set, so the regular end-to-end run is unaffected; run it with
 * `node --expose-gc` so each sample is taken after a collection.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import {
  BymaxStorageModule,
  SignedUrlService,
  StorageService,
} from '@bymax-one/nest-storage'
import { destroyStream } from '../../src/server/utils/stream-utils'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

const SOAK_MS = Number(process.env.STORAGE_SOAK_MS ?? 0)
const SAMPLE_MS = Number(process.env.STORAGE_SOAK_SAMPLE_MS ?? 30_000)
const MB = 1024 * 1024
const describeSoak = SOAK_MS > 0 ? describe : describe.skip

interface Sample {
  at: number
  heapMb: number
  rssMb: number
  sockets: number
}

function openSockets(): number {
  return process.getActiveResourcesInfo().filter((name) => name === 'TCPSocketWrap').length
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

describeSoak('Storage E2E — soak', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule

  beforeAll(async () => {
    minio = await startMinio('soak')
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: minio.endpoint,
          region: 'us-east-1',
          bucket: minio.bucket,
          forcePathStyle: true,
          credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: minio.secretAccessKey },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }),
      ],
    }).compile()
    await moduleRef.init()
  })

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('keeps heap and open sockets flat under sustained transfers', async () => {
    const storage = moduleRef.get(StorageService)
    const signed = moduleRef.get(SignedUrlService)
    const samples: Sample[] = []
    const started = Date.now()
    let nextSample = started
    let iterations = 0

    while (Date.now() - started < SOAK_MS) {
      const key = `soak/${String(iterations % 20)}.bin`
      await storage.upload({ key, body: Buffer.alloc(2 * MB, iterations % 256), contentType: 'application/octet-stream' })
      const full = await storage.download({ key })
      for await (const chunk of full.stream) {
        void chunk
      }
      const partial = await storage.download({ key })
      destroyStream(partial.stream)
      await storage.downloadBuffer({ key })
      await signed.getDownloadUrl({ key })
      await storage.upload({
        key: `soak/multi-${String(iterations % 5)}.bin`,
        body: Readable.from(Array.from({ length: 6 }, () => Buffer.alloc(MB))),
        contentType: 'application/octet-stream',
      })
      iterations += 1

      if (Date.now() >= nextSample) {
        nextSample += SAMPLE_MS
        global.gc?.()
        const mem = process.memoryUsage()
        samples.push({
          at: Math.round((Date.now() - started) / 1000),
          heapMb: Math.round(mem.heapUsed / MB),
          rssMb: Math.round(mem.rss / MB),
          sockets: openSockets(),
        })
      }
    }

    console.log(`SOAK iterations=${String(iterations)} samples=\n${samples.map((s) => JSON.stringify(s)).join('\n')}`)

    // Warm-up is the first third; compare the first and last five samples after it.
    const steady = samples.slice(Math.floor(samples.length / 3))
    expect(steady.length).toBeGreaterThanOrEqual(6)
    const head = steady.slice(0, 5)
    const tail = steady.slice(-5)
    expect(median(tail.map((s) => s.heapMb))).toBeLessThanOrEqual(median(head.map((s) => s.heapMb)) * 1.25 + 10)
    expect(median(tail.map((s) => s.sockets))).toBeLessThanOrEqual(median(head.map((s) => s.sockets)) + 2)
  }, SOAK_MS + 120_000)
})
