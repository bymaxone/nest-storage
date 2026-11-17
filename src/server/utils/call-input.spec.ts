/**
 * @fileoverview The per-call inputs that are checked for their type before they are used: the bucket
 * and the abort signal. A refusal names the field and the kind of value and nothing of the value.
 * @layer server/utils
 */
import { assertAbortSignal, resolveBucket } from './call-input'

const SENTINEL = 'SENTINEL-CALL-INPUT'

/** A value the caller should never have passed, whatever its kind: none of them may be echoed. */
const hostile: [string, unknown][] = [
  ['a number', 12345],
  ['true', true],
  ['a Symbol', Symbol(SENTINEL)],
  ['a function', function SENTINEL_FN(): void {}],
  ['an array', [SENTINEL]],
  ['an object', { toString: (): string => SENTINEL }],
  ['a BigInt', 5n],
  ['a Date', new Date(0)],
]

function refusal(run: () => unknown): { code: unknown; status: unknown; response: string; field: unknown } {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  const exception = thrown as { code?: unknown; status?: unknown; getResponse?: () => unknown }
  const response = exception.getResponse?.() as { error?: { details?: { field?: unknown } } } | undefined
  return {
    code: exception.code,
    status: exception.status,
    response: JSON.stringify(response),
    field: response?.error?.details?.field,
  }
}

describe('resolveBucket', () => {
  it('uses the per-call bucket when it is a string, and the module default when there is none', () => {
    expect(resolveBucket('per-call', 'default')).toBe('per-call')
    expect(resolveBucket(undefined, 'default')).toBe('default')
    expect(resolveBucket(null, 'default')).toBe('default')
  })

  it('reports an undefined bucket when neither the call nor the module names one', () => {
    expect(refusal(() => resolveBucket(undefined, ''))).toMatchObject({ code: 'STORAGE_BUCKET_UNDEFINED' })
    expect(refusal(() => resolveBucket('', 'default'))).toMatchObject({ code: 'STORAGE_BUCKET_UNDEFINED' })
  })

  it.each(hostile)('refuses %s as a validation error that names the bucket and echoes nothing', (_what, value) => {
    const result = refusal(() => resolveBucket(value, 'default'))

    expect(result).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400, field: 'bucket' })
    expect(result.response).not.toContain('SENTINEL')
    expect(result.response).not.toContain('12345')
  })

  it('does not read a getter on the value it refuses', () => {
    const reads: string[] = []
    const value = {
      get secret(): string {
        reads.push('secret')
        return SENTINEL
      },
    }

    refusal(() => resolveBucket(value, 'default'))

    expect(reads).toEqual([])
  })
})

describe('assertAbortSignal', () => {
  it('accepts no signal and a real one', () => {
    expect(() => {
      assertAbortSignal(undefined)
    }).not.toThrow()
    expect(() => {
      assertAbortSignal(null)
    }).not.toThrow()
    expect(() => {
      assertAbortSignal(new AbortController().signal)
    }).not.toThrow()
  })

  it('refuses an object whose property getter throws, as a validation error, not as the getter\'s own error', () => {
    const throwing = { get aborted(): boolean { throw new Error('getter ran') }, addEventListener: (): void => undefined }
    const throwingListener = { aborted: false, get addEventListener(): () => void { throw new Error('getter ran') } }

    for (const value of [throwing, throwingListener]) {
      expect(refusal(() => { assertAbortSignal(value) })).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400, field: 'abortSignal' })
    }
  })

  it.each([...hostile, ['a string', SENTINEL], ['an empty object', {}], ['an object with only aborted', { aborted: false }]] as [string, unknown][])(
    'refuses %s as a validation error that names the abort signal and echoes nothing',
    (_what, value) => {
      const result = refusal(() => {
        assertAbortSignal(value)
      })

      expect(result).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400, field: 'abortSignal' })
      expect(result.response).not.toContain('SENTINEL')
    },
  )
})
