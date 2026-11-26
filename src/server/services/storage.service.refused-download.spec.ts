/**
 * @fileoverview A download that is refused after the provider answered releases the body it holds.
 * @layer server/services
 */
import { PassThrough } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'
import { StorageObserver } from '../observability/storage-observer'
import { StorageMetricsTally } from '../observability/storage-metrics-tally'
import { StorageTracing } from '../observability/storage-tracing'

const root = Object.prototype as unknown as Record<string, unknown>

/** A service whose `send` answers with `body` and plants a key `depth` microtasks later. */
function planted(
  body: PassThrough,
  depth: number,
  bodyIdleTimeoutMs: number,
  answer?: () => Promise<unknown>,
  observer?: StorageObserver,
): StorageService {
  const options = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    bodyIdleTimeoutMs,
  })
  const send = (): Promise<unknown> => {
    let left = depth
    const hop = (): void => {
      if (left === 0) {
        root.plantedAfterAnswer = true
        return
      }
      left -= 1
      queueMicrotask(hop)
    }
    queueMicrotask(hop)
    return Promise.resolve({ Body: body, ContentLength: 3 })
  }
  const client = { send: answer ?? send } as unknown as S3Client
  const provider = {
    isConfigured: (): boolean => true,
    getClient: (): S3Client => client,
  } as unknown as S3ClientProvider
  return new StorageService(
    options,
    provider,
    new KeyResolverService(options),
    new IdempotencyCache(100, 60_000, () => 0),
    // Neither collaborator is reached on a download.
    undefined as unknown as ValidationService,
    undefined as unknown as FileScannerService,
    observer,
  )
}

describe('a refused download', () => {
  afterEach(() => {
    Reflect.deleteProperty(root, 'plantedAfterAnswer')
  })

  // Each depth refuses at a different check between the provider's answer and the first read.
  it.each([0, 1000])(
    'destroys the body at every refusal point (bodyIdleTimeoutMs %i)',
    async (idle) => {
      for (let depth = 0; depth < 6; depth += 1) {
        const body = new PassThrough()
        body.write('abc')
        const call = planted(body, depth, idle).downloadBuffer({ key: 'a.txt' })
        await expect(call).rejects.toMatchObject({
          response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
        })
        Reflect.deleteProperty(root, 'plantedAfterAnswer')
        await new Promise((resolve) => setImmediate(resolve))
        expect({ depth, destroyed: body.destroyed }).toEqual({ depth, destroyed: true })
      }
    },
  )

  // The module wires an observer, which adds its own checks after the method has returned.
  it.each(['download', 'downloadBuffer'] as const)(
    'destroys the body when %s is refused through the observer',
    async (method) => {
      let refusals = 0
      for (let depth = 0; depth < 20; depth += 1) {
        const body = new PassThrough()
        // Ended but unread: only a release, or a completed read, can destroy it.
        body.end('abc')
        const observer = new StorageObserver(new StorageMetricsTally(), new StorageTracing())
        const service = planted(body, depth, 0, undefined, observer)
        // A plant that lands after the answer leaves the body open to a caller who received it.
        const refused = await (
          method === 'download'
            ? service.download({ key: 'a.txt' })
            : service.downloadBuffer({ key: 'a.txt' })
        ).then(
          () => false,
          () => true,
        )
        // Drain first: a plant deeper than the call still runs, and would refuse the next one at entry.
        await new Promise((resolve) => setImmediate(resolve))
        Reflect.deleteProperty(root, 'plantedAfterAnswer')
        if (refused) {
          refusals += 1
          expect({ depth, destroyed: body.destroyed }).toEqual({ depth, destroyed: true })
        }
      }
      expect(refusals).toBeGreaterThan(2)
    },
  )

  it('reports a client that throws before it returns a promise as a provider failure', async () => {
    // There is no pending answer to release, and the release must not add a failure of its own.
    const send = (): never => {
      throw new Error('boom')
    }
    const service = planted(new PassThrough(), 0, 0, send)
    await expect(service.download({ key: 'a.txt' })).rejects.toMatchObject({
      response: { error: { code: 'STORAGE_PROVIDER_ERROR' } },
    })
  })

  it('answers a clean download with every byte', async () => {
    // Nothing is planted here, so nothing is released early.
    const body = new PassThrough()
    body.end('abc')
    const answer = (): Promise<unknown> => Promise.resolve({ Body: body, ContentLength: 3 })
    const call = planted(body, 0, 0, answer).downloadBuffer({ key: 'a.txt' })
    await expect(call).resolves.toMatchObject({ buffer: Buffer.from('abc') })
  })
})
