/**
 * @fileoverview The details of a failed call repeat only the identifiers the caller gave, as strings of at
 * most 1024 characters.
 * @layer server/utils
 */
import { MAX_CALLER_TEXT_LENGTH, callDetails, callerFields } from './call-details'

describe('callerFields', () => {
  it('keeps a string of exactly 1024 characters and leaves out one of 1025', () => {
    const fields = callerFields({ at: 'a'.repeat(1024), over: 'a'.repeat(1025) })

    expect(MAX_CALLER_TEXT_LENGTH).toBe(1024)
    expect(Object.keys(fields)).toEqual(['at'])
  })

  it('keeps an empty string', () => {
    expect(callerFields({ key: '' })).toEqual({ key: '' })
  })

  it.each([undefined, null, 5, true, {}, ['x'], Symbol('s')])('leaves out %p, which is not a string', (value) => {
    expect(callerFields({ key: value })).toEqual({})
  })
})

describe('callDetails', () => {
  it('puts the operation after the caller fields and the extra details after both', () => {
    expect(callDetails('head', { key: 'k', bucket: undefined }, { stored: true })).toEqual({
      key: 'k',
      op: 'head',
      stored: true,
    })
  })

  it('carries the operation alone when the caller gave nothing', () => {
    expect(callDetails('list', {})).toEqual({ op: 'list' })
  })
})
