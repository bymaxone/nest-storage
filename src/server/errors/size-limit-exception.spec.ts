/**
 * @fileoverview The mapping of a size-guard failure to a typed storage error: a body longer than
 * declared or than the maximum is `STORAGE_SIZE_EXCEEDED`, a body shorter than declared is
 * `STORAGE_VALIDATION_FAILED` naming the field.
 * @layer server/errors
 */
import { SizeLimitError, SizeShortfallError } from '../utils/size-limit'
import { declaredSizeMismatch, mapSizeLimitError } from './size-limit-exception'

function bodyOf(error: { getResponse(): unknown } | undefined): { error: { code: string; details: Record<string, unknown> } } {
  return (error as { getResponse(): unknown }).getResponse() as { error: { code: string; details: Record<string, unknown> } }
}

describe('mapSizeLimitError', () => {
  it('maps a longer body to STORAGE_SIZE_EXCEEDED with the declared size', () => {
    const mapped = mapSizeLimitError(new SizeLimitError(500, 'declared'), { key: 'k', bucket: 'b' })

    expect(bodyOf(mapped).error).toMatchObject({
      code: 'STORAGE_SIZE_EXCEEDED',
      details: { key: 'k', bucket: 'b', declaredSize: 500 },
    })
  })

  it('maps a shorter body to STORAGE_VALIDATION_FAILED (400) naming size and both lengths', () => {
    const mapped = mapSizeLimitError(new SizeShortfallError(500, 120), { key: 'k', bucket: 'b' })

    expect(mapped?.getStatus()).toBe(400)
    expect(bodyOf(mapped).error).toMatchObject({
      code: 'STORAGE_VALIDATION_FAILED',
      details: {
        key: 'k',
        bucket: 'b',
        field: 'size',
        reason: 'The body is shorter than the declared size',
        declaredSize: 500,
        receivedSize: 120,
      },
    })
  })

  it('leaves any other error alone', () => {
    expect(mapSizeLimitError(new Error('boom'), {})).toBeUndefined()
  })
})

describe('declaredSizeMismatch', () => {
  it('is STORAGE_SIZE_EXCEEDED with the declared size when the body is longer', () => {
    expect(bodyOf(declaredSizeMismatch(500, 501, { key: 'k' })).error).toMatchObject({
      code: 'STORAGE_SIZE_EXCEEDED',
      details: { key: 'k', declaredSize: 500 },
    })
  })

  it('is STORAGE_VALIDATION_FAILED naming size and both lengths when the body is shorter', () => {
    expect(bodyOf(declaredSizeMismatch(500, 499, { key: 'k' })).error).toMatchObject({
      code: 'STORAGE_VALIDATION_FAILED',
      details: { key: 'k', field: 'size', declaredSize: 500, receivedSize: 499 },
    })
  })
})

