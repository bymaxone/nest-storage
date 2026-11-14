/**
 * @fileoverview Pins the human-readable text of every storage error, so a reworded or emptied message
 * fails here instead of changing what host applications log and show.
 * @layer server/errors, tests
 */
import { HttpStatus } from '@nestjs/common'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { STORAGE_ERROR_MESSAGES } from './storage-error-messages'
import { STORAGE_ERROR_STATUS } from './storage-error-status'

describe('STORAGE_ERROR_MESSAGES', () => {
  it('holds exactly the published message for every error code', () => {
    // Host applications surface these texts; a changed, emptied or missing one is a contract change.
    expect(STORAGE_ERROR_MESSAGES).toStrictEqual({
      STORAGE_NOT_CONFIGURED: 'Storage credentials are not configured',
      STORAGE_KEY_INVALID: 'Invalid storage key',
      STORAGE_BODY_MISSING: 'Upload body is missing',
      STORAGE_CONTENT_TYPE_REQUIRED: 'Content-Type is required',
      STORAGE_MIME_NOT_ALLOWED: 'MIME type is not allowed',
      STORAGE_SIZE_EXCEEDED: 'File size exceeds the allowed maximum',
      STORAGE_VALIDATION_FAILED: 'Custom validation failed',
      STORAGE_SCAN_INFECTED: 'File scan reported the content as infected',
      STORAGE_SCAN_INCONCLUSIVE: 'File scan was inconclusive and rejection-on-unknown is enabled',
      STORAGE_OBJECT_NOT_FOUND: 'Object not found',
      STORAGE_PROVIDER_ERROR: 'Storage provider returned an error',
      STORAGE_SIGNED_URL_TTL_INVALID: 'Signed URL TTL is invalid',
      STORAGE_PART_TOO_SMALL: 'Multipart part size is below the 5 MB minimum',
      STORAGE_INVALID_PART_COUNT:
        'Multipart part count is invalid (must be an integer from 1 to 10000)',
      STORAGE_BUCKET_UNDEFINED:
        'Bucket is undefined (no default configured and none provided per call)',
      STORAGE_MULTIPART_ABORTED: 'Multipart upload was aborted',
      STORAGE_INVALID_CONFIG: 'Module configuration is invalid',
      STORAGE_TIMEOUT: 'Storage request timed out',
      STORAGE_LIFECYCLE_RULE_INVALID: 'Lifecycle rule input is invalid',
      STORAGE_LIFECYCLE_UNSUPPORTED:
        'The storage provider does not support bucket lifecycle configuration',
      STORAGE_LIFECYCLE_REJECTED: 'The storage provider rejected the lifecycle configuration',
      STORAGE_NOT_MODIFIED: 'The object has not changed since the supplied ETag',
      STORAGE_PRECONDITION_FAILED: 'The object does not satisfy the supplied precondition',
      STORAGE_BUCKET_NOT_FOUND: 'The bucket does not exist',
      STORAGE_BUCKET_ACCESS_DENIED:
        'The bucket cannot be accessed with these credentials (it may also not exist)',
      STORAGE_BUCKET_REGION_MISMATCH:
        'The bucket belongs to a different region than the configured one',
      STORAGE_REQUEST_ABORTED: 'The call was aborted by its AbortSignal',
    })
  })

  it('has a message for every error code and no other key', () => {
    // The table is keyed by the codes, so a new code without a message fails here.
    expect(Object.keys(STORAGE_ERROR_MESSAGES).sort()).toEqual(
      Object.values(STORAGE_ERROR_CODES).sort(),
    )
  })
})

describe('STORAGE_ERROR_STATUS', () => {
  it('holds exactly the HTTP status for every error code', () => {
    // Host applications map these to responses; a changed status is a contract change.
    expect(STORAGE_ERROR_STATUS).toStrictEqual({
      STORAGE_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
      STORAGE_KEY_INVALID: HttpStatus.BAD_REQUEST,
      STORAGE_BODY_MISSING: HttpStatus.BAD_REQUEST,
      STORAGE_CONTENT_TYPE_REQUIRED: HttpStatus.BAD_REQUEST,
      STORAGE_MIME_NOT_ALLOWED: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      STORAGE_SIZE_EXCEEDED: HttpStatus.PAYLOAD_TOO_LARGE,
      STORAGE_VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
      STORAGE_SCAN_INFECTED: HttpStatus.UNPROCESSABLE_ENTITY,
      STORAGE_SCAN_INCONCLUSIVE: HttpStatus.UNPROCESSABLE_ENTITY,
      STORAGE_OBJECT_NOT_FOUND: HttpStatus.NOT_FOUND,
      STORAGE_PROVIDER_ERROR: HttpStatus.BAD_GATEWAY,
      STORAGE_SIGNED_URL_TTL_INVALID: HttpStatus.BAD_REQUEST,
      STORAGE_PART_TOO_SMALL: HttpStatus.BAD_REQUEST,
      STORAGE_INVALID_PART_COUNT: HttpStatus.BAD_REQUEST,
      STORAGE_BUCKET_UNDEFINED: HttpStatus.BAD_REQUEST,
      STORAGE_MULTIPART_ABORTED: HttpStatus.INTERNAL_SERVER_ERROR,
      STORAGE_INVALID_CONFIG: HttpStatus.INTERNAL_SERVER_ERROR,
      STORAGE_TIMEOUT: HttpStatus.SERVICE_UNAVAILABLE,
      STORAGE_LIFECYCLE_RULE_INVALID: HttpStatus.BAD_REQUEST,
      STORAGE_LIFECYCLE_UNSUPPORTED: HttpStatus.NOT_IMPLEMENTED,
      STORAGE_LIFECYCLE_REJECTED: HttpStatus.UNPROCESSABLE_ENTITY,
      STORAGE_NOT_MODIFIED: HttpStatus.NOT_MODIFIED,
      STORAGE_PRECONDITION_FAILED: HttpStatus.PRECONDITION_FAILED,
      STORAGE_BUCKET_NOT_FOUND: HttpStatus.NOT_FOUND,
      STORAGE_BUCKET_ACCESS_DENIED: HttpStatus.FORBIDDEN,
      STORAGE_BUCKET_REGION_MISMATCH: HttpStatus.INTERNAL_SERVER_ERROR,
      STORAGE_REQUEST_ABORTED: 499,
    })
  })

  it('has a status for every error code and no other key', () => {
    // The table is keyed by the codes, so a new code without a status fails here.
    expect(Object.keys(STORAGE_ERROR_STATUS).sort()).toEqual(
      Object.values(STORAGE_ERROR_CODES).sort(),
    )
  })
})
