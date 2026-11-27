/**
 * @fileoverview An old-style source that fails, or is released by a rejected upload, raises nothing
 * uncaught. Run with the SDK's default checksum settings, which wrap a request body in streams of
 * the SDK's own that do not listen for its errors.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Stream } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { STORAGE_ERROR_CODES } from '../../shared'
import { StorageService } from './storage.service'

const CHUNK = Buffer.alloc(100_000, 1)

/** An old-style stream: one chunk once resumed, then silence, or what `then` names. */
const oldStyle = (then: 'close' | 'error' | undefined, onDestroy: string[]): Stream => {
  const source = new Stream()
  let started = false
  const raise = (event: string): void => {
    source.emit(event, event === 'error' ? new Error('boom') : undefined)
  }
  return Object.assign(source, {
    readable: true,
    pause: () => undefined,
    destroy: () => {
      onDestroy.forEach(raise)
    },
    resume: () => {
      if (started) return
      started = true
      setImmediate(() => {
        source.emit('data', CHUNK)
        if (then) setTimeout(raise, 30, then)
      })
    },
  })
}

describe('an old-style source under the default checksum settings', () => {
  let server: Server
  let moduleRef: TestingModule
  let storage: StorageService
  let refuses = false

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('error', () => undefined)
      if (!refuses) return
      setTimeout(() => {
        res.statusCode = 403
        res.setHeader('connection', 'close')
        res.end('<Error><Code>AccessDenied</Code></Error>')
      }, 60)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
          region: 'us-east-1',
          bucket: 'test-bucket',
          forcePathStyle: true,
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
          maxAttempts: 1,
        }),
      ],
    }).compile()
    await moduleRef.init()
    storage = moduleRef.get(StorageService)
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    await moduleRef.close()
  })

  // An error raised on the request body with nothing listening fails the test that is running.
  it.each([
    ['released with a close', true, undefined, ['close']],
    ['released with an error', true, undefined, ['error']],
    ['that errors before its end', false, 'error' as const, []],
    ['that closes before its end', false, 'close' as const, []],
  ])('fails the upload of a source %s, raising nothing else', async (_n, refused, then, raised) => {
    refuses = refused
    const body = oldStyle(then, raised) as unknown as NodeJS.ReadableStream

    await expect(
      storage.upload({ key: 'k', body, contentType: 'text/plain', size: 2 * CHUNK.length }),
    ).rejects.toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR } },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
})
