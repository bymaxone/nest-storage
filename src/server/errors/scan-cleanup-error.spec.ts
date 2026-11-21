/**
 * @fileoverview The error for an object a post-upload scan rejected and that could not be removed.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { describeCleanupFailure, withCleanupFailure } from './scan-cleanup-error'

function detailsOf(error: unknown): Record<string, unknown> | undefined {
  const body = (error as StorageException).getResponse() as {
    error: { details?: Record<string, unknown> }
  }
  return body.error.details
}

const KEYS = { key: 'k' }

describe('withCleanupFailure', () => {
  it('keeps the verdict code and status and adds what could not be cleaned up', () => {
    const verdict = new StorageException('STORAGE_SCAN_INFECTED', undefined, { threat: 'EICAR' })

    const error = withCleanupFailure(
      verdict,
      { key: 'a/b.bin' },
      new Error('delete refused'),
    ) as StorageException

    expect(error.code).toBe('STORAGE_SCAN_INFECTED')
    expect(error.getStatus()).toBe(verdict.getStatus())
    expect(detailsOf(error)).toEqual({
      threat: 'EICAR',
      key: 'a/b.bin',
      cleanup: 'failed',
      // The body carries a fixed word for the delete failure, never its message.
      cleanupError: 'UNKNOWN',
    })
  })

  it('keeps an HTTP status the scanner chose for its verdict', () => {
    const verdict = new StorageException('STORAGE_SCAN_INFECTED', HttpStatus.SERVICE_UNAVAILABLE)

    const error = withCleanupFailure(verdict, KEYS, new Error('delete refused')) as StorageException

    expect(error.getStatus()).toBe(503)
    expect(error.code).toBe('STORAGE_SCAN_INFECTED')
  })

  it("falls back to the code's own status for a status outside the HTTP enum", () => {
    const verdict = new StorageException('STORAGE_SCAN_INFECTED')
    jest.spyOn(verdict, 'getStatus').mockReturnValue(599)

    const error = withCleanupFailure(verdict, KEYS, new Error('delete refused')) as StorageException

    expect(error.getStatus()).toBe(422)
  })

  it('adds the cleanup details to a verdict that had none', () => {
    const verdict = new StorageException('STORAGE_SCAN_INCONCLUSIVE')

    const error = withCleanupFailure(verdict, KEYS, 'refused')

    expect(detailsOf(error)).toEqual({
      ...KEYS,
      cleanup: 'failed',
      cleanupError: 'UNKNOWN',
    })
  })

  it('reports a cleanup failure that is not a StorageException without throwing or quoting it', () => {
    const error = withCleanupFailure(
      new StorageException('STORAGE_SCAN_INFECTED'),
      KEYS,
      Object.create(null),
    )

    expect(detailsOf(error)?.cleanupError).toBe('UNKNOWN')
  })

  it('names only the code to a client when the delete failed with a StorageException', () => {
    // The body names the code of the delete failure; what the provider said is for the log.
    const refused = new StorageException('STORAGE_PROVIDER_ERROR', undefined, {
      reason: 'rejected',
    })

    const error = withCleanupFailure(new StorageException('STORAGE_SCAN_INFECTED'), KEYS, refused)

    expect(detailsOf(error)?.cleanupError).toBe('STORAGE_PROVIDER_ERROR')
    expect(JSON.stringify((error as StorageException).getResponse())).not.toContain('Access Denied')
  })

  describe('describeCleanupFailure, for the log', () => {
    it('gives the code of a StorageException, whose own message is generic', () => {
      const refused = new StorageException('STORAGE_PROVIDER_ERROR', undefined, {
        reason: 'rejected',
      })

      expect(describeCleanupFailure(refused)).toBe('STORAGE_PROVIDER_ERROR')
    })

    it('masks a secret, cuts the text and escapes control characters of anything else', () => {
      const failure = new Error(`denied X-Amz-Signature=abc123 a\nb ${'x'.repeat(400)}`)

      const text = describeCleanupFailure(failure)

      expect(text).toContain('X-Amz-Signature=[redacted]')
      expect(text).not.toContain('abc123')
      expect(text).not.toContain('\n')
      expect(text).toContain('a\\nb')
      expect(text.length).toBeLessThanOrEqual(300 + 20)
      expect(text).not.toContain('x'.repeat(300))
    })

    it('describes anything else by its message, without throwing', () => {
      expect(describeCleanupFailure(new Error('delete refused'))).toBe('delete refused')
      expect(describeCleanupFailure(Object.create(null))).toBe('non-printable rejection value')
    })
  })

  it('returns anything that is not a StorageException unchanged', () => {
    const crash = new Error('scanner crashed')

    expect(withCleanupFailure(crash, KEYS, new Error('x'))).toBe(crash)
  })
})
