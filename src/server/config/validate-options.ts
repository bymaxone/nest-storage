/**
 * @fileoverview Bootstrap-time validation of module options. Throws
 * `StorageException` with code `STORAGE_INVALID_CONFIG` carrying actionable
 * details. Tolerates empty credentials so dev workflows run without storage —
 * individual operations then fail lazily with `STORAGE_NOT_CONFIGURED`.
 * @layer server/config
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024

function invalid(reason: string): StorageException {
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG, HttpStatus.INTERNAL_SERVER_ERROR, {
    reason,
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Validates options at module bootstrap. Credentials may be empty (handled
 * lazily); structural fields are mandatory.
 *
 * @param options - The raw options passed to `forRoot`/`forRootAsync`.
 * @throws StorageException with code `STORAGE_INVALID_CONFIG`.
 */
export function validateOptions(options: unknown): void {
  if (!isObject(options)) {
    throw invalid('options object is required')
  }
  if (!isNonEmptyString(options.endpoint)) {
    throw invalid('options.endpoint must be a non-empty string')
  }
  if (!isNonEmptyString(options.region)) {
    throw invalid('options.region must be a non-empty string')
  }
  if (!isNonEmptyString(options.bucket)) {
    throw invalid('options.bucket must be a non-empty string')
  }
  if (!isObject(options.credentials)) {
    throw invalid('options.credentials is required')
  }
  // Credentials may be empty strings — handled lazily via STORAGE_NOT_CONFIGURED.

  const signedUrls = options.signedUrls
  if (isObject(signedUrls) && typeof signedUrls.maxTtlSeconds === 'number' && signedUrls.maxTtlSeconds <= 0) {
    throw invalid('signedUrls.maxTtlSeconds must be > 0')
  }
  const multipart = options.multipart
  if (
    isObject(multipart) &&
    typeof multipart.partSizeBytes === 'number' &&
    multipart.partSizeBytes < MIN_PART_SIZE_BYTES
  ) {
    throw invalid('multipart.partSizeBytes must be >= 5 MB (S3 hard limit)')
  }
  if (options.serverSideEncryption === 'aws:kms' && !options.kmsKeyId) {
    throw invalid('kmsKeyId is required when serverSideEncryption === "aws:kms"')
  }
}
