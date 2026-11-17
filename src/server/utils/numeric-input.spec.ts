/**
 * @fileoverview Tests for `assertIntegerInput`: a per-call number is refused unless it is absent or a
 * whole number of at least the minimum, with the field and the reason in the error details.
 * @layer server/utils
 */
import type { StorageException } from '../errors/storage-exception'
import { assertIntegerInput } from './numeric-input'

function detailsOf(call: () => void): { code: string; details: Record<string, unknown> } {
  try {
    call()
  } catch (error) {
    const body = (error as StorageException).getResponse() as {
      error: { code: string; details: Record<string, unknown> }
    }
    return body.error
  }
  throw new Error('expected assertIntegerInput to throw')
}

describe('assertIntegerInput', () => {
  it.each([undefined, 0, 1, 1000])('accepts %p when the minimum is 0', (value) => {
    expect(() => {
      assertIntegerInput(value, 'size', 0)
    }).not.toThrow()
  })

  it.each([Number.NaN, Infinity, -Infinity, -1, 1.5, '3', null])(
    'refuses %p with STORAGE_VALIDATION_FAILED, naming the field and the minimum',
    (value) => {
      const error = detailsOf(() => {
        assertIntegerInput(value as number, 'size', 0)
      })

      expect(error.code).toBe('STORAGE_VALIDATION_FAILED')
      expect(error.details).toEqual({ field: 'size', reason: 'size must be an integer of at least 0' })
    },
  )

  it('refuses a value below a minimum of 1 and names that minimum', () => {
    const error = detailsOf(() => {
      assertIntegerInput(0, 'maxKeys', 1)
    })

    expect(error.details).toEqual({ field: 'maxKeys', reason: 'maxKeys must be an integer of at least 1' })
  })
})
