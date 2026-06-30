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
  GetObjectCommand,
  HeadObjectCommand,
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
import type { ObjectMetadata, UploadResult } from '../../shared/types/storage-types'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
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

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    private readonly s3Provider: S3ClientProvider,
    private readonly keyResolver: KeyResolverService,
    @Inject(BYMAX_STORAGE_IDEMPOTENCY_CACHE) private readonly idempotencyCache: IdempotencyCache,
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

    const strategy = pickUploadStrategy(
      options.body,
      options.size,
      this.options.multipart.thresholdBytes,
    )
    const result =
      strategy === 'multipart'
        ? await this.uploadMultipart(options, finalKey, bucket)
        : await this.uploadSingleShot(options, finalKey, bucket)

    if (options.idempotencyKey) {
      this.idempotencyCache.set(
        this.idempotencyCache.computeKey(options.idempotencyKey, finalKey),
        result,
      )
    }
    return result
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
    const bytes = await (stream as unknown as SdkByteStream).transformToByteArray()
    return { buffer: Buffer.from(bytes), metadata }
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
    return base.includes(bucket) ? `${base}/${finalKey}` : `${base}/${bucket}/${finalKey}`
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
        this.emitProgress(options.onProgress, total ?? 0, total)
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
        this.emitProgress(onProgress, event.loaded ?? 0, event.total, event.part)
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
    loaded: number,
    total: number | undefined,
    part?: number,
  ): void {
    onProgress({
      loaded,
      ...(total !== undefined ? { total } : {}),
      ...(part !== undefined ? { part } : {}),
    })
  }
}
