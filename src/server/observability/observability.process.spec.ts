/**
 * @fileoverview A listener or a span that is async although it is typed `void` cannot end the process. Jest never
 * fires `unhandledRejection` inside a test, so the library's own tally, observer and tracing seam are transpiled
 * to a temporary directory with the modules they import, and run in a child `node` process that counts the real
 * events; the same run on a copy of `absorb` without the handler proves the check can fail.
 * @layer server/observability
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const SRC = resolve(__dirname, '..', '..')
const REPO = resolve(SRC, '..')

/** Every relative import of a source file, resolved to the `.ts` file it names. */
function localImports(file: string, text: string): string[] {
  const specifiers = [...text.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)].map(
    (match) => match[1] ?? '',
  )
  return specifiers
    .map((specifier) => `${resolve(dirname(file), specifier)}.ts`)
    .filter((path) => existsSync(path))
}

/** The files `entry` imports, directly or not, with it. */
function closureOf(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  for (const next of localImports(entry, readFileSync(entry, 'utf8'))) closureOf(next, seen)
  return seen
}

/**
 * What the child counted, running `driver` against the transpiled modules of `entries` (with `absorb` possibly
 * altered). `@opentelemetry/api` is a stub whose spans return rejecting promises.
 */
function unhandledRejections(
  driver: string,
  alter: (absorbSource: string) => string = (text) => text,
): number {
  const dir = mkdtempSync(join(tmpdir(), 'observability-'))
  try {
    for (const file of closureOf(join(SRC, 'server/observability/storage-observer.ts'))) {
      const out = join(dir, relative(SRC, file)).replace(/\.ts$/, '.js')
      mkdirSync(dirname(out), { recursive: true })
      const source = file.endsWith('utils/absorb.ts')
        ? alter(readFileSync(file, 'utf8'))
        : readFileSync(file, 'utf8')
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
        },
      })
      writeFileSync(out, outputText)
    }
    mkdirSync(join(dir, 'node_modules/@opentelemetry/api'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules/@opentelemetry/api/index.js'),
      `const reject = () => Promise.reject(new Error('span'))
const span = { setStatus: reject, setAttributes: reject, end: reject }
exports.trace = { getTracer: () => ({ startActiveSpan: (_name, _options, fn) => fn(span) }) }`,
    )
    writeFileSync(
      join(dir, 'driver.js'),
      `let count = 0
process.on('unhandledRejection', () => { count += 1 })
require('reflect-metadata')
const { StorageMetricsTally } = require('./server/observability/storage-metrics-tally')
const { StorageTracing } = require('./server/observability/storage-tracing')
const { StorageObserver } = require('./server/observability/storage-observer')
;(async () => {
${driver}
setTimeout(() => { process.stdout.write(String(count)) }, 100)
})()`,
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

const ASYNC_LISTENER = `const tally = new StorageMetricsTally()
tally.onDuration(() => Promise.reject(new Error('listener')))
tally.onDuration(() => ({ then: (_ok, fail) => fail(new Error('thenable')) }))
tally.operation('head', 'success', 0.1)`

const ASYNC_SPAN = `const tracing = new StorageTracing()
await tracing.onModuleInit()
const observer = new StorageObserver(new StorageMetricsTally(), tracing)
await observer.observe('upload', () => Promise.resolve(1), { span: 'storage.upload' })
await observer.observe('upload', () => Promise.reject(new Error('op')), { span: 'storage.upload' }).catch(() => undefined)`

describe('an async host function in the observability seam', () => {
  it('leaves no unhandled rejection when it is a duration listener that rejects', () => {
    expect(unhandledRejections(ASYNC_LISTENER)).toBe(0)
  })

  it('leaves no unhandled rejection when it is a span whose methods return rejecting promises', () => {
    expect(unhandledRejections(ASYNC_SPAN)).toBe(0)
  })

  it('does count them on a copy of absorb without the handler, so the check can fail', () => {
    expect(unhandledRejections(ASYNC_LISTENER, withoutHandler)).toBe(2)
    expect(unhandledRejections(ASYNC_SPAN, withoutHandler)).toBeGreaterThan(0)
  })
})
