/**
 * @fileoverview The one way a failed call to the provider is written to the log: a fixed projection of
 * the error (its name, the provider's code, the HTTP status, the request id and the message), never
 * the error itself. A logger serializes what it is given, and the SDK error holds `$response`, headers
 * and vendor fields that must not reach a log any more than a response body.
 * @layer server/utils
 */
import { Logger } from '@nestjs/common'
import { describeError } from './describe-error'
import { logValue } from './log-value'

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

/** A field of the error as text, or `-` when it is not a string or a number. */
function field(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? logValue(value) : '-'
}

/**
 * Describes a failed call for a log line, from named fields only.
 *
 * @param err - What the SDK threw (any value).
 * @returns `name`, `code`, `status`, `requestId` and the message with signatures and credentials
 *   masked and its length bounded, each as a quoted, escaped token; never throws.
 */
export function describeProviderFailure(err: unknown): string {
  const failure = (typeof err === 'object' && err !== null ? err : {}) as FailureLike
  const message = describeError(err)
    .replace(SECRET_IN_MESSAGE, '$1=[redacted]')
    .replace(BARE_ACCESS_KEY_ID, '[redacted-key-id]')
  return [
    `name=${field(failure.name)}`,
    `code=${field(failure.Code)}`,
    `status=${field(failure.$metadata?.httpStatusCode)}`,
    `requestId=${field(failure.$metadata?.requestId)}`,
    `message=${logValue(message.slice(0, MAX_MESSAGE_LENGTH))}`,
  ].join(' ')
}

/**
 * Logs a failed call to the provider at warn level, so that what the provider or the driver said is in
 * the host's logs while the error the caller receives holds only a fixed reason. A request the caller
 * cancelled is not a failure of the provider and is not logged.
 *
 * @param err - What the SDK threw.
 * @param context - Non-sensitive context of the call (`op`, `key`, `bucket`).
 * @param label - How the line opens; names what failed when it was not a single provider call.
 */
export function logProviderFailure(
  err: unknown,
  context?: Record<string, unknown>,
  label = 'Provider call failed',
): void {
  if ((err as { name?: unknown } | null)?.name === 'AbortError') {
    return
  }
  const op = typeof context?.op === 'string' ? logValue(context.op) : '-'
  const key = typeof context?.key === 'string' ? logValue(context.key) : '-'
  logger.warn(`${label}: op=${op} key=${key} ${describeProviderFailure(err)}`)
}
