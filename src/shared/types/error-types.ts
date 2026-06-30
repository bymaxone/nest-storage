/**
 * @fileoverview JSON error shape emitted by `StorageException`. Zero NestJS or
 * AWS SDK dependencies.
 * @layer shared/types
 */
import type { STORAGE_ERROR_CODES } from '../constants/error-codes.constants'

/**
 * JSON shape emitted by `StorageException` — what the host application's HTTP
 * error handler receives in `response.body`.
 */
export interface StorageErrorResponse {
  error: {
    code: keyof typeof STORAGE_ERROR_CODES
    message: string
    details?: Record<string, unknown>
  }
}
