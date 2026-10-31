/**
 * @fileoverview Classifies the failures specific to bucket lifecycle calls:
 * "no configuration yet" (an empty set, not an error), a provider that does not
 * implement the API, and a configuration the provider refuses. Everything else
 * falls through to `mapAwsError`.
 * @layer server/errors
 */
import { StorageException } from './storage-exception'
import { mapAwsError } from './aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

interface AwsLikeError {
  name?: string
  Code?: string
  $metadata?: { httpStatusCode?: number }
}

/** Error names that mean the provider does not implement the lifecycle API. */
const UNSUPPORTED_NAMES = new Set<string | undefined>([
  'NotImplemented',
  'XNotImplemented',
  'MethodNotAllowed',
])

/** Error names that mean the provider refused the configuration it was sent. */
const REJECTED_NAMES = new Set<string | undefined>([
  'MalformedXML',
  'InvalidArgument',
  'InvalidRequest',
  'BadRequest',
])

const UNSUPPORTED_STATUSES = new Set([405, 501])

/**
 * Whether a `GetBucketLifecycleConfiguration` failure only means that the bucket
 * has no lifecycle configuration yet.
 *
 * @param err - The error thrown by the AWS SDK.
 * @returns `true` for `NoSuchLifecycleConfiguration`.
 */
export function isNoLifecycleConfiguration(err: unknown): boolean {
  const e = (err ?? {}) as AwsLikeError
  return (e.Code ?? e.name) === 'NoSuchLifecycleConfiguration'
}

/**
 * Maps a lifecycle call failure to a typed `StorageException`. An unsupported
 * provider and a rejected configuration get their own stable codes; the rest are
 * mapped as any other provider failure. `details` carries the same projected
 * fields `mapAwsError` produces, never the caught error.
 *
 * @param err - The error thrown by the AWS SDK.
 * @param context - Non-sensitive context merged into `details`.
 * @returns The typed exception to throw.
 */
export function mapLifecycleError(
  err: unknown,
  context: Record<string, unknown>,
): StorageException {
  const mapped = mapAwsError(err, context)
  const e = (err ?? {}) as AwsLikeError
  const name = e.Code ?? e.name
  const status = e.$metadata?.httpStatusCode ?? 0
  const details = (mapped.getResponse() as { error: { details: Record<string, unknown> } }).error
    .details
  if (UNSUPPORTED_NAMES.has(name) || UNSUPPORTED_STATUSES.has(status)) {
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_LIFECYCLE_UNSUPPORTED, undefined, details)
  }
  if (REJECTED_NAMES.has(name)) {
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_LIFECYCLE_REJECTED, undefined, details)
  }
  return mapped
}
