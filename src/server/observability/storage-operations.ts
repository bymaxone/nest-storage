/**
 * @fileoverview The closed sets the metrics and the spans are keyed by, and how a failure is told into one
 * of the outcomes. Nothing a caller or a host supplied is ever a member.
 * @layer server/observability
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'

/** The operations the library counts and times. */
export const STORAGE_OPERATIONS = [
  'upload',
  'download',
  'head',
  'delete',
  'delete_many',
  'list',
  'copy',
  'get_download_url',
  'get_upload_url',
  'get_multipart_upload_urls',
  'check_bucket',
  'lifecycle_get',
  'lifecycle_upsert',
  'lifecycle_remove',
] as const

/** What an operation ended as. */
export const STORAGE_OUTCOMES = ['success', 'not_found', 'aborted', 'error'] as const

/** What a scan ended as. */
export const SCAN_VERDICTS = ['clean', 'infected', 'unknown', 'timeout', 'error'] as const

/** One of {@link STORAGE_OPERATIONS}. */
export type StorageOperation = (typeof STORAGE_OPERATIONS)[number]
/** One of {@link STORAGE_OUTCOMES}. */
export type StorageOutcome = (typeof STORAGE_OUTCOMES)[number]
/** One of {@link SCAN_VERDICTS}. */
export type ScanVerdict = (typeof SCAN_VERDICTS)[number]

/**
 * Tells a failure into an outcome from its library code, never from its text: an absent object is
 * `not_found`, a request or a multipart upload that was cancelled is `aborted`, anything else is `error`.
 *
 * @param error - What the operation threw.
 * @returns The outcome of a failed operation.
 */
export function outcomeOf(error: unknown): Exclude<StorageOutcome, 'success'> {
  if (!(error instanceof StorageException)) return 'error'
  if (error.code === STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND) return 'not_found'
  if (
    error.code === STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED ||
    error.code === STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED
  ) {
    return 'aborted'
  }
  return 'error'
}

/**
 * Tells a scan that did not return a result into a verdict from its library code: the scanner said `infected`,
 * said `unknown` and the module rejects that (or answered outside its contract), outlasted its deadline, or
 * failed for any other reason.
 *
 * @param error - What the scan threw.
 * @returns The verdict of a scan that threw.
 */
export function scanVerdictOfError(error: unknown): Exclude<ScanVerdict, 'clean'> {
  if (!(error instanceof StorageException)) return 'error'
  if (error.code === STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED) return 'infected'
  if (error.code === STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE) return 'unknown'
  if (error.code === STORAGE_ERROR_CODES.STORAGE_TIMEOUT) return 'timeout'
  return 'error'
}
