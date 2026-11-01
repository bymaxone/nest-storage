/**
 * @fileoverview Maps a `ListObjectsV2` response onto the public `ListResult`, returning keys
 * relative to the module's `keyPrefix`.
 * @layer server/utils
 */
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3'
import type { ListResult } from '../interfaces/list-options.interface'
import type { ListedObject } from '../../shared/types/storage-types'

/** Minimal shape of a `ListObjectsV2` `Contents` entry consumed by the mapper. */
interface S3ListEntry {
  Key?: string | undefined
  Size?: number | undefined
  ETag?: string | undefined
  LastModified?: Date | undefined
  StorageClass?: string | undefined
}

/** Maps one `Contents` entry onto `ListedObject`, stripping the global prefix. */
function toListedObject(obj: S3ListEntry, stripPrefix: (key: string) => string): ListedObject {
  return {
    key: stripPrefix(obj.Key ?? ''),
    size: obj.Size ?? 0,
    etag: obj.ETag ?? '',
    lastModified: obj.LastModified ?? new Date(0),
    ...(obj.StorageClass !== undefined ? { storageClass: obj.StorageClass } : {}),
  }
}

/**
 * Maps a `ListObjectsV2` response onto the public `ListResult` shape.
 *
 * @param response - The SDK response.
 * @param stripPrefix - Removes the module's `keyPrefix` from a key.
 * @returns The list page with relative keys.
 */
export function toListResult(
  response: ListObjectsV2CommandOutput,
  stripPrefix: (key: string) => string,
): ListResult {
  const objects = (response.Contents ?? []).map((obj) => toListedObject(obj, stripPrefix))
  const commonPrefixes = (response.CommonPrefixes ?? [])
    .map((cp) => cp.Prefix ?? '')
    .filter((cp) => cp.length > 0)
    .map((cp) => stripPrefix(cp))
  return {
    objects,
    commonPrefixes,
    isTruncated: response.IsTruncated ?? false,
    ...(response.NextContinuationToken !== undefined
      ? { nextContinuationToken: response.NextContinuationToken }
      : {}),
  }
}
