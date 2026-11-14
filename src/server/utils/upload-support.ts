/**
 * @fileoverview Small helpers of the upload path: body shapes for the scanner and the SDK, the
 * result assembled for the caller, and progress events.
 * @layer server/utils
 */
import type { PutObjectCommandInput } from '@aws-sdk/client-s3'
import type { Upload } from '@aws-sdk/lib-storage'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import type { KeyResolverService } from '../services/key-resolver.service'
import type { UploadResult } from '../../shared/types/storage-types'
import type { ValidationService } from '../services/validation.service'
import { buildACL, buildCacheControl, buildContentDisposition, buildSSE } from './header-utils'
import { buildPublicUrl } from './public-url'
import { isBufferLike, type UploadBody } from './stream-utils'

/**
 * Coerces the scan body to a `Buffer` so the scanner always receives its declared
 * contract type. In pre-upload mode a stream has already been buffered,
 * so only `Buffer` and `Uint8Array` arrive here.
 */
export function normalizeScanBody(body: UploadBody): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array)
}

/** Relays the uploader's progress events to the caller's callback, when there is one. */
export function forwardProgress(uploader: Upload, onProgress: UploadOptions['onProgress']): void {
  if (!onProgress) return
  uploader.on('httpUploadProgress', (event) => {
    emitProgress(onProgress, event.loaded, event.total, event.part)
  })
}

/** Converts a `Uint8Array` body to a `Buffer` for SDK safety; passes others through. */
export function normalizeSingleShotBody(body: UploadBody): NonNullable<PutObjectCommandInput['Body']> {
  if (isBufferLike(body)) {
    return Buffer.isBuffer(body) ? body : Buffer.from(body)
  }
  return body as NonNullable<PutObjectCommandInput['Body']>
}

/** Assembles an `UploadResult`, omitting optional fields that are absent. */
export function buildUploadResult(
  keyResolver: KeyResolverService,
  options: Pick<ResolvedBymaxStorageOptions, 'cdnBaseUrl' | 'publicBaseUrl'>,
  params: {
    finalKey: string
    bucket: string
    etag: string | undefined
    versionId: string | undefined
    size: number | undefined
    contentType: string
    multipart: boolean
  },
): UploadResult {
  return {
    key: keyResolver.stripPrefix(params.finalKey),
    bucket: params.bucket,
    etag: params.etag ?? '',
    contentType: params.contentType,
    publicUrl: buildPublicUrl(options, params.finalKey, params.bucket),
    multipart: params.multipart,
    fromIdempotencyCache: false,
    ...(params.size !== undefined ? { size: params.size } : {}),
    ...(params.versionId !== undefined ? { versionId: params.versionId } : {}),
  }
}

/** Emits a progress event, omitting `total`/`part` when they are unknown. */
export function emitProgress(
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

/** What a single-shot and a multipart upload send alike: the target, the headers, the ACL and the encryption. */
export function putObjectHeaders(
  options: UploadOptions & { contentType: string },
  resolved: ResolvedBymaxStorageOptions,
  finalKey: string,
  bucket: string,
): PutObjectCommandInput {
  return {
    Bucket: bucket,
    Key: finalKey,
    ContentType: options.contentType,
    CacheControl: buildCacheControl(options.cacheControl, resolved.defaultCacheControl),
    ContentDisposition: buildContentDisposition(
      options.contentDisposition,
      resolved.defaultContentDisposition,
    ),
    // `public-read` only takes effect on buckets that allow ACLs (see header-utils).
    ACL: buildACL(options.publicRead, resolved.defaultPublicRead),
    Metadata: options.metadata,
    ...buildSSE(options.serverSideEncryption, options.kmsKeyId, resolved),
  }
}

/** What the validation pipeline is told about an upload: its size and metadata only when it declares them. */
export function validationInput(
  options: UploadOptions & { contentType: string },
  finalKey: string,
): Parameters<ValidationService['validate']>[0] {
  return {
    key: finalKey,
    body: options.body,
    contentType: options.contentType,
    ...(options.size !== undefined ? { size: options.size } : {}),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    cacheControl: options.cacheControl,
    contentDisposition: options.contentDisposition,
    kmsKeyId: options.kmsKeyId,
  }
}
