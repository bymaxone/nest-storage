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

/** Secrets that can sit in a message: a presigned URL's signature and credentials, an access key id. */
const SECRET_IN_MESSAGE =
  /(X-Amz-(?:Signature|Credential|Security-Token)|AWSAccessKeyId|Signature)=[^&\s"']+/gi

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
  const message = describeError(err).replace(SECRET_IN_MESSAGE, '$1=[redacted]')
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
 * the host's logs while the error the caller receives holds only a fixed reason.
 *
 * @param err - What the SDK threw.
 * @param context - Non-sensitive context of the call (`op`, `key`, `bucket`).
 */
export function logProviderFailure(err: unknown, context?: Record<string, unknown>): void {
  const op = typeof context?.op === 'string' ? logValue(context.op) : '-'
  const key = typeof context?.key === 'string' ? logValue(context.key) : '-'
  logger.warn(`Provider call failed: op=${op} key=${key} ${describeProviderFailure(err)}`)
}
