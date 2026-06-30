/**
 * @fileoverview The single exception type thrown by the library. Extends NestJS
 * `HttpException` so it integrates with host global exception filters.
 * @layer server/errors
 */
import { HttpException, type HttpStatus } from '@nestjs/common'
import type { StorageErrorCode } from '../../shared/constants/error-codes.constants'
import { STORAGE_ERROR_MESSAGES } from './storage-error-messages'
import { STORAGE_ERROR_STATUS } from './storage-error-status'

/**
 * Standard exception thrown by the library. The HTTP status defaults to
 * `STORAGE_ERROR_STATUS[code]`; `code` is exposed so filters can branch without
 * deserializing the body.
 *
 * @example
 *   throw new StorageException('STORAGE_OBJECT_NOT_FOUND', undefined, { key }) // 404 from the status map
 */
export class StorageException extends HttpException {
  readonly code: StorageErrorCode

  constructor(
    code: StorageErrorCode,
    /** Defaults to `STORAGE_ERROR_STATUS[code]`. Pass only to override. */
    statusCode: HttpStatus = STORAGE_ERROR_STATUS[code],
    details?: Record<string, unknown>,
  ) {
    super(
      {
        error: {
          code,
          message: STORAGE_ERROR_MESSAGES[code],
          ...(details ? { details } : {}),
        },
      },
      statusCode,
    )
    this.code = code
  }
}
