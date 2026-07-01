/**
 * @fileoverview Wraps the consumer-injected `IFileScanner` with the library's
 * policy: mode resolution, `rejectOnUnknown`, and logging. An absent scanner
 * is a valid state — guard callers with `isEnabled()` before calling `scan()`.
 * @layer server/services
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_FILE_SCANNER } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { IFileScanner, FileScanResult } from '../interfaces/file-scanner.interface'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/** Input shape for a scan request. */
interface ScanInput {
  mode: 'pre-upload' | 'post-upload'
  body?: Buffer | NodeJS.ReadableStream
  key: string
  bucket: string
  contentType: string
  size?: number
}

@Injectable()
export class FileScannerService {
  private readonly logger = new Logger(FileScannerService.name)

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    @Inject(BYMAX_STORAGE_FILE_SCANNER) private readonly scanner: IFileScanner | null,
  ) {}

  /**
   * Returns `true` when both a scanner implementation and scanner options are
   * configured.
   *
   * @returns `true` when scanning is active.
   */
  isEnabled(): boolean {
    return this.scanner !== null && this.options.scanner !== undefined
  }

  /**
   * Returns the configured scan mode, or `null` when scanning is disabled.
   *
   * @returns `'pre-upload'`, `'post-upload'`, or `null`.
   */
  getMode(): 'pre-upload' | 'post-upload' | null {
    if (!this.isEnabled()) {
      return null
    }
    return this.options.scanner?.mode ?? 'pre-upload'
  }

  /**
   * Scans the given input. Callers MUST guard with `isEnabled()` — calling this
   * method without a configured scanner is a programming error and throws a
   * plain `Error`.
   *
   * Infected results throw `STORAGE_SCAN_INFECTED`. Inconclusive results throw
   * `STORAGE_SCAN_INCONCLUSIVE` when `rejectOnUnknown` is set; otherwise they
   * are returned with a warning log.
   *
   * @param input - The scan input.
   * @returns The scan result when `status` is `'clean'` or `'unknown'` (non-rejecting).
   * @throws Error when called without a configured scanner.
   * @throws StorageException `STORAGE_SCAN_INFECTED` on an infected result.
   * @throws StorageException `STORAGE_SCAN_INCONCLUSIVE` on an unknown result with `rejectOnUnknown`.
   */
  async scan(input: ScanInput): Promise<FileScanResult> {
    if (!this.scanner) {
      throw new Error(
        'FileScannerService.scan() called without a configured scanner — guard with isEnabled() first.',
      )
    }
    const result = await this.scanner.scan(input)

    if (result.status === 'infected') {
      this.logger.warn(`Infected file detected: key=${input.key} engine=${result.engine} threat=${result.threat ?? 'unknown'}`)
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, undefined, {
        engine: result.engine,
        threat: result.threat,
        details: result.details,
      })
    }

    if (result.status === 'unknown') {
      if (this.options.scanner?.rejectOnUnknown) {
        throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE, undefined, {
          engine: result.engine,
          details: result.details,
        })
      }
      this.logger.warn(`Inconclusive scan result accepted: key=${input.key} engine=${result.engine}`)
    }

    return result
  }
}
