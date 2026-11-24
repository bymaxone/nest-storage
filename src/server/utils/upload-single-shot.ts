/**
 * @fileoverview The single `PutObject` upload, for bodies below the multipart threshold: headers, the body
 * as the SDK needs it, progress, and the mapping of what the provider throws.
 * @layer server/utils
 */
import { PutObjectCommand, type PutObjectCommandInput } from '@aws-sdk/client-s3'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { mapAwsError } from '../errors/aws-error-mapper'
import { mapSizeLimitError } from '../errors/size-limit-exception'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import type { KeyResolverService } from '../services/key-resolver.service'
import type { UploadResult } from '../../shared/types/storage-types'
import { abortOnBodyFailure, failureOrAbort, sendOptions } from './abort-support'
import { getBodySize } from './stream-utils'
import {
  buildUploadResult,
  emitProgress,
  normalizeSingleShotBody,
  putObjectHeaders,
} from './upload-support'
import { verdictOf } from './settle-or-cut'

/** What a single-shot upload needs of the service that runs it. */
export interface UploadContext {
  readonly s3Provider: S3ClientProvider
  readonly keyResolver: KeyResolverService
  readonly options: ResolvedBymaxStorageOptions
}

/**
 * Uploads an object with one `PutObject`.
 *
 * @param context - The client, the key resolver and the resolved options.
 * @param options - The upload request.
 * @param finalKey - The key as the provider holds it.
 * @param bucket - The target bucket.
 * @param caller - What an error repeats of the call.
 * @returns The upload result.
 */
export async function uploadSingleShot(
  context: UploadContext,
  options: UploadOptions,
  finalKey: string,
  bucket: string,
  caller: Record<string, unknown>,
): Promise<UploadResult> {
  // Read once, before the send: the object is stored when `send` resolves, and a getter that throws on a
  // later read must not turn a stored object into a reported failure.
  const { onProgress, contentType, abortSignal } = options
  const total = options.size ?? getBodySize(options.body)
  const input: PutObjectCommandInput = {
    ...putObjectHeaders(options, context.options, finalKey, bucket),
    Body: normalizeSingleShotBody(options.body),
    ContentLength: total,
  }
  const watch = abortOnBodyFailure(input.Body, abortSignal)
  try {
    const response = await verdictOf(
      context.s3Provider.getClient().send(new PutObjectCommand(input), sendOptions(watch.signal)),
    )
    if (onProgress) {
      emitProgress(onProgress, total, total)
    }
    return buildUploadResult(context.keyResolver, context.options, {
      finalKey,
      bucket,
      etag: response.ETag,
      versionId: response.VersionId,
      size: total,
      contentType,
      multipart: false,
    })
  } catch (err) {
    const context = { ...caller, op: 'upload-single' }
    const mapped = mapSizeLimitError(watch.failure(), context) ?? mapAwsError(err, context)
    throw failureOrAbort(abortSignal, context, mapped)
  }
}
