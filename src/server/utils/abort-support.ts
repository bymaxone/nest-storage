/**
 * @fileoverview What an `abortSignal` means to a call: an aborted signal ends it before any request,
 * the signal rides on the SDK call, a call that fails while its signal is aborted fails as the typed
 * abort error, and the cleanup of an abandoned call runs on a deadline of its own.
 * @layer server/utils
 */
import { CreateMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3'
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

/** An S3 client whose requests carry a caller's signal, and the upload id its multipart create returned. */
export interface SignalBoundClient {
  client: S3Client
  /** The upload id `CreateMultipartUpload` answered, once it has answered; `undefined` if it never did. */
  createdUploadId: () => Promise<string | undefined>
}

/**
 * Wraps a client so that every request sent through it ends when `signal` aborts, which
 * `@aws-sdk/lib-storage` does not do by itself: its `abort()` only rejects `done()` and leaves the
 * part requests it has in flight open. `CreateMultipartUpload` is the exception: it is sent without
 * the signal so that, however late the provider answers, its upload id reaches the cleanup that
 * has to abort it.
 *
 * @param client - The module's S3 client; it is not modified.
 * @param signal - The caller's signal.
 * @returns The wrapped client and a way to read the upload id the create returned.
 */
export function bindToSignal(client: S3Client, signal: AbortSignal): SignalBoundClient {
  let created: Promise<string | undefined> = Promise.resolve(undefined)
  const bound = new Proxy(client, {
    get(target, property) {
      if (property !== 'send') {
        const value: unknown = Reflect.get(target, property, target)
        return value
      }
      return (command: Parameters<S3Client['send']>[0], options?: object) => {
        if (command instanceof CreateMultipartUploadCommand) {
          const sent = target.send(command, options)
          created = sent.then(
            (response) => response.UploadId,
            () => undefined,
          )
          return sent
        }
        return target.send(command, { ...options, abortSignal: signal })
      }
    },
  })
  return { client: bound, createdUploadId: () => created }
}

/**
 * Waits for `promise` for at most `ms`, so that cleanup never waits longer than its deadline.
 *
 * @param promise - What to wait for.
 * @param ms - The longest wait.
 * @returns The settled value, or `undefined` when `ms` passed first.
 */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ends a wait on `work` as soon as `signal` aborts. For work that reads a body before any request is
 * made (a validator peeking at a stream, the pre-upload scan buffering it): nothing there carries the
 * signal, and a silent stream would otherwise hold the call forever. `work` is not cancelled; the
 * caller releases what it reads, and whatever `work` then rejects with is dropped.
 *
 * @param work - What is being waited for.
 * @param signal - The caller's signal, if any; without one `work` is returned as it is.
 * @param context - Details to carry on the abort error.
 * @returns `work`'s outcome, its own rejection reason unchanged, or a rejection with
 *   `STORAGE_REQUEST_ABORTED` once the signal aborted.
 */
export async function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  context: Record<string, unknown>,
): Promise<T> {
  if (!signal) {
    return work
  }
  if (signal.aborted) {
    // No event will come: the work may have started, and aborted the signal, before this wait began.
    work.catch(() => undefined)
    throw requestAborted(signal, context)
  }
  const release = new AbortController()
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(requestAborted(signal, context))
      },
      { once: true, signal: release.signal },
    )
  })
  try {
    return await Promise.race([work, aborted])
  } finally {
    release.abort()
    // If the signal won, whatever `work` rejects with later is of no interest to anyone.
    work.catch(() => undefined)
  }
}
