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
