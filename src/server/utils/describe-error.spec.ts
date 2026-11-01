/**
 * @fileoverview `describeError` never throws, whatever was thrown at it.
 * @layer server/utils
 */
import { runInNewContext } from 'node:vm'
import { describeError, NON_PRINTABLE_REJECTION } from './describe-error'

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
  })

  it('uses the message of an Error from another realm', () => {
    // instanceof Error is false across realms (vm, worker, Jest); the message must still be read.
    const foreign: unknown = runInNewContext('new Error("from another realm")')

    expect(foreign instanceof Error).toBe(false)
    expect(describeError(foreign)).toBe('from another realm')
  })

  it('uses a string message on a plain object', () => {
    expect(describeError({ message: 'from an object' })).toBe('from an object')
  })

  it('prints a primitive, null and undefined', () => {
    expect(describeError('kaboom')).toBe('kaboom')
    expect(describeError(42)).toBe('42')
    expect(describeError(null)).toBe('null')
    expect(describeError(undefined)).toBe('undefined')
  })

  it('falls back to the string form when message is not a string', () => {
    expect(describeError({ message: 7, toString: () => 'custom' })).toBe('custom')
  })

  it('does not throw for an object with no prototype', () => {
    // String(Object.create(null)) raises "Cannot convert object to primitive value".
    expect(describeError(Object.create(null))).toBe(NON_PRINTABLE_REJECTION)
  })

  it('does not throw when toString or Symbol.toPrimitive throws', () => {
    const throwing = {
      toString: () => {
        throw new Error('no')
      },
    }
    const primitive = {
      [Symbol.toPrimitive]: () => {
        throw new Error('no')
      },
    }

    expect(describeError(throwing)).toBe(NON_PRINTABLE_REJECTION)
    expect(describeError(primitive)).toBe(NON_PRINTABLE_REJECTION)
  })

  it('does not throw when reading message throws', () => {
    const hostile = Object.defineProperty({}, 'message', {
      get() {
        throw new Error('no')
      },
    })

    expect(describeError(hostile)).toBe(NON_PRINTABLE_REJECTION)
  })
})
