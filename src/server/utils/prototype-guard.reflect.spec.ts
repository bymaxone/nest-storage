/**
 * @fileoverview Rows for the `Reflect` part of the root prototype guard: the functions the language defines on
 * it are compared, and the functions a metadata polyfill adds to it (a second copy defines them again) are not.
 * @layer server/utils
 */
import type * as Guard from './prototype-guard'
import { assertCleanRoot } from './prototype-guard'

/** The functions the language defines on `Reflect`; each has its own row. */
const LANGUAGE_FUNCTIONS = [
  'apply',
  'construct',
  'defineProperty',
  'deleteProperty',
  'get',
  'getOwnPropertyDescriptor',
  'getPrototypeOf',
  'has',
  'isExtensible',
  'ownKeys',
  'preventExtensions',
  'set',
  'setPrototypeOf',
] as const

const reflect = Reflect as unknown as Record<string, (...args: unknown[]) => unknown>

function refusalOf(check: () => void): unknown {
  try {
    check()
  } catch (error) {
    return error
  }
  return undefined
}

describe('the guard and the functions on Reflect', () => {
  it.each(LANGUAGE_FUNCTIONS)('refuses a replaced Reflect.%s', (name) => {
    // A replaced function of the language is what a decision path would call; a wrapper that forwards is still another function.
    const original = reflect[name] as (...args: unknown[]) => unknown
    const forwarding = (...args: unknown[]): unknown => original(...args)
    Object.defineProperty(Reflect, name, { value: forwarding })
    let thrown: unknown
    try {
      thrown = refusalOf(assertCleanRoot)
    } finally {
      Object.defineProperty(Reflect, name, { value: original })
    }
    expect(thrown).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
  })

  it('refuses a Reflect whose prototype was re-pointed', () => {
    // Where the object itself points is part of what a read of it resolves through.
    const original = Object.getPrototypeOf(Reflect) as object | null
    Object.setPrototypeOf(Reflect, Object.create(null) as object)
    let thrown: unknown
    try {
      thrown = refusalOf(assertCleanRoot)
    } finally {
      Object.setPrototypeOf(Reflect, original)
    }
    expect(thrown).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
  })

  it('does not refuse a polyfill function that was defined before load and defined again after it', async () => {
    // A second copy of the metadata polyfill defines its functions on `Reflect` again; none is read by a decision.
    Object.defineProperty(Reflect, 'defineMetadata', {
      value: () => 'first',
      configurable: true,
      writable: true,
    })
    let loaded: typeof Guard | undefined
    try {
      await jest.isolateModulesAsync(async () => {
        loaded = await import('./prototype-guard')
      })
      Object.defineProperty(Reflect, 'defineMetadata', {
        value: () => 'second',
        configurable: true,
        writable: true,
      })
      expect(loaded === undefined ? 'not loaded' : refusalOf(loaded.assertCleanRoot)).toBeUndefined()
    } finally {
      Reflect.deleteProperty(Reflect, 'defineMetadata')
    }
  })

  it('does not refuse once a second copy of the metadata polyfill is evaluated after load', async () => {
    // The real package, in a fresh module registry, the way a host's second copy arrives.
    let loaded: typeof Guard | undefined
    await jest.isolateModulesAsync(async () => {
      loaded = await import('./prototype-guard')
    })
    jest.isolateModules(() => {
      jest.requireActual('reflect-metadata')
    })
    expect(loaded === undefined ? 'not loaded' : refusalOf(loaded.assertCleanRoot)).toBeUndefined()
  })
})
