/**
 * @fileoverview Pins every `as const` value table in the package by its whole value. Stryker does not
 * mutate an object or array literal under `as const`, so an edit to one of these tables is caught
 * here or nowhere.
 * @layer shared/constants
 */
import {
  DEFAULT_SIGNED_URLS,
  DEFAULT_MULTIPART,
} from '../../server/constants/default-options.constants'
import {
  DEFAULT_DOC_MIME_WHITELIST,
  DEFAULT_IMAGE_MIME_WHITELIST,
  DEFAULT_VIDEO_MIME_WHITELIST,
} from './mime-types.constants'
import { STORAGE_ERROR_CODES } from './error-codes.constants'

describe('constant tables', () => {
  it('holds exactly the published error codes, each equal to its name', () => {
    // Host apps match on these strings; a renamed, added or dropped code is a contract change.
    expect(STORAGE_ERROR_CODES).toStrictEqual({
      STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
      STORAGE_KEY_INVALID: 'STORAGE_KEY_INVALID',
      STORAGE_BODY_MISSING: 'STORAGE_BODY_MISSING',
      STORAGE_CONTENT_TYPE_REQUIRED: 'STORAGE_CONTENT_TYPE_REQUIRED',
      STORAGE_MIME_NOT_ALLOWED: 'STORAGE_MIME_NOT_ALLOWED',
      STORAGE_SIZE_EXCEEDED: 'STORAGE_SIZE_EXCEEDED',
      STORAGE_VALIDATION_FAILED: 'STORAGE_VALIDATION_FAILED',
      STORAGE_SCAN_INFECTED: 'STORAGE_SCAN_INFECTED',
      STORAGE_SCAN_INCONCLUSIVE: 'STORAGE_SCAN_INCONCLUSIVE',
      STORAGE_OBJECT_NOT_FOUND: 'STORAGE_OBJECT_NOT_FOUND',
      STORAGE_PROVIDER_ERROR: 'STORAGE_PROVIDER_ERROR',
      STORAGE_SIGNED_URL_TTL_INVALID: 'STORAGE_SIGNED_URL_TTL_INVALID',
      STORAGE_PART_TOO_SMALL: 'STORAGE_PART_TOO_SMALL',
      STORAGE_INVALID_PART_COUNT: 'STORAGE_INVALID_PART_COUNT',
      STORAGE_BUCKET_UNDEFINED: 'STORAGE_BUCKET_UNDEFINED',
      STORAGE_MULTIPART_ABORTED: 'STORAGE_MULTIPART_ABORTED',
      STORAGE_INVALID_CONFIG: 'STORAGE_INVALID_CONFIG',
      STORAGE_TIMEOUT: 'STORAGE_TIMEOUT',
      STORAGE_LIFECYCLE_RULE_INVALID: 'STORAGE_LIFECYCLE_RULE_INVALID',
      STORAGE_LIFECYCLE_UNSUPPORTED: 'STORAGE_LIFECYCLE_UNSUPPORTED',
      STORAGE_LIFECYCLE_REJECTED: 'STORAGE_LIFECYCLE_REJECTED',
      STORAGE_NOT_MODIFIED: 'STORAGE_NOT_MODIFIED',
      STORAGE_PRECONDITION_FAILED: 'STORAGE_PRECONDITION_FAILED',
      STORAGE_BUCKET_NOT_FOUND: 'STORAGE_BUCKET_NOT_FOUND',
      STORAGE_BUCKET_ACCESS_DENIED: 'STORAGE_BUCKET_ACCESS_DENIED',
      STORAGE_BUCKET_REGION_MISMATCH: 'STORAGE_BUCKET_REGION_MISMATCH',
    })
  })

  it('holds exactly the default image, video and document whitelists, in order', () => {
    // Consumers pass these to `validation.mimeWhitelist`; a type added here widens what they accept.
    expect(DEFAULT_IMAGE_MIME_WHITELIST).toStrictEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'image/avif',
    ])
    expect(DEFAULT_VIDEO_MIME_WHITELIST).toStrictEqual([
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ])
    expect(DEFAULT_DOC_MIME_WHITELIST).toStrictEqual([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
    ])
  })

  it('holds exactly the default signed-URL and multipart settings', () => {
    // Applied under any option the consumer leaves out.
    expect(DEFAULT_SIGNED_URLS).toStrictEqual({
      defaultGetTtlSeconds: 300,
      defaultPutTtlSeconds: 300,
      maxTtlSeconds: 604_800,
    })
    expect(DEFAULT_MULTIPART).toStrictEqual({
      thresholdBytes: 5_242_880,
      partSizeBytes: 5_242_880,
      queueSize: 4,
    })
  })
})
