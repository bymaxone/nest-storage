/**
 * @fileoverview A download that is refused after the provider answered releases the body it holds.
 * @layer server/services
 */
import { PassThrough } from 'node:stream'
import { ReadableStream } from 'node:stream/web'
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

  // A `then` that erases itself is a documented limit of the check; the release must not widen it.
  it.each([
    ['without an observer', 1],
    ['through the observer', 2],
  ])('adds no point where a planted then replaces the answer (%s)', async (mode, windows) => {
    let replaced = 0
    for (let depth = 0; depth < 30; depth += 1) {
      const body = new PassThrough()
      let left = depth
      const hop = (): void => {
        if (left > 0) {
          left -= 1
          queueMicrotask(hop)
          return
        }
        Object.defineProperty(root, 'then', {
          configurable: true,
          value(this: { stream?: unknown }, resolve: (value: unknown) => void) {
            const answered = this.stream !== undefined
            Reflect.deleteProperty(root, 'then')
            if (answered) replaced += 1
            resolve(answered ? { stream: undefined } : this)
          },
        })
      }
      const observer =
        mode === 'through the observer'
          ? new StorageObserver(new StorageMetricsTally(), new StorageTracing())
          : undefined
      const answer = (): Promise<unknown> => {
        queueMicrotask(hop)
        return Promise.resolve({ Body: body, ContentLength: 3 })
      }
      await planted(body, 0, 0, answer, observer)
        .download({ key: 'a.txt' })
        .then(
          () => undefined,
          () => undefined,
        )
      await new Promise((resolve) => setImmediate(resolve))
      Reflect.deleteProperty(root, 'then')
    }
    expect(replaced).toBe(windows)
  })

  it('raises no second failure when the client resolves nothing', async () => {
    // The release reads the answer after the caller has its error; a throw there would end the process.
    const seen: unknown[] = []
    const prior = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', (reason) => seen.push(reason))
    try {
      const service = planted(new PassThrough(), 0, 0, () => Promise.resolve(undefined))
      await expect(service.download({ key: 'a.txt' })).rejects.toMatchObject({
        response: { error: { code: 'STORAGE_PROVIDER_ERROR' } },
      })
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.removeAllListeners('unhandledRejection')
      for (const listener of prior) process.on('unhandledRejection', listener)
    }
    expect(seen).toEqual([])
  })

  /** Refuses `download` after a client answered with `body`, and returns what went unhandled. */
  async function refused(body: unknown, hops = 0): Promise<unknown[]> {
    const seen: unknown[] = []
    const prior = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', (reason) => seen.push(reason))
    try {
      let depth = hops
      const hop = (): void => {
        if (depth === 0) {
          root.plantedAfterAnswer = true
          return
        }
        depth -= 1
        queueMicrotask(hop)
      }
      const answer = (): Promise<unknown> => {
        queueMicrotask(hop)
        return Promise.resolve({ Body: body, ContentLength: 3 })
      }
      await expect(
        planted(new PassThrough(), 0, 1000, answer).download({ key: 'a.txt' }),
      ).rejects.toMatchObject({ response: { error: { code: 'STORAGE_VALIDATION_FAILED' } } })
      for (let turn = 0; turn < 3; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      Reflect.deleteProperty(root, 'plantedAfterAnswer')
    } finally {
      process.removeAllListeners('unhandledRejection')
      for (const listener of prior) process.on('unhandledRejection', listener)
    }
    return seen
  }

  it('handles the rejection of a destroy that returns a promise', async () => {
    // A host's own client can answer with any stream-like body.
    const body = Object.assign(new PassThrough(), {
      destroy: (): Promise<never> => Promise.reject(new Error('from destroy')),
    })
    expect(await refused(body)).toEqual([])
  })

  // The idle guard wraps the body and takes its lock; the two depths refuse on either side of that.
  it.each([
    ['before it is wrapped', 0],
    ['after it is wrapped', 4],
  ] as const)('cancels a web stream body refused %s', async (_when, hops) => {
    let cancelled = false
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true
      },
    })
    expect(await refused(body, hops)).toEqual([])
    expect({ cancelled }).toEqual({ cancelled: true })
  })

  it('leaves a body that holds nothing to release', async () => {
    expect(await refused(new Blob(['abc']))).toEqual([])
  })

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
