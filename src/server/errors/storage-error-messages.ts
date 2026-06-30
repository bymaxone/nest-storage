/**
 * @fileoverview Human-readable English messages for each storage error code.
 * Internal — not exported from the package barrel.
 * @layer server/errors
 */
import {
  STORAGE_ERROR_CODES,
  type StorageErrorCode,
} from '../../shared/constants/error-codes.constants'

/**
 * Message per error code. `Record<StorageErrorCode, string>` forces
 * exhaustiveness at compile time.
 */
export const STORAGE_ERROR_MESSAGES: Record<StorageErrorCode, string> = {
  [STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED]: 'Storage credentials are not configured',
  [STORAGE_ERROR_CODES.STORAGE_KEY_INVALID]: 'Invalid storage key',
  [STORAGE_ERROR_CODES.STORAGE_BODY_MISSING]: 'Upload body is missing',
  [STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED]: 'Content-Type is required',
  [STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED]: 'MIME type is not allowed',
  [STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED]: 'File size exceeds the allowed maximum',
  [STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED]: 'Custom validation failed',
  [STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED]: 'File scan reported the content as infected',
  [STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE]:
    'File scan was inconclusive and rejection-on-unknown is enabled',
  [STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND]: 'Object not found',
  [STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR]: 'Storage provider returned an error',
  [STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID]: 'Signed URL TTL is invalid',
  [STORAGE_ERROR_CODES.STORAGE_PART_TOO_SMALL]: 'Multipart part size is below the 5 MB minimum',
  [STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED]:
    'Bucket is undefined (no default configured and none provided per call)',
  [STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED]: 'Multipart upload was aborted',
  [STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG]: 'Module configuration is invalid',
  [STORAGE_ERROR_CODES.STORAGE_TIMEOUT]: 'Storage request timed out',
}
