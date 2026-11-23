/**
 * @fileoverview Two-way scan of the guard source: every static call on a built-in is listed here
 * with its reason (and every listed one is in the source), no method is called on a value, and
 * the guard walks arrays by index, with no iterator, spread or `for` loop a replaced built-in
 * could redirect.
 * @layer server/utils
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'prototype-guard.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/stryMutAct_9fa48\([^)]*\)/g, '')

/** Static calls on a global, each made once at load to bind the built-in; none runs at decision time. */
const LOAD_TIME_CALLS: Record<string, string> = {
  'Reflect.get.bind': 'property reads of descriptors and prototypes',
  'Reflect.apply.bind': 'calls of captured prototype methods',
  'Reflect.ownKeys.bind': 'string and symbol keys of a built-in',
  'Object.getOwnPropertyDescriptor.bind': 'descriptor snapshot and comparison',
  'Object.getPrototypeOf.bind': 'iterator prototypes at load',
  'Object.hasOwn.bind': 'own-field reads of a descriptor',
  'Object.create.bind': 'the null-prototype details of a refusal',
}

describe('prototype guard source', () => {
  it('calls exactly the built-ins this table lists, all bound at load', () => {
    const calls = new Set(
      [
        ...source.matchAll(
          /\b((?:Object|Reflect|Set|Array|Symbol|Function|String|RegExp|Map|Number)(?:\.\w+)+)\(/g,
        ),
      ].map((m) => m[1]),
    )
    expect([...calls].sort()).toEqual(Object.keys(LOAD_TIME_CALLS).sort())
  })

  it('calls no method but the load-time binding itself', () => {
    const methods = new Set([...source.matchAll(/\.(\w+)\(/g)].map((m) => m[1]))
    expect([...methods]).toEqual(['bind'])
  })

  it('walks arrays by index: no for loop, spread or iterator', () => {
    expect(source).not.toMatch(/\bfor\s*\(/)
    expect(source).not.toMatch(/\.\.\./)
    expect(source).not.toMatch(/\bof\b/)
  })
})
