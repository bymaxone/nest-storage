/**
 * @fileoverview Mapping of a failed `HeadBucket` probe onto a typed bucket code.
 * @layer server/errors
 */
import { mapBucketCheckError } from './bucket-check-error-mapper'

const context = { bucket: 'b', op: 'checkBucket' }

describe('mapBucketCheckError', () => {
  it('keeps the status and name in details', () => {
    const e = mapBucketCheckError(
      { name: 'Forbidden', $metadata: { httpStatusCode: 403 } },
      context,
    )

    const details = (e.getResponse() as { error: { details: Record<string, unknown> } }).error
      .details
    expect(details).toEqual({
      bucket: 'b',
      op: 'checkBucket',
      httpStatus: 403,
      awsCode: 'Forbidden',
    })
  })

  it('treats a value that is not an error object as a provider error', () => {
    expect(mapBucketCheckError(null, context).code).toBe('STORAGE_PROVIDER_ERROR')
    expect(mapBucketCheckError(undefined, context).code).toBe('STORAGE_PROVIDER_ERROR')
  })

  it('maps NoSuchBucket without a status to STORAGE_BUCKET_NOT_FOUND', () => {
    expect(mapBucketCheckError({ name: 'NoSuchBucket' }, context).code).toBe(
      'STORAGE_BUCKET_NOT_FOUND',
    )
  })
})
