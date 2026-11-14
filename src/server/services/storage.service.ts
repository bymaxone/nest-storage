/**
 * @fileoverview The public storage facade. Wraps the S3 client with key
 * normalization, bucket resolution, automatic headers, an idempotency cache, and
 * typed errors. Exposes upload (single-shot and multipart), download (stream and
 * buffer), metadata reads (`head` / `exists`), an idempotent `delete`, and public
 * URL building.
 * @layer server/services
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { BYMAX_STORAGE_IDEMPOTENCY_CACHE, BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import type { DownloadBufferOptions, DownloadOptions } from '../interfaces/download-options.interface'
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
import { mapAwsError } from '../errors/aws-error-mapper'
import { mapMultipartError } from '../errors/multipart-error-mapper'
import { withCleanupFailure } from '../errors/scan-cleanup-error'
import { closeMultipartUpload } from '../utils/multipart-abort'
import { deleteObjectsChunk } from '../utils/delete-objects'
import { mapBucketCheckError } from '../errors/bucket-check-error-mapper'
import { describeError } from '../utils/describe-error'
import { toListResult } from '../utils/list-result'
import { assertHeaderValues } from '../utils/header-value'
import { guardIdleBody } from '../utils/idle-timeout'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import {
  buildACL,
  buildCacheControl,
  buildContentDisposition,
  buildSSE,
} from '../utils/header-utils'
import {
  destroyStream,
  getBodySize,
  isBufferLike,
  readStreamUpTo,
  type UploadBody,
} from '../utils/stream-utils'
import { boundStreamSize, withBytesBody } from '../utils/upload-body'
import { guardDownloadBody } from '../utils/download-body'
import { logValue } from '../utils/log-value'
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
  emitProgress,
  forwardProgress,
  normalizeScanBody,
  normalizeSingleShotBody,
} from '../utils/upload-support'
import { assertMaxBytes, readDownloadBody } from '../utils/download-buffer'
import { pickUploadStrategy } from '../utils/upload-strategy'
import type { IdempotencyCache } from '../utils/idempotency-cache'

/** Common metadata fields shared by `HeadObject` and `GetObject` responses. */
interface S3ObjectResponse {
  ContentLength?: number | undefined
  ContentType?: string | undefined
  ETag?: string | undefined
  LastModified?: Date | undefined
  CacheControl?: string | undefined
  ContentDisposition?: string | undefined
  Metadata?: Record<string, string> | undefined
  StorageClass?: string | undefined
  VersionId?: string | undefined
}

/** Per-call options that only need to override the target bucket. */
interface BucketScopedOptions {
  bucket?: string
  /** Ends the call when it aborts, rejecting `STORAGE_REQUEST_ABORTED`; an aborted signal makes no request. */
  abortSignal?: AbortSignal
}

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
  async upload(options: UploadOptions): Promise<UploadResult> {
    try {
      return await this.uploadOwningBody(options)
    } catch (err) {
      destroyStream(options.body as NodeJS.ReadableStream)
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
    const options = withBytesBody(requested)
    if (!options.contentType) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED)
    }
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    throwIfAborted(options.abortSignal, { key: finalKey, bucket, op: 'upload' })

    if (options.idempotencyKey) {
      const cacheKey = this.idempotencyCache.computeKey(options.idempotencyKey, finalKey)
      const cached = this.idempotencyCache.get(cacheKey)
      if (cached) {
        this.validation.checkHeaders(options)
        destroyStream(options.body as NodeJS.ReadableStream)
        return { ...cached, fromIdempotencyCache: true }
      }
    }

    // Reading the body (a validator peeking at it, the pre-upload scan buffering it) happens before any
    // request, so the signal is watched here: a silent stream must not hold the call.
    const context = { key: finalKey, bucket, op: 'upload' }
    const signal = options.abortSignal

    // Validation pipeline: MIME → size → custom validators.
    const validated = await abortable(this.validation.validate({
      key: finalKey,
      body: options.body,
      contentType: options.contentType,
      ...(options.size !== undefined ? { size: options.size } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
      cacheControl: options.cacheControl,
      contentDisposition: options.contentDisposition,
      kmsKeyId: options.kmsKeyId,
    }), signal, context)
    // A stream cannot be read by the scanner and then sent: buffer it first, bounded.
    const scanned = await abortable(this.bufferForPreUploadScan(validated.body, finalKey), signal, context)
    const body = boundStreamSize(scanned, options.size, this.options)
    const validatedOptions = { ...options, body }

    // Pre-upload scan: runs before the S3 PutObject.
    await abortable(this.runPreUploadScan(body, finalKey, bucket, options), signal, context)

    throwIfAborted(signal, context)
    const strategy = pickUploadStrategy(
      validatedOptions.body,
      validatedOptions.size,
      this.options.multipart.thresholdBytes,
    )
    const result =
      strategy === 'multipart'
        ? await this.uploadMultipart(validatedOptions, finalKey, bucket)
        : await this.uploadSingleShot(validatedOptions, finalKey, bucket)

    // Post-upload scan: runs after the object is written; infected → delete and re-throw.
    await this.runPostUploadScan(finalKey, bucket, options)

    if (options.idempotencyKey) {
      this.idempotencyCache.set(
        this.idempotencyCache.computeKey(options.idempotencyKey, finalKey),
        result,
      )
    }
    return result
  }

  /**
   * In pre-upload scan mode a stream body is read into one `Buffer`, so the scanner
   * and the upload see the same bytes; a stream is single-use, and one the scanner
   * had consumed would leave the upload with nothing to send. The read is bounded by
   * `validation.maxSizeBytes`, and a stream with no bound is refused rather than
   * buffered without limit. Other bodies and modes pass through unchanged.
   */
  private async bufferForPreUploadScan(body: UploadBody, finalKey: string): Promise<UploadBody> {
    if (
      !this.scanner.isEnabled() ||
      this.scanner.getMode() !== 'pre-upload' ||
      isBufferLike(body)
    ) {
      return body
    }
    const maxSizeBytes = this.options.validation?.maxSizeBytes
    if (maxSizeBytes === undefined) {
      destroyStream(body)
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
        key: finalKey,
        reason:
          'Pre-upload scanning of a stream needs validation.maxSizeBytes to bound the buffer; set it or use scanner mode post-upload',
      })
    }
    const buffered = await readStreamUpTo(body, maxSizeBytes)
    if (buffered === undefined) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
        key: finalKey,
        maxSizeBytes,
        reason:
          'The stream is longer than validation.maxSizeBytes, so it cannot be scanned before upload',
      })
    }
    return buffered
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
    await this.scanner.scan({
      mode: 'pre-upload',
      body: normalizeScanBody(body),
      key: finalKey,
      bucket,
      contentType: options.contentType,
      ...(options.size !== undefined ? { size: options.size } : {}),
    })
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
      await this.scanner.scan({
        mode: 'post-upload',
        key: finalKey,
        bucket,
        contentType: options.contentType,
        ...(options.size !== undefined ? { size: options.size } : {}),
      })
    } catch (scanErr) {
      // `delete()` takes the caller's key and prefixes it, so it is given the relative key.
      const key = this.keyResolver.stripPrefix(finalKey)
      try {
        // Its own deadline, never the caller's signal: that one may be what ended the upload.
        await this.delete(key, { bucket, abortSignal: AbortSignal.timeout(CLEANUP_DEADLINE_MS) })
      } catch (deleteErr) {
        this.logger.error(
          `STORAGE_SCAN_CLEANUP_FAILED: the rejected object is still stored: ${logValue(finalKey)}`,
          logValue(describeError(deleteErr)),
        )
        throw withCleanupFailure(scanErr, { key, storedKey: finalKey }, deleteErr)
      }
      throw scanErr
    }
  }

  /**
   * Returns metadata for an object without downloading its body.
   *
   * @param key - The raw object key (normalized internally).
   * @param options - Optional per-call bucket override.
   * @returns The object metadata.
   * @throws StorageException `STORAGE_OBJECT_NOT_FOUND` when the key is absent.
   */
  async head(key: string, options?: BucketScopedOptions): Promise<ObjectMetadata> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options?.bucket)
    const context = { key: finalKey, bucket, op: 'head' }
    throwIfAborted(options?.abortSignal, context)
    try {
      const response = await this.s3Provider
        .getClient()
        .send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }), sendOptions(options?.abortSignal))
      return this.toObjectMetadata(response, finalKey, bucket)
    } catch (err) {
      throw failureOrAbort(options?.abortSignal, context, mapAwsError(err, context))
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
      if (err instanceof StorageException && err.code === STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED) {
        throw err
      }
      this.logger.warn(`exists() — treating a non-404 error as "false": ${logValue(describeError(err))}`)
      return false
    }
  }

  /**
   * Builds the public URL for an object. Not validated against the bucket policy
   * — public delivery depends on the bucket allowing anonymous reads or a CDN.
   *
   * @param key - The raw object key.
   * @param options - Optional per-call bucket override.
   * @returns The public URL.
   */
  getPublicUrl(key: string, options?: BucketScopedOptions): string {
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options?.bucket)
    return buildPublicUrl(this.options, finalKey, bucket)
  }

  /**
   * Streams an object. The returned `stream` is a Node `Readable` consumable via
   * `for await` or `.pipe()`. `range` / `ifNoneMatch` / `ifMatch` are forwarded as
   * conditional/partial GET headers.
   *
   * @param options - The download request.
   * @returns The object stream and its metadata.
   * @throws StorageException `STORAGE_OBJECT_NOT_FOUND` when the body is absent.
   */
  async download(
    options: DownloadOptions,
  ): Promise<{ stream: NodeJS.ReadableStream; metadata: ObjectMetadata }> {
    this.assertConfigured()
    assertHeaderValues({ range: options.range, ifNoneMatch: options.ifNoneMatch, ifMatch: options.ifMatch })
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    const context = { key: finalKey, bucket, op: 'download' }
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
        throw new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND, undefined, {
          key: finalKey,
          bucket,
        })
      }
      // The SDK types `Body` as a cross-runtime union; in Node it is always a
      // Readable. The bridge is unavoidable because the static type is broader
      // than the concrete runtime value.
      const stream = guardDownloadBody(
        response.Body as unknown as NodeJS.ReadableStream,
        this.options.bodyIdleTimeoutMs,
        { key: finalKey, bucket },
        options.abortSignal,
      )
      return { stream, metadata: this.toObjectMetadata(response, finalKey, bucket) }
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
   * @param options - The download request; `maxBytes` is the most bytes to hold.
   * @returns The object buffer and its metadata.
   * @throws StorageException `STORAGE_SIZE_EXCEEDED` past `maxBytes`, by `Content-Length` or by
   *   bytes; `STORAGE_VALIDATION_FAILED` for a `maxBytes` that is not an integer of at least 1.
   */
  async downloadBuffer(
    options: DownloadBufferOptions,
  ): Promise<{ buffer: Buffer; metadata: ObjectMetadata }> {
    assertMaxBytes(options.maxBytes)
    const { stream, metadata } = await this.download(options)
    return { buffer: await readDownloadBody(stream, metadata, options.maxBytes), metadata }
  }

  /**
   * Deletes an object. Idempotent: a missing object is a no-op (logged as a
   * warning), not an error. Any other failure is propagated.
   *
   * @param key - The raw object key.
   * @param options - Optional per-call bucket override.
   */
  async delete(key: string, options?: BucketScopedOptions): Promise<void> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options?.bucket)
    const context = { key: finalKey, bucket, op: 'delete' }
    throwIfAborted(options?.abortSignal, context)
    try {
      await this.s3Provider
        .getClient()
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey }), sendOptions(options?.abortSignal))
    } catch (err) {
      const mapped = failureOrAbort(options?.abortSignal, context, mapAwsError(err, context))
      if (mapped.code !== STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND) {
        throw mapped
      }
      this.logger.warn(`delete() — key not found (idempotent no-op): ${logValue(finalKey)}`)
    }
    // The object is gone, so an upload cached as having created it no longer holds.
    this.idempotencyCache.invalidate(bucket, this.keyResolver.stripPrefix(finalKey))
  }

  /**
   * Probes the bucket with one `HeadBucket`, for a readiness check: it resolves when the bucket
   * is reachable with these credentials and otherwise rejects with a typed code. Nothing in the
   * module calls it on its own, so booting costs no request. Needs `s3:ListBucket`.
   *
   * @param options - Optional per-call bucket override.
   * @throws StorageException `STORAGE_BUCKET_NOT_FOUND` (404), `STORAGE_BUCKET_ACCESS_DENIED` (403,
   *   which a provider also answers for a bucket the caller cannot see), `STORAGE_BUCKET_REGION_MISMATCH`
   *   (301), `STORAGE_TIMEOUT`, or `STORAGE_PROVIDER_ERROR`; `STORAGE_NOT_CONFIGURED` and
   *   `STORAGE_BUCKET_UNDEFINED` before any request.
   */
  async checkBucket(options?: BucketScopedOptions): Promise<void> {
    this.assertConfigured()
    const bucket = this.resolveBucket(options?.bucket)
    const context = { bucket, op: 'checkBucket' }
    throwIfAborted(options?.abortSignal, context)
    try {
      await this.s3Provider
        .getClient()
        .send(new HeadBucketCommand({ Bucket: bucket }), sendOptions(options?.abortSignal))
    } catch (err) {
      throw failureOrAbort(options?.abortSignal, context, mapBucketCheckError(err, context))
    }
  }

  /** Throws when the S3 client was never built (missing credentials). */
  private assertConfigured(): void {
    if (!this.s3Provider.isConfigured()) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED)
    }
  }

  /** Resolves the target bucket from a per-call override or the module default. */
  private resolveBucket(perCall?: string): string {
    const bucket = perCall ?? this.options.bucket
    if (!bucket) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED)
    }
    return bucket
  }

  /** Maps an S3 metadata response onto the public `ObjectMetadata` shape. */
  private toObjectMetadata(
    response: S3ObjectResponse,
    finalKey: string,
    bucket: string,
  ): ObjectMetadata {
    return {
      key: this.keyResolver.stripPrefix(finalKey),
      bucket,
      size: response.ContentLength ?? 0,
      contentType: response.ContentType ?? 'application/octet-stream',
      etag: response.ETag ?? '',
      lastModified: response.LastModified ?? new Date(0),
      metadata: response.Metadata ?? {},
      ...(response.CacheControl !== undefined ? { cacheControl: response.CacheControl } : {}),
      ...(response.ContentDisposition !== undefined
        ? { contentDisposition: response.ContentDisposition }
        : {}),
      ...(response.StorageClass !== undefined ? { storageClass: response.StorageClass } : {}),
      ...(response.VersionId !== undefined ? { versionId: response.VersionId } : {}),
    }
  }

  /** Single `PutObject` upload for bodies below the multipart threshold. */
  private async uploadSingleShot(
    options: UploadOptions,
    finalKey: string,
    bucket: string,
  ): Promise<UploadResult> {
    const total = options.size ?? getBodySize(options.body)
    const input: PutObjectCommandInput = {
      Bucket: bucket,
      Key: finalKey,
      Body: normalizeSingleShotBody(options.body),
      ContentType: options.contentType,
      ContentLength: total,
      CacheControl: buildCacheControl(options.cacheControl, this.options.defaultCacheControl),
      ContentDisposition: buildContentDisposition(
        options.contentDisposition,
        this.options.defaultContentDisposition,
      ),
      // `public-read` only takes effect on buckets that allow ACLs (see header-utils).
      ACL: buildACL(options.publicRead, this.options.defaultPublicRead),
      Metadata: options.metadata,
      ...buildSSE(options.serverSideEncryption, options.kmsKeyId, this.options),
    }
    try {
      const response = await this.s3Provider
        .getClient()
        .send(new PutObjectCommand(input), sendOptions(options.abortSignal))
      if (options.onProgress) {
        emitProgress(options.onProgress, total, total)
      }
      return buildUploadResult(this.keyResolver, this.options, {
        finalKey,
        bucket,
        etag: response.ETag,
        versionId: response.VersionId,
        size: total,
        contentType: options.contentType,
        multipart: false,
      })
    } catch (err) {
      const context = { key: finalKey, bucket, op: 'upload-single' }
      throw failureOrAbort(options.abortSignal, context, mapAwsError(err, context))
    }
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
  ): Promise<UploadResult> {
    const params: PutObjectCommandInput = {
      Bucket: bucket,
      Key: finalKey,
      Body: guardIdleBody(options.body, this.options.uploadIdleTimeoutMs),
      ContentType: options.contentType,
      CacheControl: buildCacheControl(options.cacheControl, this.options.defaultCacheControl),
      ContentDisposition: buildContentDisposition(
        options.contentDisposition,
        this.options.defaultContentDisposition,
      ),
      ACL: buildACL(options.publicRead, this.options.defaultPublicRead),
      Metadata: options.metadata,
      ...buildSSE(options.serverSideEncryption, options.kmsKeyId, this.options),
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
    forwardProgress(uploader, options.onProgress)
    const abortUpload = (): void => {
      void uploader.abort()
    }
    signal?.addEventListener('abort', abortUpload, { once: true })
    try {
      const response = await uploader.done()
      return buildUploadResult(this.keyResolver, this.options, {
        finalKey,
        bucket,
        etag: response.ETag,
        versionId: response.VersionId,
        size: options.size,
        contentType: options.contentType,
        multipart: true,
      })
    } catch (err) {
      return await this.failMultipart(err, finalKey, bucket, {
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
    upload: {
      uploadId: string | undefined
      signal: AbortSignal | undefined
      createdUploadId: (() => Promise<string | undefined>) | undefined
    },
  ): Promise<never> {
    // Decided before the cleanup, which can take a while: a signal that fires during it must not turn
    // a real failure into an abort.
    const abortedBy = upload.signal?.aborted === true ? upload.signal : undefined
    const uploadId =
      upload.uploadId ??
      (abortedBy && upload.createdUploadId
        ? await within(upload.createdUploadId(), CLEANUP_DEADLINE_MS)
        : undefined)
    const abort = await closeMultipartUpload(
      this.s3Provider.getClient(),
      bucket,
      finalKey,
      uploadId,
    )
    const context = { key: finalKey, bucket, op: 'upload-multipart', ...abort }
    throw abortedBy ? requestAborted(abortedBy, context) : mapMultipartError(err, context)
  }

  /**
   * Lists objects in the bucket as a single page. Applies the global key prefix
   * to the caller's `prefix`, caps `maxKeys` at the S3 hard limit of 1000, threads
   * the continuation token, and strips the global prefix from every returned key.
   *
   * @param options - The listing request.
   * @returns One page of objects plus `commonPrefixes`, truncation, and the next token.
   * @throws StorageException mapped from any AWS failure.
   */
  async list(options: ListOptions): Promise<ListResult> {
    this.assertConfigured()
    const bucket = this.resolveBucket(options.bucket)
    const maxKeys = Math.min(options.maxKeys ?? MAX_LIST_KEYS, MAX_LIST_KEYS)
    const prefix = options.prefix
      ? this.keyResolver.normalize(options.prefix)
      : this.keyResolver.getPrefix()
    const context = { bucket, prefix, op: 'list' }
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
   * @param options - Source/destination keys and buckets plus copy overrides.
   * @returns The new object's ETag.
   * @throws StorageException mapped from any AWS failure.
   */
  async copy(options: CopyOptions): Promise<{ etag: string }> {
    this.assertConfigured()
    assertHeaderValues({ cacheControl: options.cacheControl })
    const sourceKey = this.keyResolver.normalize(options.sourceKey)
    const destKey = this.keyResolver.normalize(options.destinationKey)
    const sourceBucket = this.resolveBucket(options.sourceBucket)
    const destBucket = this.resolveBucket(options.destinationBucket)
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
          ACL: buildACL(options.publicRead, this.options.defaultPublicRead),
          MetadataDirective: 'COPY',
        }),
      )
      return { etag: response.CopyObjectResult?.ETag ?? '' }
    } catch (err) {
      throw mapAwsError(err, { sourceKey, destKey, op: 'copy' })
    }
  }

  /**
   * Deletes many objects, chunking the input at the S3 hard limit of 1000 keys
   * per request. Reports both successes and per-key failures; a whole-chunk send
   * failure marks every key in that chunk as failed. Returned keys are stripped of
   * the global prefix.
   *
   * @param keys - The raw object keys to delete.
   * @param options - Optional per-call bucket override.
   * @returns The deleted keys and the per-key failures.
   */
  async deleteMany(keys: string[], options?: DeleteManyOptions): Promise<DeleteManyResult> {
    this.assertConfigured()
    if (keys.length === 0) {
      return { deleted: [], failed: [] }
    }
    const bucket = this.resolveBucket(options?.bucket)
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
