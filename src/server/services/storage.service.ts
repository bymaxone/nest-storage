/**
 * @fileoverview The public storage facade. Wraps the S3 client with key
 * normalization, bucket resolution, automatic headers, an idempotency cache, and
 * typed errors. Exposes upload (single-shot and multipart), download (stream and
 * buffer), metadata reads (`head` / `exists`), an idempotent `delete`, and public
 * URL building.
 * @layer server/services
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { ObjectMetadata } from '../../shared/types/storage-types'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { StorageException } from '../errors/storage-exception'
import { mapAwsError } from '../errors/aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

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

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    private readonly s3Provider: S3ClientProvider,
    private readonly keyResolver: KeyResolverService,
  ) {}

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
}
