/**
 * @fileoverview Two-way scan of the library sources: every static call on a global built-in, and
 * every call of a global function, is either detected by the prototype guard baseline or exempt
 * with a reason. A new call that is in neither fails here, and a listed call that left the
 * sources fails too, so the table cannot drift from the code.
 * @layer server/utils
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCleanRoot } from './prototype-guard'

/** The server sources, where the files a verdict passes through live. */
const root = join(__dirname, '..')
/** Every library source: the server, the observability subpath and the shared types. */
const srcRoot = join(__dirname, '..', '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

/**
 * What the readiness indicator reads from the engine once, while its module loads and before any host code of the
 * application runs: the captured `Object` statics and the check of the promise constructor. The indicator ships
 * as its own subpath and cannot import the guard that holds the same captures for the server, so these exact
 * statements are the only exemption; a live call anywhere else in it is still found.
 */
const LOAD_TIME_CAPTURES = [
  /^const \w+(?:: \(\) => number)? = (?:Object\.\w+|Date\.now)\.bind\((?:Object|Date)\)/gm,
  /Reflect\.get\(candidate, 'prototype'\)/g,
]

function withoutLoadTimeCaptures(path: string, source: string): string {
  return path.endsWith('storage-health.ts')
    ? LOAD_TIME_CAPTURES.reduce((rest, capture) => rest.replace(capture, ''), source)
    : source
}

const text = sources(srcRoot)
  .filter((path) => !path.endsWith('prototype-guard.ts'))
  .map((path) => withoutLoadTimeCaptures(path, readFileSync(path, 'utf8')))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/stryMutAct_9fa48\([^)]*\)/g, '')

/** Calls whose replacement the guard refuses: the baseline holds the built-in. */
const DETECTED = new Set([
  'Object.*',
  'Array.*',
  'Reflect.*',
  'Number.isInteger',
  'Number.isFinite',
  'Math.min',
  'JSON.stringify',
  'Buffer.byteLength',
  'Buffer.concat',
  'Buffer.isBuffer',
  'Buffer.from',
  'Buffer.alloc',
  'ArrayBuffer.isView',
  'encodeURIComponent',
  'String',
  'Number',
  'Boolean',
])

/** Calls the guard does not detect, each with the reason it cannot move a limit or a request. */
const EXEMPT: Record<string, string> = {
  'Promise.resolve':
    'the no-op validator and scanner return a fixed answer through it and the hook absorber discards what it returns; a replaced `Promise.resolve` could change the no-op answer, which is the same-process trust SECURITY.md states; the files that carry a verdict from host code never call it (the row below)',
  'Date.now':
    'a clock read for a metric and for the `expiresAt` shown to a caller; the signed expiry is `expiresIn`, which the presigner computes',
  'AbortSignal.timeout': 'a deadline timer; the request is aborted, never widened',
  'AbortSignal.any': 'combines abort signals; the request is aborted, never widened',
  setTimeout: 'a timer',
  clearTimeout: 'a timer',
}

function listed(key: string): boolean {
  if (key in EXEMPT || DETECTED.has(key)) return true
  const [owner] = key.split('.')
  return DETECTED.has(`${owner ?? ''}.*`)
}

function globalName(name: string): boolean {
  return name in globalThis && typeof (globalThis as Record<string, unknown>)[name] !== 'undefined'
}

function callsFound(): Set<string> {
  const found = new Set<string>()
  for (const m of text.matchAll(/(?<![.\w])([A-Z]\w*)\.(\w+)\(/g)) {
    if (globalName(m[1] ?? '')) found.add(`${m[1] ?? ''}.${m[2] ?? ''}`)
  }
  for (const m of text.matchAll(/(?<![.\w])(?<!new )(\w+)\(/g)) {
    const name = m[1] ?? ''
    const value = (globalThis as Record<string, unknown>)[name]
    if (name in globalThis && typeof value === 'function' && !/^[A-Z]/.test(name)) found.add(name)
    if (['String', 'Number', 'Boolean'].includes(name)) found.add(name)
  }
  // A global function handed to an array method as the callback is called live as well.
  for (const m of text.matchAll(/\.(?:map|filter|forEach|some|every|find|flatMap)\((\w+)\)/g)) {
    const name = m[1] ?? ''
    if (typeof (globalThis as Record<string, unknown>)[name] === 'function') found.add(name)
  }
  return found
}

/**
 * Method names the sources call that a built-in prototype outside the baseline also has. The
 * baseline holds the prototypes of String, Array, Map, Set, RegExp, Number, Symbol and the
 * iterators, Buffer, the typed arrays and URL; these names belong to the others, each with the
 * receiver the sources actually use.
 */
const OUTSIDE_METHODS: Record<string, string> = {
  then: 'the hook absorber, which drops a failure; every verdict, id and size is read by `await` or through the `then` captured at load',
  toString:
    'called on numbers (`Number.prototype`, in the baseline), never an Error, Date or URLSearchParams',
  get: "called on Map, WeakMap, Reflect and the library's own cache (the first three in the baseline), never a URLSearchParams",
  set: "called on Map, WeakMap and the library's own cache (the first two in the baseline), never a URLSearchParams",
  has: 'called on Set and Map (in the baseline), never a URLSearchParams',
  delete:
    "called on Map and the library's own storage call (the first in the baseline), never a URLSearchParams",
  entries: 'the static `Object.entries` (detected), never a URLSearchParams',
  keys: 'called on a Map iterator source (in the baseline), never a URLSearchParams',
  slice: 'called on strings and arrays (in the baseline), never an ArrayBuffer',
  byteLength: 'the static `Buffer.byteLength` (detected); no DataView or ArrayBuffer receiver',
}

function outsideMethodsCalled(): string[] {
  const outside = [
    Promise.prototype,
    Error.prototype,
    Date.prototype,
    URLSearchParams.prototype,
    DataView.prototype,
    ArrayBuffer.prototype,
  ]
  const owned = new Set(outside.flatMap((prototype) => Object.getOwnPropertyNames(prototype)))
  const called = new Set([...text.matchAll(/\.(\w+)\(/g)].map((m) => m[1] ?? ''))
  return [...called].filter((name) => owned.has(name)).sort()
}

describe('library built-in calls', () => {
  it('lists every method name a prototype outside the baseline shares with a call in the sources', () => {
    const unlisted = outsideMethodsCalled().filter((name) => !(name in OUTSIDE_METHODS))
    expect(unlisted).toEqual([])
  })

  it('lists no such method name the sources no longer call', () => {
    const called = new Set(outsideMethodsCalled())
    expect(
      Object.keys(OUTSIDE_METHODS)
        .filter((name) => !called.has(name))
        .sort(),
    ).toEqual([])
  })

  it('builds every property descriptor without a prototype', () => {
    // A key planted on the root object prototype must not become a field of a descriptor.
    const definitions = [...text.matchAll(/Object\.defineProperty\(/g)].length
    const bare = [...text.matchAll(/__proto__: null,/g)].length
    expect(definitions).toBeGreaterThan(0)
    expect(bare).toBe(definitions)
  })

  it('lists every static call on a global and every global function the sources call', () => {
    const unlisted = [...callsFound()].filter((key) => !listed(key)).sort()
    expect(unlisted).toEqual([])
  })

  it('lists nothing the sources no longer call', () => {
    const found = callsFound()
    const stale = [...Object.keys(EXEMPT), ...[...DETECTED].filter((k) => !k.endsWith('.*'))]
      .filter((key) => !found.has(key))
      .sort()
    expect(stale).toEqual([])
  })

  it('builds no promise with the live Promise constructor outside the guard', () => {
    // `new Promise(` reads the global at each call, so a host that replaced it after load would build the promise
    // that carries a verdict, a chunk or a readiness answer. A site is exempt only with the reason it decides
    // nothing the library reports; every other site builds from the constructor captured at load.
    const EXEMPT_SITES: Record<string, string> = {}
    const folders = [srcRoot]
    const found = folders.flatMap((folder) =>
      sources(folder)
        .filter((path) => !path.endsWith('prototype-guard.ts'))
        .flatMap((path) => {
          const source = readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
          const hits = [...source.matchAll(/\bnew Promise\b/g)].length
          return hits > 0 ? [path.slice(srcRoot.length + 1)] : []
        }),
    )

    expect(found.filter((file) => !(file in EXEMPT_SITES))).toEqual([])
    expect(Object.keys(EXEMPT_SITES).filter((file) => !found.includes(file))).toEqual([])
  })

  it('reads no verdict, id or size through a static of Promise or through `then`', () => {
    // `await` on a native promise does not look `then` up, and a static such as `Promise.race` is read
    // off the global at each call, so a replaced one could answer a scan or a validation as it likes.
    const verdictFiles = [
      'services/file-scanner.service.ts',
      'services/validation.service.ts',
      'services/storage.service.ts',
      'utils/abort-support.ts',
      'utils/idle-timeout.ts',
      'utils/multipart-abort.ts',
      'utils/multipart-failure.ts',
    ]
    const calls = verdictFiles.flatMap((file) => {
      const source = readFileSync(join(root, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      return [...source.matchAll(/\bPromise\.\w+\(|\.then\(/g)].map((m) => `${file}: ${m[0]}`)
    })
    expect(calls).toEqual([])
  })

  it('awaits every verdict through `verdictOf` or `settleOrCut`, which check the runtime right before the await', () => {
    // A bare `await` of a verdict promise has no check between the last look at the runtime and the await,
    // and an async function that returns a promise without `await` resolves it through `then`.
    const files = [
      'services/file-scanner.service.ts',
      'services/validation.service.ts',
      'utils/abort-support.ts',
    ]
    const bare = files.flatMap((file) => {
      const source = readFileSync(join(root, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const pattern =
        /\bawait\s+(?:this\.)?(?:scanLogged|scanWithinDeadline|runCustomValidators|evaluate|validator\.validate|scanner\.scan)\(|\breturn\s+(?!await\b)(?:this\.)?(?:settleOrCut|scanLogged|scanWithinDeadline|abortable|verdictOf|observer)\b/g
      return [...source.matchAll(pattern)].map((m) => `${file}: ${m[0]}`)
    })
    expect(bare).toEqual([])
  })

  it('awaits nothing in the sources except through a hop that follows it with the then captured at load', () => {
    // A bare `await` reads the `constructor` of what it awaits at that moment, and one that is not the engine's is
    // resolved through the live `then`; a host hook that ran just before could have planted either. The hops are
    // the only awaits, and the lint rule `no-restricted-syntax` states the same for the editor.
    const folders = [srcRoot]
    const bare = folders.flatMap((folder) =>
      sources(folder)
        .filter((path) => !path.endsWith('settle-or-cut.ts') && !path.endsWith('.spec.ts'))
        .flatMap((path) => {
          const source = readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
          return [
            ...source.matchAll(
              /\bawait\s+(?!(?:verdictOf|stepOf|settleOrCut|abortable|allOf|pinnedWork)\b)[^\n]{0,40}/g,
            ),
          ].map((m) => `${path.slice(srcRoot.length + 1)}: ${m[0]}`)
        }),
    )
    expect(bare).toEqual([])
  })

  it('dispatches nothing through a live `apply`, `call`, `bind` or `Reflect`, which a replaced Function.prototype member would answer', () => {
    // A call of a function value reads `apply`, `call` or `bind` off Function.prototype at each use, and a
    // `Reflect` static off the global; the guard module holds captured copies for the sources to use.
    const live = [...text.matchAll(/\.(?:apply|call|bind)\(|\bReflect\.\w+\(/g)].map((m) => m[0])
    expect(live).toEqual([])
  })

  it('accepts the realm as loaded', () => {
    expect(() => {
      assertCleanRoot()
    }).not.toThrow()
  })
})
