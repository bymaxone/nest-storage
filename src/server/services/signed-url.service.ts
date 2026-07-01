/**
 * @fileoverview Issues presigned URLs (GET, PUT, and multipart) via
 * `@aws-sdk/s3-request-presigner`. Every TTL flows through `clampTtl`; every
 * AWS failure is normalised through `mapAwsError`. Signed URLs are temporary
 * credentials — they are NEVER logged.
 * @layer server/services
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { SignedGetUrlOptions, SignedPutUrlOptions, MultipartUploadUrlsOptions, MultipartUploadUrlsResult } from '../interfaces/signed-url-options.interface'
import type { SignedUrlResult } from '../../shared/types/signed-url-types'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { StorageException } from '../errors/storage-exception'
import { mapAwsError } from '../errors/aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { buildACL } from '../utils/header-utils'
import { clampTtl } from '../utils/ttl-clamp'

@Injectable()
export class SignedUrlService {
  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    @Inject(S3ClientProvider) private readonly s3Provider: S3ClientProvider,
    @Inject(KeyResolverService) private readonly keyResolver: KeyResolverService,
  ) {}

  /**
   * Issues a presigned GET URL for downloading an object.
   *
   * SECURITY: The returned URL is a temporary credential. NEVER log it, store it
   * in a database, or cache it across users. Issue a fresh URL per request.
   *
   * @param options - The download URL options.
   * @returns The presigned URL and its expiry metadata.
   * @throws StorageException `STORAGE_NOT_CONFIGURED` when the client is absent.
   * @throws StorageException `STORAGE_SIGNED_URL_TTL_INVALID` for non-positive TTL.
   */
  async getDownloadUrl(options: SignedGetUrlOptions): Promise<SignedUrlResult> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    const ttl = clampTtl(
      options.ttlSeconds,
      this.options.signedUrls.defaultGetTtlSeconds,
      this.options.signedUrls.maxTtlSeconds,
    )
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: finalKey,
        ...(options.responseContentDisposition !== undefined
          ? { ResponseContentDisposition: options.responseContentDisposition }
          : {}),
        ...(options.responseContentType !== undefined
          ? { ResponseContentType: options.responseContentType }
          : {}),
      })
      const url = await getSignedUrl(this.s3Provider.getClient(), command, { expiresIn: ttl })
      return { url, expiresAt: new Date(Date.now() + ttl * 1000), method: 'GET', requiredHeaders: {} }
    } catch (err) {
      if (err instanceof StorageException) throw err
      throw mapAwsError(err, { key: finalKey, bucket, op: 'getDownloadUrl' })
    }
  }

  /**
   * Issues a presigned PUT URL for uploading an object. The client MUST send
   * every header listed in `requiredHeaders` verbatim — each one is part of the
   * URL signature, so an omitted header yields `SignatureDoesNotMatch`. The map
   * always carries `Content-Type` and additionally lists `x-amz-acl` when an ACL
   * is signed and an `x-amz-meta-<key>` entry per metadata pair.
   *
   * SECURITY: The returned URL is a temporary credential — NEVER log it. A signed
   * PUT bypasses the server-side MIME/size validation pipeline. Size limits are
   * NOT enforced at presign time: a SigV4 PUT signature can only pin an exact
   * `Content-Length`, never a maximum, so binding one would reject valid smaller
   * uploads. Enforce size after the fact via a post-upload HEAD/size check plus
   * the post-upload scanner path for defence-in-depth.
   *
   * ACL caveat: `publicRead` emits `ACL: public-read`, which returns HTTP 400
   * `AccessControlListNotSupported` on modern AWS S3 buckets (Object Ownership
   * = "Bucket owner enforced") and is a no-op on Cloudflare R2. Prefer a bucket
   * policy, CDN, or signed GET URL for public delivery.
   *
   * @param options - The upload URL options.
   * @returns The presigned URL, its expiry metadata, and required headers.
   * @throws StorageException `STORAGE_NOT_CONFIGURED` when the client is absent.
   * @throws StorageException `STORAGE_SIGNED_URL_TTL_INVALID` for non-positive TTL.
   */
  async getUploadUrl(options: SignedPutUrlOptions): Promise<SignedUrlResult> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    const ttl = clampTtl(
      options.ttlSeconds,
      this.options.signedUrls.defaultPutTtlSeconds,
      this.options.signedUrls.maxTtlSeconds,
    )
    try {
      const acl = buildACL(options.publicRead, this.options.defaultPublicRead)
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: finalKey,
        ContentType: options.contentType,
        ACL: acl,
        ...(options.metadata !== undefined ? { Metadata: options.metadata } : {}),
      })
      const url = await getSignedUrl(this.s3Provider.getClient(), command, { expiresIn: ttl })
      return {
        url,
        expiresAt: new Date(Date.now() + ttl * 1000),
        method: 'PUT',
        requiredHeaders: this.buildPutRequiredHeaders(options, acl),
      }
    } catch (err) {
      if (err instanceof StorageException) throw err
      throw mapAwsError(err, { key: finalKey, bucket, op: 'getUploadUrl' })
    }
  }

  /**
   * Builds the set of headers a client MUST send for a signed PUT, mirroring the
   * headers folded into the SigV4 signature. Always includes `Content-Type`; adds
   * `x-amz-acl` when an ACL is signed and an `x-amz-meta-<key>` entry (key
   * lowercased to match SigV4 canonicalisation) for every metadata pair.
   */
  private buildPutRequiredHeaders(
    options: SignedPutUrlOptions,
    acl: 'public-read' | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': options.contentType }
    if (acl !== undefined) {
      headers['x-amz-acl'] = acl
    }
    if (options.metadata !== undefined) {
      for (const [key, value] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${key.toLowerCase()}`] = value
      }
    }
    return headers
  }

  /**
   * Presigns a multipart upload: creates the upload session on S3, then returns
   * N presigned `UploadPart` URLs (1-indexed) and a presigned `CompleteMultipart`
   * URL. The client uploads parts directly to S3 and then calls the complete URL.
   *
   * SECURITY: All returned URLs are temporary credentials — NEVER log them.
   *
   * @param options - The multipart URL options.
   * @returns `uploadId`, `partUrls`, and `completeUrl`.
   * @throws StorageException `STORAGE_NOT_CONFIGURED` when the client is absent.
   * @throws StorageException `STORAGE_SIGNED_URL_TTL_INVALID` for non-positive TTL.
   * @throws StorageException `STORAGE_PROVIDER_ERROR` when no `UploadId` is returned.
   */
  async getMultipartUploadUrls(options: MultipartUploadUrlsOptions): Promise<MultipartUploadUrlsResult> {
    this.assertConfigured()
    if (options.parts <= 0) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_INVALID_PART_COUNT, undefined, {
        reason: 'parts must be a positive integer',
        provided: options.parts,
      })
    }
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)
    const ttl = clampTtl(
      options.ttlSeconds,
      this.options.signedUrls.defaultPutTtlSeconds,
      this.options.signedUrls.maxTtlSeconds,
    )
    try {
      const createCmd = new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: finalKey,
        ContentType: options.contentType,
      })
      const createResp = await this.s3Provider.getClient().send(createCmd)
      const uploadId = createResp.UploadId
      if (!uploadId) {
        throw new StorageException(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR, undefined, {
          reason: 'CreateMultipartUpload returned no UploadId',
          key: finalKey,
          bucket,
        })
      }
      return await this.presignMultipartParts({ finalKey, bucket, uploadId, parts: options.parts, ttl })
    } catch (err) {
      if (err instanceof StorageException) throw err
      throw mapAwsError(err, { key: finalKey, bucket, op: 'getMultipartUploadUrls' })
    }
  }

  /** Presigns all part URLs and the complete URL in parallel. */
  private async presignMultipartParts(params: {
    finalKey: string
    bucket: string
    uploadId: string
    parts: number
    ttl: number
  }): Promise<MultipartUploadUrlsResult> {
    const { finalKey, bucket, uploadId, parts, ttl } = params
    const client = this.s3Provider.getClient()
    const opts = { expiresIn: ttl }

    const partNums = Array.from({ length: parts }, (_, i) => i + 1)
    const partUrls = await Promise.all(
      partNums.map(async (partNumber) => {
        const cmd = new UploadPartCommand({ Bucket: bucket, Key: finalKey, UploadId: uploadId, PartNumber: partNumber })
        const url = await getSignedUrl(client, cmd, opts)
        return { partNumber, url }
      }),
    )

    const completeCmd = new CompleteMultipartUploadCommand({ Bucket: bucket, Key: finalKey, UploadId: uploadId })
    const completeUrl = await getSignedUrl(client, completeCmd, opts)

    return { uploadId, partUrls, completeUrl }
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
}
