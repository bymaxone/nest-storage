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

const root = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

const text = sources(root)
  .filter((path) => !path.endsWith('prototype-guard.ts'))
  .map((path) => readFileSync(path, 'utf8'))
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
  'Promise.resolve': 'scheduling only; no decision reads its result',
  'Promise.race': 'scheduling only; no decision reads its result',
  'Promise.all': 'scheduling only; no decision reads its result',
  'Date.now': 'a clock read for a metric, never an amount or an expiry',
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

describe('library built-in calls', () => {
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

  it('accepts the realm as loaded', () => {
    expect(() => {
      assertCleanRoot()
    }).not.toThrow()
  })
})
