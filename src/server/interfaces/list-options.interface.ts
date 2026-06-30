/**
 * @fileoverview Per-call options and the result shape for `StorageService.list()`.
 * @layer server/interfaces
 */
import type { ListedObject } from '../../shared/types/storage-types'

/** Options for a single list call. */
export interface ListOptions {
  /** Filter prefix (applied AFTER the global key prefix). */
  prefix?: string
  bucket?: string
  /** Page size. Default: `1000` (S3 hard max). */
  maxKeys?: number
  /** Token from a previous page. */
  continuationToken?: string
  /**
   * Delimiter for pseudo-hierarchical listing. When `'/'`, objects under
   * sub-prefixes are aggregated into `commonPrefixes`.
   */
  delimiter?: string
}

/** Result of a single list call. */
export interface ListResult {
  objects: ListedObject[]
  commonPrefixes: string[]
  isTruncated: boolean
  nextContinuationToken?: string
}
