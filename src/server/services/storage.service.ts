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
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import {
  BYMAX_STORAGE_IDEMPOTENCY_CACHE,
  BYMAX_STORAGE_OPTIONS,
} from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import type { DownloadOptions } from '../interfaces/download-options.interface'
import type { ListOptions, ListResult } from '../interfaces/list-options.interface'
import type { ListedObject, ObjectMetadata, UploadResult } from '../../shared/types/storage-types'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { ValidationService } from './validation.service'
import { FileScannerService } from './file-scanner.service'
import { StorageException } from '../errors/storage-exception'
import { mapAwsError } from '../errors/aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import {
  buildACL,
  buildCacheControl,
  buildContentDisposition,
  buildSSE,
} from '../utils/header-utils'
import { getBodySize, isBufferLike, type UploadBody } from '../utils/stream-utils'
import { pickUploadStrategy } from '../utils/upload-strategy'
import { IdempotencyCache } from '../utils/idempotency-cache'

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
}

/** The Node `GetObject` body carries the sdk-stream-mixin's byte materializer. */
interface SdkByteStream {
  transformToByteArray(): Promise<Uint8Array>
}

/** Minimal shape of a `ListObjectsV2` `Contents` entry consumed by the mapper. */
interface S3ListEntry {
  Key?: string | undefined
  Size?: number | undefined
  ETag?: string | undefined
  LastModified?: Date | undefined
  StorageClass?: string | undefined
}

/** Per-call options for a batch delete. */
interface DeleteManyOptions {
  bucket?: string
}

/** Options for a server-side object copy. */
interface CopyOptions {
  sourceKey: string
  destinationKey: string
  sourceBucket?: string
  destinationBucket?: string
  publicRead?: boolean
  cacheControl?: string
}

/** A single failed key from a batch delete, with a readable provider error. */
interface FailedDeletion {
  key: string
  error: string
}

/** Aggregated outcome of a batch delete: succeeded keys and per-key failures. */
interface DeleteManyResult {
  deleted: string[]
  failed: FailedDeletion[]
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
   * @param options - The upload request.
   * @returns The upload result.
   * @throws StorageException for missing configuration, body, or content type.
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    this.assertConfigured()
    // Defensive boundary check: callers may pass an absent body from untyped
    // (JS / request-parsed) data despite the compile-time type.
    const rawBody = options.body as unknown
    if (rawBody === undefined || rawBody === null) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BODY_MISSING)
    }
    if (!options.contentType) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED)
    }
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)

    if (options.idempotencyKey) {
      const cacheKey = this.idempotencyCache.computeKey(options.idempotencyKey, finalKey)
      const cached = this.idempotencyCache.get(cacheKey)
      if (cached) {
        return { ...cached, fromIdempotencyCache: true }
      }
    }

    // Validation pipeline: MIME → size → custom validators.
    const validated = await this.validation.validate({
      key: finalKey,
      body: options.body,
      contentType: options.contentType,
      ...(options.size !== undefined ? { size: options.size } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    })
    const validatedOptions = { ...options, body: validated.body }

    // Pre-upload scan: runs before the S3 PutObject.
    await this.runPreUploadScan(validated.body, finalKey, bucket, options)

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
      body: this.normalizeScanBody(body),
      key: finalKey,
      bucket,
      contentType: options.contentType,
      ...(options.size !== undefined ? { size: options.size } : {}),
    })
  }

  /**
   * Coerces a buffer-like scan body (`Buffer` or `Uint8Array`) to a `Buffer` so
   * the scanner always receives its declared contract type; streams pass through
   * unchanged.
   */
  private normalizeScanBody(body: UploadBody): Buffer | NodeJS.ReadableStream {
    if (isBufferLike(body)) {
      return Buffer.isBuffer(body) ? body : Buffer.from(body)
    }
    return body
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
      await this.delete(finalKey, { bucket }).catch((deleteErr: unknown) => {
        this.logger.error(
          `Post-upload cleanup failed for infected/inconclusive object: ${finalKey}`,
          (deleteErr as Error).message,
        )
      })
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
    try {
      const response = await this.s3Provider
        .getClient()
        .send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }))
      return this.toObjectMetadata(response, finalKey, bucket)
    } catch (err) {
      throw mapAwsError(err, { key: finalKey, bucket, op: 'head' })
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
      if (err instanceof StorageException && err.code === STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND) {
        return false
      }
      this.logger.warn(`exists() — treating a non-404 error as "false": ${(err as Error).message}`)
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
    return this.buildPublicUrl(finalKey, bucket)
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
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    try {
      const response = await this.s3Provider.getClient().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: finalKey,
          Range: options.range,
          IfNoneMatch: options.ifNoneMatch,
          IfMatch: options.ifMatch,
        }),
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
      const stream = response.Body as unknown as NodeJS.ReadableStream
      return { stream, metadata: this.toObjectMetadata(response, finalKey, bucket) }
    } catch (err) {
      if (err instanceof StorageException) {
        throw err
      }
      throw mapAwsError(err, { key: finalKey, bucket, op: 'download' })
    }
  }

  /**
   * Materializes an object fully into memory via the sdk-stream-mixin. NOT
   * recommended for files larger than 10 MB — use {@link download} for those.
   *
   * @param options - The download request.
   * @returns The object buffer and its metadata.
   */
  async downloadBuffer(
    options: DownloadOptions,
  ): Promise<{ buffer: Buffer; metadata: ObjectMetadata }> {
    const { stream, metadata } = await this.download(options)
    // The Node GetObject body carries the sdk-stream-mixin, which the public
    // `NodeJS.ReadableStream` return type of download() does not surface.
    const bytes = await (stream as unknown as SdkByteStream).transformToByteArray()
    return { buffer: Buffer.from(bytes), metadata }
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
    try {
      await this.s3Provider
        .getClient()
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey }))
    } catch (err) {
      const mapped = mapAwsError(err, { key: finalKey, bucket, op: 'delete' })
      if (mapped.code === STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND) {
        this.logger.warn(`delete() — key not found (idempotent no-op): ${finalKey}`)
        return
      }
      throw mapped
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

  /** Builds a public URL, avoiding a duplicated bucket segment in the base. */
  private buildPublicUrl(finalKey: string, bucket: string): string {
    const base = (this.options.cdnBaseUrl ?? this.options.publicBaseUrl).replace(/\/+$/, '')
    return this.baseCarriesBucket(base, bucket)
      ? `${base}/${finalKey}`
      : `${base}/${bucket}/${finalKey}`
  }

  /**
   * Reports whether the base URL already carries the bucket as a real segment —
   * the leading host label (virtual-hosted-style `bucket.host`) or a path segment
   * (path-style `/bucket` or `/bucket/…`) — rather than an incidental substring,
   * so `bucket="test"` is not matched by a `latest` elsewhere in the base.
   */
  private baseCarriesBucket(base: string, bucket: string): boolean {
    // Stryker disable next-line Regex: `base` is always a well-formed absolute URL with a
    // single leading `scheme://` (or a bare authority with no `://`); for that input domain
    // removing the `^` anchor or widening `\d`→`\D` yields the identical leftmost scheme
    // strip, so `schemeless` is unchanged (equivalent within the contract).
    const schemeless = base.replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
    const pathStart = schemeless.indexOf('/')
    const authority = pathStart === -1 ? schemeless : schemeless.slice(0, pathStart)
    // Stryker disable next-line StringLiteral: when `pathStart === -1` the resulting `path`
    // is only consumed by `pathSegments.includes(bucket)`; '' and any non-bucket sentinel
    // are indistinguishable, and no real bucket equals the injected sentinel (equivalent).
    const path = pathStart === -1 ? '' : schemeless.slice(pathStart)
    const leadingHostLabel = authority.split('.')[0]
    // Stryker disable next-line MethodExpression,ConditionalExpression,EqualityOperator:
    // `pathSegments` is only used via `.includes(bucket)`, and `bucket` is guaranteed
    // non-empty by `resolveBucket`; keeping empty '' segments cannot change the result.
    const pathSegments = path.split('/').filter((segment) => segment.length > 0)
    return leadingHostLabel === bucket || pathSegments.includes(bucket)
  }

  /** Maps an S3 metadata response onto the public `ObjectMetadata` shape. */
  private toObjectMetadata(
    response: S3ObjectResponse,
    finalKey: string,
    bucket: string,
  ): ObjectMetadata {
    return {
      key: finalKey,
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
      Body: this.normalizeSingleShotBody(options.body),
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
      const response = await this.s3Provider.getClient().send(new PutObjectCommand(input))
      if (options.onProgress) {
        this.emitProgress(options.onProgress, total, total)
      }
      return this.buildUploadResult({
        finalKey,
        bucket,
        etag: response.ETag,
        versionId: response.VersionId,
        size: total,
        contentType: options.contentType,
        multipart: false,
      })
    } catch (err) {
      throw mapAwsError(err, { key: finalKey, bucket, op: 'upload-single' })
    }
  }

  /**
   * Multipart upload via `@aws-sdk/lib-storage`. `leavePartsOnError: false` makes
   * the SDK abort and clean up parts on failure, so no manual abort is issued.
   */
  private async uploadMultipart(
    options: UploadOptions,
    finalKey: string,
    bucket: string,
  ): Promise<UploadResult> {
    const params: PutObjectCommandInput = {
      Bucket: bucket,
      Key: finalKey,
      Body: options.body as NonNullable<PutObjectCommandInput['Body']>,
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
    const uploader = new Upload({
      client: this.s3Provider.getClient(),
      params,
      queueSize: this.options.multipart.queueSize,
      partSize: this.options.multipart.partSizeBytes,
      leavePartsOnError: false,
    })
    if (options.onProgress) {
      const onProgress = options.onProgress
      uploader.on('httpUploadProgress', (event) => {
        this.emitProgress(onProgress, event.loaded, event.total, event.part)
      })
    }
    try {
      const response = await uploader.done()
      return this.buildUploadResult({
        finalKey,
        bucket,
        etag: response.ETag,
        versionId: response.VersionId,
        size: options.size,
        contentType: options.contentType,
        multipart: true,
      })
    } catch (err) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED, undefined, {
        key: finalKey,
        bucket,
        awsMessage: (err as Error).message,
      })
    }
  }

  /** Converts a `Uint8Array` body to a `Buffer` for SDK safety; passes others through. */
  private normalizeSingleShotBody(body: UploadBody): NonNullable<PutObjectCommandInput['Body']> {
    if (isBufferLike(body)) {
      return Buffer.isBuffer(body) ? body : Buffer.from(body)
    }
    return body as NonNullable<PutObjectCommandInput['Body']>
  }

  /** Assembles an `UploadResult`, omitting optional fields that are absent. */
  private buildUploadResult(params: {
    finalKey: string
    bucket: string
    etag: string | undefined
    versionId: string | undefined
    size: number | undefined
    contentType: string
    multipart: boolean
  }): UploadResult {
    return {
      key: params.finalKey,
      bucket: params.bucket,
      etag: params.etag ?? '',
      contentType: params.contentType,
      publicUrl: this.buildPublicUrl(params.finalKey, params.bucket),
      multipart: params.multipart,
      fromIdempotencyCache: false,
      ...(params.size !== undefined ? { size: params.size } : {}),
      ...(params.versionId !== undefined ? { versionId: params.versionId } : {}),
    }
  }

  /** Emits a progress event, omitting `total`/`part` when they are unknown. */
  private emitProgress(
    onProgress: NonNullable<UploadOptions['onProgress']>,
    loaded: number | undefined,
    total: number | undefined,
    part?: number,
  ): void {
    onProgress({
      loaded: loaded ?? 0,
      ...(total !== undefined ? { total } : {}),
      ...(part !== undefined ? { part } : {}),
    })
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
    try {
      const response = await this.s3Provider.getClient().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
          ContinuationToken: options.continuationToken,
          Delimiter: options.delimiter,
        }),
      )
      return this.toListResult(response)
    } catch (err) {
      throw mapAwsError(err, { bucket, prefix, op: 'list' })
    }
  }

  /** Maps a `ListObjectsV2` response onto the public `ListResult` shape. */
  private toListResult(response: ListObjectsV2CommandOutput): ListResult {
    const objects = (response.Contents ?? []).map((obj) => this.toListedObject(obj))
    const commonPrefixes = (response.CommonPrefixes ?? [])
      .map((cp) => cp.Prefix ?? '')
      .filter((cp) => cp.length > 0)
      .map((cp) => this.keyResolver.stripPrefix(cp))
    return {
      objects,
      commonPrefixes,
      isTruncated: response.IsTruncated ?? false,
      ...(response.NextContinuationToken !== undefined
        ? { nextContinuationToken: response.NextContinuationToken }
        : {}),
    }
  }

  /** Maps one `Contents` entry onto `ListedObject`, stripping the global prefix. */
  private toListedObject(obj: S3ListEntry): ListedObject {
    return {
      key: this.keyResolver.stripPrefix(obj.Key ?? ''),
      size: obj.Size ?? 0,
      etag: obj.ETag ?? '',
      lastModified: obj.LastModified ?? new Date(0),
      ...(obj.StorageClass !== undefined ? { storageClass: obj.StorageClass } : {}),
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
    const sourceKey = this.keyResolver.normalize(options.sourceKey)
    const destKey = this.keyResolver.normalize(options.destinationKey)
    const sourceBucket = this.resolveBucket(options.sourceBucket)
    const destBucket = this.resolveBucket(options.destinationBucket)
    try {
      const response = await this.s3Provider.getClient().send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: destKey,
          CopySource: `/${sourceBucket}/${sourceKey}`,
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
      const outcome = await this.deleteChunk(bucket, chunk)
      deleted.push(...outcome.deleted)
      failed.push(...outcome.failed)
    }
    return { deleted, failed }
  }

  /** Deletes one chunk (≤ 1000 keys); a whole-chunk failure fails every key. */
  private async deleteChunk(bucket: string, chunk: string[]): Promise<DeleteManyResult> {
    const deleted: string[] = []
    const failed: FailedDeletion[] = []
    try {
      const response = await this.s3Provider.getClient().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          // `Quiet: false` returns both successes and per-key errors.
          Delete: { Objects: chunk.map((key) => ({ Key: key })), Quiet: false },
        }),
      )
      for (const ok of response.Deleted ?? []) {
        if (ok.Key !== undefined) {
          deleted.push(this.keyResolver.stripPrefix(ok.Key))
        }
      }
      for (const failure of response.Errors ?? []) {
        if (failure.Key !== undefined) {
          failed.push({
            key: this.keyResolver.stripPrefix(failure.Key),
            error: `${failure.Code ?? 'Unknown'}: ${failure.Message ?? ''}`,
          })
        }
      }
    } catch (err) {
      const message = (err as Error).message
      for (const key of chunk) {
        failed.push({ key: this.keyResolver.stripPrefix(key), error: message })
      }
    }
    return { deleted, failed }
  }
}
