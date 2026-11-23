/**
 * @fileoverview `readOnce` reads each named field of a request exactly once and returns a plain copy, so a
 * getter that answers differently on a later read has no later read to answer.
 * @layer server/utils
 */
import { runInNewContext } from 'node:vm'
import { StorageException } from '../errors/storage-exception'
import { readField, readOnce } from './read-once'

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

  it('leaves out the fields it was not asked for and one the request does not set', () => {
    const request: { a?: string; c: string } = { c: 'C' }

    const copy = readOnce(request, ['a'])

    expect({ ...copy }).toStrictEqual({})
    expect('c' in copy).toBe(false)
  })

  it('wraps an error thrown by a field, with the error as the cause and none of its text in the response', () => {
    const failure = new Error('SENTINEL field getter ran')
    const request = {
      get a(): string {
        throw failure
      },
    }
    let thrown: unknown
    try {
      readOnce(request, ['a'])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(StorageException)
    expect((thrown as StorageException).cause).toBe(failure)
    expect(JSON.stringify((thrown as StorageException).getResponse())).not.toContain('SENTINEL')
    expect((thrown as StorageException).getResponse()).toMatchObject({
      error: {
        code: 'STORAGE_VALIDATION_FAILED',
        details: { reason: 'the request could not be read' },
      },
    })
  })
})

describe('readOnce into an object the caller passes', () => {
  it('leaves the fields read before one that throws in the object it fills', () => {
    const into: { a?: string; c?: string } = {}
    const request = {
      a: 'first',
      get b(): string {
        throw new Error('field getter ran')
      },
      c: 'never read',
    }

    expect(() => readOnce(request, ['a', 'b', 'c'], into)).toThrow()
    expect({ ...into }).toStrictEqual({ a: 'first' })
  })

  it('reads a field a class supplies on its own prototype, once', () => {
    let reads = 0
    class Request {
      get a(): string {
        reads += 1
        return 'from-class'
      }
    }

    expect({ ...readOnce(new Request(), ['a']) }).toStrictEqual({ a: 'from-class' })
    expect(reads).toBe(1)
  })
})

describe('a key planted on Object.prototype', () => {
  const planted = ['publicRead', 'bucket', 'mimeWhitelist', 'accessKeyId'] as const

  beforeEach(() => {
    for (const key of planted) {
      Object.defineProperty(Object.prototype, key, {
        value: 'PLANTED',
        configurable: true,
        writable: true,
        enumerable: false,
      })
    }
  })

  afterEach(() => {
    for (const key of planted) Reflect.deleteProperty(Object.prototype, key)
  })

  it('is not read as a field of a plain request, by readOnce or readField', () => {
    const request = { key: 'k' }

    expect(readField(request, 'publicRead')).toBeUndefined()
    expect({ ...readOnce(request as Record<string, unknown>, ['key', ...planted]) }).toStrictEqual({
      key: 'k',
    })
  })

  it('is not read from the copy, which has no prototype', () => {
    const copy: Record<string, unknown> = readOnce({ key: 'k' }, ['key'])

    expect(Object.getPrototypeOf(copy)).toBeNull()
    expect(copy.publicRead).toBeUndefined()
  })

  it('is read when the request owns it, even as undefined or as a different value', () => {
    expect(readField({ publicRead: false }, 'publicRead')).toBe(false)
    const bare: object = Object.create(null, { bucket: { value: 'mine' } }) as object

    expect(readField(bare, 'bucket')).toBe('mine')
  })

  it('does not hide a field a class supplies on its own prototype, or one an own getter answers', () => {
    class Options {
      get bucket(): string {
        return ['from', 'class'].join('-')
      }
    }
    const withGetter = {
      get publicRead(): boolean {
        return true
      },
    }

    const derived: object = Object.create(new Options()) as object

    expect(readField(new Options(), 'bucket')).toBe('from-class')
    expect(readField(withGetter, 'publicRead')).toBe(true)
    expect(readField(derived, 'bucket')).toBe('from-class')
  })

  it('still ignores a planted key when the constructor of the root was overwritten', () => {
    Object.defineProperty(Object.prototype, 'constructor', {
      value: function Replaced() {
        return undefined
      },
      configurable: true,
      writable: true,
    })
    try {
      expect(readField({ key: 'k' }, 'publicRead')).toBeUndefined()
      expect(readField({ publicRead: false }, 'publicRead')).toBe(false)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'constructor')
    }
  })

  it('still ignores a planted key when the methods of the root were replaced', () => {
    const own = Object.getOwnPropertyDescriptor(Object.prototype, 'hasOwnProperty')
    Object.defineProperty(Object.prototype, 'hasOwnProperty', {
      value: () => true,
      configurable: true,
    })
    try {
      expect(readField({ key: 'k' }, 'publicRead')).toBeUndefined()
      expect(readField({ publicRead: false }, 'publicRead')).toBe(false)
    } finally {
      if (own) Object.defineProperty(Object.prototype, 'hasOwnProperty', own)
    }
  })

  it('ignores a key planted on the root of another realm, and still reads what its objects own', () => {
    const foreign = runInNewContext(
      'Object.defineProperty(Object.prototype, "publicRead", { value: true, configurable: true }); ({ key: "k", bucket: "mine" })',
    ) as object

    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype)
    expect(readField(foreign, 'publicRead')).toBeUndefined()
    expect(readField(foreign, 'bucket')).toBe('mine')
    expect({
      ...readOnce(foreign as Record<string, unknown>, ['key', 'publicRead']),
    }).toStrictEqual({ key: 'k' })
  })

  it('does not read a field supplied only by a parent that has no prototype, the one trade-off of the rule', () => {
    const parent = Object.create(null, { bucket: { value: 'from-parent' } }) as object
    const child: object = Object.create(parent) as object

    expect(readField(child, 'bucket')).toBeUndefined()
  })
})
