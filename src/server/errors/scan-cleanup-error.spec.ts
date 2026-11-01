/**
 * @fileoverview The error for an object a post-upload scan rejected and that could not be removed.
 * @layer server/errors
 */
import { StorageException } from './storage-exception'
import { withCleanupFailure } from './scan-cleanup-error'

function detailsOf(error: unknown): Record<string, unknown> | undefined {
  const body = (error as StorageException).getResponse() as {
    error: { details?: Record<string, unknown> }
  }
  return body.error.details
}

describe('withCleanupFailure', () => {
  it('keeps the verdict code and status and adds what could not be cleaned up', () => {
    const verdict = new StorageException('STORAGE_SCAN_INFECTED', undefined, { threat: 'EICAR' })

    const error = withCleanupFailure(
      verdict,
      'a/b.bin',
      new Error('delete refused'),
    ) as StorageException

    expect(error.code).toBe('STORAGE_SCAN_INFECTED')
    expect(error.getStatus()).toBe(verdict.getStatus())
    expect(detailsOf(error)).toEqual({
      threat: 'EICAR',
      key: 'a/b.bin',
      cleanup: 'failed',
      cleanupError: 'delete refused',
    })
  })

  it('adds the cleanup details to a verdict that had none', () => {
    const verdict = new StorageException('STORAGE_SCAN_INCONCLUSIVE')

    const error = withCleanupFailure(verdict, 'k', 'refused')

    expect(detailsOf(error)).toEqual({ key: 'k', cleanup: 'failed', cleanupError: 'refused' })
  })

  it('describes a cleanup failure that is not an Error without throwing', () => {
    const error = withCleanupFailure(
      new StorageException('STORAGE_SCAN_INFECTED'),
      'k',
      Object.create(null),
    )

    expect(detailsOf(error)?.cleanupError).toBe('non-printable rejection value')
  })

  it('returns anything that is not a StorageException unchanged', () => {
    const crash = new Error('scanner crashed')

    expect(withCleanupFailure(crash, 'k', new Error('x'))).toBe(crash)
  })
})
