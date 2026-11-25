/**
 * @fileoverview Pins the Stryker ignore list to the inventory exempt list: a spec the mutation run
 * leaves out is named, with a reason, in `scripts/mutation-inventory.exempt.json`, and every entry
 * of that list names a file that exists.
 * @layer repository tooling, tests
 *
 * The cold `Mutation (full)` run ends with an inventory step that fails when a unit test did not
 * run in it and its file is not exempt. A pattern added to `testPathIgnorePatterns` of
 * `jest.stryker.config.ts` and not to the exempt list therefore costs a whole cold run before
 * anything says so; this spec says so in seconds. It reads the Stryker configuration, the JSON and
 * the file tree as text, and runs no code of the package.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

const EXEMPT = (
  JSON.parse(readFileSync(join(ROOT, 'scripts/mutation-inventory.exempt.json'), 'utf8')) as {
    file: string
    reason: string
  }[]
).map((entry) => entry.file)

/**
 * The patterns `jest.stryker.config.ts` adds to `testPathIgnorePatterns`, read from its text: the
 * file imports the base configuration by a `.ts` path, which this suite's compiler does not accept.
 * The default `/node_modules/` is not one of them.
 */
const CONFIG = readFileSync(join(ROOT, 'jest.stryker.config.ts'), 'utf8')
const LIST = /testPathIgnorePatterns:\s*\[([\s\S]*?)\n\s*\]/.exec(CONFIG)?.[1] ?? ''
const ADDED = [...LIST.matchAll(/'((?:\\.|[^'\\])*)'/g)]
  .map((match) => (match[1] ?? '').replaceAll('\\\\', '\\'))
  .filter((pattern) => pattern !== '/node_modules/')

/** Every spec under `src`, as a path from the repository root. */
const SPECS = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.spec.ts'))
  .map((file) => `src/${file}`)

describe('the Stryker ignore list and the inventory exempt list', () => {
  /*
   * Given every spec under src and the patterns jest.stryker.config.ts adds to testPathIgnorePatterns
   * When each spec's path is matched against them
   * Then every spec a pattern ignores is named in the exempt list
   */
  it('names every spec the Stryker run ignores in the exempt list', () => {
    const unlisted = SPECS.filter(
      (file) =>
        ADDED.some((pattern) => new RegExp(pattern).test(`/${file}`)) && !EXEMPT.includes(file),
    )

    expect(unlisted).toStrictEqual([])
  })

  /*
   * Given the patterns jest.stryker.config.ts adds
   * When the list of them is read
   * Then it is not empty, so the row above judges something
   */
  it('reads the patterns the Stryker configuration adds', () => {
    expect(ADDED.length).toBeGreaterThan(0)
  })

  /*
   * Given every entry of the exempt list
   * When its path is looked up under the repository root
   * Then each names a file that exists, so an entry cannot outlive the spec it excuses
   */
  it('lists only files that exist', () => {
    const missing = EXEMPT.filter((file) => !existsSync(join(ROOT, file)))

    expect(missing).toStrictEqual([])
  })
})
