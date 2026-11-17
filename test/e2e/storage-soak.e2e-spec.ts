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
import { BymaxStorageModule, SignedUrlService, StorageService } from '@bymax-one/nest-storage'
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

/** Heap, resident memory and open sockets now, taken after a collection when `--expose-gc` is on. */
function takeSample(startedAt: number): Sample {
  global.gc?.()
  const mem = process.memoryUsage()
  return {
    at: Math.round((Date.now() - startedAt) / 1000),
    heapMb: Math.round(mem.heapUsed / MB),
    rssMb: Math.round(mem.rss / MB),
    sockets: openSockets(),
  }
}

/** Written straight to stderr, so the table is printed when the test ends. */
function reportSamples(iterations: number, samples: Sample[]): void {
  process.stderr.write(
    `SOAK iterations=${String(iterations)} samples=\n${samples.map((s) => JSON.stringify(s)).join('\n')}\n`,
  )
}

/** One round of the mix under test: a full and an aborted download, a buffered one, a signed URL, two uploads. */
async function transferOnce(
  storage: StorageService,
  signed: SignedUrlService,
  iteration: number,
): Promise<void> {
  const key = `soak/${String(iteration % 20)}.bin`
  await storage.upload({
    key,
    body: Buffer.alloc(2 * MB, iteration % 256),
    contentType: 'application/octet-stream',
  })
  const full = await storage.download({ key })
  for await (const chunk of full.stream) {
    void chunk
  }
  const partial = await storage.download({ key })
  destroyStream(partial.stream)
  await storage.downloadBuffer({ key })
  await signed.getDownloadUrl({ key })
  await storage.upload({
    key: `soak/multi-${String(iteration % 5)}.bin`,
    body: Readable.from(Array.from({ length: 6 }, () => Buffer.alloc(MB))),
    contentType: 'application/octet-stream',
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Starts MinIO and a module over it. */
async function bootSoakModule(): Promise<{ minio: MinioHandle; moduleRef: TestingModule }> {
  const minio = await startMinio('soak')
  const moduleRef = await Test.createTestingModule({
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
  return { minio, moduleRef }
}

/** Runs the transfer mix for `SOAK_MS`, sampling every `SAMPLE_MS`, and prints the table. */
async function runSoak(storage: StorageService, signed: SignedUrlService): Promise<Sample[]> {
  const samples: Sample[] = []
  const started = Date.now()
  let nextSample = started
  let iterations = 0

  while (Date.now() - started < SOAK_MS) {
    await transferOnce(storage, signed, iterations)
    iterations += 1

    if (Date.now() >= nextSample) {
      nextSample += SAMPLE_MS
      samples.push(takeSample(started))
    }
  }

  reportSamples(iterations, samples)
  return samples
}

describeSoak('Storage E2E — soak', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule

  beforeAll(async () => {
    ;({ minio, moduleRef } = await bootSoakModule())
  })

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it(
    'keeps heap and open sockets flat under sustained transfers',
    async () => {
      const samples = await runSoak(moduleRef.get(StorageService), moduleRef.get(SignedUrlService))

      // Warm-up is the first third; compare the first and last five samples after it.
      const steady = samples.slice(Math.floor(samples.length / 3))
      expect(steady.length).toBeGreaterThanOrEqual(6)
      const head = steady.slice(0, 5)
      const tail = steady.slice(-5)
      expect(median(tail.map((s) => s.heapMb))).toBeLessThanOrEqual(
        median(head.map((s) => s.heapMb)) * 1.25 + 10,
      )
      expect(median(tail.map((s) => s.sockets))).toBeLessThanOrEqual(
        median(head.map((s) => s.sockets)) + 2,
      )
    },
    SOAK_MS + 120_000,
  )
})
