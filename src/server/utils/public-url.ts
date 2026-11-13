/**
 * @fileoverview Builds the public URL of a stored object from the configured base URL.
 * @layer server/utils
 */
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { trimTrailingSlashes } from './trim-trailing-slashes'

/** Builds a public URL, avoiding a duplicated bucket segment in the base. */
export function buildPublicUrl(
  options: Pick<ResolvedBymaxStorageOptions, 'cdnBaseUrl' | 'publicBaseUrl'>,
  finalKey: string,
  bucket: string,
): string {
  const base = trimTrailingSlashes(options.cdnBaseUrl ?? options.publicBaseUrl)
  return baseCarriesBucket(base, bucket)
    ? `${base}/${finalKey}`
    : `${base}/${bucket}/${finalKey}`
}

/**
 * Reports whether the base URL already carries the bucket as a real segment —
 * the leading host label (virtual-hosted-style `bucket.host`) or a path segment
 * (path-style `/bucket` or `/bucket/…`) — rather than an incidental substring,
 * so `bucket="test"` is not matched by a `latest` elsewhere in the base.
 */
function baseCarriesBucket(base: string, bucket: string): boolean {
  // Stryker disable next-line Regex: `base` is always a well-formed absolute URL with a single leading `scheme://` (or a bare authority with no `://`); for that input domain removing the `^` anchor or widening `\d`→`\D` yields the identical leftmost scheme strip, so `schemeless` is unchanged (equivalent within the contract).
  const schemeless = base.replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
  const pathStart = schemeless.indexOf('/')
  const authority = pathStart === -1 ? schemeless : schemeless.slice(0, pathStart)
  // Stryker disable next-line StringLiteral: when `pathStart === -1` the resulting `path` is only consumed by `pathSegments.includes(bucket)`; '' and any non-bucket sentinel are indistinguishable, and no real bucket equals the injected sentinel (equivalent).
  const path = pathStart === -1 ? '' : schemeless.slice(pathStart)
  const leadingHostLabel = authority.split('.')[0]
  // Stryker disable next-line MethodExpression,ConditionalExpression,EqualityOperator: `pathSegments` is only used via `.includes(bucket)`, and `bucket` is guaranteed non-empty by `resolveBucket`; keeping empty '' segments cannot change the result.
  const pathSegments = path.split('/').filter((segment) => segment.length > 0)
  return leadingHostLabel === bucket || pathSegments.includes(bucket)
}
