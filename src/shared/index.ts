/**
 * @fileoverview Public barrel for the zero-dependency `./shared` subpath — pure
 * types and constants importable from any environment (frontend, edge, Node).
 * @layer shared/barrel
 */

// Types
export type { UploadResult, ObjectMetadata, ListedObject } from './types/storage-types'
export type { SignedUrlResult } from './types/signed-url-types'
export type { StorageErrorResponse } from './types/error-types'

// Constants
export { STORAGE_ERROR_CODES } from './constants/error-codes.constants'
export type { StorageErrorCode } from './constants/error-codes.constants'
export {
  DEFAULT_IMAGE_MIME_WHITELIST,
  DEFAULT_VIDEO_MIME_WHITELIST,
  DEFAULT_DOC_MIME_WHITELIST,
} from './constants/mime-types.constants'
export {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  MAX_SIGNED_URL_TTL_SECONDS,
  DEFAULT_MULTIPART_THRESHOLD_BYTES,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_MULTIPART_QUEUE_SIZE,
} from './constants/default-ttls.constants'
