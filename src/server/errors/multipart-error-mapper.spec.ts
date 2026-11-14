/**
 * @fileoverview Mapping of a failed multipart upload: an idle source is a timeout, anything
 * else an aborted multipart upload.
 * @layer server/errors
 */
import { SourceIdleError } from '../utils/idle-timeout'
import { mapMultipartError } from './multipart-error-mapper'

function messageOf(error: { getResponse(): unknown }): string | undefined {
  return (error.getResponse() as { error?: { message?: string } }).error?.message
}

function detailsOf(error: { getResponse(): unknown }): Record<string, unknown> | undefined {
  return (error.getResponse() as { error?: { details?: Record<string, unknown> } }).error?.details
}

describe('mapMultipartError', () => {
  it('maps an idle source to STORAGE_TIMEOUT (503) with the phase and the limit', () => {
    const error = mapMultipartError(new SourceIdleError(250), { key: 'k', bucket: 'b' })

    expect(error.code).toBe('STORAGE_TIMEOUT')
    expect(error.getStatus()).toBe(503)
    expect(detailsOf(error)).toEqual({ key: 'k', bucket: 'b', phase: 'source-idle', idleMs: 250 })
  })

  it.each([
    ['a refused connection', { name: 'Error', code: 'ECONNREFUSED' }, 503],
    ['an answer of 503 SlowDown', { name: 'SlowDown', Code: 'SlowDown', $metadata: { httpStatusCode: 503 } }, 503],
    ['an SDK timeout, which has a name and no code', { name: 'TimeoutError', message: 'the request socket timed out' }, 503],
    ['refused credentials', { name: 'InvalidAccessKeyId', Code: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } }, 500],
    ['a failure of our own', new Error('boom'), 500],
  ])('answers for %s as the cause says, keeping STORAGE_MULTIPART_ABORTED and the abort outcome', (_label, cause, status) => {
    const error = mapMultipartError(cause, { key: 'k', bucket: 'b', abort: 'completed' })

    expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
    expect(error.getStatus()).toBe(status)
    expect(detailsOf(error)).toMatchObject({ abort: 'completed' })
  })

  it.each([null, undefined, Object.create(null) as object])(
    'maps a rejection value that has no message (%p) without throwing',
    (value) => {
      const error = mapMultipartError(value, { key: 'k', bucket: 'b' })

      expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
      expect(typeof detailsOf(error)?.awsMessage).toBe('string')
    },
  )

  it('maps NoSuchBucket to STORAGE_BUCKET_NOT_FOUND, as a single-request upload does', () => {
    // The multipart upload starts with CreateMultipartUpload, which gets the same error body.
    const error = mapMultipartError(
      { name: 'NoSuchBucket', Code: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } },
      { key: 'k', bucket: 'b' },
    )

    expect(error.code).toBe('STORAGE_BUCKET_NOT_FOUND')
    expect(error.getStatus()).toBe(404)
  })

  it('keeps the aborted message when the abort completed or was not needed', () => {
    for (const context of [{ abort: 'completed' }, {}]) {
      const error = mapMultipartError(new Error('part 2 failed'), { key: 'k', ...context })

      expect(messageOf(error)).toBe('Multipart upload was aborted')
    }
  })

  it('says the abort did not complete when it failed', () => {
    const error = mapMultipartError(new Error('part 2 failed'), {
      key: 'k',
      abort: 'failed',
      abortError: 'denied',
    })

    expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
    expect(messageOf(error)).toBe('Multipart upload failed and could not be aborted')
  })

  it('maps any other failure to STORAGE_MULTIPART_ABORTED with the provider message', () => {
    const error = mapMultipartError(new Error('part 2 failed'), { key: 'k', bucket: 'b' })

    expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
    expect(detailsOf(error)).toEqual({ key: 'k', bucket: 'b', awsMessage: 'part 2 failed' })
  })
})
