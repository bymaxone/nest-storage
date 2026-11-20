/**
 * @fileoverview A logger or an observer that is async although it is typed `void` cannot end the process.
 * Jest never fires `unhandledRejection` inside a test, so the library's own `absorb` and `emit` are
 * transpiled to a temporary directory and run in a child `node` process that counts the real events; the
 * same run on a copy of `absorb` without the handler proves the check can fail.
 * @layer server/utils
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const SOURCE = (name: string): string => readFileSync(join(__dirname, `${name}.ts`), 'utf8')

/** What the child counted, running `driver` against the two modules (with `absorb` possibly altered). */
function unhandledRejections(driver: string, alter: (absorbSource: string) => string = (text) => text): number {
  const dir = mkdtempSync(join(tmpdir(), 'absorb-'))
  try {
    const compile = (source: string): string =>
      ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
        .outputText
    writeFileSync(join(dir, 'absorb.js'), compile(alter(SOURCE('absorb'))))
    writeFileSync(join(dir, 'log-event.js'), compile(SOURCE('log-event')))
    writeFileSync(
      join(dir, 'driver.js'),
      `let count = 0
process.on('unhandledRejection', () => { count += 1 })
const { absorb } = require('./absorb')
const { emit } = require('./log-event')
${driver}
setTimeout(() => { process.stdout.write(String(count)) }, 100)`,
    )
    const run = spawnSync(process.execPath, [join(dir, 'driver.js')], { encoding: 'utf8', timeout: 20000 })
    return Number(run.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const withoutHandler = (text: string): string => {
  expect(text).toContain('.then(undefined, () => undefined)')
  return text.replace('.then(undefined, () => undefined)', '')
}

const ASYNC_LOGGER = `const rejecting = () => Promise.reject(new Error('host logger'))
const logger = { debug: rejecting, log: rejecting, warn: rejecting, error: rejecting }
for (const level of ['debug', 'log', 'warn', 'error']) emit(logger, level, { event: 'E', message: 'm' })`

const NEST_LOGGER = (nest: string): string => `const { Logger } = require(${JSON.stringify(nest)})
Logger.overrideLogger({ warn() { throw new Error('host logger') }, log() {}, error() {}, debug() {} })
try { emit(new Logger('X'), 'warn', { event: 'E', message: 'm' }) } catch { count += 1000 }`

describe('a host LoggerService behind a real Nest Logger', () => {
  const nest = require.resolve('@nestjs/common')

  it('does not let a synchronous throw reach the caller', () => {
    expect(unhandledRejections(NEST_LOGGER(nest))).toBe(0)
  })

  it('does let it through on a copy of absorb without the try, so the check can fail', () => {
    const withoutTry = (text: string): string => {
      expect(text).toContain('catch {')
      return text.replace('catch {', 'finally {')
    }
    expect(unhandledRejections(NEST_LOGGER(nest), withoutTry)).toBe(1000)
  })
})

describe('an async host function', () => {
  it('leaves no unhandled rejection when it is a logger method that rejects', () => {
    expect(unhandledRejections(ASYNC_LOGGER)).toBe(0)
  })

  it('leaves no unhandled rejection when it is an observer or a thenable that rejects', () => {
    const observers = `absorb(() => Promise.reject(new Error('observer')))
absorb(() => ({ then: (_ok, fail) => fail(new Error('thenable')) }))
absorb(() => ({ then: () => { throw new Error('then') } }))`

    expect(unhandledRejections(observers)).toBe(0)
  })

  it('does count them on a copy of absorb without the handler, so the check can fail', () => {
    expect(unhandledRejections(ASYNC_LOGGER, withoutHandler)).toBe(4)
  })
})
