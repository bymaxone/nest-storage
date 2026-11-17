/**
 * @fileoverview The keys of the module options and of each option group, by name. Reading by name, and not by
 * the own enumerable entries of whatever the caller passed, is what makes a value that a class instance serves
 * from a prototype getter count, and what lets a key be read once. Each list is checked against its type at
 * compile time, so a key added to the options cannot be left out of a list.
 * @layer server/config
 */
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

/** `unknown` when `Keys` names every key of `Group`, `never` when one is missing. */
export type NamesEveryKey<Group, Keys extends readonly PropertyKey[]> = Exclude<
  keyof Group,
  Keys[number]
> extends never
  ? unknown
  : never

/** Types a list of the keys of `T`, refused by the compiler when one key of `T` is missing from it. */
function keysOf<T extends object>() {
  return <const K extends readonly (keyof T)[]>(keys: K & NamesEveryKey<T, K>): K => keys
}

type Options = BymaxStorageModuleOptions

export const OPTION_KEYS = keysOf<Options>()([
  'endpoint',
  'region',
  'bucket',
  'credentials',
  'forcePathStyle',
  'publicBaseUrl',
  'cdnBaseUrl',
  'defaultPublicRead',
  'keyPrefix',
  'defaultCacheControl',
  'defaultContentDisposition',
  'signedUrls',
  'multipart',
  'validation',
  'scanner',
  'serverSideEncryption',
  'kmsKeyId',
  'requestChecksumCalculation',
  'responseChecksumValidation',
  'maxAttempts',
  'requestTimeoutMs',
  'uploadIdleTimeoutMs',
  'bodyIdleTimeoutMs',
])

export const CREDENTIAL_KEYS = keysOf<Options['credentials']>()(['accessKeyId', 'secretAccessKey', 'sessionToken'])
export const SIGNED_URL_KEYS = keysOf<NonNullable<Options['signedUrls']>>()(['defaultGetTtlSeconds', 'defaultPutTtlSeconds', 'maxTtlSeconds'])
export const MULTIPART_KEYS = keysOf<NonNullable<Options['multipart']>>()(['thresholdBytes', 'partSizeBytes', 'queueSize'])
export const VALIDATION_KEYS = keysOf<NonNullable<Options['validation']>>()(['mimeWhitelist', 'maxSizeBytes', 'customValidators'])
export const SCANNER_KEYS = keysOf<NonNullable<Options['scanner']>>()(['impl', 'mode', 'rejectOnUnknown', 'timeoutMs'])
