/**
 * @fileoverview Unit tests for the lifecycle error classification: the "no
 * configuration" signal, the unsupported-provider and rejected-configuration
 * codes, the fall-through to `mapAwsError`, and the guarantee that the caught
 * error never reaches the exception.
 * @layer server/errors
 */
import { isNoLifecycleConfiguration, mapLifecycleError } from './lifecycle-error-mapper'

describe('isNoLifecycleConfiguration', () => {
  it.each([
    ['by name', { name: 'NoSuchLifecycleConfiguration' }, true],
    ['by Code, which wins over name', { Code: 'NoSuchLifecycleConfiguration', name: 'Other' }, true],
    ['another error name', { name: 'NoSuchBucket' }, false],
    ['a null error', null, false],
  ])('classifies %s', (_label, err, expected) => {
    expect(isNoLifecycleConfiguration(err)).toBe(expected)
  })
})

describe('mapLifecycleError', () => {
  it.each([
    ['NotImplemented', { name: 'NotImplemented' }],
    ['XNotImplemented', { Code: 'XNotImplemented' }],
    ['MethodNotAllowed', { name: 'MethodNotAllowed' }],
    ['HTTP 501 with no name', { $metadata: { httpStatusCode: 501 } }],
    ['HTTP 405 with no name', { $metadata: { httpStatusCode: 405 } }],
  ])('maps %s to STORAGE_LIFECYCLE_UNSUPPORTED (501)', (_label, err) => {
    const mapped = mapLifecycleError(err, { bucket: 'b' })
    expect(mapped.code).toBe('STORAGE_LIFECYCLE_UNSUPPORTED')
    expect(mapped.getStatus()).toBe(501)
  })

  it.each([
    ['MalformedXML', { name: 'MalformedXML' }],
    ['InvalidArgument', { Code: 'InvalidArgument' }],
    ['InvalidRequest', { name: 'InvalidRequest' }],
    ['BadRequest', { name: 'BadRequest' }],
  ])('maps %s to STORAGE_LIFECYCLE_REJECTED (422)', (_label, err) => {
    const mapped = mapLifecycleError(err, { bucket: 'b' })
    expect(mapped.code).toBe('STORAGE_LIFECYCLE_REJECTED')
    expect(mapped.getStatus()).toBe(422)
  })

  it('falls through to the shared mapping for everything else', () => {
    expect(mapLifecycleError({ name: 'AccessDenied' }, {}).code).toBe('STORAGE_PROVIDER_ERROR')
    expect(mapLifecycleError({ name: 'TimeoutError' }, {}).code).toBe('STORAGE_TIMEOUT')
    expect(mapLifecycleError(null, {}).code).toBe('STORAGE_PROVIDER_ERROR')
  })

  it('carries the projected fields and context in details, and never the caught error', () => {
    // details is serialized into the HTTP error envelope; only named fields may reach it.
    const mapped = mapLifecycleError(
      {
        name: 'NotImplemented',
        message: 'no lifecycle here',
        $metadata: { httpStatusCode: 501, requestId: 'req-1' },
        leaked: 'FIXTURE-must-not-leak',
      },
      { bucket: 'b', op: 'lifecycle.get' },
    )
    const details = (mapped.getResponse() as { error: { details: unknown } }).error.details
    expect(details).toEqual({
      bucket: 'b',
      op: 'lifecycle.get',
      awsCode: 'NotImplemented',
      httpStatus: 501,
      requestId: 'req-1',
      awsMessage: 'no lifecycle here',
    })
    expect(mapped.cause).toBeUndefined()
    expect(JSON.stringify(mapped.getResponse())).not.toContain('FIXTURE-must-not-leak')
  })
})
