/**
 * @fileoverview Wraps the consumer-injected `IFileScanner` with the library's
 * policy: mode resolution, `rejectOnUnknown`, and logging. An absent scanner
 * is a valid state — guard callers with `isEnabled()` before calling `scan()`.
 * @layer server/services
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_FILE_SCANNER } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { IFileScanner, FileScanResult } from '../interfaces/file-scanner.interface'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { DEFAULT_SCANNER_TIMEOUT_MS } from '../constants/default-options.constants'
import { escapeForLog } from '../utils/log-value'
import { cutText } from '../utils/cut-text'
import { emit } from '../utils/log-event'
import { STORAGE_LOG_EVENTS } from '../utils/log-events'
import { failureError } from '../utils/provider-failure-log'
import { readOptionalField } from '../utils/read-once'
import { isRootRefusal } from '../utils/prototype-guard'
import { settleOrCut, verdictOf } from '../utils/settle-or-cut'
import { StorageObserver } from '../observability/storage-observer'

/** What the log line holds when the details cannot be turned into text. */
const UNSERIALISABLE = '[unserialisable]'

/** The most characters of the engine and threat names a body and a log line carry. */
const MAX_SCANNER_LABEL_LENGTH = 200

/** The most characters of a scanner's own `details`, or of its failure message, a log line carries. */
const MAX_SCANNER_DETAILS_LENGTH = 300

/** The most characters of an unrecognised status a log line carries. */
const MAX_STATUS_LOG_LENGTH = 40

/**
 * An unrecognised status as a log field: a string is cut and escaped, anything else is named by its type,
 * so no `toString` of the scanner's own object runs and nothing it holds reaches the log.
 */
function statusForLog(status: unknown): string {
  return typeof status === 'string'
    ? escapeForLog(cutText(status, MAX_STATUS_LOG_LENGTH))
    : `<${typeof status}>`
}

/** The engine or threat name as the scanner gave it, cut to {@link MAX_SCANNER_LABEL_LENGTH}; `undefined` when it is not a string. */
function scannerLabel(value: unknown): string | undefined {
  return typeof value === 'string' ? cutText(value, MAX_SCANNER_LABEL_LENGTH) : undefined
}

/** An engine or threat name as a log field: control characters escaped; no field when it is not a string. */
function labelForLog(label: string | undefined): string | undefined {
  return label === undefined ? undefined : escapeForLog(label)
}

/** `JSON.stringify` as it behaves: `undefined`, not a string, for a value whose `toJSON()` returns nothing. */
function toJson(value: unknown): string | undefined {
  return JSON.stringify(value)
}

/**
 * What the scanner put in `details`, as a log field. The text is the scanner's, so it never reaches a
 * response body: a client is told the engine and the threat name and nothing else.
 *
 * @param details - The scanner's free-form `details`.
 * @returns The details as escaped, cut text, or no field when there are none.
 */
function scannerDetailsForLog(details: Record<string, unknown> | undefined): { details?: string } {
  if (details === undefined) return {}
  let text: string
  try {
    text = toJson(details) ?? UNSERIALISABLE
  } catch {
    text = UNSERIALISABLE
  }
  return { details: escapeForLog(cutText(text, MAX_SCANNER_DETAILS_LENGTH)) }
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
    @Optional() @Inject(StorageObserver) private readonly observer?: StorageObserver,
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
   * @param caller - What the deadline error repeats of the call (see `callerFields`): the caller's own key and
   *   bucket, never the prefixed key or the configured bucket that `input` holds for the scanner.
   * @returns The scan result when `status` is `'clean'` or `'unknown'` (non-rejecting).
   * @throws Error when called without a configured scanner.
   * @throws StorageException `STORAGE_SCAN_INFECTED` on an infected result.
   * @throws StorageException `STORAGE_SCAN_INCONCLUSIVE` on an unknown result with `rejectOnUnknown`, or a result outside the contract.
   * @throws StorageException `STORAGE_TIMEOUT` when the scan outlasts `scanner.timeoutMs`.
   */
  async scan(input: ScanInput, caller: Record<string, unknown> = {}): Promise<FileScanResult> {
    if (!this.scanner) {
      throw new Error(
        'FileScannerService.scan() called without a configured scanner — guard with isEnabled() first.',
      )
    }
    const scanner = this.scanner
    const run = (): Promise<FileScanResult> => this.evaluate(scanner, input, caller)
    return await verdictOf(
      this.observer === undefined ? run() : this.observer.scan(input.mode, run),
    )
  }

  /** Runs the scanner and applies the library's policy to what it answered. */
  private async evaluate(
    scanner: IFileScanner,
    input: ScanInput,
    caller: Record<string, unknown>,
  ): Promise<FileScanResult> {
    const result = await verdictOf(this.scanLogged(scanner, input, caller))
    // Each field of what the scanner answered is its own: a key only the root prototype supplies is not a field.
    const status = readOptionalField(result, 'status')
    const engine = scannerLabel(readOptionalField(result, 'engine'))
    const threat = scannerLabel(readOptionalField(result, 'threat'))
    const details = scannerDetailsForLog(
      readOptionalField(result, 'details') as Record<string, unknown> | undefined,
    )

    if (status === 'clean') {
      return result as FileScanResult
    }
    if (status === 'infected') {
      emit(this.logger, 'warn', {
        event: STORAGE_LOG_EVENTS.scanInfected,
        message: 'Infected file detected',
        engine: labelForLog(engine),
        threat: escapeForLog(threat ?? 'unknown'),
        ...details,
      })
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, undefined, {
        engine,
        threat,
      })
    }
    if (status === 'unknown' && !this.options.scanner?.rejectOnUnknown) {
      emit(this.logger, 'warn', {
        event: STORAGE_LOG_EVENTS.scanInconclusiveAccepted,
        message: 'Inconclusive scan result accepted',
        engine: labelForLog(engine),
      })
      return result as FileScanResult
    }
    return this.rejectInconclusive(status, engine, details)
  }

  /**
   * `unknown` with `rejectOnUnknown`, or a result outside the contract (no result, a status that is not
   * exactly one of the three): the object is not known to be clean, so it is not stored.
   */
  private rejectInconclusive(
    status: unknown,
    engine: string | undefined,
    details: { details?: string },
  ): never {
    const unrecognised = status !== 'unknown'
    emit(this.logger, 'warn', {
      event: STORAGE_LOG_EVENTS.scanInconclusiveRejected,
      message: 'Inconclusive scan result rejected',
      engine: labelForLog(engine),
      ...(unrecognised ? { status: statusForLog(status) } : {}),
      ...details,
    })
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE, undefined, {
      engine,
      ...(unrecognised ? { reason: 'unrecognised scanner status' } : {}),
    })
  }

  /**
   * Runs the scan and logs a scanner that throws: the caller is answered 500 for that, and without the
   * line there would be no trace of why. A typed failure of ours (the deadline) says it itself.
   */
  private async scanLogged(
    scanner: IFileScanner,
    input: ScanInput,
    caller: Record<string, unknown>,
  ): Promise<ScannerOutcome> {
    try {
      return await verdictOf(this.scanWithinDeadline(scanner, input, caller))
    } catch (err) {
      if (isRootRefusal(err)) {
        emit(this.logger, 'warn', {
          event: STORAGE_LOG_EVENTS.rootGuardRefused,
          message: 'The runtime differs from the one the library loaded in; the scan was refused',
        })
      } else if (!(err instanceof StorageException)) {
        emit(this.logger, 'warn', {
          event: STORAGE_LOG_EVENTS.scanFailed,
          message: 'Scanner failed',
          err: failureError(err),
        })
      }
      throw err
    }
  }

  /**
   * Runs the scanner and gives up after `scanner.timeoutMs`: a scanner that never settles would hold
   * the upload for good. The scanner is handed a signal that aborts then; one that ignores it keeps
   * running.
   */
  private async scanWithinDeadline(
    scanner: IFileScanner,
    input: ScanInput,
    caller: Record<string, unknown>,
  ): Promise<ScannerOutcome> {
    const timeoutMs = this.options.scanner?.timeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS
    const controller = new AbortController()
    return await settleOrCut(scanner.scan({ ...input, signal: controller.signal }), (cut) => {
      const timer = setTimeout(() => {
        emit(this.logger, 'warn', {
          event: STORAGE_LOG_EVENTS.scanTimeout,
          message: 'Scan timed out',
          timeoutMs,
        })
        // The rejection comes first: a scanner that settles inside its abort listener queues its outcome
        // behind it, and the deadline's rejection has already ended the wait.
        cut.reject(
          new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, undefined, {
            ...caller,
            phase: 'scan',
            timeoutMs,
          }),
        )
        controller.abort()
      }, timeoutMs)
      return () => {
        clearTimeout(timer)
      }
    })
  }
}
