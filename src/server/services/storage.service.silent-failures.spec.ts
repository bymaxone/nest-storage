/**
 * @fileoverview A failed write or cleanup must not be reported as a clean outcome. Driven against a
 * local S3 stand-in that records what reached it: a rejected scan whose object could not be removed
 * says so, a multipart upload that fails to complete or to abort says which, and a delete drops the
 * idempotency entries that promise the deleted object.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { StorageException } from '../errors/storage-exception'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { StorageService } from './storage.service'

interface Mode {
  completeFails?: boolean
  partFails?: boolean
  abortFails?: boolean
  abortNoSuchUpload?: boolean
  deleteFails?: boolean
}

const MIB = 1024 * 1024
const infected = { status: 'infected' as const, engine: 'test', threat: 'EICAR' }

function detailsOf(error: unknown): Record<string, unknown> {
  const body = (error as StorageException).getResponse() as {
    error?: { details?: Record<string, unknown> }
  }
  return body.error?.details ?? {}
}

describe('silent failures', () => {
  let server: Server
  let port: number
  let mode: Mode = {}
  let calls: string[] = []
  const objects = new Set<string>()
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stand-in')
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const kind = url.searchParams.has('uploads')
          ? '?uploads'
          : url.searchParams.has('uploadId')
            ? '?uploadId'
            : ''
        calls.push(`${req.method ?? ''} ${url.pathname}${kind}`)
        const xml = (code: number, body: string): void => {
          res.setHeader('content-type', 'application/xml')
          res.statusCode = code
          res.end(body)
        }
        const reply = (code: number): void => {
          res.statusCode = code
          res.end()
        }
        const method = req.method ?? ''
        if (method === 'POST' && url.searchParams.has('delete')) {
          const keys = [
            ...Buffer.concat(chunks)
              .toString()
              .matchAll(/<Key>(.*?)<\/Key>/g),
          ].map((m) => m[1] ?? '')
          for (const key of keys) objects.delete(`/b/${key}`)
          xml(
            200,
            `<DeleteResult>${keys.map((key) => `<Deleted><Key>${key}</Key></Deleted>`).join('')}</DeleteResult>`,
          )
        } else if (method === 'POST' && url.searchParams.has('uploads')) {
          xml(
            200,
            '<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>',
          )
        } else if (method === 'PUT' && url.searchParams.has('partNumber')) {
          res.setHeader('ETag', '"p"')
          reply(mode.partFails ? 500 : 200)
        } else if (method === 'POST' && url.searchParams.has('uploadId')) {
          if (mode.completeFails) reply(500)
          else
            xml(
              200,
              '<CompleteMultipartUploadResult><ETag>"e"</ETag></CompleteMultipartUploadResult>',
            )
        } else if (method === 'DELETE' && url.searchParams.has('uploadId')) {
          if (mode.abortNoSuchUpload)
            xml(404, '<Error><Code>NoSuchUpload</Code><Message>gone</Message></Error>')
          else reply(mode.abortFails ? 500 : 204)
        } else if (method === 'DELETE') {
          if (!mode.deleteFails) objects.delete(url.pathname)
          reply(mode.deleteFails ? 500 : 204)
        } else if (method === 'PUT') {
          objects.add(url.pathname)
          res.setHeader('ETag', '"o"')
          reply(200)
        } else if (method === 'HEAD') {
          reply(objects.has(url.pathname) ? 200 : 404)
        } else {
          reply(404)
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
    mode = {}
    calls = []
    objects.clear()
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
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          maxAttempts: 1,
          requestTimeoutMs: 5000,
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  const bigStream = (): Readable => Readable.from([Buffer.alloc(6 * MIB, 1)])
  const rejection = (promise: Promise<unknown>): Promise<unknown> =>
    promise.catch((err: unknown) => err)
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300))
  const aborts = (): string[] =>
    calls.filter((c) => c.startsWith('DELETE') && c.endsWith('?uploadId'))

  describe('a post-upload scan that rejects the object', () => {
    const postUploadScan = {
      mode: 'post-upload' as const,
      impl: { scan: () => Promise.resolve(infected) },
    }

    it('keeps the verdict as the error and says the object was removed when the delete worked', async () => {
      const storage = await storageWith({ scanner: postUploadScan })

      const error = await rejection(
        storage.upload({ key: 'bad.bin', body: Buffer.from('x'), contentType: 'x/y' }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
      expect(detailsOf(error).cleanup).toBeUndefined()
      expect(objects.size).toBe(0)
    })

    it('removes the rejected object from under the key prefix', async () => {
      const storage = await storageWith({ keyPrefix: 'tenant-x', scanner: postUploadScan })

      const error = await rejection(
        storage.upload({ key: 'bad.bin', body: Buffer.from('x'), contentType: 'x/y' }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
      expect(detailsOf(error).cleanup).toBeUndefined()
      expect(objects.size).toBe(0)
      expect(calls.filter((c) => c.startsWith('DELETE'))).toEqual(['DELETE /b/tenant-x/bad.bin'])
    })

    it('keeps the verdict but says the object is STILL STORED when the delete failed, and logs it', async () => {
      mode = { deleteFails: true }
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const storage = await storageWith({ scanner: postUploadScan })

      const error = await rejection(
        storage.upload({ key: 'bad.bin', body: Buffer.from('x'), contentType: 'x/y' }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
      expect(detailsOf(error)).toMatchObject({ cleanup: 'failed', key: 'bad.bin' })
      expect(typeof detailsOf(error).cleanupError).toBe('string')
      expect(await storage.exists('bad.bin')).toBe(true)
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('STORAGE_SCAN_CLEANUP_FAILED'),
        expect.anything(),
      )
    })
  })

  describe('a multipart upload that fails', () => {
    it('aborts the upload itself when CompleteMultipartUpload fails, and says so', async () => {
      mode = { completeFails: true }
      const storage = await storageWith()

      const error = await rejection(
        storage.upload({ key: 'a', body: bigStream(), contentType: 'x/y' }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_MULTIPART_ABORTED' })
      expect(detailsOf(error)).toMatchObject({ abort: 'completed' })
      expect(aborts()).toHaveLength(1)
    })

    it('keeps the original failure as the error when the abort also fails, and reports the abort failure', async () => {
      mode = { partFails: true, abortFails: true }
      const storage = await storageWith()

      const error = await rejection(
        storage.upload({ key: 'a', body: bigStream(), contentType: 'x/y' }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_MULTIPART_ABORTED' })
      expect(detailsOf(error)).toMatchObject({ abort: 'failed' })
      expect(typeof detailsOf(error).abortError).toBe('string')
      // The original failure is the part upload, not the abort that came after it.
      expect(String(detailsOf(error).awsMessage)).toBe('UnknownError')
      expect(
        calls.filter((c) => c.startsWith('PUT') && c.endsWith('?uploadId')).length,
      ).toBeGreaterThan(0)
    })

    it('does not call an upload that is already gone a failed abort', async () => {
      mode = { completeFails: true, abortNoSuchUpload: true }
      const storage = await storageWith()

      const error = await rejection(
        storage.upload({ key: 'a', body: bigStream(), contentType: 'x/y' }),
      )

      expect(detailsOf(error)).toMatchObject({ abort: 'completed' })
    })

    it('keeps STORAGE_TIMEOUT for a silent source and reports a failed abort', async () => {
      mode = { abortFails: true }
      const storage = await storageWith({ uploadIdleTimeoutMs: 300 })
      let sent = 0
      const stalled = new Readable({
        read() {
          if (sent < 6) {
            sent += 1
            this.push(Buffer.alloc(MIB, 1))
          }
        },
      })

      const error = await rejection(storage.upload({ key: 'a', body: stalled, contentType: 'x/y' }))
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
      expect(detailsOf(error)).toMatchObject({ phase: 'source-idle', abort: 'failed' })
    })

    it('says nothing about an abort when no multipart upload was ever created', async () => {
      const storage = await storageWith({ validation: { mimeWhitelist: ['image/png'] } })

      const error = await rejection(
        storage.upload({ key: 'a', body: bigStream(), contentType: 'text/plain' }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
      expect(detailsOf(error).abort).toBeUndefined()
      expect(aborts()).toHaveLength(0)
    })
  })

  describe('the idempotency cache and delete', () => {
    const upload = (
      storage: StorageService,
      key: string,
      idem: string,
    ): Promise<{ fromIdempotencyCache: boolean }> =>
      storage.upload({ key, body: Buffer.from('x'), contentType: 'x/y', idempotencyKey: idem })

    it('does not answer a repeated upload from the cache once the object was deleted', async () => {
      const storage = await storageWith()
      await upload(storage, 'i', 'k1')
      await storage.delete('i')

      const again = await upload(storage, 'i', 'k1')

      expect(again.fromIdempotencyCache).toBe(false)
      expect(await storage.exists('i')).toBe(true)
    })

    it('keeps the cached answer for a different object', async () => {
      const storage = await storageWith()
      await upload(storage, 'keep', 'k2')
      await upload(storage, 'gone', 'k3')
      await storage.delete('gone')

      expect((await upload(storage, 'keep', 'k2')).fromIdempotencyCache).toBe(true)
    })

    it('keeps the cached answer when the delete failed, since the object may still exist', async () => {
      const storage = await storageWith()
      await upload(storage, 'i', 'k4')
      mode = { deleteFails: true }
      await rejection(storage.delete('i'))
      mode = {}

      expect((await upload(storage, 'i', 'k4')).fromIdempotencyCache).toBe(true)
    })

    it('drops the entries of every key deleteMany removed', async () => {
      const storage = await storageWith()
      await upload(storage, 'm1', 'k5')
      await upload(storage, 'm2', 'k6')
      await storage.deleteMany(['m1'])

      expect((await upload(storage, 'm1', 'k5')).fromIdempotencyCache).toBe(false)
      expect((await upload(storage, 'm2', 'k6')).fromIdempotencyCache).toBe(true)
    })
  })
})
