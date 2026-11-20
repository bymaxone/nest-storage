/**
 * @fileoverview The log events written by real flows hold library text only. Every entry a scripted run
 * produces carries a code of the catalog and a string `message`, and nothing the host configured (the
 * region, the S3 host, the bucket, the key prefix) or supplied (a key, a scanner's error) appears in any
 * field but `err`, where the text of a failure belongs.
 * @layer server
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxStorageModule } from './bymax-storage.module'
import { StorageService } from './services/storage.service'
import type { IFileScanner } from './interfaces/file-scanner.interface'
import { STORAGE_LOG_EVENTS } from './utils/log-events'

const REGION = 'region-sentinel-9'
const HOST = 's3-host-sentinel.localhost'
const BUCKET = 'bucket-sentinel'
const PREFIX = 'prefix-sentinel'
const KEY = 'caller-key-sentinel.txt'
const HOST_ERROR = 'HOST-ERROR-SENTINEL'

const base = {
  endpoint: `http://${HOST}:1`,
  region: REGION,
  bucket: BUCKET,
  keyPrefix: PREFIX,
  maxAttempts: 1,
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

type Entry = { event: string; message: string; err?: Error } & Record<string, unknown>

describe('the log events of a scripted run', () => {
  const entries: Entry[] = []

  beforeAll(() => {
    for (const level of ['debug', 'log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        const entry = args[0]
        if (typeof entry === 'object' && entry !== null) entries.push(entry as Entry)
      })
    }
  })

  afterAll(() => {
    jest.restoreAllMocks()
  })

  async function run(extra: Record<string, unknown>, act: (storage: StorageService) => Promise<unknown>): Promise<void> {
    const module = await Test.createTestingModule({ imports: [BymaxStorageModule.forRoot({ ...base, ...extra })] }).compile()
    await module.init()
    await act(module.get(StorageService)).catch(() => undefined)
    await module.close()
  }

  const scanner = (scan: IFileScanner['scan']): Record<string, unknown> => ({
    scanner: { impl: { scan }, mode: 'pre-upload', timeoutMs: 30 },
  })
  const upload = (storage: StorageService): Promise<unknown> =>
    storage.upload({ key: KEY, body: Buffer.from('x'), contentType: 'text/plain' })

  beforeAll(async () => {
    await run({}, (storage) => storage.head(KEY))
    await run({}, async (storage) => storage.exists(KEY))
    await run({ signedUrls: { maxTtlSeconds: 604801 } }, () => Promise.resolve())
    await run({ credentials: { accessKeyId: '', secretAccessKey: '' } }, () => Promise.resolve())
    await run(scanner(() => Promise.resolve({ status: 'infected', engine: 'eng', threat: 'thr' })), upload)
    await run(scanner(() => Promise.resolve({ status: 'unknown', engine: 'eng' })), upload)
    await run({ ...scanner(() => Promise.resolve({ status: 'unknown', engine: 'eng' })), scanner: { impl: { scan: () => Promise.resolve({ status: 'unknown', engine: 'eng' }) }, mode: 'pre-upload', rejectOnUnknown: true } }, upload)
    await run(scanner(() => Promise.reject(new Error(HOST_ERROR))), upload)
    await run(scanner(() => new Promise(() => undefined)), upload)
  }, 60000)

  it('writes each event of the run, and each carries a code of the catalog and library text', () => {
    const codes = new Set(Object.values(STORAGE_LOG_EVENTS))
    const seen = new Set(entries.map((entry) => entry.event))

    for (const entry of entries) {
      expect(codes.has(entry.event as never)).toBe(true)
      expect(typeof entry.message).toBe('string')
    }
    for (const event of [
      STORAGE_LOG_EVENTS.providerCallFailed,
      STORAGE_LOG_EVENTS.existsFailed,
      STORAGE_LOG_EVENTS.ttlClamped,
      STORAGE_LOG_EVENTS.credentialsMissing,
      STORAGE_LOG_EVENTS.clientReady,
      STORAGE_LOG_EVENTS.scanInfected,
      STORAGE_LOG_EVENTS.scanInconclusiveAccepted,
      STORAGE_LOG_EVENTS.scanInconclusiveRejected,
      STORAGE_LOG_EVENTS.scanFailed,
      STORAGE_LOG_EVENTS.scanTimeout,
    ]) {
      expect(seen).toContain(event)
    }
  })

  it.each([REGION, HOST, BUCKET, PREFIX, KEY, HOST_ERROR])('keeps %s out of every field but err', (sentinel) => {
    for (const entry of entries) {
      expect(JSON.stringify({ ...entry, err: undefined })).not.toContain(sentinel)
    }
  })

  it('puts what a scanner threw under err, and not in the message', () => {
    const failed = entries.find((entry) => entry.event === STORAGE_LOG_EVENTS.scanFailed)

    expect(failed?.message).toBe('Scanner failed')
    expect(failed?.err?.message).toBe(HOST_ERROR)
  })
})
