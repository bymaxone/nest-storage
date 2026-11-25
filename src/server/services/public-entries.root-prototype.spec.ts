/**
 * @fileoverview Every public entry of the three services runs the root-prototype guard before it
 * reads an option or the key, so a runtime that differs from the one the library found at load is
 * refused with the guard's own error and never answered from a decision made with a built-in that
 * was changed (the entries that never reach the provider, such as `getPublicUrl`, included).
 * @layer server/services
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { isRootRefusal } from '../utils/prototype-guard'
import { BucketLifecycleService } from './bucket-lifecycle.service'
import { SignedUrlService } from './signed-url.service'
import { StorageService } from './storage.service'

/** An argument no entry can accept: without the guard first, each fails on its own validation. */
const BAD = undefined as never

describe('every public entry runs the guard before it reads anything', () => {
  let moduleRef: TestingModule | undefined

  afterEach(async () => {
    Reflect.deleteProperty(Object.prototype, 'plantedByTest')
    await moduleRef?.close()
    moduleRef = undefined
  })

  async function setup(): Promise<{
    storage: StorageService
    signed: SignedUrlService
    lifecycle: BucketLifecycleService
  }> {
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: 'http://127.0.0.1:1',
          region: 'us-east-1',
          bucket: 'b',
          forcePathStyle: true,
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          maxAttempts: 1,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return {
      storage: moduleRef.get(StorageService),
      signed: moduleRef.get(SignedUrlService),
      lifecycle: moduleRef.get(BucketLifecycleService),
    }
  }

  function plant(): void {
    Object.defineProperty(Object.prototype, 'plantedByTest', {
      value: 1,
      configurable: true,
      enumerable: false,
      writable: true,
    })
  }

  type Services = Awaited<ReturnType<typeof setup>>
  const ENTRIES: [string, (s: Services) => unknown][] = [
    ['upload', (s) => s.storage.upload(BAD)],
    ['head', (s) => s.storage.head(BAD)],
    ['exists', (s) => s.storage.exists(BAD)],
    ['getPublicUrl', (s) => s.storage.getPublicUrl(BAD)],
    ['download', (s) => s.storage.download(BAD)],
    ['downloadBuffer', (s) => s.storage.downloadBuffer(BAD)],
    ['delete', (s) => s.storage.delete(BAD)],
    ['checkBucket', (s) => s.storage.checkBucket({ bucket: 1 } as never)],
    ['list', (s) => s.storage.list(BAD)],
    ['copy', (s) => s.storage.copy(BAD)],
    ['deleteMany', (s) => s.storage.deleteMany(BAD)],
    ['getDownloadUrl', (s) => s.signed.getDownloadUrl(BAD)],
    ['getUploadUrl', (s) => s.signed.getUploadUrl(BAD)],
    ['getMultipartUploadUrls', (s) => s.signed.getMultipartUploadUrls(BAD)],
    ['lifecycle get', (s) => s.lifecycle.get({ bucket: 1 } as never)],
    ['lifecycle upsert', (s) => s.lifecycle.upsert(BAD)],
    ['lifecycle remove', (s) => s.lifecycle.remove(BAD)],
  ]

  async function outcome(call: () => unknown): Promise<unknown> {
    try {
      return await call()
    } catch (error) {
      return error
    }
  }

  it.each(ENTRIES)('%s refuses before it reads its argument', async (_name, call) => {
    // The argument is unusable, so an entry that reads it first fails with its own error.
    const services = await setup()
    plant()
    const result = await outcome(() => call(services))
    expect(isRootRefusal(result)).toBe(true)
  })

  it.each(ENTRIES)(
    '%s answers with its own error when the runtime is clean',
    async (_name, call) => {
      // The control: the same unusable argument, no plant, is the entry's own failure and not a refusal.
      const services = await setup()
      const result = await outcome(() => call(services))
      expect(isRootRefusal(result)).toBe(false)
    },
  )
})
