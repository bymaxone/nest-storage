/**
 * @fileoverview A host function that throws, rejects or hands back a faulty thenable changes nothing about
 * the call that invoked it.
 * @layer server/utils
 */
import { absorb } from './absorb'

describe('absorb', () => {
  it('calls the function once', () => {
    const call = jest.fn(() => 'value')

    absorb(call)

    expect(call).toHaveBeenCalledTimes(1)
  })

  it('absorbs a synchronous throw', () => {
    expect(() => {
      absorb(() => {
        throw new Error('host')
      })
    }).not.toThrow()
  })

  it('absorbs a rejected promise the function returns', async () => {
    const rejected = Promise.reject(new Error('host'))
    const handled = jest.fn()
    rejected.catch(handled)

    expect(() => {
      absorb(() => rejected)
    }).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
    expect(handled).toHaveBeenCalledTimes(1)
  })

  it('absorbs a thenable whose then throws and one that rejects', async () => {
    const throwing = { then: (): never => { throw new Error('then') } }
    const rejecting = { then: (_ok: unknown, fail: (e: unknown) => void): void => { fail(new Error('no')) } }

    expect(() => {
      absorb(() => throwing)
      absorb(() => rejecting)
    }).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
  })
})
