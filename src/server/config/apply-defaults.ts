/**
 * @fileoverview Merges consumer options with library defaults into a fully
 * resolved options object. `signedUrls` and `multipart` are shallow-merged —
 * a nested object from the consumer overrides the matching defaults key-by-key.
 * @layer server/config
 */
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { trimTrailingSlashes } from '../utils/trim-trailing-slashes'
import type { ResolvedBymaxStorageOptions } from './resolved-options'
import {
  DEFAULT_CACHE_CONTROL,
  DEFAULT_CHECKSUM_CALCULATION,
  DEFAULT_CHECKSUM_VALIDATION,
  DEFAULT_CONTENT_DISPOSITION,
  DEFAULT_FORCE_PATH_STYLE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MULTIPART,
  DEFAULT_PUBLIC_READ,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SIGNED_URLS,
} from '../constants/default-options.constants'
import {
  MULTIPART_KEYS,
  SCANNER_KEYS,
  SIGNED_URL_KEYS,
  VALIDATION_KEYS,
  type NamesEveryKey,
} from './option-keys'
import { readField } from '../utils/read-once'
import { MAX_SIGNED_URL_TTL_SECONDS } from '../../shared/constants/default-ttls.constants'

/**
 * The keys of an option group that hold a value, read by name: a key set to `undefined` or `null` means "use
 * the default", so it must not overwrite one when the group is merged over its defaults. Reading by name and
 * not by own enumerable entries keeps a value that a class instance serves from a prototype getter, which is
 * what the validation read.
 */
function definedOnly<T extends object, const K extends readonly (keyof T)[]>(
  group: T | undefined,
  keys: K & NamesEveryKey<T, K>,
): Partial<T> {
  // No prototype: a key planted on `Object.prototype` must not read as a value of a group that never set it.
  const picked = Object.create(null) as Partial<T>
  for (const key of keys) {
    const value =
      group === undefined ? undefined : (readField(group, key as string) as T[keyof T] | undefined)
    if (value !== undefined && value !== null) picked[key] = value
  }
  return picked
}

/**
 * Merges the signed-URL options over their defaults and caps `maxTtlSeconds` at the
 * SigV4 presign limit: the signer rejects any longer expiry, so a larger configured
 * ceiling could never produce a working URL.
 */
function resolveSignedUrls(
  configured: BymaxStorageModuleOptions['signedUrls'],
): ResolvedBymaxStorageOptions['signedUrls'] {
  const merged = { ...DEFAULT_SIGNED_URLS, ...definedOnly(configured, SIGNED_URL_KEYS) }
  return { ...merged, maxTtlSeconds: Math.min(merged.maxTtlSeconds, MAX_SIGNED_URL_TTL_SECONDS) }
}

/**
 * Attaches the credentials to the resolved options as a non-enumerable accessor.
 *
 * @param resolved - The resolved options being built.
 * @param credentials - The caller's credentials.
 */
function attachCredentials(
  resolved: Omit<ResolvedBymaxStorageOptions, 'credentials'>,
  credentials: ResolvedBymaxStorageOptions['credentials'],
): void {
  // The long-lived AWS keys are attached as a non-enumerable accessor rather
  // than as a plain field. This object is injected into every service, so an
  // enumerable `credentials` is emitted by whatever serializes one of them
  // incidentally: a structured logger rendering its arguments, an error
  // reporter capturing the scope of a throw, an object spread. Non-enumerable
  // removes it from `JSON.stringify`, spread and `util.inspect`; making it an
  // accessor also keeps it out of `inspect({ showHidden: true })`, which is
  // what a diagnostic dump uses and which still prints a hidden data property.
  // Reads are unchanged — `options.credentials.accessKeyId` resolves as before.
  Object.defineProperty(resolved, 'credentials', {
    // No prototype: a key planted on the root object prototype must not become a field of the descriptor.
    __proto__: null,
    get: (): ResolvedBymaxStorageOptions['credentials'] => credentials,
    enumerable: false,
    configurable: false,
  } as PropertyDescriptor)
}

/**
 * The settings that have no default: each is present only when the options configure it.
 *
 * @param options - The validated consumer options.
 * @returns The configured ones among `validation`, `scanner`, `serverSideEncryption` and `kmsKeyId`.
 */
function optionalSettings(
  options: BymaxStorageModuleOptions,
): Partial<
  Pick<ResolvedBymaxStorageOptions, 'validation' | 'scanner' | 'serverSideEncryption' | 'kmsKeyId'>
> {
  return {
    ...(options.validation !== undefined
      ? { validation: definedOnly(options.validation, VALIDATION_KEYS) }
      : {}),
    // A group is an object or it is not configured. `forRoot` refuses a `null` scanner before this runs; if one reaches here it adds no scanner.
    ...(options.scanner
      ? {
          scanner: definedOnly(options.scanner, SCANNER_KEYS) as NonNullable<
            BymaxStorageModuleOptions['scanner']
          >,
        }
      : {}),
    ...(options.serverSideEncryption !== undefined
      ? { serverSideEncryption: options.serverSideEncryption }
      : {}),
    ...(options.kmsKeyId !== undefined ? { kmsKeyId: options.kmsKeyId } : {}),
  }
}

/**
 * Produces the resolved options consumed by every service. Optional fields
 * without a default (`cdnBaseUrl`, `validation`, `scanner`,
 * `serverSideEncryption`, `kmsKeyId`) are included only when provided so the
 * result stays compatible with `exactOptionalPropertyTypes`.
 *
 * @param options - The validated consumer options.
 * @returns The fully-resolved options with every defaulted field present.
 */
export function applyDefaults(options: BymaxStorageModuleOptions): ResolvedBymaxStorageOptions {
  // No prototype: a key planted on `Object.prototype` must not read as a credential that was never given.
  const credentials = Object.assign(
    Object.create(null) as typeof options.credentials,
    options.credentials,
  )
  const hasCredentials = Boolean(credentials.accessKeyId) && Boolean(credentials.secretAccessKey)

  const publicBaseUrl =
    options.publicBaseUrl ?? `${trimTrailingSlashes(options.endpoint)}/${options.bucket}`

  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const resolved: Omit<ResolvedBymaxStorageOptions, 'credentials'> = {
    endpoint: options.endpoint,
    region: options.region,
    bucket: options.bucket,
    forcePathStyle: options.forcePathStyle ?? DEFAULT_FORCE_PATH_STYLE,
    publicBaseUrl,
    ...(options.cdnBaseUrl !== undefined ? { cdnBaseUrl: options.cdnBaseUrl } : {}),
    defaultPublicRead: options.defaultPublicRead ?? DEFAULT_PUBLIC_READ,
    keyPrefix: options.keyPrefix ?? '',
    defaultCacheControl: options.defaultCacheControl ?? DEFAULT_CACHE_CONTROL,
    defaultContentDisposition: options.defaultContentDisposition ?? DEFAULT_CONTENT_DISPOSITION,
    signedUrls: resolveSignedUrls(options.signedUrls),
    multipart: { ...DEFAULT_MULTIPART, ...definedOnly(options.multipart, MULTIPART_KEYS) },
    ...optionalSettings(options),
    requestChecksumCalculation: options.requestChecksumCalculation ?? DEFAULT_CHECKSUM_CALCULATION,
    responseChecksumValidation: options.responseChecksumValidation ?? DEFAULT_CHECKSUM_VALIDATION,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    requestTimeoutMs,
    uploadIdleTimeoutMs: options.uploadIdleTimeoutMs ?? requestTimeoutMs,
    bodyIdleTimeoutMs: options.bodyIdleTimeoutMs ?? requestTimeoutMs,
    hasCredentials,
  }

  // No prototype either: the services read the optional fields (`validation`, `scanner`, `cdnBaseUrl`, ...) off this
  // object when they were not configured, and a key planted on `Object.prototype` must not answer for them.
  const bare = Object.assign(Object.create(null) as typeof resolved, resolved)
  attachCredentials(bare, credentials)

  return bare as ResolvedBymaxStorageOptions
}
