/**
 * @fileoverview Tests for the `maxBytes` guard of a buffered download: which values are refused, which
 * are accepted, and what the refusal says.
 * @layer server/utils
 */
import type { StorageException } from '../errors/storage-exception'
import { assertMaxBytes } from './download-buffer'

/** The code and details of the StorageException `fn` throws, or fails the test when it does not throw. */
function refusal(fn: () => void): { code: string; details: Record<string, unknown> } {
  try {
    fn()
  } catch (err) {
    const body = (err as StorageException).getResponse() as {
      error: { code: string; details: Record<string, unknown> }
    }
    return { code: body.error.code, details: body.error.details }
  }
  throw new Error('expected the call to throw')
}

describe('assertMaxBytes', () => {
  it.each([undefined, 1, 2, 1_000_000])('accepts %p', (value) => {
    // No limit, and any integer from 1 up, is a valid limit: 1 itself is the smallest.
    expect(() => {
      assertMaxBytes(value)
    }).not.toThrow()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %p before any request', (value) => {
    // Zero, negative, fractional and non-finite limits cannot bound a body.
    expect(refusal(() => {
      assertMaxBytes(value)
    })).toEqual({
      code: 'STORAGE_VALIDATION_FAILED',
      details: { reason: 'maxBytes must be an integer >= 1' },
    })
  })
})
