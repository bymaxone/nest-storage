/**
 * @fileoverview A stream body that stops delivering bytes mid-upload must not hold a multipart
 * upload open: the guard aborts it, destroys the source and rejects `STORAGE_TIMEOUT`. Driven
 * against a local S3 stand-in that records which calls reached it, under both SDK checksum
 * settings (the SDK wraps a stream body in its own Readable under its default).
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import * as idleTimeout from '../utils/idle-timeout'
import type { StorageException } from '../errors/storage-exception'
import { StorageService } from './storage.service'

const MIB = 1024 * 1024

/** The `details` a `StorageException` carries in its response body. */
function detailsOf(error: unknown): Record<string, unknown> | undefined {
  const body = (error as StorageException).getResponse() as {
    error?: { details?: Record<string, unknown> }
  }
  return body.error?.details
}

/** A source that delivers `chunks` chunks of 1 MiB, one per `everyMs`, then stays silent unless `end`. */
function pacedSource(
  chunks: number,
  everyMs: number,
  end: boolean,
): { stream: Readable; sent: () => number } {
  let sent = 0
  const stream = new Readable({
    read() {
      if (sent >= chunks) {
        if (end) {
          this.push(null)
        }
        return
      }
      sent += 1
      setTimeout(() => {
        this.push(Buffer.alloc(MIB, 7))
        if (sent >= chunks && end) {
          this.push(null)
        }
      }, everyMs)
    },
  })
  return { stream, sent: () => sent }
}

describe.each(['WHEN_REQUIRED', 'WHEN_SUPPORTED'] as const)(
  'multipart upload with a source that goes silent (%s)',
  (checksumMode) => {
    let server: Server
    let port: number
    let calls: string[] = []
    let moduleRef: TestingModule | undefined

    beforeAll(async () => {
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://stand-in')
        req.resume()
        req.on('end', () => {
          calls.push(
            `${req.method ?? ''} ${url.searchParams.has('uploads') ? 'uploads' : (url.search.split('&')[0] ?? '')}`,
          )
          if (req.method === 'POST' && url.searchParams.has('uploads')) {
            res.setHeader('content-type', 'application/xml')
            res.end(
              '<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>u1</UploadId></InitiateMultipartUploadResult>',
            )
          } else if (req.method === 'PUT' && url.searchParams.has('partNumber')) {
            res.setHeader('ETag', '"p"')
            res.end()
          } else if (req.method === 'DELETE') {
            res.statusCode = 204
            res.end()
          } else if (req.method === 'PUT') {
            res.setHeader('ETag', '"single"')
            res.end()
          } else {
            res.setHeader('content-type', 'application/xml')
            res.end(
              '<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>',
            )
          }
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      port = (server.address() as AddressInfo).port
    })

    afterAll(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    })

    afterEach(async () => {
      await moduleRef?.close()
      moduleRef = undefined
      calls = []
      jest.restoreAllMocks()
    })

    async function storageWith(
      extra: Partial<BymaxStorageModuleOptions> = {},
    ): Promise<StorageService> {
      moduleRef = await Test.createTestingModule({
        imports: [
          BymaxStorageModule.forRoot({
            endpoint: `http://127.0.0.1:${String(port)}`,
            region: 'us-east-1',
            bucket: 'b',
            forcePathStyle: true,
            credentials: { accessKeyId: 'k', secretAccessKey: 's' },
            requestChecksumCalculation: checksumMode,
            responseChecksumValidation: checksumMode,
            maxAttempts: 1,
            requestTimeoutMs: 5000,
            ...extra,
          }),
        ],
      }).compile()
      await moduleRef.init()
      return moduleRef.get(StorageService)
    }

    /** Runs an upload, then reports what escaped to the process while the aftermath settled. */
    async function settle(
      attempt: () => Promise<unknown>,
    ): Promise<{ outcome: unknown; escaped: unknown[] }> {
      const escaped: unknown[] = []
      const onEscape = (err: unknown): void => {
        escaped.push(err)
      }
      process.on('uncaughtException', onEscape)
      const outcome = await attempt().then(
        (value) => value,
        (err: unknown) => err,
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
      process.removeListener('uncaughtException', onEscape)
      return { outcome, escaped }
    }

    it('rejects STORAGE_TIMEOUT, destroys the source, aborts the multipart upload and leaks nothing', async () => {
      const storage = await storageWith({ uploadIdleTimeoutMs: 400 })
      // Six chunks arrive at once, then the source goes silent without ending.
      const { stream } = pacedSource(6, 0, false)
      const started = Date.now()

      const { outcome, escaped } = await settle(() =>
        storage.upload({ key: 'a', body: stream, contentType: 'application/octet-stream' }),
      )

      expect(outcome).toMatchObject({ code: 'STORAGE_TIMEOUT' })
      expect(detailsOf(outcome)).toMatchObject({ phase: 'source-idle', idleMs: 400, key: 'a' })
      expect(Date.now() - started).toBeLessThan(4000)
      expect(stream.destroyed).toBe(true)
      expect(calls).toEqual(expect.arrayContaining(['POST uploads', 'DELETE ?uploadId=u1']))
      expect(escaped).toEqual([])
    })

    it('lets a slow source finish when every gap is shorter than the limit', async () => {
      const storage = await storageWith({ uploadIdleTimeoutMs: 600 })
      // Six chunks, 250 ms apart: the whole upload outlasts the limit, no single silence does.
      const { stream } = pacedSource(6, 250, true)

      const result = await storage.upload({
        key: 'a',
        body: stream,
        contentType: 'application/octet-stream',
      })

      expect(result.multipart).toBe(true)
      expect(calls).not.toContain('DELETE ?uploadId=u1')
    })

    it('does not time out a slow consumer: a source that is not being read is not idle', async () => {
      const storage = await storageWith({ uploadIdleTimeoutMs: 300 })
      const { stream } = pacedSource(6, 0, true)

      const result = await storage.upload({
        key: 'a',
        body: stream,
        contentType: 'application/octet-stream',
      })

      expect(result.multipart).toBe(true)
    })

    it('turns the guard off with 0', async () => {
      const storage = await storageWith({ uploadIdleTimeoutMs: 0 })
      const { stream } = pacedSource(6, 0, false)
      const guard = jest.spyOn(idleTimeout, 'withIdleTimeout')

      const pending = storage.upload({
        key: 'a',
        body: stream,
        contentType: 'application/octet-stream',
      })
      const winner = await Promise.race([
        pending.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve('still pending')
          }, 1500)
        }),
      ])

      expect(winner).toBe('still pending')
      expect(guard).not.toHaveBeenCalled()
      stream.destroy()
      await pending.catch(() => undefined)
    })

    it('does not wrap a single-shot body, so a stalled one is left to requestTimeoutMs', async () => {
      const storage = await storageWith({ uploadIdleTimeoutMs: 200, requestTimeoutMs: 900 })
      const guard = jest.spyOn(idleTimeout, 'withIdleTimeout')
      const { stream } = pacedSource(0, 0, false)

      const { outcome } = await settle(() =>
        storage.upload({ key: 'a', body: stream, contentType: 'text/plain', size: 10 }),
      )

      expect(guard).not.toHaveBeenCalled()
      expect(outcome).toMatchObject({ code: 'STORAGE_TIMEOUT' })
      expect(detailsOf(outcome)?.phase).toBeUndefined()
    })

    it('defaults the idle limit to requestTimeoutMs', async () => {
      const storage = await storageWith({ requestTimeoutMs: 400 })
      const { stream } = pacedSource(6, 0, false)

      const { outcome } = await settle(() =>
        storage.upload({ key: 'a', body: stream, contentType: 'application/octet-stream' }),
      )

      expect(outcome).toMatchObject({ code: 'STORAGE_TIMEOUT' })
      expect(detailsOf(outcome)).toMatchObject({ phase: 'source-idle', idleMs: 400 })
    })
  },
)
