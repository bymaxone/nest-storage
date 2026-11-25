/**
 * @fileoverview The observer counts how an operation ended and how long it took, starts a span when asked,
 * and changes nothing about what the operation returns or throws, even when the tally or the tracer fails.
 * @layer server/observability
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import { assertCleanRoot } from '../utils/prototype-guard'
import { Observed, StorageObserver } from './storage-observer'
import { StorageMetricsTally } from './storage-metrics-tally'
import { StorageTracing } from './storage-tracing'

function observer(): {
  tally: StorageMetricsTally
  tracing: StorageTracing
  observer: StorageObserver
} {
  const tally = new StorageMetricsTally()
  const tracing = new StorageTracing()
  return { tally, tracing, observer: new StorageObserver(tally, tracing) }
}

describe('StorageObserver.observe', () => {
  it('counts a success, passes the result through, and times the call', async () => {
    const { tally, observer: subject } = observer()
    const durations: number[] = []
    tally.onDuration((_operation, seconds) => durations.push(seconds))

    await expect(subject.observe('head', () => Promise.resolve('metadata'))).resolves.toBe(
      'metadata',
    )

    expect(tally.snapshot().operations.head).toEqual({
      success: 1,
      not_found: 0,
      aborted: 0,
      error: 0,
    })
    expect(durations).toHaveLength(1)
    expect(durations[0]).toBeGreaterThanOrEqual(0)
    expect(durations[0]).toBeLessThan(5)
  })

  it.each([
    [
      'STORAGE_OBJECT_NOT_FOUND',
      'not_found',
      new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND),
    ],
    [
      'STORAGE_REQUEST_ABORTED',
      'aborted',
      new StorageException(STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED),
    ],
    [
      'STORAGE_PROVIDER_ERROR',
      'error',
      new StorageException(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR),
    ],
    ['a plain Error', 'error', new Error('boom')],
  ] as const)('counts %s as %s and rethrows it unchanged', async (_label, outcome, failure) => {
    const { tally, observer: subject } = observer()

    await expect(subject.observe('delete', () => Promise.reject(failure))).rejects.toBe(failure)

    expect(tally.snapshot().operations.delete[outcome]).toBe(1)
    expect(tally.snapshot().operations.delete.success).toBe(0)
  })

  it('adds the bytes of a successful result to the upload counter, and nothing for a failure', async () => {
    const { tally, observer: subject } = observer()

    await subject.observe('upload', () => Promise.resolve({ size: 10 }), {
      bytes: (result) => result.size,
    })
    await subject
      .observe('upload', () => Promise.reject(new Error('x')), { bytes: () => 99 })
      .catch(() => undefined)

    expect(tally.snapshot().bytesUploaded).toBe(10)
  })

  it('does not let a tally that throws change the result or the error', async () => {
    const { tally, observer: subject } = observer()
    jest.spyOn(tally, 'operation').mockImplementation(() => {
      throw new Error('tally broke')
    })
    const failure = new Error('operation failed')

    await expect(subject.observe('list', () => Promise.resolve(1))).resolves.toBe(1)
    await expect(subject.observe('list', () => Promise.reject(failure))).rejects.toBe(failure)
  })

  it('does not let a `bytes` that throws change the result', async () => {
    const { observer: subject } = observer()

    await expect(
      subject.observe('upload', () => Promise.resolve('ok'), {
        bytes: () => {
          throw new Error('bytes broke')
        },
      }),
    ).resolves.toBe('ok')
  })

  it('starts the span it is asked for around the counted call', async () => {
    const { tally, tracing, observer: subject } = observer()
    const span = jest.spyOn(tracing, 'span').mockImplementation((_name, _attributes, run) => run())

    await subject.observe('get_download_url', () => Promise.resolve('url'), {
      span: 'storage.download_url',
      attributes: { 'bymax.storage.scan_mode': 'post-upload' },
    })

    expect(span).toHaveBeenCalledWith(
      'storage.download_url',
      { 'bymax.storage.scan_mode': 'post-upload' },
      expect.any(Function),
      undefined,
    )
    expect(tally.snapshot().operations.get_download_url.success).toBe(1)
  })

  it('starts a span with no attributes when none are given, and passes the description on', async () => {
    const { tracing, observer: subject } = observer()
    const span = jest.spyOn(tracing, 'span').mockImplementation((_name, _attributes, run) => run())
    const describe = (): Record<string, string> => ({})

    await subject.observe('upload', () => Promise.resolve(1), { span: 'storage.upload', describe })

    expect(span).toHaveBeenCalledWith('storage.upload', {}, expect.any(Function), describe)
  })

  it('starts no span when none is asked for', async () => {
    const { tracing, observer: subject } = observer()
    const span = jest.spyOn(tracing, 'span')

    await subject.observe('copy', () => Promise.resolve(1))

    expect(span).not.toHaveBeenCalled()
  })
})

describe('StorageObserver.scan', () => {
  it.each([
    [{ status: 'clean' }, 'clean'],
    [{ status: 'unknown' }, 'unknown'],
  ] as const)('counts a result of %j as %s inside the scan span', async (result, verdict) => {
    const { tally, tracing, observer: subject } = observer()
    const span = jest.spyOn(tracing, 'span').mockImplementation((_name, _attributes, run) => run())

    await expect(subject.scan('pre-upload', () => Promise.resolve(result))).resolves.toBe(result)

    expect(span).toHaveBeenCalledWith(
      'storage.scan',
      { 'bymax.storage.scan_mode': 'pre-upload' },
      expect.any(Function),
    )
    expect(tally.snapshot().scans[verdict]).toBe(1)
  })

  it.each([
    [
      'STORAGE_SCAN_INFECTED',
      'infected',
      new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED),
    ],
    [
      'STORAGE_SCAN_INCONCLUSIVE',
      'unknown',
      new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE),
    ],
    ['STORAGE_TIMEOUT', 'timeout', new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT)],
    ['a plain Error', 'error', new Error('scanner crashed')],
  ] as const)('counts %s as %s and rethrows it unchanged', async (_label, verdict, failure) => {
    const { tally, observer: subject } = observer()

    await expect(subject.scan('post-upload', () => Promise.reject(failure))).rejects.toBe(failure)

    expect(tally.snapshot().scans[verdict]).toBe(1)
  })

  it('does not let a tally that throws change the result or the error', async () => {
    const { tally, observer: subject } = observer()
    jest.spyOn(tally, 'scan').mockImplementation(() => {
      throw new Error('tally broke')
    })
    const failure = new Error('scan failed')

    await expect(
      subject.scan('pre-upload', () => Promise.resolve({ status: 'clean' })),
    ).resolves.toEqual({
      status: 'clean',
    })
    await expect(subject.scan('pre-upload', () => Promise.reject(failure))).rejects.toBe(failure)
  })
})

describe('@Observed', () => {
  class Service {
    readonly base = 1

    constructor(protected readonly observer?: StorageObserver) {}

    @Observed('list')
    work(value: number): Promise<number> {
      return Promise.resolve(value + this.base)
    }

    @Observed('copy')
    fail(): Promise<never> {
      return Promise.reject(new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND))
    }
  }

  it('runs the method as written, with its arguments and its `this`, when the class holds no observer', async () => {
    await expect(new Service().work(1)).resolves.toBe(2)
  })

  it('counts the method under the operation it is named for when the class holds an observer', async () => {
    const { tally, observer: subject } = observer()
    const service = new Service(subject)

    await expect(service.work(4)).resolves.toBe(5)
    await expect(service.fail()).rejects.toBeInstanceOf(StorageException)

    expect(tally.snapshot().operations.list.success).toBe(1)
    expect(tally.snapshot().operations.copy.not_found).toBe(1)
  })

  describe('with Function.prototype.apply replaced after load', () => {
    class Guarded {
      entered = 0

      constructor(protected readonly observer?: StorageObserver) {}

      @Observed('head')
      method(): Promise<string> {
        this.entered += 1
        assertCleanRoot()
        return Promise.resolve('real')
      }
    }

    async function outcomeWithForgedApply(service: Guarded): Promise<unknown> {
      const original = Object.getOwnPropertyDescriptor(Function.prototype, 'apply')!
      Object.defineProperty(Function.prototype, 'apply', {
        ...original,
        value: () => Promise.resolve('forged'),
      })
      try {
        return await service.method().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
      } finally {
        Object.defineProperty(Function.prototype, 'apply', original)
      }
    }

    it.each([
      ['no observer', undefined],
      ['an observer', observer().observer],
    ])('refuses the call and never answers for the method, with %s', async (_name, held) => {
      /* The forged answer must not come back, and the refusal is the library's own typed error. */
      const service = new Guarded(held)
      const outcome = await outcomeWithForgedApply(service)
      expect(outcome).toMatchObject({ error: { code: 'STORAGE_VALIDATION_FAILED' } })
      expect(service.entered).toBe(0)
    })
  })
})
