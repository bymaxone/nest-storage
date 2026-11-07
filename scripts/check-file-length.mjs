/**
 * @fileoverview File-length gate — fails when a tracked source file is longer than the limit,
 * unless the file is on a frozen baseline that can only shrink.
 * @layer scripts
 *
 * A file that already exceeds the limit is listed in the baseline with its length, so the check
 * can be red for what a change introduces without failing on what the repository inherits. The
 * list is kept honest from both sides:
 *
 * - a file over the limit that is not on the baseline fails (a new or grown offender);
 * - a baselined file that grew past its recorded length fails (the baseline cannot widen);
 * - a baselined file that shrank but is still over the limit fails until its entry is lowered
 *   to the new length, so the recorded number always matches the file;
 * - a baselined file that is now at or under the limit, or no longer tracked, fails until its
 *   entry is removed, so a fixed file cannot quietly regress later.
 *
 * Plain Node with no dependencies: copy this file and `file-length-baseline.json` as they are.
 *
 * Usage: node scripts/check-file-length.mjs [--root <dir>] [--baseline <file>]
 *   --root      repository root (default: the current directory)
 *   --baseline  JSON `{ "files": { "<path>": <length>, ... } }` (default: scripts/file-length-baseline.json)
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The most lines a source file may have. */
const LIMIT = 800

/** Tracked files with these extensions are source. Markdown, JSON and lockfiles are out of scope. */
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** Reads `--name value` from the arguments, or returns the fallback. */
function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

/** Number of lines in a text: the count of line feeds, plus a final line without one. */
function lineCount(text) {
  if (text.length === 0) return 0
  const feeds = text.split('\n').length - 1
  return text.endsWith('\n') ? feeds : feeds + 1
}

/** Paths of the tracked source files, relative to the root. */
function trackedSources(root) {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  return listing.split('\0').filter((path) => path !== '' && SOURCE_EXTENSION.test(path))
}

/** Lengths of the tracked source files over the limit, keyed by path. */
function oversize(root) {
  const lengths = {}
  for (const path of trackedSources(root)) {
    const length = lineCount(readFileSync(join(root, path), 'utf8'))
    if (length > LIMIT) lengths[path] = length
  }
  return lengths
}

/** Reads the baseline's `files` table, failing loudly on a file that is not one. */
function readBaseline(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const files = parsed?.files
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error(`${path}: expected { "files": { "<path>": <length> } }`)
  }
  for (const [file, length] of Object.entries(files)) {
    if (!Number.isInteger(length) || length <= LIMIT) {
      throw new Error(`${path}: ${file} must record an integer length above ${LIMIT}, got ${String(length)}`)
    }
  }
  return files
}

/** Compares the files over the limit with the baseline and returns one message per problem. */
function problemsOf(over, baseline) {
  const problems = []
  for (const [file, length] of Object.entries(over)) {
    const recorded = baseline[file]
    if (recorded === undefined) {
      problems.push(`${file} has ${length} lines, over the limit of ${LIMIT}. Split it by responsibility.`)
    } else if (length > recorded) {
      problems.push(`${file} grew from ${recorded} to ${length} lines. A baselined file may only shrink.`)
    } else if (length < recorded) {
      problems.push(`${file} shrank to ${length} lines. Lower its baseline entry from ${recorded} to ${length}.`)
    }
  }
  for (const file of Object.keys(baseline)) {
    if (over[file] === undefined) {
      problems.push(`${file} is on the baseline but is no longer over ${LIMIT} lines or tracked. Remove its entry.`)
    }
  }
  return problems
}

const root = resolve(option('--root', process.cwd()))
const baselinePath = resolve(option('--baseline', join(root, 'scripts', 'file-length-baseline.json')))

const problems = problemsOf(oversize(root), readBaseline(baselinePath))

if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`)
  console.error(`\n${problems.length} file-length problem(s). The limit is ${LIMIT} lines.`)
  process.exit(1)
}

console.log(`Every tracked source file is within ${LIMIT} lines, or frozen on the baseline.`)
