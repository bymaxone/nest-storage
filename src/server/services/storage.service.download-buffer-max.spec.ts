/**
 * @fileoverview `downloadBuffer({ maxBytes })` holds at most `maxBytes`: an object whose
 * `Content-Length` is over it is refused before its body is read, a body longer than it turns out
 * to be is cut off as it is counted, and the connection is released either way.
 * @layer server/services
 */
import { Readable } from 'node:stream'
import { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import { StorageException } from '../errors/storage-exception'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import { ValidationService } from './validation.service'
import { FileScannerService } from './file-scanner.service'

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

function makeService(bodyIdleTimeoutMs = 0): { service: StorageService; send: jest.SpyInstance } {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    bodyIdleTimeoutMs,
  })
  // Real collaborators. Replaced: the client's `send` (the network call) and the provider's `getClient`
  // and `isConfigured`, which would otherwise need an initialised module; everything else is real.
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  })
  const send = jest.spyOn(client, 'send')
  const s3Provider = new S3ClientProvider(resolved)
  jest.spyOn(s3Provider, 'getClient').mockReturnValue(client)
  jest.spyOn(s3Provider, 'isConfigured').mockReturnValue(true)
  const service = new StorageService(
    resolved,
    s3Provider,
    new KeyResolverService(resolved),
    new IdempotencyCache(10, 1000, () => 0),
    new ValidationService(resolved, []),
    new FileScannerService(resolved, null),
  )
  return { service, send }
}

/** The `details` of a `StorageException`, or an empty object for any other error. */
function detailsOf(error: unknown): Record<string, unknown> {
  if (!(error instanceof StorageException)) {
    return {}
  }
  const body: unknown = error.getResponse()
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return {}
  }
  const inner: unknown = body.error
  if (typeof inner !== 'object' || inner === null || !('details' in inner)) {
    return {}
  }
  const details: unknown = inner.details
  return typeof details === 'object' && details !== null ? { ...details } : {}
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
    expect(detailsOf(error)).toMatchObject({
      maxSize: 4096,
      contentLength: 100 * 1024,
      key: 'big.bin',
      bucket: 'b',
    })
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
    // Without maxBytes the whole body is buffered, whatever its size.
    const { service, send } = makeService()
    const { body } = countedBody(8, 1024)
    send.mockResolvedValue({ Body: body, ContentLength: 8192 })

    const { buffer } = await service.downloadBuffer({ key: 'free.bin' })

    expect(buffer.length).toBe(8192)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5'])(
    'rejects a maxBytes of %p before any request',
    async (maxBytes) => {
      // A zero, negative, fractional, non-finite or non-number limit would silently mean no limit or an
      // impossible one. Reflect.apply takes untyped arguments, so a caller's bad input reaches the method as
      // it would from untyped code, with no assertion to hide a type error.
      const { service, send } = makeService()
      const callUntyped = (input: unknown): Promise<unknown> => {
        const result: unknown = Reflect.apply(service.downloadBuffer, service, [input])
        return Promise.resolve(result)
      }

      const error: unknown = await callUntyped({ key: 'a.bin', maxBytes }).catch((err: unknown) => err)

      expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
      expect(error).toBeInstanceOf(StorageException)
      expect(JSON.stringify(error instanceof StorageException ? error.getResponse() : {})).toContain('maxBytes')
      expect(send).not.toHaveBeenCalled()
    },
  )

  it('returns a body of exactly maxBytes when no Content-Length was sent', async () => {
    // With no header to check, the count alone must let the limit itself through.
    const { service, send } = makeService()
    const { body } = countedBody(4, 1024)
    send.mockResolvedValue({ Body: body })

    const { buffer } = await service.downloadBuffer({ key: 'exact.bin', maxBytes: 4096 })

    expect(buffer.length).toBe(4096)
  })

  it('passes a failure of the body mid-read through unchanged and releases it', async () => {
    // A connection that drops while counting is the provider's error, not a size error.
    const { service, send } = makeService()
    let pulled = 0
    const failure = new Error('connection reset')
    const body = new Readable({
      read() {
        pulled += 1
        if (pulled === 1) {
          this.push(Buffer.alloc(10))
          return
        }
        this.destroy(failure)
      },
    })
    send.mockResolvedValue({ Body: body })

    const error: unknown = await service
      .downloadBuffer({ key: 'drop.bin', maxBytes: 4096 })
      .catch((err: unknown) => err)

    expect(error).toBe(failure)
    expect(body.destroyed).toBe(true)
  })

  it('still ends a stalled body with STORAGE_TIMEOUT when a limit is set', async () => {
    // The limit adds to the idle guard of download(); it does not replace it.
    const { service, send } = makeService(200)
    let sent = false
    const body = new Readable({
      read() {
        // Delivers one chunk, then goes silent.
        if (!sent) {
          sent = true
          this.push(Buffer.alloc(10))
        }
      },
    })
    send.mockResolvedValue({ Body: body, ContentLength: 20 })

    const error: unknown = await service
      .downloadBuffer({ key: 'stall.bin', maxBytes: 4096 })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
    expect(detailsOf(error)).toMatchObject({ phase: 'body-idle' })
    expect(body.destroyed).toBe(true)
  })
})
