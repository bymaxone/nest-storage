/**
 * @fileoverview The README "Log events" table lists every code the library writes, and no code it does not.
 * @layer root
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORAGE_LOG_EVENTS } from './server/utils/log-events'

const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')
const section = README.slice(README.indexOf('## 📋 Log events'), README.indexOf('## 🚫 What This Library Does NOT Do'))
const listed = [...section.matchAll(/^\| `(STORAGE_[A-Z_]+)` \|/gm)].map((match) => match[1])

describe('the README log events table', () => {
  it('lists every code of the catalog once', () => {
    expect([...listed].sort()).toEqual(Object.values(STORAGE_LOG_EVENTS).sort())
  })

  it('gives every row one of the four levels', () => {
    for (const row of section.split('\n').filter((line) => line.startsWith('| `STORAGE_'))) {
      expect(row).toMatch(/\| (debug|log|warn|error) \|/)
    }
  })
})
