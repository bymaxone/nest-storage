/**
 * @fileoverview Refuses to talk to S3 while the runtime is not as the library found it at load.
 * The AWS SDK reads every optional input and configuration name off the object it is given, so
 * a key planted on `Object.prototype` becomes a header, a credential or a host, and a built-in
 * replaced after import changes what every decision reads. The check runs before the client is
 * built and before every attempt of every command, so no byte leaves the process while the
 * runtime differs. Everything it uses is captured at load; replacing a built-in before the
 * library is imported is outside what it can see.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import type { Callable } from './callable'

/** The names a clean `Object.prototype` carries; any other string key is planted. */
const STANDARD_NAMES = [
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  'hasOwnProperty',
  '__lookupGetter__',
  '__lookupSetter__',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'valueOf',
  '__proto__',
  'toLocaleString',
]
/** The Buffer functions the library calls live. */
const BUFFER_CALLS = ['from', 'alloc', 'concat', 'byteLength', 'isBuffer']
const FIELDS = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable']
/** Global bindings compared by the value they resolve to. */
const GLOBALS = [
  'Object',
  'Function',
  'Array',
  'String',
  'RegExp',
  'Symbol',
  'Reflect',
  'Map',
  'Set',
  'WeakMap',
  'Error',
  'TypeError',
  'Number',
  'Math',
  'JSON',
  'encodeURIComponent',
  'Boolean',
  'Uint8Array',
  'ArrayBuffer',
  'Buffer',
  'process',
  'URL',
]

/** Every built-in below is read from the realm once, here, and bound; a later replacement is not seen. */
const root: object = Object.prototype
/** Carriers whose own `then` would make every array or function a thenable that `await` or a resolution calls. */
const arrayPrototype: object = Array.prototype
const functionPrototype: object = Function.prototype
const reflectGet = Reflect.get.bind(Reflect) as (target: object, key: PropertyKey) => unknown
const apply = Reflect.apply.bind(Reflect)
const functionBind = reflectGet(Function.prototype, 'bind')
const ownKeys = Reflect.ownKeys.bind(Reflect)
const getDescriptor = Object.getOwnPropertyDescriptor.bind(Object)
const getPrototype = Object.getPrototypeOf.bind(Object) as (target: unknown) => object
const hasOwn = Object.hasOwn.bind(Object)
const same = Object.is.bind(Object) as (left: unknown, right: unknown) => boolean
const defineOwn = Object.defineProperty.bind(Object) as (
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
) => unknown
const create = Object.create.bind(Object) as (prototype: null) => Record<string, unknown>
const symbolFor = reflectGet(Symbol, 'for') as (key: string) => symbol
const exemptSymbol = symbolFor('$$jest-protect-from-deletion')
const setHas = reflectGet(Set.prototype, 'has')
const standardNames = new Set(STANDARD_NAMES)
const weakHas = reflectGet(WeakSet.prototype, 'has') as (key: object) => boolean
const weakAdd = reflectGet(WeakSet.prototype, 'add') as (key: object) => unknown
/**
 * The promise prototype and constructor `await` consults, read from an async function's own promise and
 * not from the global binding, which a host may have replaced before this module loaded.
 */
const intrinsicPromisePrototype = getPrototype(
  (async (): Promise<void> => {
    // Nothing to await: only the promise this function returns is read.
  })(),
)
/** The `Promise` constructor of the engine, as {@link intrinsicPromisePrototype} names it. */
export const INTRINSIC_PROMISE = reflectGet(
  intrinsicPromisePrototype,
  'constructor',
) as PromiseConstructor
/** The engine's own `then`, read at load, to mark a started promise as handled whatever `then` is now. */
const intrinsicThen = reflectGet(intrinsicPromisePrototype, 'then') as (
  this: Promise<unknown>,
  onFulfilled: () => void,
  onRejected: () => void,
) => unknown
function ignore(): void {
  // A settlement nobody reads: the promise is only being marked as handled.
}

/**
 * Marks a started promise as handled with the `then` captured at load, so a refusal that leaves it
 * behind does not end as an unhandled rejection. A value that is not a native promise is left alone.
 *
 * @param work - A promise that has been started.
 */
export function markHandled(work: PromiseLike<unknown>): void {
  try {
    apply(intrinsicThen as () => unknown, work, [ignore, ignore])
  } catch {
    // Not a native promise: its own `then` is the host's, and it is not called here.
  }
}

/**
 * Gives a promise this library built an own `constructor` equal to the engine's, set with the `defineProperty`
 * captured at load. A caller's `await` reads `constructor` of what it awaits, and when that is not the engine's
 * `Promise` it queues a job that calls the live `then`; a host hook that ran before the promise was handed back
 * could have replaced the one on the prototype, so a promise on a decision path carries its own.
 *
 * @param own - A native promise built by this library.
 * @returns The same promise.
 */
export function tagged<P extends Promise<unknown>>(own: P): P {
  try {
    defineOwn(own, 'constructor', { value: INTRINSIC_PROMISE, configurable: true, writable: true })
  } catch {
    // Frozen: the caller's await decides.
  }
  return own
}

/**
 * Marks a promise this library built as handled, after giving it an own constructor, so the species lookup
 * of `then` does not read the one on the prototype, which a host may have made throw: that would leave this
 * very rejection unhandled.
 *
 * @param own - A native promise built by this library.
 */
export function markOwnHandled(own: Promise<unknown>): void {
  markHandled(tagged(own))
}

/**
 * Wraps an answer in an object without a prototype, built with the `create` captured at load, so
 * neither a replaced `Object.create` nor a `then` on any prototype is consulted when the box is
 * built or resolved with.
 *
 * @param value - The answer to carry.
 * @returns A prototype-less object whose only property is `value`.
 */
export function boxed<V>(value: V): { readonly value: V } {
  const box = create(null)
  box.value = value
  return box as { readonly value: V }
}
/**
 * Calls a function with the `Reflect.apply` captured at load, so a replaced `Function.prototype.apply` or
 * `call` is never the one that runs it.
 *
 * @param fn - The function to call.
 * @param thisArg - Its `this`.
 * @param args - Its arguments.
 * @returns What the function returned.
 */
export function dispatch<R>(fn: Callable<R>, thisArg: unknown, args: readonly unknown[]): R {
  return apply(fn as () => unknown, thisArg, args) as R
}

/**
 * Binds a function to a `this` with the `Function.prototype.bind` captured at load, so a replaced `bind`
 * cannot hand back a function of its own.
 *
 * @param fn - The function to bind.
 * @param thisArg - What it is bound to.
 * @returns The bound function.
 */
export function bindTo<F extends Callable>(fn: F, thisArg: unknown): F {
  return apply(functionBind as () => unknown, fn, [thisArg]) as F
}

/**
 * A promise already rejected with `reason`, built from the constructor captured at load, not from
 * `Promise.reject`, which is read off the global at each call.
 *
 * @param reason - The rejection.
 * @returns A rejected native promise.
 */
export function rejectedWith<T>(reason: unknown): Promise<T> {
  return new INTRINSIC_PROMISE<T>((_resolve, reject) => {
    const settle: (reason: unknown) => void = reject
    settle(reason)
  })
}

/**
 * Hands the outcome of `work` to two callbacks without a live `then` lookup. A native promise, a subclass
 * included, is followed with the `then` captured at load, so a `Promise.prototype.then` replaced after load
 * never answers for it, which `await` would let it do for any promise whose constructor is not the engine's.
 * A native promise that cannot be followed that way is refused, and a thenable that is not a promise is
 * followed through its own `then`, which is the host's; any other value is the answer itself.
 *
 * @param work - The promise or thenable to follow.
 * @param onValue - Receives what it fulfilled with.
 * @param onError - Receives what it rejected with, or the refusal.
 */
export function follow<T>(
  work: PromiseLike<T>,
  onValue: (value: T) => void,
  onError: (reason: unknown) => void,
): void {
  try {
    apply(intrinsicThen as () => unknown, work, [onValue, onError])
    return
  } catch {
    // Either not a native promise, or one whose species threw: told apart below.
  }
  if (work instanceof INTRINSIC_PROMISE) {
    onError(refusal(0, 1))
    return
  }
  const candidate: unknown = work
  const kind = typeof candidate
  let then: unknown
  try {
    then =
      candidate !== null && (kind === 'object' || kind === 'function')
        ? reflectGet(candidate as object, 'then')
        : undefined
  } catch (error) {
    onError(error)
    return
  }
  if (typeof then !== 'function') {
    // Not a thenable: the value is the answer, as a resolution would take it.
    onValue(work as T)
    return
  }
  try {
    apply(then as () => unknown, work, [onValue, onError])
  } catch (error) {
    onError(error)
  }
}

/** The refusals this module raised, so a caller can tell one from an ordinary validation error. */
const raised = new WeakSet()

/** One own property of a built-in as it was at load, with the fields a replacement could change. */
interface Entry {
  readonly target: object
  readonly key: string | symbol
  readonly fields: readonly unknown[]
}

/** An element read as a plain property read, so the index result is not `undefined`-typed. */
function item<T>(list: readonly T[], at: number): T {
  return reflectGet(list, at) as T
}

function field(descriptor: PropertyDescriptor | undefined, name: string): unknown {
  return descriptor !== undefined && hasOwn(descriptor, name)
    ? reflectGet(descriptor, name)
    : undefined
}

function fieldsOf(target: object, key: string | symbol): unknown[] {
  if (target === globalThis) {
    // A global binding may be a lazy accessor; the value it resolves to is what a decision reads.
    return [reflectGet(target, key)]
  }
  const descriptor = getDescriptor(target, key)
  // Stryker disable next-line ArrayDeclaration: a constant first element is the same at load and at every check (equivalent).
  const fields: unknown[] = []
  let at = 0
  // Stryker disable next-line EqualityOperator: an index past the list reads `undefined` on both sides of the compare (equivalent).
  while (at < FIELDS.length) {
    fields[fields.length] = field(descriptor, item(FIELDS, at))
    at += 1
  }
  return fields
}

const entries: Entry[] = []
/** Set once a built-in could not be read at load; the guard then refuses at every use. */
let unreadable = false

function capture(target: object, key: string | symbol): void {
  entries[entries.length] = { target, key, fields: fieldsOf(target, key) }
}

function captureAll(target: object): void {
  const keys = ownKeys(target)
  let at = 0
  // Stryker disable next-line EqualityOperator: an index past the keys captures the key `undefined`, which reads the same at load and at every check (equivalent).
  while (at < keys.length) {
    capture(target, item(keys, at))
    at += 1
  }
}

/** The built-ins a decision path calls live: functions, prototypes and the iterator prototypes. */
function baselineTargets(): object[] {
  // Stryker disable next-line ArrayDeclaration: any array yields the same iterator prototype (equivalent).
  const arrayIterator = getPrototype([][Symbol.iterator]())
  const list: object[] = [
    root,
    Object,
    Function.prototype,
    Array,
    Array.prototype,
    String,
    String.prototype,
    RegExp.prototype,
    Reflect,
    Map.prototype,
    Set.prototype,
    WeakMap.prototype,
    WeakSet.prototype,
    Symbol,
    Symbol.prototype,
    Number,
    Number.prototype,
    Math,
    JSON,
    ArrayBuffer,
    Buffer.prototype as object,
    Uint8Array.prototype,
    getPrototype(Uint8Array.prototype),
    URL.prototype,
    arrayIterator,
    getPrototype(arrayIterator),
    // Stryker disable next-line StringLiteral: any string yields the same iterator prototype (equivalent).
    getPrototype(''[Symbol.iterator]()),
    getPrototype(new Map()[Symbol.iterator]()),
    getPrototype(new Set()[Symbol.iterator]()),
  ]
  return list
}

function readBaseline(): void {
  const list = baselineTargets()
  let at = 0
  while (at < list.length) {
    captureAll(item(list, at))
    at += 1
  }
  // Not the whole of Buffer: its pool size is a setting a host may tune, and no decision reads it.
  at = 0
  while (at < BUFFER_CALLS.length) {
    capture(Buffer, item(BUFFER_CALLS, at))
    at += 1
  }
  // `await` takes a promise's own resolution only while its `constructor` is the native one; any other
  // value sends it through a `then` lookup. It is a data property that no instrumentation rewrites.
  capture(intrinsicPromisePrototype, 'constructor')
  at = 0
  // Stryker disable next-line EqualityOperator: an index past the list reads the global `undefined` at load and at every check (equivalent).
  while (at < GLOBALS.length) {
    capture(globalThis, item(GLOBALS, at))
    at += 1
  }
}

try {
  readBaseline()
} catch {
  unreadable = true
}

function differs(entry: Entry): boolean {
  const now = fieldsOf(entry.target, entry.key)
  let at = 0
  // Stryker disable next-line EqualityOperator: an index past the fields compares `undefined` with `undefined` (equivalent).
  while (at < now.length) {
    if (!same(now[at], entry.fields[at])) {
      return true
    }
    at += 1
  }
  return false
}

function isPlantedKey(key: string | symbol): boolean {
  if (typeof key === 'symbol') {
    return key !== exemptSymbol
  }
  return !apply(setHas as () => unknown, standardNames, [key])
}

/** One for an own `then` on a carrier that has none at load, which would answer for every value it holds. */
function carriesThen(carrier: object): number {
  return hasOwn(carrier, 'then') ? 1 : 0
}

/** A fresh refusal per call: typed, counts only, and it names neither a key nor a built-in. */
function refusal(planted: number, replaced: number): StorageException {
  const details = create(null)
  details.planted = planted
  details.replaced = replaced
  details.reason =
    replaced > 0
      ? 'a built-in was replaced after the library loaded'
      : 'the root object prototype carries a key the library did not find at load'
  const error = new StorageException('STORAGE_VALIDATION_FAILED', undefined, details)
  apply(weakAdd as () => unknown, raised, [error])
  return error
}

/**
 * Whether an error is a refusal raised by {@link assertCleanRoot}, as opposed to a validation
 * failure about a caller's input.
 *
 * @param error - Any thrown value.
 * @returns `true` only for an object this module raised.
 */
export function isRootRefusal(error: unknown): boolean {
  // `WeakSet.prototype.has` answers `false` for a primitive or `null`, so no type test comes first.
  return apply(weakHas as () => unknown, raised, [error]) as boolean
}

/**
 * Throws when the root object prototype holds a key outside the standard set (string or symbol),
 * or when a standard property or a built-in the library's decisions call changed since load.
 *
 * @returns Nothing when the runtime is as it was at load.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` with counts only (`planted`, `replaced`).
 * @example
 *   assertCleanRoot() // before `new S3Client(...)` and before every attempt of a command
 */
export function assertCleanRoot(): void {
  let planted = 0
  let replaced = unreadable ? 1 : 0
  const keys = ownKeys(root)
  let at = 0
  while (at < keys.length) {
    if (isPlantedKey(item(keys, at))) {
      planted += 1
    }
    at += 1
  }
  planted += carriesThen(arrayPrototype) + carriesThen(functionPrototype)
  at = 0
  while (at < entries.length) {
    if (differs(item(entries, at))) {
      replaced += 1
    }
    at += 1
  }
  if (planted > 0 || replaced > 0) {
    throw refusal(planted, replaced)
  }
}
