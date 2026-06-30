/**
 * @fileoverview Unit tests for `StorageException` — HttpException integration,
 * the public `code` property, default-status derivation, and the body shape.
 * @layer server/errors
 */
import { HttpException, HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'

interface StorageBody {
  error: { code: string; message: string; details?: { reason: string } }
}

describe('StorageException', () => {
  it('should extend HttpException', () => {
    // Integrates with host global exception filters.
    expect(new StorageException('STORAGE_KEY_INVALID')).toBeInstanceOf(HttpException)
  })

  it('should expose the code as a public property', () => {
    // Filters can branch without deserializing the body.
    expect(new StorageException('STORAGE_KEY_INVALID').code).toBe('STORAGE_KEY_INVALID')
  })

  it('should derive the default status from the status map', () => {
    // Default-parameter branch — STORAGE_NOT_CONFIGURED maps to 503.
    expect(new StorageException('STORAGE_NOT_CONFIGURED').getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    )
  })

  it('should honor an explicit status override', () => {
    // Explicit-status branch.
    const e = new StorageException('STORAGE_OBJECT_NOT_FOUND', HttpStatus.BAD_REQUEST)
    expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST)
  })

  it('should serialize details into the response body', () => {
    // Details-present branch of the body spread.
    const body = new StorageException('STORAGE_KEY_INVALID', HttpStatus.BAD_REQUEST, {
      reason: 'X',
    }).getResponse() as StorageBody
    expect(body.error.code).toBe('STORAGE_KEY_INVALID')
    expect(body.error.message).toBe('Invalid storage key')
    expect(body.error.details?.reason).toBe('X')
  })

  it('should omit the details key when none is provided', () => {
    // Details-absent branch of the body spread.
    const body = new StorageException('STORAGE_KEY_INVALID').getResponse() as StorageBody
    expect(body.error.details).toBeUndefined()
  })
})
