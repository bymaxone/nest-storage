/**
 * @fileoverview Unit tests for the `FileScannerService` scan deadline (`scanner.timeoutMs`).
 * @layer server/services
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { Logger } from '@nestjs/common'
import { FileScannerService } from './file-scanner.service'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_FILE_SCANNER } from '../bymax-storage.constants'
import type { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { IFileScanner, FileScanResult } from '../interfaces/file-scanner.interface'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'

function buildOptions(
  scanner?: ResolvedBymaxStorageOptions['scanner'],
): ResolvedBymaxStorageOptions {
  return {
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
    forcePathStyle: false,
    publicBaseUrl: 'https://s3.amazonaws.com',
    defaultPublicRead: false,
    keyPrefix: '',
    defaultCacheControl: 'no-cache',
    defaultContentDisposition: 'inline',
    signedUrls: { defaultGetTtlSeconds: 300, defaultPutTtlSeconds: 300, maxTtlSeconds: 604800 },
    multipart: { thresholdBytes: 5242880, partSizeBytes: 5242880, queueSize: 4 },
    requestChecksumCalculation: 'WHEN_SUPPORTED',
    responseChecksumValidation: 'WHEN_SUPPORTED',
    maxAttempts: 3,
    requestTimeoutMs: 30000,
    uploadIdleTimeoutMs: 30000,
    bodyIdleTimeoutMs: 30000,
    hasCredentials: true,
    scanner,
  }
}

const SCAN_INPUT = {
  mode: 'pre-upload' as const,
  key: 'test/file.png',
  bucket: 'test-bucket',
  contentType: 'image/png',
}

async function buildService(
  opts: ResolvedBymaxStorageOptions,
  scanner: IFileScanner | null,
): Promise<FileScannerService> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      FileScannerService,
      { provide: BYMAX_STORAGE_OPTIONS, useValue: opts },
      { provide: BYMAX_STORAGE_FILE_SCANNER, useValue: scanner },
    ],
  }).compile()
  return mod.get(FileScannerService)
}

/** What a log spy was called with, as the one entry object the library writes. */
function entryAt(spy: { mock: { calls: unknown[][] } }, index = 0): Record<string, unknown> {
  return spy.mock.calls[index]?.[0] as Record<string, unknown>
}

describe('FileScannerService', () => {
  describe('scan', () => {
    describe('the scan deadline (scanner.timeoutMs)', () => {
      afterEach(() => {
        jest.useRealTimers()
      })

      function neverSettling(): { impl: IFileScanner; seen: AbortSignal[] } {
        const seen: AbortSignal[] = []
        const impl: IFileScanner = {
          scan: jest.fn((input: { signal?: AbortSignal }) => {
            if (input.signal) seen.push(input.signal)
            return new Promise<FileScanResult>(() => undefined)
          }),
        }
        return { impl, seen }
      }

      it('rejects STORAGE_TIMEOUT (503) naming the phase, the limit and what the caller gave, and aborts the signal it handed over', async () => {
        const { impl, seen } = neverSettling()
        const service = await buildService(buildOptions({ impl, timeoutMs: 30 }), impl)

        const err = await service
          .scan(SCAN_INPUT, { key: 'file.png', bucket: 'asked' })
          .catch((e: unknown) => e)

        expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_TIMEOUT)
        expect((err as StorageException).getStatus()).toBe(503)
        expect((err as StorageException).getResponse()).toEqual({
          error: expect.objectContaining({
            details: { key: 'file.png', bucket: 'asked', phase: 'scan', timeoutMs: 30 },
          }) as unknown,
        })
        expect(seen).toHaveLength(1)
        expect(seen[0]?.aborted).toBe(true)
      })

      it("repeats nothing of the scan input in the deadline error: the key and bucket it holds are the scanner's, not the caller's", async () => {
        const { impl } = neverSettling()
        const service = await buildService(buildOptions({ impl, timeoutMs: 30 }), impl)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        const details = ((err as StorageException).getResponse() as { error: { details: object } })
          .error.details
        expect(details).toEqual({ phase: 'scan', timeoutMs: 30 })
      })

      it.each([
        [
          'resolves',
          (input: { signal?: AbortSignal }) =>
            new Promise<FileScanResult>((resolve) => {
              input.signal?.addEventListener('abort', () => {
                resolve({ status: 'unknown', engine: 't' })
              })
            }),
        ],
        [
          'rejects',
          (input: { signal?: AbortSignal }) =>
            new Promise<FileScanResult>((_resolve, reject) => {
              input.signal?.addEventListener('abort', () => {
                reject(new Error('scanner gave up'))
              })
            }),
        ],
      ])(
        'still fails STORAGE_TIMEOUT when the scanner %s as soon as its signal aborts',
        async (_label, scan) => {
          // The scanner settles inside the abort listener, ahead of anything queued after the abort.
          const impl: IFileScanner = { scan: jest.fn(scan) }
          const service = await buildService(buildOptions({ impl, timeoutMs: 20 }), impl)

          const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

          expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_TIMEOUT)
        },
      )

      it('waits 60 s when scanner.timeoutMs is not set, and no longer', async () => {
        jest.useFakeTimers()
        const { impl } = neverSettling()
        const service = await buildService(buildOptions({ impl }), impl)
        let outcome: unknown = 'pending'
        void service.scan(SCAN_INPUT).catch((e: unknown) => {
          outcome = e
        })

        await jest.advanceTimersByTimeAsync(59_999)
        expect(outcome).toBe('pending')
        await jest.advanceTimersByTimeAsync(1)

        expect((outcome as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_TIMEOUT)
      })

      it.each([
        [
          'a scan that settles',
          () => Promise.resolve<FileScanResult>({ status: 'clean', engine: 'clamav' }),
        ],
        ['a scan that fails', () => Promise.reject(new Error('engine down'))],
      ])('leaves no timer behind after %s', async (_label, run) => {
        jest.useFakeTimers()
        const impl: IFileScanner = { scan: jest.fn(run) }
        const service = await buildService(buildOptions({ impl, timeoutMs: 5000 }), impl)

        await service.scan(SCAN_INPUT).catch(() => null)

        expect(jest.getTimerCount()).toBe(0)
      })

      it('hands a signal that is not aborted to a scanner that finishes in time', async () => {
        const seen: (AbortSignal | undefined)[] = []
        const impl: IFileScanner = {
          scan: jest.fn((input: { signal?: AbortSignal }) => {
            seen.push(input.signal)
            return Promise.resolve<FileScanResult>({ status: 'clean', engine: 'clamav' })
          }),
        }
        const service = await buildService(buildOptions({ impl, timeoutMs: 5000 }), impl)

        await service.scan(SCAN_INPUT)

        expect(seen[0]?.aborted).toBe(false)
      })

      it('does not raise an unhandled rejection when the scanner fails after the deadline', async () => {
        let fail: (error: Error) => void = () => undefined
        const impl: IFileScanner = {
          scan: jest.fn(
            () =>
              new Promise<FileScanResult>((_r, reject) => {
                fail = reject
              }),
          ),
        }
        const service = await buildService(buildOptions({ impl, timeoutMs: 10 }), impl)
        const unhandled = jest.fn()
        process.once('unhandledRejection', unhandled)

        await service.scan(SCAN_INPUT).catch(() => null)
        fail(new Error('late failure'))
        await new Promise((resolve) => setTimeout(resolve, 20))

        process.removeListener('unhandledRejection', unhandled)
        expect(unhandled).not.toHaveBeenCalled()
      })
    })

    describe('a scan that outlasts its deadline', () => {
      it('is logged once, naming the limit and nothing the scanner holds, and no key', async () => {
        const impl: IFileScanner = {
          scan: jest.fn(() => new Promise<FileScanResult>(() => undefined)),
        }
        const service = await buildService(buildOptions({ impl, timeoutMs: 20 }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(entryAt(warnSpy)).toEqual({
          event: 'STORAGE_SCAN_TIMEOUT',
          message: 'Scan timed out',
          timeoutMs: 20,
        })
        warnSpy.mockRestore()
      })
    })
  })
})
