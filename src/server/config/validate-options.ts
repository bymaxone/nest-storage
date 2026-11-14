/**
 * @fileoverview Bootstrap-time validation of module options. Throws
 * `StorageException` with code `STORAGE_INVALID_CONFIG` carrying actionable
 * details. Tolerates empty credentials so dev workflows run without storage —
 * individual operations then fail lazily with `STORAGE_NOT_CONFIGURED`.
 * @layer server/config
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { isHeaderValue } from '../utils/header-value'

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024

function invalid(reason: string): StorageException {
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG, HttpStatus.INTERNAL_SERVER_ERROR, {
    reason,
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * What precedes the authority: an optional scheme and any run of slashes or backslashes, since a URL
 * parser accepts `https://host`, `https:/host`, `https:host` and `//host` alike.
 */
const BEFORE_AUTHORITY = /^(?:[a-z][a-z\d+.-]*:)?[/\\]*/i

/**
 * The value as a URL parser reads it before parsing: leading control characters and spaces are
 * dropped (trailing ones cannot matter here) and tabs and line breaks are removed wherever they are.
 */
function asParsed(value: string): string {
  return value.replace(/[\t\n\r]/g, '').replace(/^[\p{Cc} ]+/u, '')
}

/** Whether a URL parser reads the value as having a user or a password. */
function parsedCarriesCredentials(value: string): boolean {
  try {
    const url = new URL(value)
    return url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}

/**
 * Whether the text holds userinfo read as a string: the authority is what follows
 * {@link BEFORE_AUTHORITY} up to the first `/`, `?` or `#` (a backslash is not one: only a special
 * scheme reads it as a slash, so counting it as part of the authority can only refuse more), and an
 * `@` in it separates userinfo from the host. This covers values a URL parser reads as something
 * else or rejects (`user@host:9000`, `user:pw@host`).
 */
function authorityCarriesCredentials(text: string): boolean {
  const rest = text.replace(BEFORE_AUTHORITY, '')
  const end = rest.search(/[/?#]/)
  return (end === -1 ? rest : rest.slice(0, end)).includes('@')
}

/**
 * Whether a URL option holds userinfo, by either reading: the URL parser's own, which normalizes
 * whatever it normalizes, or the string reading of the value as the parser would see it.
 */
function urlCarriesCredentials(value: string): boolean {
  return parsedCarriesCredentials(value) || authorityCarriesCredentials(asParsed(value))
}

/**
 * Validates options at module bootstrap. Credentials may be empty (handled
 * lazily); structural fields are mandatory.
 *
 * @param options - The raw options passed to `forRoot`/`forRootAsync`.
 * @throws StorageException with code `STORAGE_INVALID_CONFIG`.
 */
export function validateOptions(options: unknown): void {
  if (!isObject(options)) {
    throw invalid('options object is required')
  }
  if (!isNonEmptyString(options.endpoint)) {
    throw invalid('options.endpoint must be a non-empty string')
  }
  // The endpoint is logged and is the base of the derived public URL; the two public URLs are
  // returned to callers in every `publicUrl`. A secret in any of them reaches logs or clients.
  for (const name of ['endpoint', 'publicBaseUrl', 'cdnBaseUrl'] as const) {
    const value = options[name]
    if (typeof value === 'string' && urlCarriesCredentials(value)) {
      throw invalid(`options.${name} must not carry credentials; pass them in options.credentials`)
    }
  }
  if (!isNonEmptyString(options.region)) {
    throw invalid('options.region must be a non-empty string')
  }
  if (!isNonEmptyString(options.bucket)) {
    throw invalid('options.bucket must be a non-empty string')
  }
  if (!isObject(options.credentials)) {
    throw invalid('options.credentials is required')
  }
  // Credentials may be empty strings — handled lazily via STORAGE_NOT_CONFIGURED.

  const signedUrls = options.signedUrls
  if (isObject(signedUrls) && typeof signedUrls.maxTtlSeconds === 'number' && signedUrls.maxTtlSeconds <= 0) {
    throw invalid('signedUrls.maxTtlSeconds must be > 0')
  }
  const multipart = options.multipart
  if (
    isObject(multipart) &&
    typeof multipart.partSizeBytes === 'number' &&
    multipart.partSizeBytes < MIN_PART_SIZE_BYTES
  ) {
    throw invalid('multipart.partSizeBytes must be >= 5 MB (S3 hard limit)')
  }
  for (const name of ['requestTimeoutMs', 'maxAttempts'] as const) {
    const value = options[name]
    if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
      throw invalid(`${name} must be an integer >= 1`)
    }
  }
  for (const name of ['uploadIdleTimeoutMs', 'bodyIdleTimeoutMs'] as const) {
    const idle = options[name]
    if (idle !== undefined && (typeof idle !== 'number' || !Number.isInteger(idle) || idle < 0)) {
      throw invalid(`${name} must be an integer >= 0 (0 disables the guard)`)
    }
  }
  if (options.serverSideEncryption === 'aws:kms' && !options.kmsKeyId) {
    throw invalid('kmsKeyId is required when serverSideEncryption === "aws:kms"')
  }
  for (const name of ['defaultCacheControl', 'kmsKeyId'] as const) {
    if (options[name] !== undefined && !isHeaderValue(options[name])) {
      throw invalid(`options.${name} must be a string of tab, space and printable ASCII characters`)
    }
  }
}
