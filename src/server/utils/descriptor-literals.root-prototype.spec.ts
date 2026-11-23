/**
 * @fileoverview The two property descriptors the library defines are built without a prototype, so a
 * key planted on the root object prototype can neither turn them into something else nor make the
 * definition throw: the credentials accessor of the resolved options and the code of a provider
 * failure the logger receives.
 * @layer server/utils
 */
import { applyDefaults } from '../config/apply-defaults'
import { failureError } from './provider-failure-log'

const options = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

/** Plants `name` on the root prototype for the duration of `run`, and always takes it away again. */
function planted<T>(name: string, value: unknown, run: () => T): T {
  Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(Object.prototype, name)
  }
}

describe('descriptors built by the library ignore the root prototype', () => {
  it.each(['value', 'writable', 'set'])(
    'keeps the credentials accessor a read-only accessor when %s is planted',
    (name) => {
      // An inherited `value` or `writable` makes the definition throw, and an inherited `set` gives
      // the accessor a setter the planting code controls.
      const calls: unknown[] = []
      const resolved = planted(name, name === 'set' ? (v: unknown) => calls.push(v) : 1, () =>
        applyDefaults(options),
      )
      const descriptor = Object.getOwnPropertyDescriptor(resolved, 'credentials')
      expect(descriptor?.get).toBeDefined()
      expect(descriptor?.set).toBeUndefined()
      expect(descriptor?.enumerable).toBe(false)
      expect(descriptor?.configurable).toBe(false)
      expect(resolved.credentials.accessKeyId).toBe('k')
      expect(calls).toHaveLength(0)
    },
  )

  it.each(['get', 'set'])('still builds the failure error when %s is planted', (name) => {
    // An inherited accessor key makes the definition of a data property throw a TypeError.
    const error = planted(
      name,
      () => 1,
      () => failureError({ name: 'X', Code: 'NoSuchKey' }),
    )
    expect(error).toBeInstanceOf(Error)
    expect(Object.getOwnPropertyDescriptor(error, 'awsCode')).toEqual({
      value: 'NoSuchKey',
      writable: false,
      enumerable: true,
      configurable: false,
    })
  })
})
