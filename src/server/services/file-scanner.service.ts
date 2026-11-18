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
import { DEFAULT_SCANNER_TIMEOUT_MS } from '../constants/default-options.constants'
import { describeError } from '../utils/describe-error'
import { logValue } from '../utils/log-value'
import { cutText } from '../utils/cut-text'

/** What the log line holds when the details cannot be turned into text. */
const UNSERIALISABLE = '[unserialisable]'

/** The most characters of the engine and threat names a body and a log line carry. */
const MAX_SCANNER_LABEL_LENGTH = 200

/** The most characters of a scanner's own `details`, or of its failure message, a log line carries. */
const MAX_SCANNER_DETAILS_LENGTH = 300

/** The most characters of an unrecognised status a log line carries. */
const MAX_STATUS_LOG_LENGTH = 40

/**
 * An unrecognised status as a log token: a string is cut and escaped, anything else is named by its type,
 * so no `toString` of the scanner's own object runs and nothing it holds reaches the line.
 */
function statusForLog(status: unknown): string {
  return typeof status === 'string'
    ? logValue(cutText(status, MAX_STATUS_LOG_LENGTH))
    : `<${typeof status}>`
}

/** The engine or threat name as the scanner gave it, cut to {@link MAX_SCANNER_LABEL_LENGTH}; `undefined` when it is not a string. */
function scannerLabel(value: unknown): string | undefined {
  return typeof value === 'string' ? cutText(value, MAX_SCANNER_LABEL_LENGTH) : undefined
}

/** `JSON.stringify` as it behaves: `undefined`, not a string, for a value whose `toJSON()` returns nothing. */
function toJson(value: unknown): string | undefined {
  return JSON.stringify(value)
}

/**
 * What the scanner put in `details`, as a log suffix. The text is the scanner's, so it never reaches
 * a response body: a client is told the engine and the threat name and nothing else.
 *
 * @param details - The scanner's free-form `details`.
 * @returns ` details=<escaped, cut text>`, or an empty string when there are none.
 */
function scannerDetailsForLog(details: Record<string, unknown> | undefined): string {
  if (details === undefined) return ''
  let text: string
  try {
    text = toJson(details) ?? UNSERIALISABLE
  } catch {
    text = UNSERIALISABLE
  }
  return ` details=${logValue(cutText(text, MAX_SCANNER_DETAILS_LENGTH))}`
}

/** Input shape for a scan request. */
interface ScanInput {
  mode: 'pre-upload' | 'post-upload'
  body?: Buffer | NodeJS.ReadableStream
  key: string
  bucket: string
  contentType: string
  size?: number
}

/** What a scanner returned, as it can be at run time: a JS scanner may return anything. */
type ScannerOutcome = Partial<FileScanResult> | null | undefined

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
   * are returned with a warning log. Anything else (no result, a status that is not exactly
   * `'clean'`, `'infected'` or `'unknown'`) is rejected as inconclusive whatever `rejectOnUnknown`
   * says, and a scan that outlasts `scanner.timeoutMs` throws `STORAGE_TIMEOUT`.
   *
   * @param input - The scan input.
   * @returns The scan result when `status` is `'clean'` or `'unknown'` (non-rejecting).
   * @throws Error when called without a configured scanner.
   * @throws StorageException `STORAGE_SCAN_INFECTED` on an infected result.
   * @throws StorageException `STORAGE_SCAN_INCONCLUSIVE` on an unknown result with `rejectOnUnknown`, or a result outside the contract.
   * @throws StorageException `STORAGE_TIMEOUT` when the scan outlasts `scanner.timeoutMs`.
   */
  async scan(input: ScanInput): Promise<FileScanResult> {
    if (!this.scanner) {
      throw new Error(
        'FileScannerService.scan() called without a configured scanner — guard with isEnabled() first.',
      )
    }
    const result = await this.scanLogged(this.scanner, input)
    const status = result?.status
    const engine = scannerLabel(result?.engine)
    const threat = scannerLabel(result?.threat)
    const details = scannerDetailsForLog(result?.details)

    if (status === 'clean') {
      return result as FileScanResult
    }
    if (status === 'infected') {
      this.logger.warn(`Infected file detected: key=${logValue(input.key)} engine=${logValue(engine)} threat=${logValue(threat ?? 'unknown')}${details}`)
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, undefined, {
        engine,
        threat,
      })
    }
    if (status === 'unknown' && !this.options.scanner?.rejectOnUnknown) {
      this.logger.warn(`Inconclusive scan result accepted: key=${logValue(input.key)} engine=${logValue(engine)}`)
      return result as FileScanResult
    }
    // `unknown` with `rejectOnUnknown`, or a result outside the contract (no result, a status that is
    // not exactly one of the three): the object is not known to be clean, so it is not stored.
    const unrecognised = status !== 'unknown'
    this.logger.warn(`Inconclusive scan result rejected: key=${logValue(input.key)} engine=${logValue(engine)}${unrecognised ? ` status=${statusForLog(status)}` : ''}${details}`)
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE, undefined, {
      engine,
      ...(unrecognised ? { reason: 'unrecognised scanner status' } : {}),
    })
  }

  /**
   * Runs the scan and logs a scanner that throws: the caller is answered 500 for that, and without the
   * line there would be no trace of why. A typed failure of ours (the deadline) says it itself.
   */
  private async scanLogged(scanner: IFileScanner, input: ScanInput): Promise<ScannerOutcome> {
    try {
      return await this.scanWithinDeadline(scanner, input)
    } catch (err) {
      if (!(err instanceof StorageException)) {
        this.logger.warn(
          `Scanner failed: key=${logValue(input.key)} error=${logValue(cutText(describeError(err), MAX_SCANNER_DETAILS_LENGTH))}`,
        )
      }
      throw err
    }
  }

  /**
   * Runs the scanner and gives up after `scanner.timeoutMs`: a scanner that never settles would hold
   * the upload for good. The scanner is handed a signal that aborts then; one that ignores it keeps
   * running.
   */
  private async scanWithinDeadline(scanner: IFileScanner, input: ScanInput): Promise<ScannerOutcome> {
    const timeoutMs = this.options.scanner?.timeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.logger.warn(`Scan timed out: key=${logValue(input.key)} timeoutMs=${String(timeoutMs)}`)
        // The rejection comes first: a scanner that settles inside its abort listener queues its outcome
        // ahead of anything queued after the abort, and would win the race over the deadline.
        reject(
          new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, undefined, {
            key: input.key,
            bucket: input.bucket,
            phase: 'scan',
            timeoutMs,
          }),
        )
        controller.abort()
      }, timeoutMs)
    })
    try {
      return await Promise.race([scanner.scan({ ...input, signal: controller.signal }), deadline])
    } finally {
      clearTimeout(timer)
    }
  }
}
