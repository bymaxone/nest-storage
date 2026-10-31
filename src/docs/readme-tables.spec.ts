/**
 * @fileoverview Pins the README's option-defaults table and error-code table to
 * the code they describe. The tables are prose a reader trusts, so a default or a
 * status that drifts from the implementation fails here by name instead of
 * surviving until a consumer notices.
 * @layer docs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyDefaults } from '../server/config/apply-defaults'
import { STORAGE_ERROR_STATUS } from '../server/errors/storage-error-status'
import { STORAGE_ERROR_CODES } from '../shared/constants/error-codes.constants'

const README = readFileSync(join(process.cwd(), 'README.md'), 'utf8')

/** The rows of the first Markdown table after `heading`, as trimmed cell arrays (header and rule skipped). */
function tableAfter(heading: string): string[][] {
  const start = README.indexOf(heading)
  if (start === -1) {
    throw new Error(`README heading not found: ${heading}`)
  }
  const lines = README.slice(start).split('\n')
  const first = lines.findIndex((line) => line.startsWith('|'))
  const rows: string[][] = []
  for (const line of lines.slice(first)) {
    if (!line.startsWith('|')) {
      break
    }
    // Split on unescaped pipes: a cell may contain `\|` (a union type).
    const cells = line
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim())
    rows.push(cells)
  }
  return rows.slice(2)
}

/** The text inside the first pair of backticks in a cell, or undefined. */
function code(cell: string | undefined): string | undefined {
  return cell === undefined ? undefined : /`([^`]+)`/.exec(cell)?.[1]
}

/** Parses a documented default: `3`, `604800`, `false`, `'WHEN_SUPPORTED'`, or `10 MiB`. */
function parseDefault(raw: string): unknown {
  const mib = /^(\d+) MiB$/.exec(raw)
  if (mib?.[1] !== undefined) {
    return Number(mib[1]) * 1024 * 1024
  }
  if (raw === 'true' || raw === 'false') {
    return raw === 'true'
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw)
  }
  return raw.replace(/^'|'$/g, '')
}

function valueAt(source: object, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], source)
}

const resolved = applyDefaults({
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
})

/** Options whose default the code assigns, which the table must therefore document. */
const DEFAULTED_OPTIONS = [
  'forcePathStyle',
  'defaultPublicRead',
  'defaultCacheControl',
  'defaultContentDisposition',
  'signedUrls.defaultGetTtlSeconds',
  'signedUrls.defaultPutTtlSeconds',
  'signedUrls.maxTtlSeconds',
  'multipart.thresholdBytes',
  'multipart.partSizeBytes',
  'multipart.queueSize',
  'maxAttempts',
  'requestTimeoutMs',
]

describe('README configuration table', () => {
  const rows = tableAfter('## ⚙️ Configuration')
  const documented = new Map(rows.map((cells) => [code(cells[0]), cells[2] ?? '']))

  it('documents every option the code defaults', () => {
    // A defaulted option missing from the table is a default a reader cannot find.
    for (const path of DEFAULTED_OPTIONS) {
      expect(documented.has(path)).toBe(true)
    }
  })

  it.each(DEFAULTED_OPTIONS)('documents the real default of %s', (path) => {
    const cell = documented.get(path) ?? ''
    const literal = code(cell)
    // Compare what the table says with what applyDefaults resolves.
    expect(literal).toBeDefined()
    expect(parseDefault(literal ?? '')).toEqual(valueAt(resolved, path))
  })

  it('lists no option the module does not resolve or accept', () => {
    // A row naming an option that does not exist (a renamed field) fails here, by name.
    // `credentials` is a non-enumerable accessor and the rest have no default, so none is a key of `resolved`.
    const withoutDefault = [
      'credentials',
      'validation.mimeWhitelist',
      'validation.maxSizeBytes',
      'validation.customValidators',
      'scanner',
      'serverSideEncryption',
      'kmsKeyId',
    ]
    const known = new Set([
      ...Object.keys(resolved),
      ...Object.keys(resolved.signedUrls).map((key) => `signedUrls.${key}`),
      ...Object.keys(resolved.multipart).map((key) => `multipart.${key}`),
      ...withoutDefault,
      'cdnBaseUrl',
    ])
    const unknown = rows.map((cells) => code(cells[0]) ?? '').filter((name) => !known.has(name))
    expect(unknown).toEqual([])
  })
})

describe('README error-code table', () => {
  const rows = tableAfter('## 🚨 Error Codes')
  const documented = new Map(rows.map((cells) => [code(cells[0]), Number(cells[1])]))

  it('lists every error code the library defines', () => {
    for (const name of Object.keys(STORAGE_ERROR_CODES)) {
      expect(documented.has(name)).toBe(true)
    }
  })

  it('lists no code the library does not define', () => {
    const known = new Set<string>(Object.keys(STORAGE_ERROR_CODES))
    for (const name of documented.keys()) {
      expect(known.has(name ?? '')).toBe(true)
    }
  })

  it.each(Object.keys(STORAGE_ERROR_CODES))('documents the real HTTP status of %s', (name) => {
    expect(documented.get(name)).toBe(STORAGE_ERROR_STATUS[name as keyof typeof STORAGE_ERROR_STATUS])
  })
})
