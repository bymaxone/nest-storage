/**
 * @fileoverview Refuses a per-call numeric input that is not an integer in range, with a typed error
 * naming the field, before any request is made. A comparison alone lets `NaN` through.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * Throws unless `value` is absent or an integer of at least `min`.
 *
 * @param value - The caller's number, if any.
 * @param field - The option's name, for the error details.
 * @param min - The least value allowed.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` with `details.field` and `details.reason`.
 */
export function assertIntegerInput(value: number | undefined, field: string, min: number): void {
  if (value === undefined) return
  // `Number.isInteger` is false for NaN, Infinity, a fraction and any non-number, so it is the type check too.
  if (!Number.isInteger(value) || value < min) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      field,
      reason: `${field} must be an integer of at least ${String(min)}`,
    })
  }
}
