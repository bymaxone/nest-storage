/**
 * @fileoverview Rows for the root prototype guard: planted string and symbol keys, changed
 * descriptors of the standard names, and built-ins replaced after the module loaded.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import type * as Guard from './prototype-guard'
import { assertCleanRoot } from './prototype-guard'

const root = Object.prototype as unknown as Record<string | symbol, unknown>

function refusal(): StorageException {
  try {
    assertCleanRoot()
  } catch (error) {
    return error as StorageException
  }
  throw new Error('the guard accepted a dirty root')
}

describe('assertCleanRoot', () => {
  it('accepts the root as the runtime created it', () => {
    // Nothing planted: the test runner's own symbol key is exempt and every descriptor is the original.
    expect(() => {
      assertCleanRoot()
    }).not.toThrow()
  })

  it.each(['ACL', 'Bucket', 'sessionToken', 'endpointProvider', 'protocol', 'then', 'x'])(
    'refuses a string key %s planted on the root, naming no key',
    (key) => {
      Object.defineProperty(Object.prototype, key, { value: 1, configurable: true, writable: true })
      try {
        const error = refusal()
        expect(error).toBeInstanceOf(StorageException)
        expect(error.code).toBe('STORAGE_VALIDATION_FAILED')
        expect(JSON.stringify(error.getResponse())).not.toContain(key)
      } finally {
        Reflect.deleteProperty(Object.prototype, key)
      }
    },
  )

  it('refuses an enumerable key assigned on the root', () => {
    // Plain assignment is the reachable plant: it is enumerable, so a `for in` merge copies it.
    Object.defineProperty(Object.prototype, 'Tagging', {
      value: 'a=b',
      configurable: true,
      writable: true,
      enumerable: true,
    })
    try {
      expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
    } finally {
      Reflect.deleteProperty(Object.prototype, 'Tagging')
    }
  })

  it('refuses a symbol key other than the runner own', () => {
    const planted = Symbol('planted')
    root[planted] = 1
    try {
      expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
    } finally {
      Reflect.deleteProperty(Object.prototype, planted)
    }
  })

  it('refuses a symbol key whose description is empty', () => {
    const planted = Symbol()
    root[planted] = 1
    try {
      expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
    } finally {
      Reflect.deleteProperty(Object.prototype, planted)
    }
  })

  it.each(['hasOwnProperty', 'toString', 'constructor', 'valueOf', 'isPrototypeOf'])(
    'refuses the standard name %s overwritten with another value',
    (name) => {
      const original = descriptorOf(Object.prototype, name)
      Object.defineProperty(Object.prototype, name, { ...original, value: () => 'planted' })
      try {
        expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
      } finally {
        Object.defineProperty(Object.prototype, name, original)
      }
    },
  )

  it('refuses a standard name made read-only or non-enumerable-flag-changed', () => {
    const original = descriptorOf(Object.prototype, 'toString')
    Object.defineProperty(Object.prototype, 'toString', { ...original, enumerable: true })
    try {
      expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
    } finally {
      Object.defineProperty(Object.prototype, 'toString', original)
    }
  })

  it('refuses a standard name replaced by an accessor', () => {
    const original = descriptorOf(Object.prototype, 'valueOf')
    Object.defineProperty(Object.prototype, 'valueOf', {
      get: () => original.value as unknown,
      configurable: true,
    })
    try {
      expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
    } finally {
      Object.defineProperty(Object.prototype, 'valueOf', original)
    }
  })

  it('refuses a standard name that was deleted', () => {
    const original = descriptorOf(Object.prototype, 'toLocaleString')
    Reflect.deleteProperty(Object.prototype, 'toLocaleString')
    try {
      expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
    } finally {
      Object.defineProperty(Object.prototype, 'toLocaleString', original)
    }
  })

  it('reads a planted descriptor field through the own check, not through the descriptor prototype', () => {
    // A key planted on the root makes every descriptor object appear to carry it; the guard is
    // already refusing, and it must also not throw anything but the refusal while it reads fields.
    Object.defineProperty(Object.prototype, 'get', {
      get() {
        throw new Error('planted getter was read')
      },
      configurable: true,
    })
    try {
      expect(refusal().code).toBe('STORAGE_VALIDATION_FAILED')
    } finally {
      Reflect.deleteProperty(Object.prototype, 'get')
    }
  })

  describe('built-ins replaced after the module loaded', () => {
    const iterator = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object
    const setIterator = Object.getPrototypeOf(new Set()[Symbol.iterator]()) as object
    const mapIterator = Object.getPrototypeOf(new Map()[Symbol.iterator]()) as object
    const replaced: [string, () => () => void][] = [
      ['Object.hasOwn', () => swap(Object, 'hasOwn', () => true)],
      [
        'Object.getOwnPropertyDescriptor',
        () => swap(Object, 'getOwnPropertyDescriptor', () => undefined),
      ],
      ['Object.keys', () => swap(Object, 'keys', () => [])],
      ['Reflect.ownKeys', () => swap(Reflect, 'ownKeys', () => [])],
      ['Reflect.apply', () => swap(Reflect, 'apply', () => false)],
      ['Reflect.get', () => swap(Reflect, 'get', () => undefined)],
      ['Set.prototype.has', () => swap(Set.prototype, 'has', () => true)],
      ['Map.prototype.get', () => swap(Map.prototype, 'get', () => undefined)],
      ['Array.prototype.some', () => swap(Array.prototype, 'some', () => false)],
      ['Array.prototype.map', () => swap(Array.prototype, 'map', () => [])],
      [
        'Array.prototype[Symbol.iterator]',
        () => swap(Array.prototype, Symbol.iterator, wrapped(Array.prototype[Symbol.iterator])),
      ],
      ['String.prototype.indexOf', () => swap(String.prototype, 'indexOf', () => -1)],
      [
        'String.prototype[Symbol.iterator]',
        () => swap(String.prototype, Symbol.iterator, () => [][Symbol.iterator]()),
      ],
      ['RegExp.prototype[Symbol.replace]', () => swap(RegExp.prototype, Symbol.replace, () => '')],
      ['RegExp.prototype[Symbol.split]', () => swap(RegExp.prototype, Symbol.split, () => [])],
      ['RegExp.prototype.test', () => swap(RegExp.prototype, 'test', () => true)],
      [
        'the iterator prototype',
        () =>
          swap(iterator, Symbol.iterator, function (this: unknown) {
            return this
          }),
      ],
      ['Function.prototype.bind', () => swap(Function.prototype, 'bind', () => () => false)],
      ['Function.prototype.apply', () => swap(Function.prototype, 'apply', () => false)],
      [
        'Symbol.prototype description',
        () => swapGetter(Symbol.prototype, 'description', () => 'planted'),
      ],
      ['Number.isInteger', () => swap(Number, 'isInteger', () => true)],
      ['Number.isFinite', () => swap(Number, 'isFinite', () => true)],
      ['Math.min', () => swap(Math, 'min', () => 0)],
      ['JSON.stringify', () => swap(JSON, 'stringify', () => '')],
      ['Buffer.byteLength', () => swap(Buffer, 'byteLength', () => 0)],
      ['Buffer.concat', () => swap(Buffer, 'concat', () => Buffer.alloc(0))],
      ['Buffer.isBuffer', () => swap(Buffer, 'isBuffer', () => true)],
      ['Buffer.from', () => swap(Buffer, 'from', () => Buffer.alloc(0))],
      ['Buffer.alloc', () => swap(Buffer, 'alloc', () => Buffer.alloc(0))],
      ['encodeURIComponent', () => swapGlobal('encodeURIComponent', () => '')],
      ['ArrayBuffer.isView', () => swap(ArrayBuffer, 'isView', () => true)],
      ['the Set iterator prototype', () => swap(setIterator, 'next', () => ({ done: true }))],
      ['the Map iterator prototype', () => swap(mapIterator, 'next', () => ({ done: true }))],
      ['the Set binding', () => swapGlobal('Set', class Other {})],
      ['the Buffer binding', () => swapGlobal('Buffer', class Other {})],
    ]

    it.each(replaced)(
      'refuses with a count of replaced built-ins when %s is replaced',
      (_name, install) => {
        // The replacement can break the assertion library itself, so the verdict is read after it is undone.
        const restore = install()
        let error: StorageException | undefined
        try {
          assertCleanRoot()
        } catch (thrown) {
          error = thrown as StorageException
        } finally {
          restore()
        }
        expect(error?.code).toBe('STORAGE_VALIDATION_FAILED')
        const details = (
          error?.getResponse() as { error: { details: { planted: number; replaced: number } } }
        ).error.details
        expect(details.replaced).toBeGreaterThan(0)
        expect(details.planted).toBe(0)
      },
    )

    it('still names a planted key by count when a built-in is replaced too', () => {
      const restore = swap(Object, 'hasOwn', () => true)
      Object.defineProperty(Object.prototype, 'ACL', {
        value: 'public-read',
        configurable: true,
        writable: true,
      })
      try {
        const details = (refusal().getResponse() as { error: { details: { planted: number } } })
          .error.details
        expect(details.planted).toBe(1)
      } finally {
        Reflect.deleteProperty(Object.prototype, 'ACL')
        restore()
      }
    })
  })

  it('refuses at every use when a built-in could not be read at load', async () => {
    // A guard that could not take its baseline cannot vouch for the runtime, so it fails closed.
    const original = Reflect.ownKeys
    Reflect.ownKeys = (target: object) => {
      if (target === Function.prototype) {
        throw new Error('unreadable')
      }
      return original(target)
    }
    let loaded: typeof Guard | undefined
    try {
      await jest.isolateModulesAsync(async () => {
        loaded = await import('./prototype-guard')
      })
    } finally {
      Reflect.ownKeys = original
    }
    let thrown: unknown
    try {
      loaded?.assertCleanRoot()
    } catch (error) {
      thrown = error
    }
    // The isolated registry has its own exception class, so the code is what identifies it.
    expect(thrown).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
  })

  it('builds a fresh refusal on every call, carrying counts and no key', () => {
    Object.defineProperty(Object.prototype, 'ACL', {
      value: 'public-read',
      configurable: true,
      writable: true,
    })
    try {
      const first = refusal()
      const second = refusal()
      expect(first).not.toBe(second)
      expect(JSON.stringify(first.getResponse())).not.toContain('ACL')
      expect(JSON.stringify(first.getResponse())).toContain('"planted":1')
    } finally {
      Reflect.deleteProperty(Object.prototype, 'ACL')
    }
  })
})

const define = Object.defineProperty.bind(Object)

function wrapped(original: (this: unknown) => unknown): () => unknown {
  return function (this: unknown) {
    return original.call(this)
  }
}

function swapGlobal(name: string, value: unknown): () => void {
  const original = descriptorOf(globalThis, name)
  define(globalThis, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: original.enumerable === true,
  })
  return () => {
    define(globalThis, name, original)
  }
}

function swap(target: object, name: PropertyKey, value: unknown): () => void {
  const original = descriptorOf(target, name)
  Object.defineProperty(target, name, { ...original, value })
  return () => {
    Object.defineProperty(target, name, original)
  }
}

function swapGetter(target: object, name: string, value: () => unknown): () => void {
  const original = descriptorOf(target, name)
  Object.defineProperty(target, name, { ...original, get: value })
  return () => {
    Object.defineProperty(target, name, original)
  }
}

function descriptorOf(target: object, name: PropertyKey): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(target, name)
  if (descriptor === undefined) {
    throw new Error(`no own property ${String(name)}`)
  }
  return descriptor
}
