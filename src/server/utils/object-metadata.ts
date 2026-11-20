/**
 * @fileoverview Maps the metadata an S3 `HeadObject` or `GetObject` response carries onto the public
 * `ObjectMetadata` shape.
 * @layer server/utils
 */
import type { ObjectMetadata } from '../../shared/types/storage-types'

/** Common metadata fields shared by `HeadObject` and `GetObject` responses. */
export interface S3ObjectResponse {
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

/**
 * Maps an S3 metadata response onto the public `ObjectMetadata` shape.
 *
 * @param response - What `HeadObject` or `GetObject` answered.
 * @param key - The object's key as the caller knows it (without the module's `keyPrefix`).
 * @param bucket - The bucket the object is in.
 * @returns The object's metadata, with defaults for what the provider left out.
 */
export function toObjectMetadata(
  response: S3ObjectResponse,
  key: string,
  bucket: string,
): ObjectMetadata {
  return {
    key,
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
