/**
 * @fileoverview What an `abortSignal` means to a call: an aborted signal ends it before any request,
 * the signal rides on the SDK call, a call that fails while its signal is aborted fails as the typed
 * abort error, and the cleanup of an abandoned call runs on a deadline of its own.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * How long the cleanup of an aborted or failed call may take. It runs with a signal of its own, never
 * the caller's (an aborted signal would cancel it and leave parts stored), so an unresponsive store
 * cannot hold the call open either.
 */
export const CLEANUP_DEADLINE_MS = 10_000

/** The name of an abort reason (`AbortError`, `TimeoutError`, ...), never its message. */
function reasonName(signal: AbortSignal): string {
  const reason: unknown = signal.reason
  // Not `instanceof Error`: a DOMException (the default reason, and a timeout's) can come from
  // another realm and is not one, yet it carries the name.
  if (typeof reason === 'object' && reason !== null && 'name' in reason && typeof reason.name === 'string') {
    return reason.name
  }
  return 'AbortError'
}

/**
 * The error a call ends with when its signal aborted.
 *
 * @param signal - The caller's signal.
 * @param context - Non-sensitive details to carry (key, bucket, op and, for multipart, the abort outcome).
 * @returns `STORAGE_REQUEST_ABORTED` with `details.reason` set to the reason's name.
 */
export function requestAborted(
  signal: AbortSignal,
  context: Record<string, unknown>,
): StorageException {
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED, undefined, {
    ...context,
    reason: reasonName(signal),
  })
}

/**
 * Ends the call before any request when its signal has already aborted.
 *
 * @param signal - The caller's signal, if any.
 * @param context - Details to carry on the error.
 * @throws StorageException `STORAGE_REQUEST_ABORTED`.
 */
export function throwIfAborted(
  signal: AbortSignal | undefined,
  context: Record<string, unknown>,
): void {
  if (signal?.aborted) {
    throw requestAborted(signal, context)
  }
}

/**
 * The per-call options of an SDK `send` that carry the caller's signal; nothing without one.
 *
 * @param signal - The caller's signal, if any.
 * @returns `{ abortSignal }`, or `undefined`.
 */
export function sendOptions(signal: AbortSignal | undefined): { abortSignal: AbortSignal } | undefined {
  return signal ? { abortSignal: signal } : undefined
}

/**
 * The error a failed call ends with: the typed abort error when its signal aborted (whatever the SDK
 * reported), otherwise `mapped`.
 *
 * @param signal - The caller's signal, if any.
 * @param context - Details to carry on an abort error.
 * @param mapped - What the failure maps to when the signal did not abort.
 * @returns The exception to throw.
 */
export function failureOrAbort(
  signal: AbortSignal | undefined,
  context: Record<string, unknown>,
  mapped: StorageException,
): StorageException {
  return signal?.aborted ? requestAborted(signal, context) : mapped
}
