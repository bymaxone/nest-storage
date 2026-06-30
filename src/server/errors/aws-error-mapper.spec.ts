/**
 * @fileoverview Unit tests for `mapAwsError` — error classification heuristics
 * and observability metadata preserved in `details`.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { mapAwsError } from './aws-error-mapper'

interface MappedDetails {
  awsCode?: string
  httpStatus?: number
  requestId?: string
  awsMessage?: string
  scope?: string
}

describe('mapAwsError', () => {
  it('should map a NotFound name to STORAGE_OBJECT_NOT_FOUND', () => {
    // First condition true via the error name.
    const e = mapAwsError({ name: 'NotFound' })
    expect(e.code).toBe('STORAGE_OBJECT_NOT_FOUND')
    expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND)
  })

  it('should map a 404 status to STORAGE_OBJECT_NOT_FOUND', () => {
    // First condition true via the HTTP status (name absent → awsCode falls back).
    const e = mapAwsError({ $metadata: { httpStatusCode: 404 } })
    expect(e.code).toBe('STORAGE_OBJECT_NOT_FOUND')
  })

  it('should map a TimeoutError to STORAGE_TIMEOUT', () => {
    // Second condition branch.
    const e = mapAwsError({ name: 'TimeoutError' })
    expect(e.code).toBe('STORAGE_TIMEOUT')
    expect(e.getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT)
  })

  it('should map any other error to STORAGE_PROVIDER_ERROR and preserve metadata', () => {
    // Fallback branch; `Code` wins over `name`; context is merged.
    const e = mapAwsError(
      { Code: 'AccessDenied', name: 'Forbidden', message: 'denied', $metadata: { httpStatusCode: 403, requestId: 'req-1' } },
      { scope: 'upload' },
    )
    expect(e.code).toBe('STORAGE_PROVIDER_ERROR')
    expect(e.getStatus()).toBe(HttpStatus.BAD_GATEWAY)
    const details = (e.getResponse() as { error: { details: MappedDetails } }).error.details
    expect(details.awsCode).toBe('AccessDenied')
    expect(details.httpStatus).toBe(403)
    expect(details.requestId).toBe('req-1')
    expect(details.awsMessage).toBe('denied')
    expect(details.scope).toBe('upload')
  })

  it('should fall back to the error name as awsCode when Code is absent', () => {
    // `e.Code ?? e.name` right branch; no context provided.
    const e = mapAwsError({ name: 'SomethingElse' })
    const details = (e.getResponse() as { error: { details: MappedDetails } }).error.details
    expect(e.code).toBe('STORAGE_PROVIDER_ERROR')
    expect(details.awsCode).toBe('SomethingElse')
  })

  it('should tolerate a null error value', () => {
    // `err ?? {}` left branch — a non-object error never throws.
    const e = mapAwsError(null)
    expect(e.code).toBe('STORAGE_PROVIDER_ERROR')
  })
})
