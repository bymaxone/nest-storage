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

const KEYS = { key: 'k', storedKey: 'tenant/k' }

describe('withCleanupFailure', () => {
  it('keeps the verdict code and status and adds what could not be cleaned up', () => {
    const verdict = new StorageException('STORAGE_SCAN_INFECTED', undefined, { threat: 'EICAR' })

    const error = withCleanupFailure(
      verdict,
      { key: 'a/b.bin', storedKey: 'tenant/a/b.bin' },
      new Error('delete refused'),
    ) as StorageException

    expect(error.code).toBe('STORAGE_SCAN_INFECTED')
    expect(error.getStatus()).toBe(verdict.getStatus())
    expect(detailsOf(error)).toEqual({
      threat: 'EICAR',
      key: 'a/b.bin',
      storedKey: 'tenant/a/b.bin',
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

  it('keeps the scan verdict cause on the rewritten exception', () => {
    const scanCause = new Error('scanner socket closed')
    const verdict = new StorageException(
      'STORAGE_SCAN_INCONCLUSIVE',
      undefined,
      undefined,
      undefined,
      scanCause,
    )

    expect((withCleanupFailure(verdict, KEYS, 'x') as StorageException).cause).toBe(scanCause)
  })

  it('names only the code to a client when the delete failed with a StorageException', () => {
    // The body names the code of the delete failure; what the provider said is for the log.
    const refused = new StorageException(
      'STORAGE_PROVIDER_ERROR',
      undefined,
      { reason: 'rejected' },
      undefined,
      new Error('Access Denied'),
    )

    const error = withCleanupFailure(new StorageException('STORAGE_SCAN_INFECTED'), KEYS, refused)

    expect(detailsOf(error)?.cleanupError).toBe('STORAGE_PROVIDER_ERROR')
    expect(JSON.stringify((error as StorageException).getResponse())).not.toContain('Access Denied')
  })

  describe('describeCleanupFailure, for the log', () => {
    it('gives the code and what the cause said for a StorageException', () => {
      const refused = new StorageException(
        'STORAGE_PROVIDER_ERROR',
        undefined,
        undefined,
        undefined,
        new Error('Access Denied'),
      )

      expect(describeCleanupFailure(refused)).toBe('STORAGE_PROVIDER_ERROR: Access Denied')
    })

    it('gives only the code when the StorageException has no cause', () => {
      expect(describeCleanupFailure(new StorageException('STORAGE_TIMEOUT'))).toBe(
        'STORAGE_TIMEOUT',
      )
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
