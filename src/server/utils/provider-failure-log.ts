/**
 * @fileoverview The one way a failed call to the provider is written to the log: an event with named fields
 * (the operation, the provider's code, the HTTP status, the request id and the kind of failure) and the
 * error as a fresh object built from a fixed projection of the SDK's, never the SDK's own. A logger
 * serialises what it is given, and the SDK error holds `$response`, headers and vendor fields that must
 * not reach a log any more than a response body.
 * @layer server/utils
 */
import { Logger } from '@nestjs/common'
import { providerFailureReason } from '../errors/provider-failure'
import { cutText } from './cut-text'
import { describeError } from './describe-error'
import { emit } from './log-event'
import { STORAGE_LOG_EVENTS } from './log-events'
import { escapeForLog } from './log-value'

/**
 * Secrets that can sit in a message, as `name=value`: a presigned URL's signature and credentials, the
 * credential scope and signature of an `Authorization` header, an access key id.
 */
const SECRET_IN_MESSAGE =
  /(X-Amz-(?:Signature|Credential|Security-Token)|AWSAccessKeyId|Credential|Signature)=[^&\s"']+/gi

/** An access key id on its own (long-term `AKIA`, temporary `ASIA`): an identifier worth keeping out of a log. */
const BARE_ACCESS_KEY_ID = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g

/** The longest message a log line carries, so a provider that answers with a page cannot flood it. */
const MAX_MESSAGE_LENGTH = 300

const logger = new Logger('StorageProvider')

interface FailureLike {
  name?: unknown
  Code?: unknown
  $metadata?: { httpStatusCode?: unknown; requestId?: unknown }
}

/** What the log carries of a failed call: the fixed fields of the error, each a string or a number. */
export interface ProviderFailureView {
  readonly name?: string
  readonly awsCode?: string
  readonly httpStatus?: number
  readonly requestId?: string
  /** The message with secrets masked, bounded and control characters escaped. */
  readonly message: string
}

/** The longest name, code or request id a log line carries. */
const MAX_FIELD_LENGTH = 128

/** What `read` returns, or `undefined` when reading it throws: a getter of the host's or the driver's must not break a log line. */
function readOrUndefined<T>(read: () => T): T | undefined {
  // prettier-ignore
  try {
    return read()
  }
  // Stryker disable next-line BlockStatement: an empty catch block ends the function with `undefined`, which is what `return undefined` returns (equivalent).
  catch {
    return undefined
  }
}

/** A string field of the error, cut and escaped; `undefined` when it is not a string. */
function textField(value: unknown): string | undefined {
  return typeof value === 'string' ? escapeForLog(cutText(value, MAX_FIELD_LENGTH)) : undefined
}

/**
 * Projects a failed call onto the fields a log carries, from named fields only.
 *
 * @param err - What the SDK threw (any value).
 * @returns The name, the provider's code, the HTTP status, the request id and the message with signatures
 *   and credentials masked and its length bounded; a field the error does not have, or holds as another
 *   kind, is left out. Never throws.
 */
export function projectProviderFailure(err: unknown): ProviderFailureView {
  const failure = (typeof err === 'object' && err !== null ? err : {}) as FailureLike
  const message = describeError(err)
    .replace(SECRET_IN_MESSAGE, '$1=[redacted]')
    .replace(BARE_ACCESS_KEY_ID, '[redacted-key-id]')
  const status = readOrUndefined(() => failure.$metadata?.httpStatusCode)
  const name = textField(readOrUndefined(() => failure.name))
  const awsCode = textField(readOrUndefined(() => failure.Code))
  const requestId = textField(readOrUndefined(() => failure.$metadata?.requestId))
  return {
    ...(name !== undefined ? { name } : {}),
    ...(awsCode !== undefined ? { awsCode } : {}),
    ...(typeof status === 'number' ? { httpStatus: status } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    message: escapeForLog(cutText(message, MAX_MESSAGE_LENGTH)),
  }
}

/**
 * A fresh error built from the projection, for a logger to serialise: the name, the provider's code and
 * the masked message, and nothing else of the SDK's error (no `$response`, no `$metadata`, no headers and
 * no `cause`).
 *
 * @param err - What the SDK threw (any value).
 * @returns A new `Error`; never the SDK's own.
 */
export function failureError(err: unknown): Error {
  const view = projectProviderFailure(err)
  const error = new Error(view.message)
  if (view.name !== undefined) error.name = view.name
  if (view.awsCode !== undefined)
    Object.defineProperty(error, 'awsCode', {
      __proto__: null,
      value: view.awsCode,
      enumerable: true,
    } as PropertyDescriptor)
  return error
}

/**
 * Logs a failed call to the provider as a warning event, so that what the provider or the driver said
 * reaches the operator under `err` and never in the message. A request the caller cancelled
 * (`AbortError`) is not a failure of the provider and is not logged.
 *
 * @param err - What the SDK threw.
 * @param context - Non-sensitive context of the call: only `op` is read. No key and no bucket is logged.
 * @param label - The library text of the event; names what failed when it was not a single provider call.
 */
export function logProviderFailure(
  err: unknown,
  context?: Record<string, unknown>,
  label = 'Provider call failed',
): void {
  if (readOrUndefined(() => (err as { name?: unknown } | null)?.name) === 'AbortError') {
    return
  }
  const view = projectProviderFailure(err)
  emit(logger, 'warn', {
    event: STORAGE_LOG_EVENTS.providerCallFailed,
    message: label,
    ...(typeof context?.op === 'string' ? { operation: escapeForLog(context.op) } : {}),
    ...(view.awsCode !== undefined ? { awsCode: view.awsCode } : {}),
    ...(view.httpStatus !== undefined ? { httpStatus: view.httpStatus } : {}),
    ...(view.requestId !== undefined ? { requestId: view.requestId } : {}),
    reason: readOrUndefined(() => providerFailureReason(err)) ?? 'rejected',
    err: failureError(err),
  })
}
