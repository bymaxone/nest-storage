/**
 * @fileoverview An `onProgress` hook that is async although it is typed `void` cannot end the process. Jest never
 * fires `unhandledRejection` inside a test, so the library's own progress helpers are transpiled to a temporary
 * directory with the modules they import and run in a child `node` process that counts the real events; the same
 * run on a copy of `absorb` without the handler proves the check can fail.
 * @layer server/utils
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const SRC = resolve(__dirname, '..', '..')
const REPO = resolve(SRC, '..')

/** The files `entry` imports, directly or not, with it. */
function closureOf(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const text = readFileSync(entry, 'utf8')
  for (const match of text.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) {
    const next = `${resolve(dirname(entry), match[1] ?? '')}.ts`
    if (existsSync(next)) closureOf(next, seen)
  }
  return seen
}

/** What the child counted, running `driver` against the transpiled helpers (with `absorb` possibly altered). */
function unhandledRejections(
  driver: string,
  alter: (absorbSource: string) => string = (text) => text,
): number {
  const dir = mkdtempSync(join(tmpdir(), 'progress-'))
  try {
    for (const file of closureOf(join(SRC, 'server/utils/upload-support.ts'))) {
      const out = join(dir, relative(SRC, file)).replace(/\.ts$/, '.js')
      mkdirSync(dirname(out), { recursive: true })
      const source = file.endsWith('utils/absorb.ts')
        ? alter(readFileSync(file, 'utf8'))
        : readFileSync(file, 'utf8')
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      })
      writeFileSync(out, outputText)
    }
    writeFileSync(
      join(dir, 'driver.js'),
      `let count = 0
process.on('unhandledRejection', () => { count += 1 })
const { EventEmitter } = require('node:events')
const { emitProgress, forwardProgress } = require('./server/utils/upload-support')
${driver}
setTimeout(() => { process.stdout.write(String(count)) }, 100)`,
    )
    const run = spawnSync(process.execPath, [join(dir, 'driver.js')], {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, NODE_PATH: join(REPO, 'node_modules') },
    })
    return Number(run.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const withoutHandler = (text: string): string => {
  expect(text).toContain('.then(undefined, () => undefined)')
  return text.replace('.then(undefined, () => undefined)', '')
}

const ASYNC_HOOK = `const hook = () => Promise.reject(new Error('host hook'))
emitProgress(hook, 1, 2)
const uploader = new EventEmitter()
forwardProgress(uploader, hook)
uploader.emit('httpUploadProgress', { loaded: 1, total: 2, part: 1 })
uploader.emit('httpUploadProgress', { loaded: 2, total: 2, part: 2 })`

describe('an async onProgress hook', () => {
  it('leaves no unhandled rejection, on the single-shot call and on the multipart listener', () => {
    expect(unhandledRejections(ASYNC_HOOK)).toBe(0)
  })

  it('does count them on a copy of absorb without the handler, so the check can fail', () => {
    expect(unhandledRejections(ASYNC_HOOK, withoutHandler)).toBe(3)
  })
})
