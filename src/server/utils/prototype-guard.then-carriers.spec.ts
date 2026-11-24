/**
 * @fileoverview Rows for what the guard reads on a value and on the prototypes above it: a function that carries
 * a `then`, a chain too long to be read, a `then` on a built-in prototype that no value inherits from, the
 * descriptor `markHandled` leaves behind, and a thenable that is a function.
 * @layer server/utils
 */
import type { StorageException } from '../errors/storage-exception'
import { assertCleanRoot, follow, markHandled, settles, tagged } from './prototype-guard'

function planted(carrier: object, run: () => void): void {
  Object.defineProperty(carrier, 'then', { value: () => undefined, configurable: true })
  try {
    run()
  } finally {
    Reflect.deleteProperty(carrier, 'then')
  }
}

function plantedCount(): number {
  try {
    assertCleanRoot()
  } catch (error) {
    return (
      (error as StorageException).getResponse() as { error: { details: { planted: number } } }
    ).error.details.planted
  }
  throw new Error('the guard accepted a dirty runtime')
}

describe('settles and the values it walks', () => {
  it('refuses a function that carries a then, and an object whose prototype is one', () => {
    // A callable with a `then` is a thenable as much as an object is, whether it is the value or sits above it.
    const callable = Object.assign(() => undefined, { then: () => undefined })
    const heir = Object.create(callable) as object

    expect(() => settles(callable)).toThrow()
    expect(() => settles(heir)).toThrow()
  })

  it('refuses a chain too long to be read even when no prototype in it carries a then', () => {
    // The walk has a limit so a chain that never ends cannot hold it; a chain past the limit is refused whole.
    let long: object = {}
    for (let level = 0; level < 70; level += 1) long = Object.create(long) as object
    let short: object = {}
    for (let level = 0; level < 50; level += 1) short = Object.create(short) as object

    expect(() => settles(long)).toThrow()
    expect(settles(short)).toBe(short)
  })

  it.each([
    ['Array.prototype', Array.prototype],
    ['Function.prototype', Function.prototype],
  ])('refuses a plain value while a then is planted on %s alone', (_name, carrier) => {
    // The plain value does not inherit from either, so only the closing read of the built-in prototypes sees it.
    planted(carrier, () => {
      expect(() => settles({})).toThrow()
    })
    expect(settles({})).toEqual({})
  })
})

describe('assertCleanRoot and a then on a built-in prototype', () => {
  it.each([
    ['Array.prototype', Array.prototype, 1],
    ['Function.prototype', Function.prototype, 1],
  ])('counts one planted key for a then on %s alone', (_name, carrier, count) => {
    planted(carrier, () => {
      expect(plantedCount()).toBe(count)
    })
    expect(() => {
      assertCleanRoot()
    }).not.toThrow()
  })

  it('counts both when a then is planted on each', () => {
    planted(Array.prototype, () => {
      planted(Function.prototype, () => {
        expect(plantedCount()).toBe(2)
      })
    })
  })
})

describe('markHandled on a promise whose species cannot be read', () => {
  it('leaves an own constructor the caller can still pin, and pins it', async () => {
    // The own `constructor` is `undefined`, writable and configurable, and the later pin replaces it.
    const broken = Promise.resolve('value')
    Reflect.defineProperty(broken, 'constructor', {
      get() {
        throw new Error('species read')
      },
      configurable: true,
    })

    markHandled(broken)

    expect(Object.getOwnPropertyDescriptor(broken, 'constructor')).toEqual({
      value: undefined,
      writable: true,
      enumerable: false,
      configurable: true,
    })
    expect(() => tagged(broken)).not.toThrow()
    expect(Object.getOwnPropertyDescriptor(broken, 'constructor')?.value).toBe(Promise)
    await expect(broken).resolves.toBe('value')
  })
})

describe('follow and a thenable that is a function', () => {
  it('follows the then of a callable, as a resolution would', () => {
    const answers: unknown[] = []
    const callable = Object.assign(() => undefined, {
      then(onValue: (value: unknown) => void) {
        onValue('from the callable')
      },
    })

    follow(
      callable,
      (value) => answers.push(value),
      (reason) => answers.push(reason),
    )

    expect(answers).toEqual(['from the callable'])
  })
})
