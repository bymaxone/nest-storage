/**
 * @fileoverview The fields each service method reads of the options its caller passes, and the one read of them.
 * A method that read `options.bucket` or `options.publicRead` off the caller's object directly would also read a key
 * planted on `Object.prototype`, and send the object to a bucket, or publish it, because of a field its caller never
 * set. Each method reads its fields once through {@link readOnce}, from a list the compiler checks names every field.
 * @layer server/utils
 */
import type { NamesEveryKey } from '../config/option-keys'
import type { CopyOptions } from '../interfaces/copy-options.interface'
import type { DeleteManyOptions } from '../interfaces/delete-many-options.interface'
import type {
  DownloadBufferOptions,
  DownloadOptions,
} from '../interfaces/download-options.interface'
import type { LifecycleBucketOptions } from '../interfaces/lifecycle-options.interface'
import type { ListOptions } from '../interfaces/list-options.interface'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import { readOnce } from './read-once'

/** Per-call options that only need to override the target bucket. */
export interface BucketScopedOptions {
  bucket?: string
  /** Ends the call when it aborts, rejecting `STORAGE_REQUEST_ABORTED`; an aborted signal makes no request. */
  abortSignal?: AbortSignal
}

/** Types a list of the keys of `T`, refused by the compiler when one key of `T` is missing from it. */
function keysOf<T extends object>() {
  return <const K extends readonly (keyof T)[]>(keys: K & NamesEveryKey<T, K>): K => keys
}

const BUCKET_SCOPED_KEYS = keysOf<BucketScopedOptions>()(['bucket', 'abortSignal'])
const DOWNLOAD_KEYS = keysOf<DownloadOptions>()([
  'key',
  'bucket',
  'range',
  'ifNoneMatch',
  'ifMatch',
  'abortSignal',
])
const DOWNLOAD_BUFFER_KEYS = keysOf<DownloadBufferOptions>()([...DOWNLOAD_KEYS, 'maxBytes'])
const LIST_KEYS = keysOf<ListOptions>()([
  'prefix',
  'bucket',
  'maxKeys',
  'continuationToken',
  'delimiter',
  'abortSignal',
])
const COPY_KEYS = keysOf<CopyOptions>()([
  'sourceKey',
  'destinationKey',
  'sourceBucket',
  'destinationBucket',
  'publicRead',
  'cacheControl',
])
const DELETE_MANY_KEYS = keysOf<DeleteManyOptions>()(['bucket'])
// `body` first: it is the field a failed read must still let the caller release.
export const UPLOAD_KEYS = keysOf<UploadOptions>()([
  'body',
  'key',
  'contentType',
  'bucket',
  'size',
  'cacheControl',
  'contentDisposition',
  'publicRead',
  'serverSideEncryption',
  'kmsKeyId',
  'metadata',
  'idempotencyKey',
  'abortSignal',
  'onProgress',
])
const LIFECYCLE_BUCKET_KEYS = keysOf<LifecycleBucketOptions>()(['bucket'])
const LIFECYCLE_RULE_KEYS = [
  'id',
  'prefix',
  'expirationDays',
  'abortIncompleteMultipartDays',
] as const

/** The fields of a lifecycle rule as a caller may pass them, whichever of the two rule shapes it is. */
export interface LooseLifecycleRule {
  id?: unknown
  prefix?: unknown
  expirationDays?: unknown
  abortIncompleteMultipartDays?: unknown
}

/** One read of the optional per-call bucket and abort signal; absent options read as no fields. */
export function readBucketScoped(options?: BucketScopedOptions): BucketScopedOptions {
  return readOnce<BucketScopedOptions, 'bucket' | 'abortSignal'>(options ?? {}, BUCKET_SCOPED_KEYS)
}

/** One read of the fields of a download request. */
export function readDownload(request: DownloadOptions): DownloadOptions {
  return readOnce(request, DOWNLOAD_KEYS)
}

/** One read of the fields of a buffered download request. */
export function readDownloadBuffer(request: DownloadBufferOptions): DownloadBufferOptions {
  return readOnce(request, DOWNLOAD_BUFFER_KEYS)
}

/** One read of the fields of a listing request. */
export function readList(request: ListOptions): ListOptions {
  return readOnce(request, LIST_KEYS)
}

/** One read of the fields of a copy request. */
export function readCopy(request: CopyOptions): CopyOptions {
  return readOnce(request, COPY_KEYS)
}

/** One read of the optional per-call bucket of a bulk delete. */
export function readDeleteMany(options?: DeleteManyOptions): DeleteManyOptions {
  return readOnce<DeleteManyOptions, 'bucket'>(options ?? {}, DELETE_MANY_KEYS)
}

/** One read of the optional per-call bucket of a lifecycle call. */
export function readLifecycleBucket(options?: LifecycleBucketOptions): LifecycleBucketOptions {
  return readOnce<LifecycleBucketOptions, 'bucket'>(options ?? {}, LIFECYCLE_BUCKET_KEYS)
}

/** One read of the fields of a lifecycle rule, of either shape. */
export function readLifecycleRule(rule: unknown): LooseLifecycleRule {
  return readOnce<LooseLifecycleRule, keyof LooseLifecycleRule>(rule ?? {}, LIFECYCLE_RULE_KEYS)
}
