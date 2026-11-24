/**
 * @fileoverview Rows for the members of `Promise` a host could replace after load: none of them turns an
 * infected scan or a rejected validation into an accepted one, a delegating wrapper of `then` (what a
 * tracing agent installs) is not refused, and the members the verdict does read are refused.
 * @layer server/services
 */
import { Test } from '@nestjs/testing'
import { FileScannerService } from './file-scanner.service'
import { abortable } from '../utils/abort-support'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_FILE_SCANNER } from '../bymax-storage.constants'
import { StorageException } from '../errors/storage-exception'
import type { IFileScanner } from '../interfaces/file-scanner.interface'

const CLEAN = { status: 'clean' }
const nativeResolve = Promise.resolve.bind(Promise)
const nativeReject = Promise.reject.bind(Promise)
const nativeThen = Promise.prototype.then
const NativePromise = Promise
const proto = Promise.prototype as unknown as Record<string, unknown>
const input = { mode: 'pre-upload', key: 'k', bucket: 'b', contentType: 'x' } as never

type Outcome = { accepted: true } | { accepted: false; error: unknown }

async function serviceFor(scanner: IFileScanner): Promise<FileScannerService> {
  const module = await Test.createTestingModule({
    providers: [
      FileScannerService,
      {
        provide: BYMAX_STORAGE_OPTIONS,
        useValue: { scanner: { mode: 'pre-upload', timeoutMs: 1000 } },
      },
      { provide: BYMAX_STORAGE_FILE_SCANNER, useValue: scanner },
    ],
  }).compile()
  return module.get(FileScannerService)
}

const infected: IFileScanner = {
  scan: () => nativeResolve({ status: 'infected', engine: 'e', threat: 't' } as const),
}
const clean: IFileScanner = { scan: () => nativeResolve({ status: 'clean', engine: 'e' } as const) }

/** The call's outcome, read with `await` only: a replaced `then` or static must not touch the harness. */
async function outcomeOf(call: () => Promise<unknown>): Promise<Outcome> {
  try {
    await call()
    return { accepted: true }
  } catch (error) {
    return { accepted: false, error }
  }
}

/** Runs `call` while `apply` has replaced something, and always puts it back. */
async function under(apply: () => () => void, call: () => Promise<unknown>): Promise<Outcome> {
  const restore = apply()
  try {
    return await outcomeOf(call)
  } finally {
    restore()
  }
}

function patch(target: object, name: PropertyKey, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, name)!
  Object.defineProperty(target, name, { ...original, value })
  return () => {
    Object.defineProperty(target, name, original)
  }
}

function patchSpecies(value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!
  Object.defineProperty(Promise, Symbol.species, { ...original, get: () => value })
  return () => {
    Object.defineProperty(Promise, Symbol.species, original)
  }
}

/** A `then` that turns every settlement into a clean verdict, as a hostile host would write it. */
const cleaningThen = function (
  this: Promise<unknown>,
  onFulfilled?: (value: unknown) => unknown,
): unknown {
  return nativeThen.call(
    this,
    () => onFulfilled?.(CLEAN),
    () => onFulfilled?.(CLEAN),
  )
}
/** A well-formed subclass: a species that cannot build a capability would break every `then` in the harness too. */
class Subclass extends NativePromise<unknown> {}
class Impostor {}
const rejectionOf = (outcome: Outcome): unknown => (outcome.accepted ? undefined : outcome.error)

describe('verdict paths and the members of Promise', () => {
  let infectedService: FileScannerService
  let cleanService: FileScannerService
  beforeAll(async () => {
    infectedService = await serviceFor(infected)
    cleanService = await serviceFor(clean)
  })

  const answeredClean: [string, () => () => void][] = [
    ['Promise.race', () => patch(Promise, 'race', () => nativeResolve(CLEAN))],
    ['Promise.resolve', () => patch(Promise, 'resolve', () => nativeResolve(CLEAN))],
    ['Promise.all', () => patch(Promise, 'all', () => nativeResolve([CLEAN]))],
    ['Promise.prototype.then', () => patch(proto, 'then', cleaningThen)],
    ['Promise[Symbol.species]', () => patchSpecies(Subclass)],
    [
      'the Promise binding',
      () =>
        patch(
          globalThis,
          'Promise',
          Object.assign(function () {}, {
            race: () => nativeResolve(CLEAN),
            resolve: () => nativeResolve(CLEAN),
          }),
        ),
    ],
  ]

  it.each(answeredClean)(
    'keeps an infected scan infected with %s replaced to answer clean',
    async (_name, apply) => {
      /* The scan's verdict is read by `await` on a promise built from the captured constructor. */
      const outcome = await under(apply, () => infectedService.scan(input))
      expect(rejectionOf(outcome)).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
    },
  )

  it.each(answeredClean)(
    'keeps a rejected validation rejected with %s replaced to answer clean',
    async (_name, apply) => {
      /* `abortable` carries the validator's and the scans' outcomes under a caller's signal. */
      const failure = new Error('rejected')
      const outcome = await under(apply, () =>
        abortable(nativeReject(failure), new AbortController().signal, {}),
      )
      expect(rejectionOf(outcome)).toBe(failure)
    },
  )

  it('does not refuse a clean scan while a tracing agent’s delegating then is installed, with fake timers', async () => {
    /* An agent that wraps `then` and passes every argument on changes nothing the verdict reads. */
    jest.useFakeTimers()
    try {
      const delegating = function (
        this: Promise<unknown>,
        ...args: Parameters<Promise<unknown>['then']>
      ): unknown {
        return nativeThen.apply(this, args)
      }
      const outcome = await under(
        () => patch(proto, 'then', delegating),
        () => cleanService.scan(input),
      )
      expect(outcome).toEqual({ accepted: true })
    } finally {
      jest.useRealTimers()
    }
  })

  it('refuses a clean scan, with counts only, when the constructor of a promise was replaced', async () => {
    /* The constructor decides whether `await` looks `then` up, so the baseline holds it. */
    const outcome = await under(
      () => patch(proto, 'constructor', Impostor),
      () => cleanService.scan(input),
    )
    const error = rejectionOf(outcome)
    expect(error).toBeInstanceOf(StorageException)
    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    expect((error as StorageException).getResponse()).toMatchObject({
      error: { details: { planted: 0, replaced: 1 } },
    })
  })

  it('refuses a scan when a then is planted on the root prototype, whatever the verdict', async () => {
    /* A planted `then` would make the verdict object a thenable that answers for itself. */
    const root = Object.prototype as unknown as Record<string, unknown>
    let rejection: unknown
    // The outcome is kept in a variable: an object returned through a promise would itself be a thenable here.
    const run = async (): Promise<void> => {
      // Answers with an object that has no prototype, so the answer is not itself a thenable that loops.
      root.then = (resolve: (value: unknown) => void) => {
        resolve(Object.assign(Object.create(null) as object, CLEAN))
      }
      try {
        await infectedService.scan(input)
      } catch (error) {
        rejection = error
      } finally {
        Reflect.deleteProperty(root, 'then')
      }
    }
    await run()
    expect(rejection).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
  })

  it('keeps an infected scan infected when a replaced then forges only the infected answers', async () => {
    /* A `then` that passes every other settlement on and answers clean for an infected one, as a returned promise would reach it. */
    const forgingThen = function (
      this: Promise<unknown>,
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ): unknown {
      return nativeThen.call(
        this,
        (value: unknown) =>
          onFulfilled?.(
            typeof value === 'object' && value !== null && 'threat' in value
              ? { status: 'clean', engine: 'e' }
              : value,
          ),
        onRejected,
      )
    }
    const outcome = await under(
      () => patch(proto, 'then', forgingThen),
      () => infectedService.scan(input),
    )
    expect(rejectionOf(outcome)).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
  })

  it('refuses a scan when a replaced then restores the constructor before the verdict is read', async () => {
    /* The forger swaps the constructor so `await` looks `then` up, and its `then` swaps it back. */
    const original = Object.getOwnPropertyDescriptor(proto, 'constructor')!
    const forger = function (
      this: Promise<unknown>,
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ): unknown {
      Object.defineProperty(proto, 'constructor', original)
      // A rejection is passed on as it is, so the harness itself leaves nothing unhandled.
      return nativeThen.call(
        this,
        () => onFulfilled?.(Object.assign(Object.create(null) as object, CLEAN)),
        onRejected,
      )
    }
    // The outcome is kept in a variable: the forger answers for every await in this scope, the harness's too.
    let rejection: unknown
    const restoreThen = patch(proto, 'then', forger)
    const restoreConstructor = patch(proto, 'constructor', Impostor)
    try {
      await infectedService.scan(input)
    } catch (error) {
      rejection = error
    } finally {
      restoreConstructor()
      restoreThen()
    }
    expect(rejection).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
  })

  it.each([
    ['Object.prototype', Object.prototype],
    ['Array.prototype', Array.prototype],
    ['Function.prototype', Function.prototype],
  ])(
    'refuses a scan when a self-erasing then is planted on %s before the call',
    async (_name, carrier) => {
      /* The planted `then` removes itself when called and answers clean, so only a check before the await sees it. */
      const holder = carrier as unknown as Record<string, unknown>
      const outcome = await under(
        () => {
          holder.then = (resolve: (value: unknown) => void) => {
            Reflect.deleteProperty(holder, 'then')
            resolve(Object.assign(Object.create(null) as object, CLEAN))
          }
          return () => {
            Reflect.deleteProperty(holder, 'then')
          }
        },
        () => infectedService.scan(input),
      )
      expect(rejectionOf(outcome)).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    },
  )

  it('refuses a rejected scan when the runtime changed while it ran', async () => {
    /* The rejection path is checked too, so a failure is not trusted either. */
    const failing: IFileScanner = {
      scan: () => {
        Object.defineProperty(proto, 'constructor', {
          ...Object.getOwnPropertyDescriptor(proto, 'constructor')!,
          value: Impostor,
        })
        return nativeReject(new Error('scanner down'))
      },
    }
    const service = await serviceFor(failing)
    const original = Object.getOwnPropertyDescriptor(proto, 'constructor')!
    try {
      const outcome = await outcomeOf(() => service.scan(input))
      expect(rejectionOf(outcome)).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    } finally {
      Object.defineProperty(proto, 'constructor', original)
    }
  })

  it('builds the wait from the constructor captured at load', () => {
    /* Guards the premise of the rows above: the captured constructor is the realm's own. */
    expect(NativePromise).toBe(Promise)
  })
})
