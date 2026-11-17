/**
 * @fileoverview Mapping of a failed multipart upload: an idle source is a timeout, anything
 * else an aborted multipart upload.
 * @layer server/errors
 */
import { Logger } from '@nestjs/common'
import { SourceIdleError } from '../utils/idle-timeout'
import { SizeLimitError } from '../utils/size-limit'
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
    [
      'an answer of 503 SlowDown',
      { name: 'SlowDown', Code: 'SlowDown', $metadata: { httpStatusCode: 503 } },
      503,
    ],
    [
      'an SDK timeout, which has a name and no code',
      { name: 'TimeoutError', message: 'the request socket timed out' },
      503,
    ],
    [
      'refused credentials',
      {
        name: 'InvalidAccessKeyId',
        Code: 'InvalidAccessKeyId',
        $metadata: { httpStatusCode: 403 },
      },
      500,
    ],
    ['a failure of our own', new Error('boom'), 500],
  ])(
    'answers for %s as the cause says, keeping STORAGE_MULTIPART_ABORTED and the abort outcome',
    (_label, cause, status) => {
      const error = mapMultipartError(cause, { key: 'k', bucket: 'b', abort: 'completed' })

      expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
      expect(error.getStatus()).toBe(status)
      expect(detailsOf(error)).toMatchObject({ abort: 'completed' })
    },
  )

  it.each([null, undefined, Object.create(null) as object])(
    'maps a rejection value that has no message (%p) without throwing',
    (value) => {
      const error = mapMultipartError(value, { key: 'k', bucket: 'b' })

      expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
      // The body carries a fixed reason for a value with no message.
      expect(detailsOf(error)?.reason).toBe('rejected')
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
    })

    expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
    expect(messageOf(error)).toBe('Multipart upload failed and could not be aborted')
  })

  it('maps any other failure to STORAGE_MULTIPART_ABORTED, without the provider text', () => {
    // The body holds a fixed reason, never the provider's message.
    const original = new Error('part 2 failed')
    const error = mapMultipartError(original, { key: 'k', bucket: 'b' })

    expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
    expect(detailsOf(error)).toEqual({ key: 'k', bucket: 'b', reason: 'rejected' })
    expect(error.cause).toBeUndefined()
    expect(JSON.stringify(error.getResponse())).not.toContain('part 2 failed')
  })

  describe('what it logs', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('logs a failed upload once, under its own label, and not as a failed provider call', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      mapMultipartError(new Error('source stream broke'), {
        key: 'k',
        bucket: 'b',
        op: 'upload-multipart',
      })

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/^Multipart upload failed: op="upload-multipart" /),
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('source stream broke'))
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Provider call failed'))
    })

    it('logs nothing for a missing bucket, whose code says it all', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      mapMultipartError(
        { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } },
        { key: 'k', bucket: 'b' },
      )

      expect(warn).not.toHaveBeenCalled()
    })

    it.each([
      ['an idle source', new SourceIdleError(250)],
      ['a source that is too long', new SizeLimitError(1024, 'declared')],
    ])('logs nothing for %s', (_label, failure) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      mapMultipartError(failure, { key: 'k', bucket: 'b' })

      expect(warn).not.toHaveBeenCalled()
    })
  })
})
