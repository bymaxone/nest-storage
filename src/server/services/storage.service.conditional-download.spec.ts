/**
 * @fileoverview Conditional and ranged downloads against a local HTTP server that
 * answers like S3: `If-None-Match` matching gives 304, `If-Match` failing gives 412,
 * a `Range` gives 206. The outcomes are typed errors with stable codes.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { StorageService } from './storage.service'

describe('conditional and ranged download', () => {
  let server: Server
  let port: number
  let seen: Record<string, string | string[] | undefined>[] = []
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.headers)
      res.setHeader('ETag', '"v1"')
      res.setHeader('Content-Type', 'text/plain')
      if (req.headers['if-none-match'] === '"v1"') {
        res.statusCode = 304
        res.end()
      } else if (req.headers['if-match'] !== undefined && req.headers['if-match'] !== '"v1"') {
        res.statusCode = 412
        res.setHeader('Content-Type', 'application/xml')
        res.end('<Error><Code>PreconditionFailed</Code><Message>At least one of the preconditions you specified did not hold.</Message></Error>')
      } else if (req.headers.range !== undefined) {
        res.statusCode = 206
        res.setHeader('Content-Range', 'bytes 0-2/10')
        res.setHeader('Content-Length', '3')
        res.end('abc')
      } else {
        res.setHeader('Content-Length', '10')
        res.end('abcdefghij')
      }
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
    seen = []
  })

  async function storage(): Promise<StorageService> {
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
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  async function failure(promise: Promise<unknown>): Promise<unknown> {
    return promise.catch((err: unknown) => err)
  }

  it('maps a matching If-None-Match (304) to STORAGE_NOT_MODIFIED', async () => {
    const error = await failure((await storage()).download({ key: 'a.txt', ifNoneMatch: '"v1"' }))

    expect(error).toMatchObject({ code: 'STORAGE_NOT_MODIFIED', status: 304 })
    expect(seen[0]?.['if-none-match']).toBe('"v1"')
  })

  it('maps a failing If-Match (412) to STORAGE_PRECONDITION_FAILED', async () => {
    const error = await failure((await storage()).download({ key: 'a.txt', ifMatch: '"other"' }))

    expect(error).toMatchObject({ code: 'STORAGE_PRECONDITION_FAILED', status: 412 })
  })

  it('carries the provider status and request context in details, never the caught error', async () => {
    const error = await failure((await storage()).download({ key: 'a.txt', ifNoneMatch: '"v1"' }))

    const details = (error as { getResponse(): { error: { details: Record<string, unknown> } } }).getResponse().error.details
    expect(details).toMatchObject({ httpStatus: 304, op: 'download', bucket: 'b', key: 'a.txt' })
    expect((error as { cause?: unknown }).cause).toBeUndefined()
  })

  it('returns the object when the conditions hold', async () => {
    const result = await (await storage()).downloadBuffer({ key: 'a.txt', ifNoneMatch: '"v2"', ifMatch: '"v1"' })

    expect(result.buffer.toString()).toBe('abcdefghij')
  })

  it('returns the requested range', async () => {
    const result = await (await storage()).downloadBuffer({ key: 'a.txt', range: 'bytes=0-2' })

    expect(result.buffer.toString()).toBe('abc')
    expect(seen[0]?.range).toBe('bytes=0-2')
  })
})
