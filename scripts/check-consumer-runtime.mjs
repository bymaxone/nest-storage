#!/usr/bin/env node
/**
 * Consumer load gate.
 *
 * Every other gate reads the source or the type declarations. This one packs the
 * tarball, lays it out the way npm would, and loads every subpath from it — in
 * ESM and in CommonJS — asserting the values each one is supposed to export are
 * really there.
 *
 * `attw` proves the declarations *resolve*; it never runs the JavaScript. A
 * broken `exports` map, a bundler misconfiguration, or an entry that ships an
 * empty module all pass a type check and fail here.
 *
 * It shells out to `npm pack` and `tar`, both of which have to be on PATH. That
 * is deliberate: packing through npm itself is what makes the gate inspect the
 * same tarball a publish would produce, rather than a directory that resembles
 * it. On Windows, run it from a shell that provides `tar` (Git Bash, WSL, or
 * Windows 10 1803+, which ships bsdtar).
 *
 * Usage: `node scripts/check-consumer-runtime.mjs` (run after `pnpm build`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
// Read from the manifest rather than hard-coded: this gate exists to inspect
// the packed artifact, so a rename must not leave it silently checking a
// package that no longer exists.
const packageName = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).name
const consumerDir = join(rootDir, '.consumer-runtime-check')

/** Subpath → the values a consumer must find on it. */
const SUBPATHS = {
  ".": [
    "BymaxStorageModule",
    "StorageService",
    "SignedUrlService",
    "StorageException",
    "NoOpFileScanner",
    "NoOpUploadValidator",
    "providerRecipes",
    "STORAGE_ERROR_CODES",
    "BYMAX_STORAGE_OPTIONS",
    "BYMAX_STORAGE_S3_CLIENT"
  ],
  "./shared": [
    "STORAGE_ERROR_CODES",
    "DEFAULT_SIGNED_URL_TTL_SECONDS",
    "MAX_SIGNED_URL_TTL_SECONDS",
    "DEFAULT_IMAGE_MIME_WHITELIST",
    "DEFAULT_VIDEO_MIME_WHITELIST",
    "DEFAULT_DOC_MIME_WHITELIST",
    "DEFAULT_MULTIPART_THRESHOLD_BYTES",
    "DEFAULT_MULTIPART_PART_SIZE_BYTES",
    "DEFAULT_MULTIPART_QUEUE_SIZE"
  ]
}

const probeBody = `
const failures = []
for (const [subpath, names] of Object.entries(SUBPATHS)) {
  const namespace = loaded[subpath]
  if (namespace === undefined) {
    failures.push(subpath + ' did not load')
    continue
  }
  const missing = names.filter((name) => namespace[name] === undefined)
  if (missing.length) failures.push(subpath + ' does not export: ' + missing.join(', '))
}
if (failures.length) {
  for (const failure of failures) console.error('  ✗ ' + failure)
  process.exit(1)
}
const total = Object.values(SUBPATHS).reduce((sum, names) => sum + names.length, 0)
console.log('  ✓ ' + FORMAT + ': ' + Object.keys(SUBPATHS).length + ' subpath(s), ' + total + ' export(s) present')
`

const specifier = (subpath) => (subpath === '.' ? packageName : packageName + subpath.slice(1))

const esmProbe = `${Object.keys(SUBPATHS)
  .map((s, i) => `import * as m${i} from '${specifier(s)}'`)
  .join('\n')}
const SUBPATHS = ${JSON.stringify(SUBPATHS)}
const loaded = { ${Object.keys(SUBPATHS).map((s, i) => `'${s}': m${i}`).join(', ')} }
const FORMAT = 'ESM'
${probeBody}`

const cjsProbe = `${Object.keys(SUBPATHS)
  .map((s, i) => `const m${i} = require('${specifier(s)}')`)
  .join('\n')}
const SUBPATHS = ${JSON.stringify(SUBPATHS)}
const loaded = { ${Object.keys(SUBPATHS).map((s, i) => `'${s}': m${i}`).join(', ')} }
const FORMAT = 'CJS'
${probeBody}`

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
}

function cleanup() {
  rmSync(consumerDir, { recursive: true, force: true })
}

console.log('Consumer load gate')

if (!existsSync(join(rootDir, 'dist'))) {
  console.error('✗ dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

cleanup()
const packDir = mkdtempSync(join(tmpdir(), 'pack-'))
let failed = false

try {
  // `--ignore-scripts` keeps `prepublishOnly` from rebuilding underneath the
  // artifact this gate is meant to inspect.
  // The tarball is located by reading the directory it was packed into, not by
  // parsing `npm pack`'s stdout. Inside a publish, npm writes notices around the
  // filename, so taking the last line yields a path with trailing text and `tar`
  // fails on a name that does not exist. The directory is freshly created and
  // holds exactly one archive.
  // `npm_config_dry_run` is cleared for the child: a `npm publish --dry-run`
  // pre-flight exports it, the nested pack inherits it, and a dry pack writes no
  // file — so the gate would report a missing tarball for a reason that has
  // nothing to do with the package. Cleared, the gate means the same thing in
  // every context it can be invoked from.
  const packEnv = { ...process.env }
  delete packEnv['npm_config_dry_run']
  // `cwd: rootDir`: the package to pack is this repository's, whatever directory
  // the script was invoked from. Without it the gate would inspect whichever
  // package npm resolved from the caller's cwd.
  run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', packDir], {
    cwd: rootDir,
    env: packEnv,
  })
  const packed = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
  if (packed.length !== 1) {
    throw new Error(`expected one tarball in ${packDir}, found ${packed.length}`)
  }
  const tarball = join(packDir, packed[0])

  const packageDir = join(consumerDir, 'node_modules', packageName)
  mkdirSync(packageDir, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])

  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'consumer-runtime-check', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
  )
  writeFileSync(join(consumerDir, 'probe.mjs'), esmProbe)
  writeFileSync(join(consumerDir, 'probe.cjs'), cjsProbe)

  for (const probe of ['probe.mjs', 'probe.cjs']) {
    try {
      process.stdout.write(run('node', [probe], { cwd: consumerDir, stdio: 'pipe' }))
    } catch (error) {
      process.stdout.write(error.stdout ?? '')
      process.stderr.write(error.stderr ?? '')
      failed = true
    }
  }
} catch (error) {
  console.error(`✗ gate setup failed: ${error.message}`)
  if (error.stderr) process.stderr.write(error.stderr)
  failed = true
} finally {
  cleanup()
  rmSync(packDir, { recursive: true, force: true })
}

if (failed) {
  console.error('\n✗ The published artifact does not load for a consumer.')
  process.exit(1)
}

console.log('✓ Every subpath loads in ESM and CommonJS.')
