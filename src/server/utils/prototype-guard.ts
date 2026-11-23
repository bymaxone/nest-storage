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
const reflectGet = Reflect.get.bind(Reflect) as (target: object, key: PropertyKey) => unknown
const apply = Reflect.apply.bind(Reflect)
const ownKeys = Reflect.ownKeys.bind(Reflect)
const getDescriptor = Object.getOwnPropertyDescriptor.bind(Object)
const getPrototype = Object.getPrototypeOf.bind(Object) as (target: unknown) => object
const hasOwn = Object.hasOwn.bind(Object)
const same = Object.is.bind(Object) as (left: unknown, right: unknown) => boolean
const create = Object.create.bind(Object) as (prototype: null) => Record<string, unknown>
const symbolFor = reflectGet(Symbol, 'for') as (key: string) => symbol
const exemptSymbol = symbolFor('$$jest-protect-from-deletion')
const setHas = reflectGet(Set.prototype, 'has')
const standardNames = new Set(STANDARD_NAMES)
const weakHas = reflectGet(WeakSet.prototype, 'has') as (key: object) => boolean
const weakAdd = reflectGet(WeakSet.prototype, 'add') as (key: object) => unknown
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
  const fields: unknown[] = [descriptor !== undefined]
  let at = 0
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
  while (at < keys.length) {
    capture(target, item(keys, at))
    at += 1
  }
}

/** The built-ins a decision path calls live: functions, prototypes and the iterator prototypes. */
function readBaseline(): void {
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
    arrayIterator,
    getPrototype(arrayIterator),
    getPrototype(''[Symbol.iterator]()),
    getPrototype(new Map()[Symbol.iterator]()),
    getPrototype(new Set()[Symbol.iterator]()),
  ]
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
  at = 0
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
  return (
    typeof error === 'object' &&
    error !== null &&
    (apply(weakHas as () => unknown, raised, [error]) as boolean)
  )
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
