/**
 * @fileoverview The error for an object a post-upload scan rejected and that could not be removed.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { withCleanupFailure } from './scan-cleanup-error'

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
      cleanupError: 'delete refused',
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
      cleanupError: 'refused',
    })
  })

  it('describes a cleanup failure that is not an Error without throwing', () => {
    const error = withCleanupFailure(
      new StorageException('STORAGE_SCAN_INFECTED'),
      KEYS,
      Object.create(null),
    )

    expect(detailsOf(error)?.cleanupError).toBe('non-printable rejection value')
  })

  it('names the provider cause when the delete failed with a StorageException', () => {
    // `StorageException.message` is the generic 'Storage Exception'; the cause is in its details.
    const refused = new StorageException('STORAGE_PROVIDER_ERROR', undefined, {
      awsMessage: 'Access Denied',
    })

    const error = withCleanupFailure(new StorageException('STORAGE_SCAN_INFECTED'), KEYS, refused)

    expect(detailsOf(error)?.cleanupError).toBe('STORAGE_PROVIDER_ERROR: Access Denied')
  })

  it('names only the code when the delete failure carries no provider message', () => {
    const error = withCleanupFailure(
      new StorageException('STORAGE_SCAN_INFECTED'),
      KEYS,
      new StorageException('STORAGE_TIMEOUT'),
    )

    expect(detailsOf(error)?.cleanupError).toBe('STORAGE_TIMEOUT')
  })

  it('returns anything that is not a StorageException unchanged', () => {
    const crash = new Error('scanner crashed')

    expect(withCleanupFailure(crash, KEYS, new Error('x'))).toBe(crash)
  })
})
