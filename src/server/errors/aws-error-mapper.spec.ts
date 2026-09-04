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

  it.each([
    ['not-found', { name: 'NotFound' }, 'STORAGE_OBJECT_NOT_FOUND'],
    ['timeout', { name: 'TimeoutError' }, 'STORAGE_TIMEOUT'],
    ['provider-error', { name: 'AccessDenied' }, 'STORAGE_PROVIDER_ERROR'],
  ])(
    'should never attach the caught error on the %s branch',
    (_label, shape, expectedCode) => {
      // `details` is serialized into the HTTP error envelope this library returns to API
      // clients, so anything reachable from the returned exception is a published surface.
      // A `cause` chain drags the whole SDK error with it — `$metadata`, `$fault`, an
      // possibly-unconsumed `$response.body` stream and any vendor fields — so the mapper
      // projects named fields instead of attaching the error.
      //
      // Driven across all three return paths on purpose: each constructs its own
      // exception, so a guard on one says nothing about the others, and the not-found
      // branch is the one `head` and `download` misses travel through.
      const caught = { ...shape, message: 'denied', leaked: 'FIXTURE-must-not-leak' }

      const mapped = mapAwsError(caught, { key: 'k', bucket: 'b', op: 'head' })

      expect(mapped.code).toBe(expectedCode)
      expect(mapped.cause).toBeUndefined()
      expect(JSON.stringify(mapped.getResponse())).not.toContain('FIXTURE-must-not-leak')
    },
  )

  it('should project only the four named fields beside the caller context', () => {
    // Guards the projection itself, so the `cause` assertions above cannot pass by the
    // mapper having quietly stopped copying anything. `context` is spread verbatim and is
    // the caller's responsibility, not the mapper's — see the AGENTS.md rule.
    const mapped = mapAwsError(
      {
        name: 'AccessDenied',
        message: 'denied',
        Code: 'AccessDenied',
        $metadata: { httpStatusCode: 403, requestId: 'req-1' },
        $fault: 'client',
        leaked: 'FIXTURE-must-not-leak',
      },
      { key: 'k', bucket: 'b', op: 'head' },
    )

    const details = (mapped.getResponse() as { error: { details: MappedDetails } }).error.details
    expect(details).toEqual({
      key: 'k',
      bucket: 'b',
      op: 'head',
      awsCode: 'AccessDenied',
      httpStatus: 403,
      requestId: 'req-1',
      awsMessage: 'denied',
    })
  })
})