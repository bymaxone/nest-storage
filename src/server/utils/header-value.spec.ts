/**
 * @fileoverview Tests for the header-value guards: what is accepted, what is refused, and that an
 * error never repeats the offending value.
 * @layer server/utils
 */
import type { StorageException } from '../errors/storage-exception'
import { assertHeaderValues, assertMetadata, isHeaderValue } from './header-value'

const VALUE_REASON = 'must be a string of tab, space and printable ASCII characters'
const KEY_REASON =
  "every key must be a non-empty header name of letters, digits and the characters !#$%&'*+-.^_`|~"

/** The details of the StorageException `fn` throws, or fails the test when it does not throw. */
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

/** Every character class QA probed, plus the neighbours of each boundary. */
const REFUSED: readonly (readonly [string, string])[] = [
  ['CR', 'a\rb'],
  ['LF', 'a\nb'],
  ['CRLF injection', 'a\r\nX-Injected: 1'],
  ['NUL', 'a\u0000b'],
  ['C0 control', 'a\u0001b'],
  ['unit separator', 'a\u001Fb'],
  ['vertical tab', 'a\u000Bb'],
  ['form feed', 'a\u000Cb'],
  ['DEL', 'a\u007Fb'],
  ['C1 control', 'a\u0080b'],
  ['Latin-1 letter', 'café'],
  ['no-break space', 'a b'],
  ['beyond Latin-1', 'a日'],
  ['emoji', 'a\u{1F600}'],
  ['line separator', 'a b'],
]

const ACCEPTED: readonly (readonly [string, string])[] = [
  ['empty', ''],
  ['plain', 'text/plain'],
  ['tab and space', 'a\tb c'],
  ['the whole printable range', ' !"#$%&\'()*+,-./0123456789:;<=>?@[\\]^_`{|}~ABCxyz'],
  ['a percent-encoded filename', "attachment; filename*=UTF-8''caf%C3%A9.pdf"],
]

describe('isHeaderValue', () => {
  it.each(ACCEPTED)('accepts %s', (_label, value) => {
    expect(isHeaderValue(value)).toBe(true)
  })

  it.each(REFUSED)('refuses %s', (_label, value) => {
    expect(isHeaderValue(value)).toBe(false)
  })

  it.each([undefined, null, 5, {}, ['a']])('refuses a non-string %p', (value) => {
    expect(isHeaderValue(value)).toBe(false)
  })
})

describe('assertHeaderValues', () => {
  it('passes when every value is a header value or absent', () => {
    expect(() => {
      assertHeaderValues({ cacheControl: 'no-cache', contentDisposition: undefined })
    }).not.toThrow()
  })

  it.each(REFUSED)(
    'throws STORAGE_VALIDATION_FAILED for %s, naming the field and not the value',
    (_label, value) => {
      const { code, details } = refusal(() => {
        assertHeaderValues({ ok: 'fine', contentType: value })
      })

      expect(code).toBe('STORAGE_VALIDATION_FAILED')
      expect(details.field).toBe('contentType')
      expect(details.reason).toBe(VALUE_REASON)
      expect(JSON.stringify(details)).not.toContain(value)
    },
  )

  it('reports the first offending field', () => {
    expect(
      refusal(() => {
        assertHeaderValues({ a: 'x\ny', b: 'x\ry' })
      }).details.field,
    ).toBe('a')
  })
})

describe('assertMetadata', () => {
  it('passes an absent table, an empty table and ordinary entries', () => {
    expect(() => {
      assertMetadata(undefined)
    }).not.toThrow()
    expect(() => {
      assertMetadata({})
    }).not.toThrow()
    expect(() => {
      assertMetadata({ 'Order-Id': '42', owner: 'caf%C3%A9' })
    }).not.toThrow()
  })

  it.each([
    ['an empty key', { '': 'v' }],
    ['a key with a colon', { 'a:b': 'v' }],
    ['a key with a space', { 'a b': 'v' }],
    ['a key with CRLF', { 'a\r\nx': 'v' }],
    ['a key with a slash', { 'a/b': 'v' }],
    ['a non-ASCII key', { café: 'v' }],
  ])('refuses %s', (_label, metadata) => {
    const { code, details } = refusal(() => {
      assertMetadata(metadata)
    })

    expect(code).toBe('STORAGE_VALIDATION_FAILED')
    expect(details).toStrictEqual({ field: 'metadata', reason: KEY_REASON })
  })

  it.each(REFUSED)('refuses a value with %s, without repeating it', (_label, value) => {
    const { details } = refusal(() => {
      assertMetadata({ k: value })
    })

    expect(details).toStrictEqual({ field: 'metadata', reason: VALUE_REASON })
    expect(JSON.stringify(details)).not.toContain(value)
  })

  it('accepts every token character in a key, in either case', () => {
    expect(() => {
      assertMetadata({ "Aa09!#$%&'*+-.^_`|~": 'v' })
    }).not.toThrow()
  })
})
