/**
 * @fileoverview Every public method that takes a per-call bucket refuses a bucket that is not a string, and
 * every `StorageService` method that takes an `abortSignal` refuses a signal that is not one, before any
 * request: a validation error that names the field and echoes nothing of the value. Driven through the real
 * module wiring, so a method that forgot the check, or a service that has its own copy of it, shows here.
 * @layer server/services
 */
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { BucketLifecycleService } from './bucket-lifecycle.service'
import { SignedUrlService } from './signed-url.service'
import { StorageService } from './storage.service'

const SENTINEL = 'SENTINEL-SERVICE-INPUT'

const base = {
  endpoint: 'http://127.0.0.1:1',
  region: 'us-east-1',
  bucket: 'default-bucket',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

interface Services {
  storage: StorageService
  signed: SignedUrlService
  lifecycle: BucketLifecycleService
}

/** A call under test: the method's name, and how to run it with the hostile value in the field being checked. */
type Call = [string, (s: Services, bad: unknown) => unknown]

const bucketCalls: Call[] = [
  ['upload', (s, bad) => s.storage.upload({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain', bucket: bad as string })],
  ['head', (s, bad) => s.storage.head('k', { bucket: bad as string })],
  ['download', (s, bad) => s.storage.download({ key: 'k', bucket: bad as string })],
  ['downloadBuffer', (s, bad) => s.storage.downloadBuffer({ key: 'k', bucket: bad as string })],
  ['delete', (s, bad) => s.storage.delete('k', { bucket: bad as string })],
  ['deleteMany', (s, bad) => s.storage.deleteMany(['k'], { bucket: bad as string })],
  ['checkBucket', (s, bad) => s.storage.checkBucket({ bucket: bad as string })],
  ['list', (s, bad) => s.storage.list({ bucket: bad as string })],
  ['getPublicUrl', (s, bad) => s.storage.getPublicUrl('k', { bucket: bad as string })],
  ['copy (source)', (s, bad) => s.storage.copy({ sourceKey: 'a', destinationKey: 'b', sourceBucket: bad as string })],
  ['copy (destination)', (s, bad) => s.storage.copy({ sourceKey: 'a', destinationKey: 'b', destinationBucket: bad as string })],
  ['getDownloadUrl', (s, bad) => s.signed.getDownloadUrl({ key: 'k', bucket: bad as string })],
  ['getUploadUrl', (s, bad) => s.signed.getUploadUrl({ key: 'k', contentType: 'text/plain', bucket: bad as string })],
  ['getMultipartUploadUrls', (s, bad) => s.signed.getMultipartUploadUrls({ key: 'k', contentType: 'text/plain', parts: 2, bucket: bad as string })],
  ['lifecycle get', (s, bad) => s.lifecycle.get({ bucket: bad as string })],
  ['lifecycle upsert', (s, bad) => s.lifecycle.upsert({ id: 'r', prefix: 'p/', expirationDays: 7 }, { bucket: bad as string })],
  ['lifecycle remove', (s, bad) => s.lifecycle.remove('r', { bucket: bad as string })],
]

const abortCalls: Call[] = [
  ['upload', (s, bad) => s.storage.upload({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain', abortSignal: bad as AbortSignal })],
  ['head', (s, bad) => s.storage.head('k', { abortSignal: bad as AbortSignal })],
  ['download', (s, bad) => s.storage.download({ key: 'k', abortSignal: bad as AbortSignal })],
  ['downloadBuffer', (s, bad) => s.storage.downloadBuffer({ key: 'k', abortSignal: bad as AbortSignal })],
  ['delete', (s, bad) => s.storage.delete('k', { abortSignal: bad as AbortSignal })],
  ['checkBucket', (s, bad) => s.storage.checkBucket({ abortSignal: bad as AbortSignal })],
  ['list', (s, bad) => s.storage.list({ abortSignal: bad as AbortSignal })],
]

const hostileBuckets: [string, unknown][] = [
  ['a Symbol', Symbol(SENTINEL)],
  ['a function', function SENTINEL_SERVICE_FN(): void {}],
  ['an array', [SENTINEL]],
  ['a getter object', { get secret(): string { return SENTINEL } }],
  ['a Date', new Date(0)],
  ['a BigInt', 7n],
]

const hostileSignals: [string, unknown][] = [
  ['a string', SENTINEL],
  ['a Symbol', Symbol(SENTINEL)],
  ['a BigInt', 7n],
  ['a getter object', { get secret(): string { return SENTINEL } }],
]

/** What a call ended with: the typed error's code, status, field and its whole response body. */
async function outcome(run: () => unknown): Promise<{ code: unknown; status: unknown; field: unknown; response: string }> {
  let thrown: unknown
  try {
    await run()
  } catch (error) {
    thrown = error
  }
  const exception = thrown as { code?: unknown; status?: unknown; getResponse?: () => unknown } | undefined
  const response = exception?.getResponse?.() as { error?: { details?: { field?: unknown } } } | undefined
  return {
    code: exception?.code,
    status: exception?.status,
    field: response?.error?.details?.field,
    response: JSON.stringify(response ?? String(thrown)),
  }
}

describe('a per-call input of the wrong kind', () => {
  let moduleRef: TestingModule | undefined
  let services: Services

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [BymaxStorageModule.forRoot(base)] }).compile()
    services = {
      storage: moduleRef.get(StorageService),
      signed: moduleRef.get(SignedUrlService),
      lifecycle: moduleRef.get(BucketLifecycleService),
    }
  })

  afterAll(async () => {
    await moduleRef?.close()
  })

  describe.each(bucketCalls)('%s: the bucket', (_method, call) => {
    it.each(hostileBuckets)('refuses %s with a validation error that names the bucket and echoes nothing', async (_what, bad) => {
      const result = await outcome(() => call(services, bad))

      expect(result).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400, field: 'bucket' })
      expect(result.response).not.toContain('SENTINEL')
    })
  })

  describe.each(abortCalls)('%s: the abort signal', (_method, call) => {
    it.each(hostileSignals)('refuses %s with a validation error that names the signal and echoes nothing', async (_what, bad) => {
      const result = await outcome(() => call(services, bad))

      expect(result).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400, field: 'abortSignal' })
      expect(result.response).not.toContain('SENTINEL')
    })
  })

  describe('exists: the bucket', () => {
    // `exists` answers false for any failure that is not a missing object and logs it, so a bucket of the wrong
    // kind shows as that answer and a warning: what must hold is that the warning repeats nothing of the value.
    it.each(hostileBuckets)('answers false for %s and warns without echoing it', async (_what, bad) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      try {
        const answer = await services.storage.exists('k', { bucket: bad as string })

        expect(answer).toBe(false)
        expect(JSON.stringify(warn.mock.calls)).not.toContain('SENTINEL')
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    })
  })

  describe('getMultipartUploadUrls: the part count', () => {
    it.each([
      ['a string', SENTINEL],
      ['an array', [SENTINEL]],
      ['NaN', Number.NaN],
      ['a Symbol', Symbol(SENTINEL)],
      ['a BigInt', 7n],
    ] as [string, unknown][])('refuses %s without echoing it', async (_what, bad) => {
      const result = await outcome(() =>
        services.signed.getMultipartUploadUrls({ key: 'k', contentType: 'text/plain', parts: bad as number }),
      )

      expect(result).toMatchObject({ code: 'STORAGE_INVALID_PART_COUNT' })
      expect(result.response).not.toContain('SENTINEL')
      expect(result.response).not.toContain('provided')
    })

    it('still names a numeric part count that is out of range', async () => {
      const result = await outcome(() =>
        services.signed.getMultipartUploadUrls({ key: 'k', contentType: 'text/plain', parts: 10_001 }),
      )

      expect(result.response).toContain('"provided":10001')
    })
  })
})
