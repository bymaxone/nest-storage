/**
 * @fileoverview What an error carries of the strings a call was given. The identifiers the caller supplied in
 * THIS request (the per-call bucket, the key, the copy keys, the list prefix) may stay in the details, as a
 * string of at most 1024 characters (S3's key limit) and otherwise are left out; a value the host supplied as
 * configuration (the option bucket, the key prefix, the MIME whitelist) never appears. Driven through the
 * real module wiring against an endpoint that refuses the connection, so every failure is a provider failure.
 * @layer server/services
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { Logger } from '@nestjs/common'
import { BymaxStorageModule } from '../bymax-storage.module'
import { StorageService } from './storage.service'

const CONFIG_BUCKET = 'CFG-BUCKET-SENTINEL'
const CONFIG_PREFIX = 'CFG-PREFIX-SENTINEL'
const CONFIG_MIME = 'cfg-mime-sentinel/x'
const CALLER_BUCKET = 'caller-bucket-held'
const CALLER_KEY = 'caller/object.txt'
const LONG = 'k'.repeat(1025)
const LIMIT = 'k'.repeat(1024)

const base = {
  endpoint: 'http://127.0.0.1:1',
  region: 'us-east-1',
  bucket: CONFIG_BUCKET,
  keyPrefix: CONFIG_PREFIX,
  maxAttempts: 1,
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

type Run = (s: StorageService, key: string, bucket?: string) => Promise<unknown>

const calls: [string, Run][] = [
  ['upload', (s, key, bucket) => s.upload({ key, body: Buffer.from('x'), contentType: 'text/plain', ...(bucket ? { bucket } : {}) })],
  ['head', (s, key, bucket) => s.head(key, bucket ? { bucket } : undefined)],
  ['download', (s, key, bucket) => s.download({ key, ...(bucket ? { bucket } : {}) })],
  ['downloadBuffer', (s, key, bucket) => s.downloadBuffer({ key, ...(bucket ? { bucket } : {}) })],
  ['delete', (s, key, bucket) => s.delete(key, bucket ? { bucket } : undefined)],
  ['copy', (s, key, bucket) => s.copy({ sourceKey: key, destinationKey: key, ...(bucket ? { sourceBucket: bucket } : {}) })],
]

/** The error a call ends with, as its whole response body. */
async function failure(run: () => Promise<unknown>): Promise<{ text: string; details: Record<string, unknown> }> {
  try {
    await run()
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as
      | { error?: { details?: Record<string, unknown> } }
      | undefined
    return { text: JSON.stringify(response), details: response?.error?.details ?? {} }
  }
  throw new Error('the call did not fail')
}

describe('the strings an error carries', () => {
  let moduleRef: TestingModule | undefined
  let storage: StorageService

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    moduleRef = await Test.createTestingModule({ imports: [BymaxStorageModule.forRoot(base)] }).compile()
    storage = moduleRef.get(StorageService)
  })

  afterAll(async () => {
    await moduleRef?.close()
    jest.restoreAllMocks()
  })

  describe.each(calls)('%s', (name, run) => {
    it('keeps the key the caller gave, and its bucket where the call reports one, and nothing of the configuration', async () => {
      const { text, details } = await failure(() => run(storage, CALLER_KEY, CALLER_BUCKET))

      expect(text).not.toContain(CONFIG_BUCKET)
      expect(text).not.toContain(CONFIG_PREFIX)
      expect(JSON.stringify(details)).toContain(CALLER_KEY)
      if (name !== 'copy') expect(details.bucket).toBe(CALLER_BUCKET)
    })

    it('leaves out the bucket when the caller gave none, so the configured one is not repeated', async () => {
      const { text, details } = await failure(() => run(storage, CALLER_KEY))

      expect(text).not.toContain(CONFIG_BUCKET)
      expect(text).not.toContain(CONFIG_PREFIX)
      expect(details).not.toHaveProperty('bucket')
    })

    it('carries a key of 1024 characters and leaves out one of 1025', async () => {
      const kept = await failure(() => run(storage, LIMIT))
      const dropped = await failure(() => run(storage, LONG))

      expect(kept.text).toContain(LIMIT)
      expect(dropped.text).not.toContain(LONG)
      expect(dropped.text).not.toContain(CONFIG_PREFIX)
    })
  })

  it('leaves the configured whitelist out of the MIME refusal and keeps the type the caller sent', async () => {
    const module = await Test.createTestingModule({
      imports: [BymaxStorageModule.forRoot({ ...base, validation: { mimeWhitelist: [CONFIG_MIME] } })],
    }).compile()
    const { text, details } = await failure(() =>
      module.get(StorageService).upload({ key: CALLER_KEY, body: Buffer.from('x'), contentType: 'text/plain' }),
    )
    await module.close()

    expect(text).not.toContain(CONFIG_MIME)
    expect(details).not.toHaveProperty('whitelist')
    expect(details.contentType).toBe('text/plain')
  })

  describe('a pre-upload scan that outlasts its deadline', () => {
    it('keeps the key the caller passed and leaves out the configured prefix and bucket', async () => {
      const never = { scan: () => new Promise<never>(() => undefined) }
      const module = await Test.createTestingModule({
        imports: [BymaxStorageModule.forRoot({ ...base, scanner: { impl: never, mode: 'pre-upload', timeoutMs: 20 } })],
      }).compile()
      const { text, details } = await failure(() =>
        module.get(StorageService).upload({ key: CALLER_KEY, body: Buffer.from('x'), contentType: 'text/plain' }),
      )
      await module.close()

      expect(details).toMatchObject({ phase: 'scan', timeoutMs: 20, key: CALLER_KEY })
      expect(details).not.toHaveProperty('bucket')
      expect(text).not.toContain(CONFIG_BUCKET)
      expect(text).not.toContain(CONFIG_PREFIX)
    })
  })

  it('leaves the configured bucket and prefix out of a list failure and keeps the prefix the caller gave', async () => {
    const { text, details } = await failure(() => storage.list({ prefix: 'mine/' }))

    expect(text).not.toContain(CONFIG_BUCKET)
    expect(text).not.toContain(CONFIG_PREFIX)
    expect(details.prefix).toBe('mine/')
  })

  it('leaves out the prefix of a list the caller gave none, so the configured one is not repeated', async () => {
    const { text, details } = await failure(() => storage.list({}))

    expect(text).not.toContain(CONFIG_PREFIX)
    expect(details).not.toHaveProperty('prefix')
  })
})
