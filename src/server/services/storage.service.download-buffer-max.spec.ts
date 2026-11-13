/**
 * @fileoverview `downloadBuffer({ maxBytes })` holds at most `maxBytes`: an object whose
 * `Content-Length` is over it is refused before its body is read, a body longer than it turns out
 * to be is cut off as it is counted, and the connection is released either way.
 * @layer server/services
 */
import { Readable } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { StorageException } from '../errors/storage-exception'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'

/** A body of `chunks` chunks of `chunkBytes` bytes, counting how many the consumer pulled. */
function countedBody(chunks: number, chunkBytes: number): { body: Readable; pulled: () => number } {
  let pulled = 0
  const body = new Readable({
    read() {
      if (pulled >= chunks) {
        this.push(null)
        return
      }
      pulled += 1
      this.push(Buffer.alloc(chunkBytes, 9))
    },
  })
  return { body, pulled: () => pulled }
}

function makeService(): { service: StorageService; send: jest.Mock } {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    bodyIdleTimeoutMs: 0,
  })
  const send = jest.fn()
  const s3Provider = {
    isConfigured: (): boolean => true,
    getClient: (): S3Client => ({ send }) as unknown as S3Client,
  } as unknown as S3ClientProvider
  const service = new StorageService(
    resolved,
    s3Provider,
    new KeyResolverService(resolved),
    new IdempotencyCache(10, 1000, () => 0),
    { validate: jest.fn() } as unknown as ValidationService,
    { isEnabled: () => false, getMode: () => null, scan: jest.fn() } as unknown as FileScannerService,
  )
  return { service, send }
}

function detailsOf(error: unknown): Record<string, unknown> {
  const body = (error as StorageException).getResponse() as {
    error?: { details?: Record<string, unknown> }
  }
  return body.error?.details ?? {}
}

describe('downloadBuffer maxBytes', () => {
  it('refuses an object whose Content-Length is over the limit without reading its body', async () => {
    // The header already says the object is too big, so nothing is pulled and the body is released.
    const { service, send } = makeService()
    const { body, pulled } = countedBody(100, 1024)
    send.mockResolvedValue({ Body: body, ContentLength: 100 * 1024 })

    const error: unknown = await service
      .downloadBuffer({ key: 'big.bin', maxBytes: 4096 })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED', status: 413 })
    expect(detailsOf(error)).toMatchObject({ maxSize: 4096, contentLength: 100 * 1024, key: 'big.bin' })
    expect(pulled()).toBe(0)
    expect(body.destroyed).toBe(true)
  })

  it('cuts off a body with no Content-Length once it passes the limit, and releases it', async () => {
    // A missing length cannot be trusted, so the bytes are counted as they arrive.
    const { service, send } = makeService()
    const { body, pulled } = countedBody(1000, 1024)
    send.mockResolvedValue({ Body: body })

    const error: unknown = await service
      .downloadBuffer({ key: 'chunked.bin', maxBytes: 4096 })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(detailsOf(error)).toMatchObject({ maxSize: 4096 })
    expect(pulled()).toBeLessThan(10)
    expect(body.destroyed).toBe(true)
  })

  it('cuts off a body longer than its understated Content-Length', async () => {
    // A wrong length passes the header check and is caught by the count.
    const { service, send } = makeService()
    const { body } = countedBody(10, 1024)
    send.mockResolvedValue({ Body: body, ContentLength: 10 })

    const error: unknown = await service
      .downloadBuffer({ key: 'liar.bin', maxBytes: 4096 })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(body.destroyed).toBe(true)
  })

  it.each([4096, 5000])('returns a body that fits in maxBytes %i, including one of exactly the limit', async (limit) => {
    // The limit itself is allowed.
    const { service, send } = makeService()
    const { body } = countedBody(4, 1024)
    send.mockResolvedValue({ Body: body, ContentLength: 4096 })

    const { buffer } = await service.downloadBuffer({ key: 'ok.bin', maxBytes: limit })

    expect(buffer.length).toBe(4096)
  })

  it('buffers without a limit when maxBytes is not given', async () => {
    // The option is opt-in; the call behaves as before without it.
    const { service, send } = makeService()
    const { body } = countedBody(8, 1024)
    send.mockResolvedValue({ Body: body, ContentLength: 8192 })

    const { buffer } = await service.downloadBuffer({ key: 'free.bin' })

    expect(buffer.length).toBe(8192)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5' as unknown as number])(
    'rejects a maxBytes of %p before any request',
    async (maxBytes) => {
      // A zero, negative, fractional, non-finite or non-number limit would silently mean no limit or an impossible one.
      const { service, send } = makeService()

      const error: unknown = await service
        .downloadBuffer({ key: 'a.bin', maxBytes })
        .catch((err: unknown) => err)

      expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
      expect(JSON.stringify((error as StorageException).getResponse())).toContain('maxBytes')
      expect(send).not.toHaveBeenCalled()
    },
  )
})
