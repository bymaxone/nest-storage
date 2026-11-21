/**
 * @fileoverview The span seam runs the operation exactly once, whatever the tracer does, states a closed set
 * of attributes, and reports only the library error code on failure.
 * @layer server/observability
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import { StorageTracing, type StorageSpanAttributes } from './storage-tracing'

interface FakeSpan {
  setStatus: jest.Mock
  setAttributes: jest.Mock
  end: jest.Mock
}

type StartActiveSpan = (
  name: string,
  options: { attributes: Record<string, string> },
  fn: (span: FakeSpan) => unknown,
) => unknown

/** What the fake tracer does when a span is started; each case sets it. */
let startActiveSpan: StartActiveSpan

/** The names the seam asked the API for a tracer under. */
const mockTracerNames: string[] = []

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: (name: string) => {
      mockTracerNames.push(name)
      return {
        startActiveSpan: (...args: unknown[]) =>
          startActiveSpan(...(args as Parameters<StartActiveSpan>)),
      }
    },
  },
}))

/** A span whose calls are recorded. */
function span(): FakeSpan {
  return { setStatus: jest.fn(), setAttributes: jest.fn(), end: jest.fn() }
}

/** A seam that has loaded the (fake) API. */
async function loaded(): Promise<StorageTracing> {
  const tracing = new StorageTracing()
  await tracing.onModuleInit()
  return tracing
}

describe('StorageSpanAttributes', () => {
  it('names the three keys the library states, so a host value cannot become an attribute', () => {
    const allowed: StorageSpanAttributes = {
      'bymax.storage.outcome': 'success',
      'bymax.storage.multipart': 'false',
      'bymax.storage.scan_mode': 'pre-upload',
    }
    // @ts-expect-error a key outside the union is refused at compile time
    const key: StorageSpanAttributes = { 'bymax.storage.key': 'tenant/secret.txt' }
    // @ts-expect-error a value outside a key's own values is refused at compile time
    const value: StorageSpanAttributes = { 'bymax.storage.outcome': 'tenant/secret.txt' }

    expect(Object.keys(allowed)).toHaveLength(3)
    expect([key, value]).toHaveLength(2)
  })
})

describe('StorageTracing', () => {
  beforeEach(() => {
    const live = span()
    startActiveSpan = (_name, _options, fn) => fn(live)
  })

  it('runs the operation bare before the API is loaded', async () => {
    const run = jest.fn(() => Promise.resolve('done'))

    await expect(new StorageTracing().span('storage.upload', {}, run)).resolves.toBe('done')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('starts the named span with its attributes, states the outcome and what it is told of the result, and ends it', async () => {
    const live = span()
    const seen: [string, Record<string, string>][] = []
    startActiveSpan = (name, options, fn) => {
      seen.push([name, options.attributes])
      return fn(live)
    }

    const result = await (
      await loaded()
    ).span(
      'storage.upload',
      { 'bymax.storage.scan_mode': 'pre-upload' },
      () => Promise.resolve({ multipart: true }),
      (value) => ({ 'bymax.storage.multipart': value.multipart ? 'true' : 'false' }),
    )

    expect(result).toEqual({ multipart: true })
    expect(seen).toEqual([['storage.upload', { 'bymax.storage.scan_mode': 'pre-upload' }]])
    expect(mockTracerNames).toContain('@bymax-one/nest-storage')
    expect(live.setAttributes).toHaveBeenCalledWith({
      'bymax.storage.outcome': 'success',
      'bymax.storage.multipart': 'true',
    })
    expect(live.end).toHaveBeenCalledTimes(1)
    expect(live.setStatus).not.toHaveBeenCalled()
  })

  it('marks the span failed with the library code and the outcome, and nothing of the message', async () => {
    const live = span()
    startActiveSpan = (_name, _options, fn) => fn(live)
    const failure = new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND, undefined, {
      key: 'SENTINEL-4242',
    })

    await expect(
      (await loaded()).span('storage.download_url', {}, () => Promise.reject(failure)),
    ).rejects.toBe(failure)

    expect(live.setStatus).toHaveBeenCalledWith({ code: 2, message: 'STORAGE_OBJECT_NOT_FOUND' })
    expect(live.setAttributes).toHaveBeenCalledWith({ 'bymax.storage.outcome': 'not_found' })
    expect(
      JSON.stringify([live.setStatus.mock.calls, live.setAttributes.mock.calls]),
    ).not.toContain('SENTINEL-4242')
    expect(live.end).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a plain error', new Error('SENTINEL-4242 secret@example.com')],
    ['a thrown string', 'SENTINEL-4242'],
    ['an unshaped code', new StorageException('Storage.Weird Code' as never)],
    ['a code with a prefix', new StorageException('x_STORAGE_FOO' as never)],
    ['a code with a suffix', new StorageException('STORAGE_FOO.bar' as never)],
  ])('reports a generic code for %s', async (_case, failure) => {
    const live = span()
    startActiveSpan = (_name, _options, fn) => fn(live)

    await expect(
      (await loaded()).span('storage.scan', {}, () => Promise.reject(failure as Error)),
    ).rejects.toBe(failure)

    expect(live.setStatus).toHaveBeenCalledWith({ code: 2, message: 'STORAGE_ERROR' })
  })

  it('runs the operation once when the tracer throws', async () => {
    startActiveSpan = () => {
      throw new Error('tracer broke')
    }
    const run = jest.fn(() => Promise.resolve('bare'))

    await expect((await loaded()).span('storage.upload', {}, run)).resolves.toBe('bare')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs the operation once when the tracer never calls back', async () => {
    startActiveSpan = () => undefined
    const run = jest.fn(() => Promise.resolve('bare'))

    await expect((await loaded()).span('storage.upload', {}, run)).resolves.toBe('bare')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs the operation once when the tracer calls back twice', async () => {
    const live = span()
    startActiveSpan = (_name, _options, fn) => {
      fn(live)
      return fn(live)
    }
    const run = jest.fn(() => Promise.resolve('once'))

    await expect((await loaded()).span('storage.upload', {}, run)).resolves.toBe('once')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs the operation once when the tracer calls back late', async () => {
    const live = span()
    let late: (() => unknown) | undefined
    startActiveSpan = (_name, _options, fn) => {
      late = () => fn(live)
      return undefined
    }
    const run = jest.fn(() => Promise.resolve('once'))

    await expect((await loaded()).span('storage.upload', {}, run)).resolves.toBe('once')
    late?.()
    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('ignores a span that throws or rejects, and a description that throws', async () => {
    const live: FakeSpan = {
      setStatus: jest.fn(() => {
        throw new Error('setStatus broke')
      }),
      setAttributes: jest.fn(() => Promise.reject(new Error('setAttributes rejected'))),
      end: jest.fn(() => Promise.reject(new Error('end rejected'))),
    }
    startActiveSpan = (_name, _options, fn) => fn(live)
    const failure = new Error('operation failed')
    const tracing = await loaded()

    await expect(tracing.span('storage.upload', {}, () => Promise.reject(failure))).rejects.toBe(
      failure,
    )
    await expect(tracing.span('storage.upload', {}, () => Promise.resolve(7))).resolves.toBe(7)
    await expect(
      tracing.span(
        'storage.upload',
        {},
        () => Promise.resolve(8),
        () => {
          throw new Error('describe broke')
        },
      ),
    ).resolves.toBe(8)
    await new Promise((resolve) => setImmediate(resolve))
  })
})
