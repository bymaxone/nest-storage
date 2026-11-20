import { defineConfig, type Options } from 'tsup'

/**
 * Bundling configuration for the two published subpaths. Every `@nestjs/*`
 * package, every `@aws-sdk/*` package, and `reflect-metadata` stay external so
 * they are never bundled — the library declares them as peer dependencies and
 * resolves them from the host application at runtime. The `shared` entry has no
 * externals because it carries zero dependencies (pure types and constants).
 */
const server: Options = {
  entry: { 'server/index': 'src/server/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  // `@opentelemetry/api` is loaded with a dynamic import at start-up and is optional: the bundle must never inline it.
  external: [/^@nestjs\//, /^@aws-sdk\//, 'reflect-metadata', '@opentelemetry/api'],
  target: 'node24',
  clean: false,
  splitting: false,
  treeshake: true,
  sourcemap: false,
}

const shared: Options = {
  entry: { 'shared/index': 'src/shared/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  target: 'node24',
  clean: false,
  splitting: false,
  treeshake: true,
  sourcemap: false,
}

export default defineConfig([server, shared])
