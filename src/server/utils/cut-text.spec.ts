/**
 * @fileoverview `cutText` keeps what fits and never leaves half of a surrogate pair.
 * @layer server/utils
 */
import { cutText } from './cut-text'

const EMOJI = '\u{1F600}'

describe('cutText', () => {
  it('returns a string that fits as it is', () => {
    expect(cutText('abc', 3)).toBe('abc')
    expect(cutText('', 3)).toBe('')
    expect(cutText(`a${EMOJI}`, 3)).toBe(`a${EMOJI}`)
  })

  it('cuts a longer string to the length', () => {
    expect(cutText('abcdef', 3)).toBe('abc')
  })

  it('drops a pair whole when the cut falls between its halves', () => {
    expect(cutText(`ab${EMOJI}c`, 3)).toBe('ab')
  })

  it('keeps a pair that ends exactly at the cut', () => {
    expect(cutText(`ab${EMOJI}c`, 4)).toBe(`ab${EMOJI}`)
  })

  it('keeps a lone low surrogate that is not half of a pair at the cut', () => {
    expect(cutText('a\uDE00bc', 3)).toBe('a\uDE00b')
  })
})
