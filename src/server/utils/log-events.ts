/**
 * @fileoverview The codes of the log events the library writes. Each is listed, with its level, the
 * moment it is written and its fields, in the README "Log events" table.
 * @layer server/utils
 */
export const STORAGE_LOG_EVENTS = {
  ttlClamped: 'STORAGE_TTL_CLAMPED',
  credentialsMissing: 'STORAGE_CREDENTIALS_MISSING',
  clientReady: 'STORAGE_CLIENT_READY',
  providerCallFailed: 'STORAGE_PROVIDER_CALL_FAILED',
  multipartAbortFailed: 'STORAGE_MULTIPART_ABORT_FAILED',
  scanInfected: 'STORAGE_SCAN_INFECTED',
  scanInconclusiveAccepted: 'STORAGE_SCAN_INCONCLUSIVE_ACCEPTED',
  scanInconclusiveRejected: 'STORAGE_SCAN_INCONCLUSIVE_REJECTED',
  scanFailed: 'STORAGE_SCAN_FAILED',
  scanTimeout: 'STORAGE_SCAN_TIMEOUT',
  scanCleanupFailed: 'STORAGE_SCAN_CLEANUP_FAILED',
  existsFailed: 'STORAGE_EXISTS_FAILED',
  deleteNotFound: 'STORAGE_DELETE_NOT_FOUND',
} as const

/** The code of a log event. */
export type StorageLogEvent = (typeof STORAGE_LOG_EVENTS)[keyof typeof STORAGE_LOG_EVENTS]
