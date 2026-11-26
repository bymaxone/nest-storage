#!/usr/bin/env node
// @ts-check
import { readFileSync } from 'node:fs'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

/**
 * Brotli-compressed bundle budgets in bytes (never gzip). The server entry
 * carries the full NestJS module surface; the AWS SDK is a peer dependency and
 * stays external, so the shipped bundle is library code only. The shared entry
 * is types and constants. Both the ESM and the CJS build are measured, at maximum brotli quality. A ceiling is the measured size plus 30 B, and
 * the number is stated where it is changed.
 */
const BUDGETS = [
  {
    name: 'server (NestJS module + AWS SDK externals)',
    path: 'dist/server/index.mjs',
    brotli: 34_448,
  },
  {
    name: 'server CJS (NestJS module + AWS SDK externals)',
    path: 'dist/server/index.cjs',
    brotli: 34_470,
  },
  {
    name: 'observability (metrics contributor + readiness indicator)',
    path: 'dist/observability/index.mjs',
    brotli: 2_300,
  },
  {
    name: 'observability CJS (metrics contributor + readiness indicator)',
    path: 'dist/observability/index.cjs',
    brotli: 2_324,
  },
  { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 3_500 },
  { name: 'shared CJS (types + constants)', path: 'dist/shared/index.cjs', brotli: 3_500 },
]

let failed = false

for (const { name, path, brotli: budget } of BUDGETS) {
  let raw
  try {
    raw = readFileSync(path)
  } catch {
    console.error(`✖ ${name} — ${path} missing (run "pnpm build" first)`)
    failed = true
    continue
  }

  const size = brotliCompressSync(raw, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY },
  }).length
  const ok = size <= budget
  console.log(
    `${ok ? '✔' : '✖'} ${name} — ${size} B brotli / ${budget} B budget (${ok ? 'within budget' : 'OVER BUDGET'})`,
  )
  if (!ok) failed = true
}

if (failed) {
  console.error('Bundle size budget exceeded.')
  process.exit(1)
}

console.log('All bundles within budget.')
