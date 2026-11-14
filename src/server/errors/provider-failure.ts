/**
 * @fileoverview Tells what kind of failure an error from the provider is, so that a caller's HTTP layer
 * can answer "try again later" for an outage and not for a fault of the deployment.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'

/**
 * What the failure says about the provider: `unavailable` (it could not be reached, or it answered with
 * a server error: worth retrying), `credentials-refused` (it rejected the access key or the signature: a
 * deployment fault that a retry does not fix) or `other` (it rejected this request).
 */
export type ProviderFailure = 'unavailable' | 'credentials-refused' | 'other'

interface FailureLike {
  name?: unknown
  code?: unknown
  Code?: unknown
  message?: unknown
  cause?: unknown
  errors?: unknown
  $metadata?: { httpStatusCode?: unknown }
}

/** Node's error codes for a connection that could not be made or was cut. */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
])

/**
 * A network failure that reached the SDK as an error from another realm (a test runner's sandbox, for
 * one) is re-thrown as a wrapper that keeps the message and drops the code, so the code is looked for
 * in the message too. That is only read when there is no HTTP answer: a message the provider wrote
 * belongs to an answer, and may say anything.
 */
const UNREACHABLE_IN_MESSAGE = new RegExp(`\\b(?:${[...UNREACHABLE_CODES].join('|')})\\b`)

/** The SDK's wrapper for the error a dual-stack connection ends with when every address fails. */
const ADDRESSES_FAILED = 'AWS SDK error wrapper for AggregateError'

/** The provider answers with these when the access key or the signature is wrong. */
const CREDENTIAL_CODES: ReadonlySet<string> = new Set(['InvalidAccessKeyId', 'SignatureDoesNotMatch'])

/** Whether the failure is a connection that could not be made or was cut, however the SDK reports it. */
function cutConnection(failure: FailureLike, noAnswer: boolean): boolean {
  const codes = [failure.code, (failure.cause as FailureLike | undefined)?.code]
  if (Array.isArray(failure.errors)) {
    codes.push(...failure.errors.map((inner: FailureLike) => inner.code))
  }
  if (codes.some((code) => typeof code === 'string' && UNREACHABLE_CODES.has(code))) {
    return true
  }
  // Stryker disable next-line StringLiteral: the fallback only has to match neither check below, and no text a mutant could put there is a socket error code or the wrapper's prefix (equivalent).
  const message = typeof failure.message === 'string' ? failure.message : ''
  return noAnswer && (UNREACHABLE_IN_MESSAGE.test(message) || message.startsWith(ADDRESSES_FAILED))
}

/**
 * Classifies an error thrown for a request to the provider.
 *
 * Only the provider's own answer refuses credentials: a `HEAD` answer carries no body, so for those
 * calls the code is not there and the failure is `other`.
 *
 * @param err - What the SDK threw.
 * @returns The kind of failure.
 */
export function classifyProviderFailure(err: unknown): ProviderFailure {
  const failure = (err ?? {}) as FailureLike
  const status = failure.$metadata?.httpStatusCode
  if (cutConnection(failure, status === undefined)) {
    return 'unavailable'
  }
  // 501 is the provider saying it does not implement the call: asking again will not change that.
  if (typeof status === 'number' && status >= 500 && status !== 501) {
    return 'unavailable'
  }
  const awsCode = failure.Code ?? failure.name
  if (status === 403 && typeof awsCode === 'string' && CREDENTIAL_CODES.has(awsCode)) {
    return 'credentials-refused'
  }
  return 'other'
}

/**
 * The HTTP status a failure of the provider calls for, when it is not the one its code has by default:
 * 503 for an outage and 500 for refused credentials, which a retry does not fix.
 *
 * @param err - What the SDK threw.
 * @returns The status, or `undefined` to keep the code's own.
 */
export function providerFailureStatus(err: unknown): number | undefined {
  const failure = classifyProviderFailure(err)
  if (failure === 'unavailable') {
    return HttpStatus.SERVICE_UNAVAILABLE
  }
  return failure === 'credentials-refused' ? HttpStatus.INTERNAL_SERVER_ERROR : undefined
}
