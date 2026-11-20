/**
 * @fileoverview Tests for FileScannerService — pre/post modes, infected/unknown handling.
 * @layer server/services
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { Logger } from '@nestjs/common'
import { FileScannerService } from './file-scanner.service'
import { NoOpFileScanner } from '../providers/no-op-scanner'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_FILE_SCANNER } from '../bymax-storage.constants'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { IFileScanner, FileScanResult } from '../interfaces/file-scanner.interface'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'

function buildOptions(scanner?: ResolvedBymaxStorageOptions['scanner']): ResolvedBymaxStorageOptions {
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

function makeMockScanner(result: FileScanResult): IFileScanner {
  return { scan: jest.fn().mockResolvedValue(result) }
}

describe('FileScannerService', () => {
  describe('isEnabled', () => {
    it('returns false when scanner is null', async () => {
      // no scanner → scanning is disabled
      const service = await buildService(buildOptions(), null)
      expect(service.isEnabled()).toBe(false)
    })

    it('returns false when options.scanner is undefined', async () => {
      // scanner implementation provided but no options config → disabled
      const service = await buildService(buildOptions(undefined), makeMockScanner({ status: 'clean', engine: 'test' }))
      expect(service.isEnabled()).toBe(false)
    })

    it('returns false when the scanner impl is null even though options.scanner is set', async () => {
      // Both operands of the `&&` matter: options config present but a null impl → still
      // disabled. Forcing the `scanner !== null` operand to `true` would wrongly enable it.
      const service = await buildService(
        buildOptions({ impl: makeMockScanner({ status: 'clean', engine: 'test' }) }),
        null,
      )
      expect(service.isEnabled()).toBe(false)
    })

    it('returns true when scanner and options.scanner are both set', async () => {
      // both scanner and options config present → enabled
      const service = await buildService(
        buildOptions({ impl: makeMockScanner({ status: 'clean', engine: 'test' }) }),
        makeMockScanner({ status: 'clean', engine: 'test' }),
      )
      expect(service.isEnabled()).toBe(true)
    })
  })

  describe('getMode', () => {
    it('returns null when scanning is disabled', async () => {
      // disabled scanner has no mode
      const service = await buildService(buildOptions(), null)
      expect(service.getMode()).toBeNull()
    })

    it('defaults to "pre-upload" when mode is not configured', async () => {
      // pre-upload is the default scan mode
      const impl = makeMockScanner({ status: 'clean', engine: 'test' })
      const service = await buildService(buildOptions({ impl }), impl)
      expect(service.getMode()).toBe('pre-upload')
    })

    it('returns the configured mode "post-upload"', async () => {
      // explicitly configured mode must be returned
      const impl = makeMockScanner({ status: 'clean', engine: 'test' })
      const service = await buildService(buildOptions({ impl, mode: 'post-upload' }), impl)
      expect(service.getMode()).toBe('post-upload')
    })
  })

  describe('scan', () => {
    it('returns the result when status is "clean"', async () => {
      // clean result must be returned as-is
      const impl = makeMockScanner({ status: 'clean', engine: 'clamav' })
      const service = await buildService(buildOptions({ impl }), impl)
      const result = await service.scan(SCAN_INPUT)
      expect(result.status).toBe('clean')
    })

    it('throws STORAGE_SCAN_INFECTED with threat details on "infected"', async () => {
      // infected result must throw SCAN_INFECTED with engine and threat preserved
      const impl = makeMockScanner({ status: 'infected', engine: 'clamav', threat: 'Trojan.X', details: { extra: 1 } })
      const service = await buildService(buildOptions({ impl }), impl)

      const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED)
      const resp = (err as StorageException).getResponse() as { error: { details: Record<string, unknown> } }
      expect(resp.error.details.engine).toBe('clamav')
      expect(resp.error.details.threat).toBe('Trojan.X')
    })

    describe('the scanner\'s free-form details', () => {
      // `details` is the scanner's own text: it reaches the operator's log, never a client's response body.
      const SECRET = 'host-path=/srv/scan/quarantine/7f3a token=SECRETEXAMPLE'

      function bodyOf(err: unknown): string {
        return JSON.stringify((err as StorageException).getResponse())
      }

      it.each([
        ['infected', { status: 'infected', engine: 'clamav', threat: 'Trojan.X', details: { note: SECRET } }, false],
        ['unknown', { status: 'unknown', engine: 'clamav', details: { note: SECRET } }, true],
      ] as const)('keeps it out of the body of a %s rejection and logs it once', async (_label, result, rejectOnUnknown) => {
        const impl = makeMockScanner({ ...result })
        const service = await buildService(buildOptions({ impl, rejectOnUnknown }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect(bodyOf(err)).not.toContain('SECRETEXAMPLE')
        expect((err as StorageException).getResponse()).toMatchObject({ error: { details: { engine: 'clamav' } } })
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SECRETEXAMPLE'))
        warnSpy.mockRestore()
      })

      it('keeps the threat name in the body of an infected rejection', async () => {
        const impl = makeMockScanner({ status: 'infected', engine: 'clamav', threat: 'Trojan.X', details: { note: SECRET } })
        const service = await buildService(buildOptions({ impl }), impl)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect((err as StorageException).getResponse()).toMatchObject({ error: { details: { threat: 'Trojan.X' } } })
      })

      it('writes it in a log line as one escaped token, cut at 300 characters', async () => {
        const impl = makeMockScanner({ status: 'infected', engine: 'clamav', details: { note: `a\nb${'x'.repeat(400)}` } })
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        const line = String(warnSpy.mock.calls[0]?.[0])
        expect(line).not.toContain('\n')
        expect(line).toContain('details="{\\"note\\":\\"a\\\\nb')
        // The first 300 characters of the JSON text are kept: 13 of them are the key, the quote and `a\\nb`.
        expect(line).toContain('x'.repeat(287))
        expect(line).not.toContain('x'.repeat(288))
        warnSpy.mockRestore()
      })

      it('does not fail the rejection when the details cannot be serialised', async () => {
        const circular: Record<string, unknown> = {}
        circular.self = circular
        const impl = makeMockScanner({ status: 'infected', engine: 'clamav', details: circular })
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[unserialisable]'))
        warnSpy.mockRestore()
      })

      it('still rejects when the details serialise to nothing', async () => {
        // JSON.stringify returns undefined, without throwing, for an object whose toJSON() returns undefined.
        const impl = makeMockScanner({ status: 'infected', engine: 'clamav', details: { toJSON: () => undefined } })
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[unserialisable]'))
        warnSpy.mockRestore()
      })

      it('adds nothing to the log line when the scanner sent none', async () => {
        const impl = makeMockScanner({ status: 'infected', engine: 'clamav', threat: 'Trojan.X' })
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        expect(warnSpy.mock.calls[0]?.[0]).toBe('Infected file detected: key="test/file.png" engine="clamav" threat="Trojan.X"')
        warnSpy.mockRestore()
      })
    })

    describe('the engine and threat names', () => {
      const LONG = 'x'.repeat(500)

      it('are cut to 200 characters in the body and in the log', async () => {
        const impl = makeMockScanner({ status: 'infected', engine: LONG, threat: LONG })
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        const { engine, threat } = ((err as StorageException).getResponse() as { error: { details: Record<string, string> } }).error.details
        expect(engine).toBe('x'.repeat(200))
        expect(threat).toBe('x'.repeat(200))
        const line = String(warnSpy.mock.calls[0]?.[0])
        expect(line).toContain(`"${'x'.repeat(200)}"`)
        expect(line).not.toContain('x'.repeat(201))
        warnSpy.mockRestore()
      })

      it('are left whole at exactly 200 characters', async () => {
        const name = 'y'.repeat(200)
        const impl = makeMockScanner({ status: 'infected', engine: name, threat: name })
        const service = await buildService(buildOptions({ impl }), impl)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect((err as StorageException).getResponse()).toMatchObject({ error: { details: { engine: name, threat: name } } })
      })

      it('are left out of the body when they are not strings', async () => {
        const impl: IFileScanner = { scan: jest.fn().mockResolvedValue({ status: 'infected', engine: 'clamav', threat: { secret: 'x' } }) }
        const service = await buildService(buildOptions({ impl }), impl)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect(JSON.stringify((err as StorageException).getResponse())).not.toContain('secret')
        expect((err as StorageException).getResponse()).toMatchObject({ error: { details: { engine: 'clamav' } } })
      })
    })

    describe('a scanner that throws', () => {
      it('is logged once with its message cut at 300 characters, and the error is rethrown unchanged', async () => {
        const failure = new Error(`engine down ${'z'.repeat(500)}`)
        const impl: IFileScanner = { scan: jest.fn().mockRejectedValue(failure) }
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect(err).toBe(failure)
        expect(warnSpy).toHaveBeenCalledTimes(1)
        const line = String(warnSpy.mock.calls[0]?.[0])
        expect(line).toMatch(/^Scanner failed: key="test\/file\.png" error="engine down z+"$/)
        expect(line).not.toContain('z'.repeat(300))
        warnSpy.mockRestore()
      })

      it('logs a value that is not an Error without throwing', async () => {
        const impl: IFileScanner = { scan: jest.fn().mockRejectedValue(Object.create(null)) }
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('non-printable rejection value'))
        warnSpy.mockRestore()
      })

      it('does not log the deadline as a scanner failure: it has its own line, and only that one', async () => {
        const impl: IFileScanner = { scan: jest.fn(() => new Promise<FileScanResult>(() => undefined)) }
        const service = await buildService(buildOptions({ impl, timeoutMs: 10 }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        // The deadline is logged as a timeout (see 'a scan that outlasts its deadline'), never as `Scanner failed`.
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('Scanner failed')
        warnSpy.mockRestore()
      })
    })

    describe('a result outside the contract', () => {
      // Only the exact string 'clean' lets an object through: a scanner written in JS, a typo, or a
      // result that is not an object must not be read as a pass.
      const outside: [string, unknown][] = [
        ['no result', undefined],
        ['null', null],
        ['a string result', 'clean'],
        ['an empty object', {}],
        ['a status in another case', { status: 'CLEAN', engine: 'clamav' }],
        ['a status with a leading space', { status: ' clean', engine: 'clamav' }],
        ['a status with a trailing newline', { status: 'clean\n', engine: 'clamav' }],
        ['an object status', { status: {}, engine: 'clamav' }],
        ['a numeric status', { status: 1, engine: 'clamav' }],
        ['a made-up status', { status: 'ok', engine: 'clamav' }],
      ]

      it.each(outside)('rejects %s as inconclusive, with rejectOnUnknown on and off', async (_label, result) => {
        for (const rejectOnUnknown of [false, true]) {
          const impl: IFileScanner = { scan: jest.fn().mockResolvedValue(result) }
          const service = await buildService(buildOptions({ impl, rejectOnUnknown }), impl)
          const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

          const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

          expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE)
          expect((err as StorageException).getResponse()).toMatchObject({
            error: { details: { reason: 'unrecognised scanner status' } },
          })
          expect(warnSpy).toHaveBeenCalledTimes(1)
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Inconclusive scan result rejected'))
          warnSpy.mockRestore()
        }
      })

      it('names the unrecognised status, escaped, in its log line and gives the reason in the body', async () => {
        const impl: IFileScanner = { scan: jest.fn().mockResolvedValue({ status: 'CLEAN\n', engine: 'clamav' }) }
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect(String(warnSpy.mock.calls[0]?.[0])).toContain(' status="CLEAN\\n"')
        expect(JSON.stringify((err as StorageException).getResponse())).toContain('unrecognised scanner status')
        warnSpy.mockRestore()
      })

      it('names an unrecognised status that is not a string by its type only, and runs none of its code', async () => {
        const hostile = { toString: jest.fn(() => 'HOSTILE-text'), valueOf: jest.fn(() => 'HOSTILE-value') }
        const impl: IFileScanner = { scan: jest.fn().mockResolvedValue({ status: hostile, engine: 'clamav' }) }
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        expect(String(warnSpy.mock.calls[0]?.[0])).toBe('Inconclusive scan result rejected: key="test/file.png" engine="clamav" status=<object>')
        expect(hostile.toString).not.toHaveBeenCalled()
        expect(hostile.valueOf).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('cuts a long unrecognised status to 40 characters in the log', async () => {
        const impl: IFileScanner = { scan: jest.fn().mockResolvedValue({ status: 'x'.repeat(100), engine: 'clamav' }) }
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        const line = String(warnSpy.mock.calls[0]?.[0])
        expect(line).toContain(` status="${'x'.repeat(40)}"`)
        expect(line).not.toContain('x'.repeat(41))
        warnSpy.mockRestore()
      })

      it('says nothing of a status or a reason for an unknown result that rejectOnUnknown refuses', async () => {
        const impl = makeMockScanner({ status: 'unknown', engine: 'clamav' })
        const service = await buildService(buildOptions({ impl, rejectOnUnknown: true }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect(String(warnSpy.mock.calls[0]?.[0])).toBe('Inconclusive scan result rejected: key="test/file.png" engine="clamav"')
        expect(JSON.stringify((err as StorageException).getResponse())).not.toContain('reason')
        warnSpy.mockRestore()
      })

      it('names the engine only when it is a string', async () => {
        const named: IFileScanner = { scan: jest.fn().mockResolvedValue({ status: 'ok', engine: 'clamav' }) }
        const unnamed: IFileScanner = { scan: jest.fn().mockResolvedValue({ status: 'ok', engine: { secret: 'x' } }) }

        const withEngine = await (await buildService(buildOptions({ impl: named }), named)).scan(SCAN_INPUT).catch((e: unknown) => e)
        const withoutEngine = await (await buildService(buildOptions({ impl: unnamed }), unnamed)).scan(SCAN_INPUT).catch((e: unknown) => e)

        expect((withEngine as StorageException).getResponse()).toMatchObject({ error: { details: { engine: 'clamav' } } })
        expect(JSON.stringify((withoutEngine as StorageException).getResponse())).not.toContain('secret')
      })

      it('still lets the exact string "clean" through and still accepts "unknown" without rejectOnUnknown', async () => {
        const clean = makeMockScanner({ status: 'clean', engine: 'clamav' })
        const unknown = makeMockScanner({ status: 'unknown', engine: 'clamav' })
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        expect((await (await buildService(buildOptions({ impl: clean }), clean)).scan(SCAN_INPUT)).status).toBe('clean')
        expect((await (await buildService(buildOptions({ impl: unknown }), unknown)).scan(SCAN_INPUT)).status).toBe('unknown')
      })
    })

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

        const err = await service.scan(SCAN_INPUT, { key: 'file.png', bucket: 'asked' }).catch((e: unknown) => e)

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

      it('repeats nothing of the scan input in the deadline error: the key and bucket it holds are the scanner\'s, not the caller\'s', async () => {
        const { impl } = neverSettling()
        const service = await buildService(buildOptions({ impl, timeoutMs: 30 }), impl)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        const details = ((err as StorageException).getResponse() as { error: { details: object } }).error.details
        expect(details).toEqual({ phase: 'scan', timeoutMs: 30 })
      })

      it.each([
        ['resolves', (input: { signal?: AbortSignal }) => new Promise<FileScanResult>((resolve) => { input.signal?.addEventListener('abort', () => { resolve({ status: 'unknown', engine: 't' }) }) })],
        ['rejects', (input: { signal?: AbortSignal }) => new Promise<FileScanResult>((_resolve, reject) => { input.signal?.addEventListener('abort', () => { reject(new Error('scanner gave up')) }) })],
      ])('still fails STORAGE_TIMEOUT when the scanner %s as soon as its signal aborts', async (_label, scan) => {
        // The scanner settles inside the abort listener, ahead of anything queued after the abort.
        const impl: IFileScanner = { scan: jest.fn(scan) }
        const service = await buildService(buildOptions({ impl, timeoutMs: 20 }), impl)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_TIMEOUT)
      })

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
        ['a scan that settles', () => Promise.resolve<FileScanResult>({ status: 'clean', engine: 'clamav' })],
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
        const impl: IFileScanner = { scan: jest.fn(() => new Promise<FileScanResult>((_r, reject) => { fail = reject })) }
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

    it('returns a "clean" result even when rejectOnUnknown is true (does not enter the unknown branch)', async () => {
      // The `status === 'unknown'` guard must gate the reject path: a clean result with
      // rejectOnUnknown enabled must still pass, never throw SCAN_INCONCLUSIVE.
      const impl = makeMockScanner({ status: 'clean', engine: 'clamav' })
      const service = await buildService(buildOptions({ impl, rejectOnUnknown: true }), impl)
      const result = await service.scan(SCAN_INPUT)
      expect(result.status).toBe('clean')
    })

    it('uses "unknown" as the threat label when the result carries no threat name', async () => {
      // threat may be absent; the warn log must substitute the fallback label "unknown"
      const impl = makeMockScanner({ status: 'infected', engine: 'clamav' })
      const service = await buildService(buildOptions({ impl }), impl)
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      await service.scan(SCAN_INPUT).catch(() => null)

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown'))
      warnSpy.mockRestore()
    })

    it('logs a warning on infected result', async () => {
      // infected results must emit a warn-level log
      const impl = makeMockScanner({ status: 'infected', engine: 'clamav', threat: 'Virus.Y' })
      const service = await buildService(buildOptions({ impl }), impl)
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      await service.scan(SCAN_INPUT).catch(() => null)

      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('throws STORAGE_SCAN_INCONCLUSIVE on "unknown" when rejectOnUnknown is true', async () => {
      // rejectOnUnknown: true must turn "unknown" into SCAN_INCONCLUSIVE
      const impl = makeMockScanner({ status: 'unknown', engine: 'clamav' })
      const service = await buildService(buildOptions({ impl, rejectOnUnknown: true }), impl)

      const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageException)
      expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE)
      // The inconclusive exception must carry the engine in details, not a blank object.
      const resp = (err as StorageException).getResponse() as { error: { details: Record<string, unknown> } }
      expect(resp.error.details.engine).toBe('clamav')
    })

    it('returns result with a specific warning log on "unknown" when rejectOnUnknown is false', async () => {
      // inconclusive without rejectOnUnknown must pass but log the exact acceptance warning
      const impl = makeMockScanner({ status: 'unknown', engine: 'clamav' })
      const service = await buildService(buildOptions({ impl, rejectOnUnknown: false }), impl)
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      const result = await service.scan(SCAN_INPUT)

      expect(result.status).toBe('unknown')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Inconclusive scan result accepted'))
      warnSpy.mockRestore()
    })

    it('throws a programmatic Error with the guard message when scan is called without a scanner', async () => {
      // caller must guard with isEnabled() — the error message names the required guard
      const service = await buildService(buildOptions(), null)
      await expect(service.scan(SCAN_INPUT)).rejects.toThrow('guard with isEnabled')
    })

    describe('a cut never leaves half of a surrogate pair', () => {
      // An emoji is two UTF-16 units; a cut between them leaves a lone surrogate that is not text.
      const EMOJI = '\u{1F600}'
      const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\\ud83d/i

      it('in the engine and threat names, which a client reads, at 200', async () => {
        const name = `${'a'.repeat(199)}${EMOJI}b`
        const impl = makeMockScanner({ status: 'infected', engine: name, threat: name })
        const service = await buildService(buildOptions({ impl }), impl)
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        const err = await service.scan(SCAN_INPUT).catch((e: unknown) => e)

        const { engine, threat } = ((err as StorageException).getResponse() as { error: { details: Record<string, string> } }).error.details
        expect(engine).toBe('a'.repeat(199))
        expect(threat).toBe('a'.repeat(199))
        expect(`${String(engine)}${String(threat)}`).not.toMatch(LONE_SURROGATE)
      })

      it.each([
        ['an unrecognised status, at 40', { status: `${'a'.repeat(39)}${EMOJI}b`, engine: 'clamav' }, 'a'.repeat(39)],
        ['the details of a scanner, at 300', { status: 'infected', engine: 'clamav', details: { n: `${'a'.repeat(293)}${EMOJI}b` } }, 'a'.repeat(293)],
      ])('in the log: %s', async (_what, result, kept) => {
        const impl: IFileScanner = { scan: jest.fn().mockResolvedValue(result) }
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        const line = String(warnSpy.mock.calls[0]?.[0])
        expect(line).toContain(kept)
        expect(line).not.toMatch(LONE_SURROGATE)
        warnSpy.mockRestore()
      })

      it('in the message of a scanner that throws, at 300', async () => {
        const impl: IFileScanner = { scan: jest.fn().mockRejectedValue(new Error(`${'a'.repeat(299)}${EMOJI}b`)) }
        const service = await buildService(buildOptions({ impl }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        const line = String(warnSpy.mock.calls[0]?.[0])
        expect(line).toContain('a'.repeat(299))
        expect(line).not.toMatch(LONE_SURROGATE)
        warnSpy.mockRestore()
      })
    })

    describe('a scan that outlasts its deadline', () => {
      it('is logged once, naming the key and the limit and nothing the scanner holds', async () => {
        const impl: IFileScanner = { scan: jest.fn(() => new Promise<FileScanResult>(() => undefined)) }
        const service = await buildService(buildOptions({ impl, timeoutMs: 20 }), impl)
        const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

        await service.scan(SCAN_INPUT).catch(() => null)

        expect(warnSpy).toHaveBeenCalledTimes(1)
        const line = String(warnSpy.mock.calls[0]?.[0])
        expect(line).toContain('Scan timed out')
        expect(line).toContain('key="test/file.png"')
        expect(line).toContain('timeoutMs=20')
        warnSpy.mockRestore()
      })
    })
  })

  describe('NoOpFileScanner', () => {
    it('returns { status: "clean", engine: "noop" }', async () => {
      // no-op shape must match the documented contract exactly
      const noop = new NoOpFileScanner()
      const result = await noop.scan(SCAN_INPUT)
      expect(result).toEqual({ status: 'clean', engine: 'noop' })
    })
  })
})
