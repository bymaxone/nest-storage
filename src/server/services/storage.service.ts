/**
 * @fileoverview The public storage facade. Wraps the S3 client with key
 * normalization, bucket resolution, automatic headers, an idempotency cache, and
 * typed errors. Exposes upload (single-shot and multipart), download (stream and
 * buffer), metadata reads (`head` / `exists`), an idempotent `delete`, and public
 * URL building.
 * @layer server/services
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { BYMAX_STORAGE_IDEMPOTENCY_CACHE, BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import type {
  DownloadBufferOptions,
  DownloadOptions,
} from '../interfaces/download-options.interface'
import type { ListOptions, ListResult } from '../interfaces/list-options.interface'
import type { CopyOptions } from '../interfaces/copy-options.interface'
import type {
  DeleteManyOptions,
  DeleteManyResult,
  FailedDeletion,
} from '../interfaces/delete-many-options.interface'
import type { ObjectMetadata, UploadResult } from '../../shared/types/storage-types'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { ValidationService } from './validation.service'
import { FileScannerService } from './file-scanner.service'
import { StorageException } from '../errors/storage-exception'
import { resolveBucket as resolveBucketInput } from '../utils/call-input'
import { mapAwsError } from '../errors/aws-error-mapper'
import { mapMultipartError } from '../errors/multipart-error-mapper'
import { describeCleanupFailure, withCleanupFailure } from '../errors/scan-cleanup-error'
import {
  abortFailureLogger,
  closeMultipartUpload,
  closeWhenCreated,
} from '../utils/multipart-abort'
import { deleteObjectsChunk } from '../utils/delete-objects'
import { mapBucketCheckError } from '../errors/bucket-check-error-mapper'
import { emit } from '../utils/log-event'
import { isRootRefusal } from '../utils/prototype-guard'
import { STORAGE_LOG_EVENTS } from '../utils/log-events'
import { failureError } from '../utils/provider-failure-log'
import { toListResult } from '../utils/list-result'
import { assertHeaderValues, copyMetadata } from '../utils/header-value'
import { readOnce, withFields } from '../utils/read-once'
import {
  readBucketScoped,
  readCopy,
  readDeleteMany,
  readDownload,
  readDownloadBuffer,
  readList,
  UPLOAD_KEYS,
  type BucketScopedOptions,
} from '../utils/request-fields'
import { guardIdleBody } from '../utils/idle-timeout'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { buildACL } from '../utils/header-utils'
import { destroyStream, isBufferLike, type UploadBody } from '../utils/stream-utils'
import { assertIntegerInput } from '../utils/numeric-input'
import { callDetails, callerFields } from '../utils/call-details'
import { toObjectMetadata } from '../utils/object-metadata'
import {
  assertScannedSize,
  boundStreamSize,
  bufferStreamForScan,
  withBytesBody,
} from '../utils/upload-body'
import { guardDownloadBody } from '../utils/download-body'
import { escapeForLog } from '../utils/log-value'
import {
  abortable,
  bindToSignal,
  CLEANUP_DEADLINE_MS,
  failureOrAbort,
  requestAborted,
  sendOptions,
  throwIfAborted,
  within,
} from '../utils/abort-support'
import { buildPublicUrl } from '../utils/public-url'
import {
  buildUploadResult,
  putObjectHeaders,
  validationInput,
  forwardProgress,
  trackLoaded,
  normalizeScanBody,
} from '../utils/upload-support'
import { assertMaxBytes, readDownloadBody } from '../utils/download-buffer'
import { pickUploadStrategy } from '../utils/upload-strategy'
import { Observed, StorageObserver } from '../observability/storage-observer'
import { rememberUploadedBytes, uploadedBytesOf } from '../utils/uploaded-bytes'
import { uploadSingleShot, type UploadContext } from '../utils/upload-single-shot'
import type { IdempotencyCache } from '../utils/idempotency-cache'
import { assertCleanRoot } from '../utils/prototype-guard'

/** S3's hard cap on the number of keys returned by one `ListObjectsV2` request. */
const MAX_LIST_KEYS = 1000

/** S3's hard cap on the number of keys accepted by one `DeleteObjects` request. */
const DELETE_BATCH_LIMIT = 1000

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    // Class providers are injected by explicit token rather than by reflected
    // parameter type: the published bundle is produced without decorator metadata,
    // so type-only injection would resolve to `undefined` for consumers.
    @Inject(S3ClientProvider) private readonly s3Provider: S3ClientProvider,
    @Inject(KeyResolverService) private readonly keyResolver: KeyResolverService,
    @Inject(BYMAX_STORAGE_IDEMPOTENCY_CACHE) private readonly idempotencyCache: IdempotencyCache,
    @Inject(ValidationService) private readonly validation: ValidationService,
    @Inject(FileScannerService) private readonly scanner: FileScannerService,
    @Optional() @Inject(StorageObserver) protected readonly observer?: StorageObserver,
  ) {}

  /**
   * Uploads an object, choosing single-shot or multipart automatically. When an
   * `idempotencyKey` is supplied and a matching result is cached within the TTL
   * window, the cached result is returned without re-uploading.
   *
   * The library takes ownership of a `Readable` body, as `stream.pipeline` does: when the
   * upload is rejected for any reason (configuration, validation, scan, provider failure)
   * the stream is destroyed (without an error: the SDK forwards a stream's error to wrappers
   * that nothing listens to), which releases the file handle or socket behind it; a cache hit
   * destroys it unread. A stream consumed by a successful upload ends on its own.
   *
   * @param options - The upload request.
   * @returns The upload result.
   * @throws StorageException for missing configuration, body, or content type.
   */
  @Observed<UploadResult>('upload', {
    span: 'storage.upload',
    describe: (result) => ({ 'bymax.storage.multipart': result.multipart ? 'true' : 'false' }),
    bytes: uploadedBytesOf,
  })
  async upload(request: UploadOptions): Promise<UploadResult> {
    assertCleanRoot()
    // Filled as the fields are read: a field that throws leaves the ones read before it here, the body included.
    const copy: Partial<UploadOptions> = Object.create(null) as Partial<UploadOptions>
    try {
      // One read of each field of the caller's request; a field that throws when read is the library's refusal.
      const options = readOnce(request, UPLOAD_KEYS, copy) as UploadOptions
      return await this.uploadOwningBody(options)
    } catch (err) {
      destroyStream(copy.body as NodeJS.ReadableStream)
      throw err
    }
  }

  /** The upload itself; `upload()` destroys a stream body when this rejects. */
  private async uploadOwningBody(requested: UploadOptions): Promise<UploadResult> {
    this.assertConfigured()
    // Defensive boundary check: callers may pass an absent body from untyped
    // (JS / request-parsed) data despite the compile-time type.
    const rawBody = requested.body as unknown
    if (rawBody === undefined || rawBody === null) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BODY_MISSING)
    }
    assertIntegerInput(requested.size, 'size', 0)
    const options = withBytesBody(requested)
    // One read of each pair: what is checked, signed and sent is the copy, not the caller's object.
    if (options.metadata !== undefined) options.metadata = copyMetadata(options.metadata)
    if (!options.contentType) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED)
    }
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    const context = callDetails('upload', { key: options.key, bucket: options.bucket })
    throwIfAborted(options.abortSignal, context)

    if (options.idempotencyKey) {
      const cacheKey = this.idempotencyCache.computeKey(options.idempotencyKey, finalKey)
      const cached = this.idempotencyCache.get(cacheKey)
      if (cached) {
        this.validation.checkHeaders(options)
        destroyStream(options.body as NodeJS.ReadableStream)
        return { ...cached, fromIdempotencyCache: true }
      }
    }

    const validatedOptions = await this.validateAndScan(options, finalKey, bucket, context)
    throwIfAborted(options.abortSignal, context)
    const strategy = pickUploadStrategy(
      validatedOptions.body,
      validatedOptions.size,
      this.options.multipart.thresholdBytes,
    )
    const result =
      strategy === 'multipart'
        ? await this.uploadMultipart(validatedOptions, finalKey, bucket, context)
        : await uploadSingleShot(this.uploadContext, validatedOptions, finalKey, bucket, context)

    // Post-upload scan: an abort ends the wait, not the scan; an infected stored object is still deleted.
    const stored = { ...context, stored: true }
    await abortable(this.runPostUploadScan(finalKey, bucket, options), options.abortSignal, stored)

    this.rememberUpload(options, finalKey, result)
    return result
  }

  /**
   * Validates the upload and runs the pre-upload scan, returning the options with the body to send.
   * Reading the body (a validator peeking at it, the scan buffering it) happens before any request, so
   * the signal is watched here: a silent stream must not hold the call.
   */
  private async validateAndScan(
    options: UploadOptions,
    finalKey: string,
    bucket: string,
    context: Record<string, unknown>,
  ): Promise<UploadOptions> {
    const signal = options.abortSignal
    // Validation pipeline: MIME → size → custom validators.
    const input = validationInput(options, finalKey)
    const validated = await abortable(this.validation.validate(input), signal, context)
    // A stream cannot be read by the scanner and then sent: buffer it first, bounded.
    const scanned = await abortable(
      this.bufferForPreUploadScan(validated.body, context),
      signal,
      context,
    )
    assertScannedSize(scanned, options.size, this.options.multipart.thresholdBytes, context)
    const body = boundStreamSize(scanned, options.size, this.options)
    const validatedOptions = withFields(options, { body })

    // Pre-upload scan: runs before the S3 PutObject.
    await abortable(this.runPreUploadScan(body, finalKey, bucket, options), signal, context)
    return validatedOptions
  }

  /**
   * In pre-upload scan mode a stream body is read into one `Buffer`, and a buffer body is copied, so
   * the scanner and the upload see the same bytes; a stream is single-use, and one the scanner
   * had consumed would leave the upload with nothing to send. The read is bounded by
   * `validation.maxSizeBytes`, and a stream with no bound is refused rather than
   * buffered without limit. Other bodies and modes pass through unchanged.
   */
  private async bufferForPreUploadScan(
    body: UploadBody,
    context: Record<string, unknown>,
  ): Promise<UploadBody> {
    if (!this.scanner.isEnabled() || this.scanner.getMode() !== 'pre-upload') {
      return body
    }
    // A buffer is copied: the caller still holds it, and a change they make while the scan runs would
    // otherwise be stored without having been scanned.
    if (isBufferLike(body)) {
      return Buffer.from(body)
    }
    return bufferStreamForScan(body, context, this.options.validation?.maxSizeBytes)
  }

  /** Runs a pre-upload scan when configured; throws on infected. */
  private async runPreUploadScan(
    body: UploadBody,
    finalKey: string,
    bucket: string,
    options: UploadOptions,
  ): Promise<void> {
    if (!this.scanner.isEnabled() || this.scanner.getMode() !== 'pre-upload') {
      return
    }
    await this.scanner.scan(
      {
        mode: 'pre-upload',
        body: normalizeScanBody(body),
        key: finalKey,
        bucket,
        contentType: options.contentType,
        ...(options.size !== undefined ? { size: options.size } : {}),
      },
      callerFields({ key: options.key, bucket: options.bucket }),
    )
  }

  /** Remembers the result of an upload under its idempotency key, when it has one. */
  private rememberUpload(options: UploadOptions, finalKey: string, result: UploadResult): void {
    if (!options.idempotencyKey) return
    this.idempotencyCache.set(
      this.idempotencyCache.computeKey(options.idempotencyKey, finalKey),
      result,
    )
  }

  /**
   * Runs a post-upload scan. On infection, deletes the just-uploaded object
   * (logging delete failures as errors) and re-throws the scan exception.
   */
  private async runPostUploadScan(
    finalKey: string,
    bucket: string,
    options: UploadOptions,
  ): Promise<void> {
    if (!this.scanner.isEnabled() || this.scanner.getMode() !== 'post-upload') {
      return
    }
    try {
      await this.scanner.scan(
        {
          mode: 'post-upload',
          key: finalKey,
          bucket,
          contentType: options.contentType,
          ...(options.size !== undefined ? { size: options.size } : {}),
        },
        callerFields({ key: options.key, bucket: options.bucket }),
      )
    } catch (scanErr) {
      // `delete()` takes the caller's key and prefixes it, so it is given the relative key.
      const key = this.keyResolver.stripPrefix(finalKey)
      try {
        // Its own deadline, never the caller's signal: that one may be what ended the upload.
        await this.delete(key, { bucket, abortSignal: AbortSignal.timeout(CLEANUP_DEADLINE_MS) })
      } catch (deleteErr) {
        // The key as the provider holds it is for the operator who removes the object: it goes to the log, in a
        // field of its own, and never to the caller.
        emit(this.logger, 'error', {
          event: STORAGE_LOG_EVENTS.scanCleanupFailed,
          message: 'The rejected object is still stored',
          storedKey: escapeForLog(finalKey),
          cleanupFailure: describeCleanupFailure(deleteErr),
        })
        throw withCleanupFailure(scanErr, { key }, deleteErr)
      }
      throw scanErr
    }
  }

  /**
   * Returns metadata for an object without downloading its body.
   *
   * @param key - The raw object key (normalized internally).
   * @param scoped - Optional per-call bucket override.
   * @returns The object metadata.
   * @throws StorageException `STORAGE_OBJECT_NOT_FOUND` when the key is absent.
   */
  @Observed('head')
  async head(key: string, scoped?: BucketScopedOptions): Promise<ObjectMetadata> {
    assertCleanRoot()
    const options = readBucketScoped(scoped)
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options.bucket)
    const context = callDetails('head', { key, bucket: options.bucket })
    throwIfAborted(options.abortSignal, context)
    try {
      const response = await this.s3Provider
        .getClient()
        .send(
          new HeadObjectCommand({ Bucket: bucket, Key: finalKey }),
          sendOptions(options.abortSignal),
        )
      return toObjectMetadata(response, this.keyResolver.stripPrefix(finalKey), bucket)
    } catch (err) {
      throw failureOrAbort(options.abortSignal, context, mapAwsError(err, context))
    }
  }

  /**
   * Best-effort existence check. Returns `false` for a missing object and, to
   * stay non-throwing, also `false` (with a warning) for any other error.
   *
   * @param key - The raw object key.
   * @param options - Optional per-call bucket override.
   * @returns `true` when the object exists, `false` otherwise.
   */
  async exists(key: string, options?: BucketScopedOptions): Promise<boolean> {
    assertCleanRoot()
    try {
      await this.head(key, options)
      return true
    } catch (err) {
      if (
        err instanceof StorageException &&
        err.code === STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND
      ) {
        return false
      }
      if (
        isRootRefusal(err) ||
        (err instanceof StorageException &&
          err.code === STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED)
      ) {
        throw err
      }
      emit(this.logger, 'warn', {
        event: STORAGE_LOG_EVENTS.existsFailed,
        message: 'exists() — treating a non-404 error as "false"',
        err: failureError(err),
      })
      return false
    }
  }

  /**
   * Builds the public URL for an object. Not validated against the bucket policy
   * — public delivery depends on the bucket allowing anonymous reads or a CDN.
   *
   * @param key - The raw object key.
   * @param scoped - Optional per-call bucket override.
   * @returns The public URL.
   */
  getPublicUrl(key: string, scoped?: BucketScopedOptions): string {
    assertCleanRoot()
    const options = readBucketScoped(scoped)
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options.bucket)
    return buildPublicUrl(this.options, finalKey, bucket)
  }

  /**
   * Streams an object. The returned `stream` is a Node `Readable` consumable via
   * `for await` or `.pipe()`. `range` / `ifNoneMatch` / `ifMatch` are forwarded as
   * conditional/partial GET headers.
   *
   * @param request - The download request.
   * @returns The object stream and its metadata.
   * @throws StorageException `STORAGE_OBJECT_NOT_FOUND` when the body is absent.
   */
  @Observed('download')
  async download(
    request: DownloadOptions,
  ): Promise<{ stream: NodeJS.ReadableStream; metadata: ObjectMetadata }> {
    assertCleanRoot()
    const options = readDownload(request)
    this.assertConfigured()
    assertHeaderValues({
      range: options.range,
      ifNoneMatch: options.ifNoneMatch,
      ifMatch: options.ifMatch,
    })
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    const context = callDetails('download', { key: options.key, bucket: options.bucket })
    throwIfAborted(options.abortSignal, context)
    try {
      const response = await this.s3Provider.getClient().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: finalKey,
          Range: options.range,
          IfNoneMatch: options.ifNoneMatch,
          IfMatch: options.ifMatch,
        }),
        sendOptions(options.abortSignal),
      )
      if (!response.Body) {
        throw new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND, undefined, context)
      }
      // The SDK types `Body` as a cross-runtime union; in Node it is always a
      // Readable. The bridge is unavoidable because the static type is broader
      // than the concrete runtime value.
      const stream = guardDownloadBody(
        response.Body as unknown as NodeJS.ReadableStream,
        this.options.bodyIdleTimeoutMs,
        context,
        options.abortSignal,
      )
      return {
        stream,
        metadata: toObjectMetadata(response, this.keyResolver.stripPrefix(finalKey), bucket),
      }
    } catch (err) {
      if (err instanceof StorageException) {
        throw err
      }
      throw failureOrAbort(options.abortSignal, context, mapAwsError(err, context))
    }
  }

  /**
   * Reads an object fully into memory through the same idle-guarded stream as {@link download}.
   * Without `maxBytes` the whole object is held, however large; use {@link download} for large ones.
   *
   * @param request - The download request; `maxBytes` is the most bytes to hold.
   * @returns The object buffer and its metadata.
   * @throws StorageException `STORAGE_SIZE_EXCEEDED` past `maxBytes`, by `Content-Length` or by
   *   bytes; `STORAGE_VALIDATION_FAILED` for a `maxBytes` that is not an integer of at least 1.
   */
  async downloadBuffer(
    request: DownloadBufferOptions,
  ): Promise<{ buffer: Buffer; metadata: ObjectMetadata }> {
    assertCleanRoot()
    const options = readDownloadBuffer(request)
    assertMaxBytes(options.maxBytes)
    const { stream, metadata } = await this.download(options)
    const buffer = await readDownloadBody(
      stream,
      metadata,
      options.maxBytes,
      options.abortSignal,
      callerFields({ key: options.key, bucket: options.bucket }),
    )
    return { buffer, metadata }
  }

  /**
   * Deletes an object. Idempotent: a missing object is a no-op (logged as a
   * warning), not an error. Any other failure is propagated.
   *
   * @param key - The raw object key.
   * @param scoped - Optional per-call bucket override.
   */
  @Observed('delete')
  async delete(key: string, scoped?: BucketScopedOptions): Promise<void> {
    assertCleanRoot()
    const options = readBucketScoped(scoped)
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options.bucket)
    const context = callDetails('delete', { key, bucket: options.bucket })
    throwIfAborted(options.abortSignal, context)
    try {
      await this.s3Provider
        .getClient()
        .send(
          new DeleteObjectCommand({ Bucket: bucket, Key: finalKey }),
          sendOptions(options.abortSignal),
        )
    } catch (err) {
      const mapped = failureOrAbort(options.abortSignal, context, mapAwsError(err, context))
      if (mapped.code !== STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND) {
        throw mapped
      }
      emit(this.logger, 'warn', {
        event: STORAGE_LOG_EVENTS.deleteNotFound,
        message: 'delete() — key not found (idempotent no-op)',
      })
    }
    // The object is gone, so an upload cached as having created it no longer holds.
    this.idempotencyCache.invalidate(bucket, this.keyResolver.stripPrefix(finalKey))
  }

  /**
   * Probes the bucket with one `HeadBucket`, for a readiness check: it resolves when the bucket
   * is reachable with these credentials and otherwise rejects with a typed code. Nothing in the
   * module calls it on its own, so booting costs no request. Needs `s3:ListBucket`.
   *
   * @param scoped - Optional per-call bucket override.
   * @throws StorageException `STORAGE_BUCKET_NOT_FOUND` (404), `STORAGE_BUCKET_ACCESS_DENIED` (403,
   *   which a provider also answers for a bucket the caller cannot see), `STORAGE_BUCKET_REGION_MISMATCH`
   *   (301), `STORAGE_TIMEOUT`, or `STORAGE_PROVIDER_ERROR`; `STORAGE_NOT_CONFIGURED` and
   *   `STORAGE_BUCKET_UNDEFINED` before any request.
   */
  @Observed('check_bucket')
  async checkBucket(scoped?: BucketScopedOptions): Promise<void> {
    assertCleanRoot()
    const options = readBucketScoped(scoped)
    this.assertConfigured()
    const bucket = this.resolveBucket(options.bucket)
    const context = callDetails('checkBucket', { bucket: options.bucket })
    throwIfAborted(options.abortSignal, context)
    try {
      await this.s3Provider
        .getClient()
        .send(new HeadBucketCommand({ Bucket: bucket }), sendOptions(options.abortSignal))
    } catch (err) {
      throw failureOrAbort(options.abortSignal, context, mapBucketCheckError(err, context))
    }
  }

  /** What the single-shot upload needs of this service. */
  private get uploadContext(): UploadContext {
    return { s3Provider: this.s3Provider, keyResolver: this.keyResolver, options: this.options }
  }

  /** Throws when the S3 client was never built (missing credentials). */
  private assertConfigured(): void {
    if (!this.s3Provider.isConfigured()) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED)
    }
  }

  /** Resolves the target bucket from a per-call override or the module default. */
  private resolveBucket(perCall?: string): string {
    return resolveBucketInput(perCall, this.options.bucket)
  }

  /**
   * Multipart upload via `@aws-sdk/lib-storage`. The SDK is told to leave the parts
   * (`leavePartsOnError: true`) because its own abort runs inside its failure path: a failing
   * abort replaced the failure that caused it, and a failed `CompleteMultipartUpload` was never
   * aborted. This method aborts the upload itself and reports the outcome in the error details.
   */
  private async uploadMultipart(
    options: UploadOptions,
    finalKey: string,
    bucket: string,
    caller: Record<string, unknown>,
  ): Promise<UploadResult> {
    const params: PutObjectCommandInput = {
      ...putObjectHeaders(options, this.options, finalKey, bucket),
      Body: guardIdleBody(options.body, this.options.uploadIdleTimeoutMs),
    }
    const signal = options.abortSignal
    const bound = signal ? bindToSignal(this.s3Provider.getClient(), signal) : undefined
    const uploader = new Upload({
      client: bound?.client ?? this.s3Provider.getClient(),
      params,
      queueSize: this.options.multipart.queueSize,
      partSize: this.options.multipart.partSizeBytes,
      leavePartsOnError: true,
    })
    const sent = trackLoaded(uploader)
    forwardProgress(uploader, options.onProgress)
    const abortUpload = (): void => {
      void uploader.abort()
    }
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: the listener is removed in the `finally` below and a signal aborts once, so whether it removes itself on firing is not observable (equivalent).
    signal?.addEventListener('abort', abortUpload, { once: true })
    try {
      const response = await uploader.done()
      return rememberUploadedBytes(
        buildUploadResult(this.keyResolver, this.options, {
          finalKey,
          bucket,
          etag: response.ETag,
          versionId: response.VersionId,
          size: options.size,
          contentType: options.contentType,
          multipart: true,
        }),
        sent(),
      )
    } catch (err) {
      return await this.failMultipart(err, finalKey, bucket, caller, {
        uploadId: uploader.uploadId,
        signal,
        createdUploadId: bound?.createdUploadId,
      })
    } finally {
      signal?.removeEventListener('abort', abortUpload)
    }
  }

  /**
   * Aborts the multipart upload that failed, then throws the original failure with the outcome. Whether
   * the failure is an abort is decided first: a signal that fires during the cleanup does not turn a
   * real failure into one. An upload id the provider answered late is waited for, within the cleanup
   * deadline, so that an abort during `CreateMultipartUpload` still aborts the upload it created.
   */
  private async failMultipart(
    err: unknown,
    finalKey: string,
    bucket: string,
    caller: Record<string, unknown>,
    upload: {
      uploadId: string | undefined
      signal: AbortSignal | undefined
      createdUploadId: (() => Promise<string | undefined>) | undefined
    },
  ): Promise<never> {
    // Decided before the cleanup, which can take a while: a signal that fires during it must not turn
    // a real failure into an abort.
    const abortedBy = upload.signal?.aborted === true ? upload.signal : undefined
    const client = this.s3Provider.getClient()
    const lookup = abortedBy ? upload.createdUploadId?.() : undefined
    let uploadId = upload.uploadId
    // Stryker disable next-line ConditionalExpression: when the uploader already holds an id it is the one the create answered, so waiting for the created id again yields the same value (equivalent).
    if (uploadId === undefined && lookup) {
      uploadId = await within(lookup, CLEANUP_DEADLINE_MS)
      // The caller does not wait longer, but an id that arrives later is still aborted.
      if (uploadId === undefined) {
        closeWhenCreated(client, bucket, finalKey, lookup, abortFailureLogger(this.logger))
      }
    }
    const abort = await closeMultipartUpload(
      client,
      bucket,
      finalKey,
      uploadId,
      abortFailureLogger(this.logger),
    )
    const context = { ...caller, op: 'upload-multipart', ...abort }
    throw abortedBy ? requestAborted(abortedBy, context) : mapMultipartError(err, context)
  }

  /**
   * Lists objects in the bucket as a single page. Applies the global key prefix
   * to the caller's `prefix`, caps `maxKeys` at the S3 hard limit of 1000, threads
   * the continuation token, and strips the global prefix from every returned key.
   *
   * @param request - The listing request.
   * @returns One page of objects plus `commonPrefixes`, truncation, and the next token.
   * @throws StorageException mapped from any AWS failure.
   */
  @Observed('list')
  async list(request: ListOptions): Promise<ListResult> {
    assertCleanRoot()
    const options = readList(request)
    this.assertConfigured()
    const bucket = this.resolveBucket(options.bucket)
    assertIntegerInput(options.maxKeys, 'maxKeys', 1)
    const maxKeys = Math.min(options.maxKeys ?? MAX_LIST_KEYS, MAX_LIST_KEYS)
    const prefix = options.prefix
      ? this.keyResolver.normalize(options.prefix)
      : this.keyResolver.getPrefix()
    const context = callDetails('list', { bucket: options.bucket, prefix: options.prefix })
    throwIfAborted(options.abortSignal, context)
    try {
      const response = await this.s3Provider.getClient().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
          ContinuationToken: options.continuationToken,
          Delimiter: options.delimiter,
        }),
        sendOptions(options.abortSignal),
      )
      return toListResult(response, (key) => this.keyResolver.stripPrefix(key))
    } catch (err) {
      throw failureOrAbort(options.abortSignal, context, mapAwsError(err, context))
    }
  }

  /**
   * Server-side copy of an object (no bytes flow through the app). Supports both
   * same-bucket and cross-bucket copies and preserves the source metadata.
   *
   * @param request - Source/destination keys and buckets plus copy overrides.
   * @returns The new object's ETag.
   * @throws StorageException mapped from any AWS failure.
   */
  @Observed('copy')
  async copy(request: CopyOptions): Promise<{ etag: string }> {
    assertCleanRoot()
    const options = readCopy(request)
    this.assertConfigured()
    assertHeaderValues({ cacheControl: options.cacheControl })
    const sourceKey = this.keyResolver.normalize(options.sourceKey)
    const destKey = this.keyResolver.normalize(options.destinationKey)
    const sourceBucket = this.resolveBucket(options.sourceBucket)
    const destBucket = this.resolveBucket(options.destinationBucket)
    // Outside the `try`: a flag that is not a boolean is the caller's mistake, not a provider failure.
    const acl = buildACL(options.publicRead, this.options.defaultPublicRead)
    try {
      const response = await this.s3Provider.getClient().send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: destKey,
          // `CopySource` must be URL-encoded per path segment; the slashes that
          // separate the segments stay literal so the bucket/key boundaries hold.
          CopySource: `/${sourceBucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
          CacheControl: options.cacheControl ?? this.options.defaultCacheControl,
          // ACLs are a no-op on modern S3 (Object Ownership) and R2; see header-utils.
          ACL: acl,
          MetadataDirective: 'COPY',
        }),
      )
      return { etag: response.CopyObjectResult?.ETag ?? '' }
    } catch (err) {
      throw mapAwsError(
        err,
        callDetails('copy', { sourceKey: options.sourceKey, destKey: options.destinationKey }),
      )
    }
  }

  /**
   * Deletes many objects, chunking the input at the S3 hard limit of 1000 keys
   * per request. Reports both successes and per-key failures; a whole-chunk send
   * failure marks every key in that chunk as failed. Returned keys are stripped of
   * the global prefix.
   *
   * @param keys - The raw object keys to delete.
   * @param scoped - Optional per-call bucket override.
   * @returns The deleted keys and the per-key failures.
   */
  @Observed('delete_many')
  async deleteMany(keys: string[], scoped?: DeleteManyOptions): Promise<DeleteManyResult> {
    assertCleanRoot()
    const options = readDeleteMany(scoped)
    this.assertConfigured()
    if (keys.length === 0) {
      return { deleted: [], failed: [] }
    }
    const bucket = this.resolveBucket(options.bucket)
    const normalized = keys.map((key) => this.keyResolver.normalize(key))
    const deleted: string[] = []
    const failed: FailedDeletion[] = []
    for (let i = 0; i < normalized.length; i += DELETE_BATCH_LIMIT) {
      const chunk = normalized.slice(i, i + DELETE_BATCH_LIMIT)
      const outcome = await deleteObjectsChunk(this.s3Provider.getClient(), bucket, chunk, (key) =>
        this.keyResolver.stripPrefix(key),
      )
      deleted.push(...outcome.deleted)
      failed.push(...outcome.failed)
    }
    for (const key of deleted) {
      this.idempotencyCache.invalidate(bucket, key)
    }
    return { deleted, failed }
  }
}
