/**
 * @fileoverview `readOnce` reads each named field of a request exactly once and returns a plain copy, so a
 * getter that answers differently on a later read has no later read to answer.
 * @layer server/utils
 */
import { readOnce } from './read-once'

describe('readOnce', () => {
  it('reads each named field once and copies what it read', () => {
    // A getter that counts its reads stands for any value the caller can change between two reads.
    const reads: string[] = []
    const request = {
      get a(): string {
        reads.push('a')
        return 'A'
      },
      get b(): string {
        reads.push('b')
        return 'B'
      },
      c: 'C',
    }

    const copy = readOnce(request, ['a', 'b'])

    expect(reads).toEqual(['a', 'b'])
    expect(copy).toEqual({ a: 'A', b: 'B' })
    expect(Object.getOwnPropertyDescriptor(copy, 'a')).toMatchObject({ value: 'A' })
  })

  it('leaves out the fields it was not asked for and gives undefined for one the request lacks', () => {
    const request: { a?: string; c: string } = { c: 'C' }

    const copy = readOnce(request, ['a'])

    expect(copy).toEqual({ a: undefined })
    expect('c' in copy).toBe(false)
  })
})
