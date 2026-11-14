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

  it.each([
    ['name', { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }],
    ['Code', { name: 'Unknown', Code: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }],
  ])('should map NoSuchBucket (by %s) to STORAGE_BUCKET_NOT_FOUND, not to an absent object', (_how, failure) => {
    // A 404 alone means "absent object"; the bucket code is the more specific fact.
    const e = mapAwsError(failure)
    expect(e.code).toBe('STORAGE_BUCKET_NOT_FOUND')
    expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND)
  })

  it('should keep NoSuchKey as STORAGE_OBJECT_NOT_FOUND', () => {
    expect(mapAwsError({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }).code).toBe(
      'STORAGE_OBJECT_NOT_FOUND',
    )
  })

  it('should map HTTP 304 to STORAGE_NOT_MODIFIED', () => {
    // A matching If-None-Match: the provider answers 304 and the SDK names it NotModified.
    const e = mapAwsError({ name: 'NotModified', $metadata: { httpStatusCode: 304 } })
    expect(e.code).toBe('STORAGE_NOT_MODIFIED')
    expect(e.getStatus()).toBe(HttpStatus.NOT_MODIFIED)
  })

  it('should map HTTP 412 to STORAGE_PRECONDITION_FAILED', () => {
    // A failing If-Match: the provider answers 412.
    const e = mapAwsError({ name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } })
    expect(e.code).toBe('STORAGE_PRECONDITION_FAILED')
    expect(e.getStatus()).toBe(HttpStatus.PRECONDITION_FAILED)
  })

  it('should map a TimeoutError to STORAGE_TIMEOUT', () => {
    // Second condition branch.
    const e = mapAwsError({ name: 'TimeoutError' })
    expect(e.code).toBe('STORAGE_TIMEOUT')
    expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
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

  describe('a provider that is unavailable, or that refused the credentials', () => {
    // The error shapes below are what the SDK throws for each condition, measured against local servers.
    it.each([
      ['a refused connection', { name: 'Error', code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:9000' }],
      ['an unknown host', { name: 'Error', code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND minio' }],
      ['a temporary DNS failure', { name: 'Error', code: 'EAI_AGAIN' }],
      ['an unreachable host', { name: 'Error', code: 'EHOSTUNREACH' }],
      ['a reset connection', { name: 'Error', code: 'ECONNRESET' }],
      ['a broken pipe', { name: 'Error', code: 'EPIPE' }],
      ['a refused connection, as the SDK reports it from inside a test runner', { name: 'Error', message: 'AWS SDK error wrapper for Error: connect ECONNREFUSED 127.0.0.1:9000' }],
      ['a reset connection, as the SDK reports it from inside a test runner', { name: 'Error', message: 'AWS SDK error wrapper for TimeoutError: connect ECONNRESET 127.0.0.1:9000' }],
      ['every address of a host refused (the dual-stack error)', { name: 'AggregateError', code: 'ECONNREFUSED', errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] }],
      ['every address of a host refused, as the SDK reports it from inside a test runner', { name: 'Error', message: 'AWS SDK error wrapper for AggregateError' }],
      ['a dual-stack error that carries its codes only in errors', { name: 'AggregateError', errors: [{ code: 'ECONNREFUSED' }] }],
      ['a wrapper for the dual-stack error with more text after it', { name: 'Error', message: 'AWS SDK error wrapper for AggregateError: all failed' }],
      ['a read that was reset, as Node words it', { name: 'Error', message: 'read ECONNRESET' }],
      ['a hang up, as the SDK reports it from inside a test runner', { name: 'Error', message: 'AWS SDK error wrapper for Error: socket hang up' }],
      ['a failure whose cause is a reset', { name: 'Error', cause: { code: 'ECONNRESET' } }],
      ['an answer of 503 SlowDown', { name: 'SlowDown', Code: 'SlowDown', $metadata: { httpStatusCode: 503 } }],
      ['an answer of 500', { name: 'InternalError', Code: 'InternalError', $metadata: { httpStatusCode: 500 } }],
      ['an answer of 502 with no body', { name: 'Unknown', $metadata: { httpStatusCode: 502 } }],
      ['an answer of 504 with no body', { name: 'Unknown', $metadata: { httpStatusCode: 504 } }],
    ])('answers 503 for %s, keeping STORAGE_PROVIDER_ERROR', (_label, failure) => {
      const e = mapAwsError(failure)

      expect(e.code).toBe('STORAGE_PROVIDER_ERROR')
      expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    })

    it.each(['InvalidAccessKeyId', 'SignatureDoesNotMatch'])(
      'answers 500 for a 403 %s: the credentials are a deployment fault, not a retryable outage',
      (code) => {
        const e = mapAwsError({ name: code, Code: code, $metadata: { httpStatusCode: 403 } })

        expect(e.code).toBe('STORAGE_PROVIDER_ERROR')
        expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
      },
    )

    it.each([
      ['a 403 AccessDenied on an object', { name: 'AccessDenied', Code: 'AccessDenied', $metadata: { httpStatusCode: 403 } }],
      ['a 400', { name: 'BadRequest', Code: 'BadRequest', $metadata: { httpStatusCode: 400 } }],
      ['a 409', { name: 'Conflict', Code: 'Conflict', $metadata: { httpStatusCode: 409 } }],
      ['a 501 the provider does not implement', { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } }],
      ['an error with an unrelated code', { name: 'Error', code: 'ERR_INVALID_ARG_TYPE' }],
      ['an error whose code is not a string', { name: 'Error', code: 7 }],
      ['an answer whose own message names a socket error', { name: 'Conflict', message: 'ECONNRESET was in our log', $metadata: { httpStatusCode: 409 } }],
      ['a message that only ends with the dual-stack wrapper text', { name: 'Error', message: 'see: AWS SDK error wrapper for AggregateError' }],
      ['a message that mentions a socket code after other words', { name: 'Error', message: 'AWS SDK error wrapper for Error: malformed option ECONNRESET' }],
      ['a message that mentions a socket code in prose', { name: 'Error', message: 'we saw ECONNRESET earlier' }],
      ['an error whose message names no socket error', { name: 'Error', message: 'the request is malformed' }],
      ['an error whose message is not text', { name: 'Error', message: 7 }],
      ['errors that carry no code', { name: 'AggregateError', errors: [{}, {}] }],
    ])('keeps 502 for %s', (_label, failure) => {
      const e = mapAwsError(failure)

      expect(e.code).toBe('STORAGE_PROVIDER_ERROR')
      expect(e.getStatus()).toBe(HttpStatus.BAD_GATEWAY)
    })

    it('reads the credentials code from Code before name', () => {
      // The provider's own code is `Code`; `name` is what the SDK called the error.
      const e = mapAwsError({ name: 'Error', Code: 'SignatureDoesNotMatch', $metadata: { httpStatusCode: 403 } })

      expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    })

    it('cannot tell refused credentials on a HEAD answer, which has no body, so it keeps 502', () => {
      // A HEAD response carries no error code: the SDK names the failure after the status alone, so a
      // refused credential and a 403 on an object look the same there.
      const e = mapAwsError({ name: 'Forbidden', $metadata: { httpStatusCode: 403 } })

      expect(e.code).toBe('STORAGE_PROVIDER_ERROR')
      expect(e.getStatus()).toBe(HttpStatus.BAD_GATEWAY)
    })

    it('keeps a 403 InvalidAccessKeyId that is not a 403 as an ordinary rejection', () => {
      // Only the answer of the provider refuses credentials: the name alone, with another status, does not.
      expect(mapAwsError({ name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 400 } }).getStatus()).toBe(
        HttpStatus.BAD_GATEWAY,
      )
    })
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