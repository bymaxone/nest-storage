/**
 * @fileoverview Mapping of a failed multipart upload: an idle source is a timeout, anything
 * else an aborted multipart upload.
 * @layer server/errors
 */
import { SourceIdleError } from '../utils/idle-timeout'
import { mapMultipartError } from './multipart-error-mapper'

function detailsOf(error: { getResponse(): unknown }): Record<string, unknown> | undefined {
  return (error.getResponse() as { error?: { details?: Record<string, unknown> } }).error?.details
}

describe('mapMultipartError', () => {
  it('maps an idle source to STORAGE_TIMEOUT (504) with the phase and the limit', () => {
    const error = mapMultipartError(new SourceIdleError(250), { key: 'k', bucket: 'b' })

    expect(error.code).toBe('STORAGE_TIMEOUT')
    expect(error.getStatus()).toBe(504)
    expect(detailsOf(error)).toEqual({ key: 'k', bucket: 'b', phase: 'source-idle', idleMs: 250 })
  })

  it.each([null, undefined, Object.create(null) as object])(
    'maps a rejection value that has no message (%p) without throwing',
    (value) => {
      const error = mapMultipartError(value, { key: 'k', bucket: 'b' })

      expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
      expect(typeof detailsOf(error)?.awsMessage).toBe('string')
    },
  )

  it('maps any other failure to STORAGE_MULTIPART_ABORTED with the provider message', () => {
    const error = mapMultipartError(new Error('part 2 failed'), { key: 'k', bucket: 'b' })

    expect(error.code).toBe('STORAGE_MULTIPART_ABORTED')
    expect(detailsOf(error)).toEqual({ key: 'k', bucket: 'b', awsMessage: 'part 2 failed' })
  })
})
