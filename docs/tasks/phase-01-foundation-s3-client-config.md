# Phase 1 — Foundation + S3 Client + Config

> **Status**: ✅ Done · **Progress**: 17 / 17 tasks · **Last updated**: 2026-06-30
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) §2
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §2–§4, §12

---

## Context

This phase establishes the full project scaffold for `@bymax-one/nest-storage` and the public contracts the rest of the library is built on: shared types and constants (zero-dependency `./shared` subpath), server interfaces, DI tokens, the error catalog, and configuration validation/merge. It implements the first two runtime building blocks — `S3ClientProvider` (correct `S3Client` lifecycle with lazy, credential-tolerant init) and `KeyResolverService` (path-traversal guard + global `keyPrefix`) — and wires the synchronous `BymaxStorageModule.forRoot()`.

When the phase closes, the library can be installed in a NestJS fixture app, credentials configured, and the `S3Client` instantiated (no S3 calls yet — those land in the next phase). The four CI workflows (`ci`, `codeql`, `scorecard`, `release`) are front-loaded here so every pull request is gated from the first one; the release workflow stays inert until a `v*.*.*` tag exists.

---

## Rules-of-phase

1. **TDD — test-first.** Write the failing spec before the implementation for every service, mapper, validator, and config function; let the test drive the shape.
2. **100% line/branch coverage on every file implemented in this phase** — the Bymax library floor (not 80%). Mutation testing runs under Stryker with thresholds **high 100 / low 95 / break 95**; `key-resolver.service.ts` is security-critical and must not relax the gate (use a narrow `// Stryker disable next-line` with a justification over lowering the threshold).
3. **English-only and timeless comments.** No `Phase N`, `Task X`, or roadmap-stage references inside any code, JSDoc (`@param`/`@returns`/`@throws`), config, or committed YAML. Explain *what* and *why*, never *which roadmap stage*.
4. **`@fileoverview` + `@layer` header on every source file** — state the file's single responsibility and its architectural layer.
5. **Clean-code sizing.** Functions ≤ 50 lines; files ≤ 800 (200–400 typical). Split by responsibility.
6. **Official-docs-first.** Before touching any AWS SDK v3 API (`S3Client` config, `destroy()`, `@aws-sdk/s3-request-presigner`), re-verify the current docs via context7 (`resolve-library-id` → `query-docs`). Do not code SDK options from memory.
7. **Conventional Commits**, `<type>(storage): <subject> (<id>)` — **no `Co-Authored-By` trailer**, no AI-attribution footer of any kind.
8. **Never create `.gitkeep` / `.keep` or empty-directory placeholders.** Directories emerge from real files only. `test/e2e/` is created in a later phase when the first e2e spec is written — do not pre-create it.
9. **Zero direct dependencies.** `package.json` keeps `"dependencies": {}`; everything is a peer dep. `src/shared/` imports zero `@nestjs/*` and `@aws-sdk/*` (verifiable by grep).
10. **AWS SDK v3 is SigV4-only — there is NO `signatureVersion` option anywhere** (not in the options interface, not in resolved options, not in the merge, not in the `S3Client` config). Use **`maxAttempts`** (NOT v2's `maxRetries`); `DEFAULT_MAX_ATTEMPTS = 3`.
11. **Provider checksum trap (the #1 compatibility issue).** The options, resolved options, and `S3Client` config all carry `requestChecksumCalculation` and `responseChecksumValidation` (`'WHEN_SUPPORTED' | 'WHEN_REQUIRED'`, default `'WHEN_SUPPORTED'`). AWS S3 accepts the default; non-AWS providers (R2, B2, MinIO, Spaces, Wasabi) reject the default CRC32 integrity headers and require `'WHEN_REQUIRED'`.
12. **Bundle budgets are brotli** (never gzip): `server` < 30 KB brotli, `shared` < 3.5 KB brotli.
13. **DI tokens are `Symbol`.** The internal maps `STORAGE_ERROR_MESSAGES` (code→message) and `STORAGE_ERROR_STATUS` (code→`HttpStatus`) are implementation details and are **NOT exported**; only `STORAGE_ERROR_CODES` and `StorageException` are public.
14. **`defaultPublicRead` via ACL is a known dead-end** on modern AWS S3 (returns HTTP 400 `AccessControlListNotSupported` when Object Ownership = "Bucket owner enforced") and a no-op on Cloudflare R2 — document this where the field/flag is defined; prefer bucket policy / CDN / signed URLs.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md) §2.1 (scaffold + `package.json` + `tsup.config.ts` + the four CI workflows), §2.2 (shared types & constants skeletons), §2.3 (interface skeletons), §2.4 (DI tokens + default-options), §2.5 (validate/resolved/apply-defaults), §2.6 (error catalog), §2.7 (`KeyResolverService`), §2.8 (`S3ClientProvider`), §2.9 (`forRoot`), §2.10 (tests + barrel), §2.11 (phase validation), §6.5 (bundle budgets).
- [`../technical_specification.md`](../technical_specification.md) §2 (architecture + `S3Client` lifecycle), §3 (package structure + subpath exports), §4 (configuration API + provider recipes), §12 (error code catalog + `STORAGE_ERROR_STATUS` + AWS mapping).
- `/bymax-workflow:standards` — universal Clean Code + SOLID rules.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 1.1 | Project scaffold — `package.json` + pnpm init | ✅ Done | P0 | S | — |
| 1.2 | Build config — `tsconfig.*` + `tsup.config.ts` | ✅ Done | P0 | S | 1.1 |
| 1.3 | ESLint + Prettier + `.gitignore` + `.npmignore` | ✅ Done | P1 | S | 1.1 |
| 1.4 | Jest configs (4 variants) + Stryker config | ✅ Done | P0 | S | 1.2 |
| 1.5 | `scripts/check-size.mjs` — brotli bundle gate | ✅ Done | P1 | S | 1.2 |
| 1.6 | `src/` structure + four CI workflows (ci/codeql/scorecard/release, incl. e2e job) | ✅ Done | P0 | L | 1.2, 1.3, 1.4, 1.5 |
| 1.7 | Shared types | ✅ Done | P0 | S | 1.6 |
| 1.8 | Shared constants (`STORAGE_ERROR_CODES`, MIME whitelists, TTLs) | ✅ Done | P0 | S | 1.6 |
| 1.9 | Server interfaces (8 contracts + barrel) | ✅ Done | P0 | M | 1.7 |
| 1.10 | DI tokens (Symbol) + default-options constants | ✅ Done | P0 | S | 1.8 |
| 1.11 | Error catalog — messages + status map + `StorageException` + AWS mapper | ✅ Done | P0 | M | 1.8 |
| 1.12 | Config — `validate-options` + `resolved-options` + `apply-defaults` | ✅ Done | P0 | M | 1.9, 1.10, 1.11 |
| 1.13 | `KeyResolverService` — path-traversal guard + `keyPrefix` | ✅ Done | P0 | M | 1.11, 1.12 |
| 1.14 | `S3ClientProvider` — lifecycle + lazy init | ✅ Done | P0 | M | 1.12 |
| 1.15 | `BymaxStorageModule.forRoot()` synchronous + initial barrel | ✅ Done | P0 | S | 1.13, 1.14 |
| 1.16 | Unit tests — config, error catalog, KeyResolver, S3ClientProvider, module | ✅ Done | P0 | L | 1.12, 1.13, 1.14, 1.15 |
| 1.17 | Phase validation + integration smoke | ✅ Done | P0 | S | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16 |

---

## Tasks

### Task 1.1 — Project scaffold: `package.json` + pnpm init

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: —

#### Description

Initialize `package.json` under the `@bymax-one` scope with canonical scripts, the six required peer dependencies, the dev toolchain, and `"dependencies": {}` (zero direct deps). Establish the two-subpath `exports` map (`.` server, `./shared`) and run `pnpm install`.

#### Acceptance criteria

- [ ] `package.json` created with `"name": "@bymax-one/nest-storage"`, `"version": "0.1.0-alpha.0"`, `"type": "module"`, `"sideEffects": false`, `"files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"]`.
- [ ] `exports` declares exactly two subpaths — `.` (server entry) and `./shared` (types + constants) — each with `types`/`import`/`require`.
- [ ] `"dependencies": {}` (zero direct deps); the six peer deps (`@nestjs/common`, `@nestjs/core`, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`, `reflect-metadata`) are present and all marked `{ "optional": false }` in `peerDependenciesMeta`.
- [ ] All canonical scripts present (`build`, `lint`, `lint:fix`, `test`, `test:cov`, `test:watch`, `test:e2e`, `test:all`, `test:cov:all`, `mutation`, `mutation:incremental`, `mutation:dry-run`, `typecheck`, `size`, `clean`, `prepublishOnly`, `release`).
- [ ] `"packageManager": "pnpm@10.8.1"`, `"engines": { "node": ">=24.0.0" }`, `"publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }`.
- [ ] `pnpm install` completes with no missing-peer-dep warnings; `pnpm-lock.yaml` is generated.

#### Files to create / modify

- `package.json`
- `pnpm-lock.yaml` (generated)

#### Agent prompt

````
You are a senior NestJS library release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a public, provider-agnostic S3-compatible object-storage
library for NestJS (AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, MinIO, Wasabi)
built on a single `@aws-sdk/client-s3` engine. Published to npm with two subpaths: `.` (server)
and `./shared` (zero-dependency types + constants). Zero direct dependencies — everything is a
peer dep. Mirrors the conventions of the sibling `@bymax-one/nest-auth`.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.1 of 17 (FIRST)

PRECONDITIONS
- The repo currently contains only `docs/`. No source, no config, no node_modules.

REQUIRED READING (only these — do not load whole files):
- `docs/development_plan.md` §2.1 "Detail — `package.json` for this phase" (the full package.json
  block) and the config-source table at the top of §2.1.
- `docs/technical_specification.md` §14 "Dependencies (peer deps)" (the peer-dep strategy and the
  six required peers).

TASK
Author `package.json` exactly per the §2.1 block and install dependencies.

DELIVERABLES
1. `package.json` with: scope `@bymax-one/nest-storage`; version `0.1.0-alpha.0`; `type: module`;
   `sideEffects: false`; `files: ["dist","LICENSE","README.md","CHANGELOG.md"]`; the two-subpath
   `exports` map (`.` → `dist/server/index.{d.ts,mjs,cjs}`, `./shared` → `dist/shared/index.*`);
   `"dependencies": {}`; the six `peerDependencies` (`@nestjs/common ^11`, `@nestjs/core ^11`,
   `@aws-sdk/client-s3 ^3.700.0`, `@aws-sdk/lib-storage ^3.700.0`,
   `@aws-sdk/s3-request-presigner ^3.700.0`, `reflect-metadata ^0.2.0`) all marked optional:false
   in `peerDependenciesMeta`; the dev toolchain (NestJS 11 suite, jest 30 + ts-jest 29, Stryker 9
   + jest-runner + typescript-checker, testcontainers 10 + @testcontainers/minio, tsup 8.5,
   typescript 5.9, eslint 9, prettier 3.8, supertest 7) per the §2.1 list; all canonical scripts;
   `packageManager: pnpm@10.8.1`; `engines.node >=24.0.0`; `publishConfig` public.
2. Run `pnpm install` in the package root and confirm `pnpm-lock.yaml` is generated cleanly.

Constraints:
- `"dependencies": {}` — zero direct deps. The AWS SDK and NestJS are peers + devDeps only.
- Do NOT invent versions from memory beyond the §2.1 block; copy the listed ranges.
- English-only; no roadmap/phase references anywhere in the file.
- Do NOT create `.gitkeep` or empty-directory placeholders.

Verification:
- `pnpm install` — expected: completes, no missing-peer warnings.
- `node -e "console.log(require('./package.json').name)"` — expected: `@bymax-one/nest-storage`.
- `node -e "const p=require('./package.json'); if(Object.keys(p.dependencies||{}).length)throw new Error('non-empty dependencies')"` — expected: no throw.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.1 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): scaffold package.json (1.1)` — NO Co-Authored-By trailer.
````

---

### Task 1.2 — Build config: `tsconfig.*` + `tsup.config.ts`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1

#### Description

Create `tsconfig.json` plus the four variants (`build`/`server`/`e2e`/`jest`) and `tsup.config.ts` with the two build entries. Adapt the path aliases to the two subpaths (drop the three extra aliases `nest-auth` carries).

#### Acceptance criteria

- [ ] Five `tsconfig.*.json` files present; `tsconfig.json` `paths` declares exactly two aliases (`@bymax-one/nest-storage` → `./src/server/index.ts`, `@bymax-one/nest-storage/shared` → `./src/shared/index.ts`).
- [ ] Strict settings inherited (target ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- [ ] `tsup.config.ts` has two entries (`server/index`, `shared/index`), emits `.mjs`/`.cjs` + `.d.ts`, `treeshake: true`, and externalizes the peer deps for the server entry (`/^@nestjs\//`, `/^@aws-sdk\//`, `reflect-metadata`); the shared entry has no externals (zero deps).
- [ ] `pnpm typecheck` passes against placeholder `src/server/index.ts` and `src/shared/index.ts` (`export {}`).

#### Files to create / modify

- `tsconfig.json`, `tsconfig.build.json`, `tsconfig.server.json`, `tsconfig.e2e.json`, `tsconfig.jest.json`
- `tsup.config.ts`
- `src/server/index.ts`, `src/shared/index.ts` (placeholder `export {}`)

#### Agent prompt

````
You are a senior NestJS library build engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS on a
single `@aws-sdk/client-s3` engine; two subpaths (`.` server, `./shared` zero-dep); zero direct
deps. Mirrors `@bymax-one/nest-auth` conventions.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.2 of 17

PRECONDITIONS
- Task 1.1 done: `package.json` exists and `pnpm install` has run.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.1 — the config-source table (which nest-auth files to copy/adapt)
  and the "Detail — `tsup.config.ts`" skeleton block.
- Reference files to copy & adapt:
  `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/tsconfig.json`,
  `tsconfig.build.json`, `tsconfig.server.json`, `tsconfig.e2e.json`, `tsconfig.jest.json`.

TASK
Copy the five `tsconfig.*.json` from nest-auth and adapt; author `tsup.config.ts` with two entries.

DELIVERABLES
1. The five tsconfig files, adapted: in `tsconfig.json` swap the `paths` to exactly two aliases
   (`@bymax-one/nest-storage` → `./src/server/index.ts`,
   `@bymax-one/nest-storage/shared` → `./src/shared/index.ts`) — remove nest-auth's `/client`,
   `/react`, `/nextjs` aliases. Keep the strict compiler options
   (ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). `tsconfig.server.json`
   includes `src/server/**/*`; `tsconfig.e2e.json` includes `test/e2e/` (created later).
2. `tsup.config.ts` per the §2.1 skeleton: two entries (`server/index`, `shared/index`), formats
   `['esm','cjs']`, `dts: true`, `tsconfig: 'tsconfig.build.json'`, output `.mjs`/`.cjs`,
   `target: 'node24'`, `treeshake: true`, `splitting: false`, `sourcemap: false`. Server entry
   `external: [/^@nestjs\//, /^@aws-sdk\//, 'reflect-metadata']`; shared entry has no externals.
3. Placeholder `src/server/index.ts` and `src/shared/index.ts`, each `export {}`.

Constraints:
- Exactly two subpath aliases — not five.
- English-only; timeless comments; no roadmap/phase references.
- Do NOT create `.gitkeep` or empty-directory placeholders.

Verification:
- `pnpm typecheck` — expected: passes on the two placeholder index files.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.2 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add tsconfig and tsup build config (1.2)` — NO Co-Authored-By trailer.
````

---

### Task 1.3 — ESLint + Prettier + `.gitignore` + `.npmignore`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.1

#### Description

Lint and format configuration mirroring `nest-auth` (flat ESLint v9), adapted to the storage surface, plus `.gitignore` and a tarball-minimizing `.npmignore`.

#### Acceptance criteria

- [ ] `eslint.config.mjs` (flat config v9) adapted — rules specific to folders this lib does not have (`oauth/`, `crypto/`, `nextjs/`, `react/`) removed; keeps `@typescript-eslint/no-explicit-any` (error), `eslint-plugin-security`, `eslint-plugin-import` (order, no-cycle), and `eslint-config-prettier` last.
- [ ] `.prettierrc` identical to `nest-auth`.
- [ ] `.gitignore` covers `node_modules`, `dist`, `coverage`, `reports`, `.stryker-tmp`.
- [ ] `.npmignore` excludes `src/`, `test/`, `docs/`, `coverage/`, `reports/`, `.github/`, `*.config.ts`, `tsconfig.*.json`, `.stryker-tmp/`, `eslint.config.mjs`, `.prettierrc`; only `dist/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` remain in the tarball.
- [ ] `pnpm lint` passes on the placeholder source.

#### Files to create / modify

- `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.npmignore`

#### Agent prompt

````
You are a senior NestJS library tooling engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS;
two subpaths (`.` server, `./shared`); zero direct deps. Mirrors `@bymax-one/nest-auth`.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.3 of 17

PRECONDITIONS
- Task 1.1 done: `package.json` exists with the eslint/prettier devDeps installed.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.1 — the eslint/prettier/.gitignore rows of the config table.
- Reference files: `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/eslint.config.mjs`,
  `.prettierrc`, `.gitignore`, `.npmignore` (if present).

TASK
Copy and adapt the lint/format configs and the ignore files.

DELIVERABLES
1. `eslint.config.mjs` — copied from nest-auth, with any rules scoped to `oauth/`, `crypto/`,
   `nextjs/`, `react/` removed. Keep: `@typescript-eslint/no-explicit-any` as an error (the AWS
   SDK is strongly typed, so `any` is never needed), `eslint-plugin-security` (recommended),
   `eslint-plugin-import` (order + no-cycle), and `eslint-config-prettier` placed LAST.
2. `.prettierrc` — identical to nest-auth.
3. `.gitignore` — covers `node_modules`, `dist`, `coverage`, `reports`, `.stryker-tmp`, editor cruft.
4. `.npmignore` — excludes everything except `dist/`, `package.json`, `README.md`, `LICENSE`,
   `CHANGELOG.md` (exclude `src/`, `test/`, `docs/`, `coverage/`, `reports/`, `.github/`,
   `*.config.ts`, `tsconfig.*.json`, `.stryker-tmp/`, `eslint.config.mjs`, `.prettierrc`).

Constraints:
- English-only; timeless comments; no roadmap/phase references.
- Do NOT create `.gitkeep` or empty-directory placeholders.

Verification:
- `pnpm lint` — expected: passes with zero warnings on the placeholder source.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.3 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `chore(storage): add eslint, prettier, gitignore, npmignore (1.3)` — NO Co-Authored-By trailer.
````

---

### Task 1.4 — Jest configs (4 variants) + Stryker config

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.2

#### Description

Author `jest.config.ts`, `jest.coverage.config.ts` (100% release gate), `jest.e2e.config.ts` (60s Testcontainers timeout), `jest.stryker.config.ts`, and `stryker.config.json` with the Bymax mutation floor.

#### Acceptance criteria

- [ ] Five Jest/Stryker files created, adapted from `nest-auth`.
- [ ] `jest.config.ts` `moduleNameMapper` has exactly two entries (`^@bymax-one/nest-storage$` → `<rootDir>/server/index.ts`, `^@bymax-one/nest-storage/shared$` → `<rootDir>/shared/index.ts`).
- [ ] **`jest.config.ts` AND `jest.coverage.config.ts` both set `coverageThreshold` global to 100%** (line/branch/function/statement) — the per-PR `pnpm test:cov` gate enforces the same hard floor as the release `test:cov:all`, with no drift (the Bymax library floor for every implemented file).
- [ ] **`passWithNoTests: true` is set in `jest.config.ts`, `jest.coverage.config.ts`, AND `jest.e2e.config.ts`** so `pnpm test:cov` and `pnpm test:e2e` exit 0 on the empty scaffold (green-from-first-PR), and `collectCoverageFrom` is scoped to `src/**/*.ts` (empty-safe — the 100% threshold never trips on zero collected files).
- [ ] `jest.e2e.config.ts` uses `rootDir: '<rootDir>/test/e2e'` and `testTimeout: 60_000`.
- [ ] `stryker.config.json` thresholds are **high 100, low 95, break 95** with `jest-runner` + `typescript-checker` plugins; inherent equivalent mutants are documented with `// Stryker disable next-line` rather than by lowering the gate.
- [ ] `pnpm test:cov`, `pnpm test:e2e`, and `pnpm mutation:dry-run` all exit 0 on the scaffold (no specs yet) — verified, not merely "tolerated".

#### Files to create / modify

- `jest.config.ts`, `jest.coverage.config.ts`, `jest.e2e.config.ts`, `jest.stryker.config.ts`, `stryker.config.json`

#### Agent prompt

````
You are a senior NestJS library test-infrastructure engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS;
two subpaths; zero direct deps. Coverage floor is 100% line/branch on every implemented file;
mutation testing under Stryker (high 100 / low 95 / break 95).

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.4 of 17

PRECONDITIONS
- Task 1.2 done: tsconfig variants + tsup config exist; placeholder index files typecheck.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.1 — the jest/stryker rows of the config table.
- `docs/development_plan.md` §2.10 — the per-file coverage expectations (all critical paths land
  at 100% under the Bymax floor).
- Reference files: nest-auth `jest.config.ts`, `jest.coverage.config.ts`, `jest.e2e.config.ts`,
  `jest.stryker.config.ts`, `stryker.config.json`.

TASK
Copy and adapt the five Jest/Stryker files.

DELIVERABLES
1. `jest.config.ts` — `moduleNameMapper` with exactly two entries (the two subpaths);
   `coverageThreshold` GLOBAL 100% (branches/functions/lines/statements — the per-PR gate matches the
   release gate, no drift); `passWithNoTests: true`;
   `collectCoverageFrom: ['src/**/*.ts', '!**/index.ts', '!**/*.spec.ts']` (empty-safe).
2. `jest.coverage.config.ts` — same moduleNameMapper; `coverageThreshold` global 100%;
   `passWithNoTests: true` (this is `test:cov:all`, which also folds e2e-covered lines).
3. `jest.e2e.config.ts` — `rootDir: '<rootDir>/test/e2e'`, `testTimeout: 60_000` (Testcontainers
   needs 10-30s to start MinIO), `passWithNoTests: true` (green-empty until Phase 4 adds specs).
4. `jest.stryker.config.ts` — identical posture to nest-auth.
5. `stryker.config.json` — point at this repo's tsconfig; thresholds high 100 / low 95 / break 95;
   plugins jest-runner + typescript-checker. Do NOT lower the gate for I/O equivalent mutants —
   annotate them with a narrow `// Stryker disable next-line` + reason.

Constraints:
- English-only; timeless comments; no roadmap/phase references.
- Do NOT create `.gitkeep` or empty-directory placeholders. `test/e2e/` is created later.

Verification:
- `pnpm test:cov` — expected: EXITS 0 on the empty scaffold (passWithNoTests; the 100% threshold does not trip on zero collected files).
- `pnpm test:e2e` — expected: EXITS 0 on the empty scaffold (passWithNoTests).
- `pnpm mutation:dry-run` — expected: validates the Stryker config without running mutants.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.4 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `chore(storage): add jest and stryker configs (1.4)` — NO Co-Authored-By trailer.
````

---

### Task 1.5 — `scripts/check-size.mjs` — brotli bundle gate

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.2

#### Description

A native, zero-dependency Node script that measures the **brotli** size of each subpath bundle and fails when a budget is exceeded.

#### Acceptance criteria

- [ ] `scripts/check-size.mjs` created; `BUDGETS` has two entries — `server` (`dist/server/index.mjs`, **30_000** brotli bytes) and `shared` (`dist/shared/index.mjs`, **3_500** brotli bytes).
- [ ] Uses only `node:zlib` (brotli, max quality), `node:fs`, `node:url`, `node:path` — zero external deps (runs in CI).
- [ ] Runs via `pnpm size` (after `pnpm build`), reports both subpaths, and exits non-zero when a subpath exceeds its **brotli** budget.

#### Files to create / modify

- `scripts/check-size.mjs`

#### Agent prompt

````
You are a senior release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS;
two subpaths (`.` server, `./shared`); zero direct deps. The AWS SDK is a peer dep (externalized),
so the shipped `server` bundle is only library code.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.5 of 17

PRECONDITIONS
- Task 1.2 done: `tsup.config.ts` builds two entries to `dist/server` and `dist/shared`.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.1 — the `scripts/check-size.mjs` row.
- `docs/development_plan.md` §6.5 — the bundle-budget justification (the budgets are brotli).
- Reference: `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/scripts/check-size.mjs`.

TASK
Copy and adapt the size-check script with two brotli budgets.

DELIVERABLES
1. `scripts/check-size.mjs` with:
   - `BUDGETS` = two entries:
     `{ name: 'server (NestJS module + AWS SDK externals)', path: 'dist/server/index.mjs', brotli: 30_000 }`
     and `{ name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 3_500 }`.
   - Brotli measurement via `node:zlib` at max quality; only `node:fs`/`node:url`/`node:path`
     besides zlib. ZERO external deps.
   - Prints each subpath's measured brotli size vs budget; `process.exit(1)` if any exceeds.

Constraints:
- The budgets are BROTLI bytes — never gzip. State this in the script's header comment.
- English-only; timeless comments; no roadmap/phase references.
- Do NOT create `.gitkeep` or empty-directory placeholders.

Verification:
- `node --check scripts/check-size.mjs` — expected: parses cleanly.
- (After a build exists) `pnpm build && pnpm size` — expected: reports both subpaths under budget.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.5 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `chore(storage): add brotli bundle-size gate (1.5)` — NO Co-Authored-By trailer.
````

---

### Task 1.6 — `src/` structure + four CI workflows (ci/codeql/scorecard/release)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.2, 1.3, 1.4, 1.5

#### Description

Establish the `src/server` and `src/shared` entry files per the canonical tree (directories emerge from real files — no `.gitkeep`, no pre-created empty dirs), and front-load all four GitHub Actions workflows so every PR is gated from the first one (the agent-built-lib standard). The `ci` workflow is **incremental-safe** (jest `passWithNoTests: true` from Task 1.4, coverage on implemented files, a build-integrity loop over the **two** subpaths, brotli size budget) so it is green on the scaffold PR before any spec or feature exists. Crucially, ci.yml also includes a **front-loaded `e2e` job** (Testcontainers + MinIO) that is green-empty now and automatically gates the real e2e specs once Phase 4 adds them — so e2e is wired into CI from day one and no later phase needs to touch the workflow. `codeql` and `scorecard` are independent of build state; `release` is OIDC-only (no `NPM_TOKEN`), behind an `npm-publish` environment, inert until a `v*.*.*` tag exists.

#### Acceptance criteria

- [ ] `src/server/index.ts` and `src/shared/index.ts` exist (placeholder `export {}`); the canonical directory layout is documented but **not** materialized with placeholders.
- [ ] No `.gitkeep`/`.keep` files anywhere; `test/e2e/` is **not** pre-created.
- [ ] `.github/workflows/ci.yml`: triggers `pull_request`+`push:[main]`+`workflow_dispatch`; `permissions: contents: read`; `concurrency` with `cancel-in-progress`; pinned actions; Node `24.x`; pnpm `10.8.1`; a PR-only `actions/dependency-review-action@v4` (`fail-on-severity: high`); a `verify` job (`pnpm typecheck`/`lint`/`test:cov`/`build`/size) with a coverage-artifact upload and a **build-output-integrity loop over exactly the two subpaths `server` and `shared`** checking `index.{mjs,cjs,d.ts}`; a separate `e2e` job (`needs: verify`, Docker preinstalled on `ubuntu-latest`) that pre-pulls a **pinned** `minio/minio` tag and runs `pnpm test:e2e`. Green on the scaffold PR (no specs yet) via `passWithNoTests`.
- [ ] `ci.yml`'s coverage step enforces the **100% global** floor (jest.config.ts threshold from Task 1.4) — `pnpm test:cov` is the per-PR gate, not just a release-time check.
- [ ] `.github/workflows/codeql.yml`: JS/TS (`javascript-typescript`), `queries: security-extended`, on PR+push+weekly `schedule`, `permissions: security-events: write`. Valid and green.
- [ ] `.github/workflows/scorecard.yml`: OpenSSF `ossf/scorecard-action`, scheduled+push+`branch_protection_rule`, `permissions: { security-events: write, id-token: write }`, `persist-credentials: false`, `publish_results: true`. Valid and green.
- [ ] `.github/workflows/release.yml`: tag-driven (`v*.*.*`)+`workflow_dispatch`; `concurrency: release` (no cancel); workflow-level `permissions: contents: read`, publish job widens to `contents: write` + `id-token: write`; an `npm-publish` `environment` (manual-approval gate); a tag↔`package.json` version check; `pnpm prepublishOnly` release gate; `pnpm publish --provenance --no-git-checks` via **OIDC Trusted Publishing (no `NPM_TOKEN` secret)**; a `gh release create`. Inert on non-tag events.
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}` and `dist/shared/index.{mjs,cjs,d.ts}` from the empty entries.

#### Files to create / modify

- `src/server/index.ts`, `src/shared/index.ts`
- `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/workflows/scorecard.yml`, `.github/workflows/release.yml`

#### Agent prompt

````
You are a senior NestJS library CI/CD engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS;
TWO subpaths (`.`=server, `./shared`); zero direct deps (AWS SDK + NestJS are peers); published to
npm with provenance. Bymax CI conventions: least-privilege permissions, concurrency, pinned actions,
OIDC Trusted Publishing (NO NPM_TOKEN).

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.6 of 17

PRECONDITIONS
- Tasks 1.2-1.5 done: tsconfig/tsup, eslint/prettier, jest/stryker, brotli size script exist.
- Task 1.4 set `passWithNoTests: true` and a GLOBAL 100% `coverageThreshold` in jest.config.ts AND
  jest.coverage.config.ts, and `passWithNoTests: true` in jest.e2e.config.ts. So `pnpm test:cov` and
  `pnpm test:e2e` BOTH exit 0 on the empty scaffold.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm size` already pass on the scaffold.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.1 (file tree, the four `.github/workflows/*.yml`, no `.gitkeep`),
  §2.10/§6.5 (the 100% coverage gate + brotli budgets), §6.4 (CI conventions).
- `docs/technical_specification.md` §3.1 (canonical `src/` tree), §3.2 (the 2 subpath exports),
  §14 (peer deps).
- Reference workflows to ADAPT (do not copy verbatim — they are 5-subpath, no Docker e2e):
  `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/.github/workflows/{ci,codeql,scorecard,release}.yml`.

TASK
Confirm the two entry files, document (do NOT materialize) the canonical tree, and author the four
CI workflows so every PR — including e2e — is gated from the first one.

DELIVERABLES

1. `src/server/index.ts` and `src/shared/index.ts` — placeholder `export {}` (subdirectories are
   created on demand by later tasks; do NOT pre-create empty folders or `test/e2e/`).

2. `.github/workflows/ci.yml` — adapt for TWO subpaths + a Dockerized e2e job:

   ```yaml
   name: CI
   on:
     workflow_dispatch:
     push:
       branches: [main]
     pull_request:
       branches: [main]
   concurrency:
     group: ci-${{ github.ref }}
     cancel-in-progress: true
   permissions:
     contents: read
   jobs:
     verify:
       name: Verify (typecheck · lint · test · build · size)
       runs-on: ubuntu-latest
       timeout-minutes: 15
       strategy:
         fail-fast: false
         matrix:
           node-version: [24.x]
       steps:
         - uses: actions/checkout@v6
         - name: Dependency review
           if: github.event_name == 'pull_request'
           uses: actions/dependency-review-action@v4
           with:
             fail-on-severity: high
             comment-summary-in-pr: on-failure
         - uses: pnpm/action-setup@v6
           with: { version: 10.8.1, run_install: false }
         - uses: actions/setup-node@v6
           with: { node-version: ${{ matrix.node-version }}, cache: pnpm }
         - run: pnpm install --frozen-lockfile
         - run: pnpm typecheck
         - run: pnpm lint
         - name: Unit tests with coverage (100% global enforced by jest.config.ts)
           run: pnpm test:cov
         - name: Upload coverage artifact
           if: always()
           uses: actions/upload-artifact@v7
           with: { name: coverage-node-${{ matrix.node-version }}, path: coverage/, retention-days: 14 }
         - run: pnpm build
         - name: Verify build output integrity (2 subpaths)
           run: |
             for subpath in server shared; do
               for ext in mjs cjs d.ts; do
                 if [ ! -f "dist/$subpath/index.$ext" ]; then
                   echo "Missing dist/$subpath/index.$ext"; exit 1
                 fi
               done
             done
             echo "Both subpaths produced ESM + CJS + .d.ts"
         - name: Bundle size budget (brotli)
           run: pnpm size
     e2e:
       name: E2E (Testcontainers + MinIO)
       runs-on: ubuntu-latest          # Docker is preinstalled on GitHub-hosted ubuntu
       needs: verify
       timeout-minutes: 20
       steps:
         - uses: actions/checkout@v6
         - uses: pnpm/action-setup@v6
           with: { version: 10.8.1, run_install: false }
         - uses: actions/setup-node@v6
           with: { node-version: 24.x, cache: pnpm }
         - run: pnpm install --frozen-lockfile
         - name: Pre-pull pinned MinIO image (cache for Testcontainers)
           run: docker pull minio/minio:RELEASE.2024-01-16T16-07-38Z   # keep in sync with test/e2e/minio-container.ts
         - name: E2E (passWithNoTests → green until Phase 4 adds specs)
           run: pnpm test:e2e
   ```

3. `.github/workflows/codeql.yml`:

   ```yaml
   name: CodeQL
   on:
     push: { branches: [main] }
     pull_request: { branches: [main] }
     schedule: [{ cron: '27 3 * * 1' }]
   concurrency:
     group: codeql-${{ github.ref }}
     cancel-in-progress: true
   permissions:
     contents: read
   jobs:
     analyze:
       name: Analyze (javascript-typescript)
       runs-on: ubuntu-latest
       timeout-minutes: 20
       permissions: { security-events: write, actions: read, contents: read }
       steps:
         - uses: actions/checkout@v6
         - uses: github/codeql-action/init@v4
           with: { languages: javascript-typescript, queries: security-extended }
         - uses: github/codeql-action/analyze@v4
           with: { category: '/language:javascript-typescript' }
   ```

4. `.github/workflows/scorecard.yml`:

   ```yaml
   name: Scorecard
   on:
     branch_protection_rule:
     schedule: [{ cron: '18 2 * * 2' }]
     push: { branches: [main] }
   permissions:
     contents: read
   jobs:
     analysis:
       name: Scorecard analysis
       runs-on: ubuntu-latest
       timeout-minutes: 15
       permissions: { security-events: write, id-token: write }
       steps:
         - uses: actions/checkout@v6
           with: { persist-credentials: false }
         - uses: ossf/scorecard-action@v2.4.0
           with: { results_file: results.sarif, results_format: sarif, publish_results: true }
         - uses: github/codeql-action/upload-sarif@v4
           with: { sarif_file: results.sarif }
   ```

5. `.github/workflows/release.yml` — OIDC Trusted Publishing, NO NPM_TOKEN, manual-approval gate:

   ```yaml
   name: Release
   on:
     workflow_dispatch:
     push:
       tags: ['v*.*.*']
   concurrency:
     group: release
     cancel-in-progress: false
   permissions:
     contents: read
   jobs:
     publish:
       name: Publish to npm + GitHub Release
       runs-on: ubuntu-latest
       timeout-minutes: 20
       environment:
         name: npm-publish        # repo Settings → Environments: require a reviewer to approve
         url: https://www.npmjs.com/package/@bymax-one/nest-storage
       permissions:
         contents: write          # gh release create
         id-token: write          # npm OIDC Trusted Publishing — exchanges OIDC for a short-lived token; NO NPM_TOKEN secret
       steps:
         - uses: actions/checkout@v6
           with: { fetch-depth: 0 }
         - uses: pnpm/action-setup@v6
           with: { version: 10.8.1, run_install: false }
         - uses: actions/setup-node@v6
           with: { node-version: 24.x, cache: pnpm, registry-url: https://registry.npmjs.org }
         - run: pnpm install --frozen-lockfile
         - name: Verify tag matches package.json version
           run: |
             PKG=$(node -p "require('./package.json').version")
             TAG=${GITHUB_REF_NAME#v}
             [ "$PKG" = "$TAG" ] || { echo "Tag $GITHUB_REF_NAME != package.json $PKG"; exit 1; }
         - name: Release gate
           run: pnpm prepublishOnly        # typecheck · lint · 100% coverage (test:cov:all) · build · size
         - name: Publish with provenance (OIDC)
           run: pnpm publish --provenance --no-git-checks
         - name: Create GitHub Release
           env: { GH_TOKEN: ${{ github.token }} }
           run: gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --generate-notes
   ```

Constraints:
- Least privilege everywhere; pin each action to at least a major version (the reference repo pins
  these exact majors). Adapt the build-integrity loop to the TWO storage subpaths (server, shared) —
  the reference repo's 5-subpath/`.d.cts` loop would FAIL here.
- The four workflows must be valid YAML and green/inert on the current scaffold PR (the e2e job is
  green because jest.e2e.config.ts has `passWithNoTests: true`).
- OIDC Trusted Publishing ONLY — do NOT add an NPM_TOKEN secret. (A Trusted Publisher must be
  configured on npmjs.com and an `npm-publish` GitHub Environment created with a required reviewer.)
- English-only; timeless comments — NO phase/task references in any YAML.
- NEVER create `.gitkeep`/`.keep` or empty-directory placeholders; do NOT pre-create `test/e2e/`.

Verification:
- `pnpm build` — expected: `dist/server/index.{mjs,cjs,d.ts}` + `dist/shared/index.{mjs,cjs,d.ts}`.
- `pnpm test:cov` and `pnpm test:e2e` — expected: BOTH exit 0 on the empty scaffold (passWithNoTests).
- `find . -name .gitkeep -o -name .keep` — expected: no output.
- `grep -q 'minio' .github/workflows/ci.yml` — expected: match (e2e job is wired).
- `grep -L 'NPM_TOKEN' .github/workflows/release.yml` — expected: release.yml listed (no NPM_TOKEN).
- Validate each workflow YAML (`yamllint` or `gh workflow view`) — expected: valid.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.6 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `chore(storage): scaffold src entries and CI workflows (1.6)` — NO Co-Authored-By trailer.
````

---

### Task 1.7 — Shared types

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.6

#### Description

Define the public data shapes in `src/shared/types/` — `UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`, `StorageErrorResponse` — with zero NestJS/AWS-SDK dependencies.

#### Acceptance criteria

- [ ] `storage-types.ts` (`UploadResult`, `ObjectMetadata`, `ListedObject`), `signed-url-types.ts` (`SignedUrlResult` with the "NEVER LOG this" caution), and `error-types.ts` (`StorageErrorResponse`) created, all with full JSDoc.
- [ ] `readonly` used where appropriate; `import type` for all type imports; no `any` in any signature.
- [ ] Zero imports of `@nestjs/*` or `@aws-sdk/*` in `src/shared/`.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/shared/types/storage-types.ts`, `src/shared/types/signed-url-types.ts`, `src/shared/types/error-types.ts`

#### Agent prompt

````
You are a senior TypeScript API designer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS. The
`./shared` subpath is zero-dependency and safe to import in frontends/edge/workers — it must never
pull `@nestjs/*` or `@aws-sdk/*`.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.7 of 17

PRECONDITIONS
- Task 1.6 done: `src/server/index.ts` and `src/shared/index.ts` exist.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.2 — the full skeletons for `storage-types.ts`,
  `signed-url-types.ts`, `error-types.ts`.
- `docs/technical_specification.md` §5.3 (`UploadResult`/`ObjectMetadata`) and §7.2
  (`SignedUrlResult`).

TASK
Author the three shared type files exactly per the §2.2 skeletons.

DELIVERABLES
1. `src/shared/types/storage-types.ts` — `UploadResult`, `ObjectMetadata`, `ListedObject`, full JSDoc.
2. `src/shared/types/signed-url-types.ts` — `SignedUrlResult` (the `url` field carries the "NEVER
   LOG this — it is a temporary credential" caution in JSDoc).
3. `src/shared/types/error-types.ts` — `StorageErrorResponse` (the JSON shape emitted by
   `StorageException`), importing the code union via `import type`.

Constraints:
- `@fileoverview` + `@layer` header on each file; `readonly` where appropriate; `import type` for
  all type imports; NO `any` in any signature.
- Zero `@nestjs/*` or `@aws-sdk/*` imports.
- English-only; timeless comments; no roadmap/phase references.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -rn ': any\b\|any\[\]' src/shared/` — expected: no match.
- `grep -rn '@nestjs\|@aws-sdk' src/shared/` — expected: no match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.7 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add shared types (1.7)` — NO Co-Authored-By trailer.
````

---

### Task 1.8 — Shared constants (`STORAGE_ERROR_CODES`, MIME whitelists, TTLs)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.6

#### Description

Public constants in `src/shared/constants/` — the 17 stable error codes (`as const`), MIME whitelists, and default TTL/multipart values — and wire `src/shared/index.ts`.

#### Acceptance criteria

- [ ] `error-codes.constants.ts` exports `STORAGE_ERROR_CODES` (`as const`) with **exactly 17** codes and the derived `StorageErrorCode` type.
- [ ] `mime-types.constants.ts` exports `DEFAULT_IMAGE_MIME_WHITELIST`, `DEFAULT_VIDEO_MIME_WHITELIST`, `DEFAULT_DOC_MIME_WHITELIST` (`readonly string[]` via `as const`, no wildcards in the defaults).
- [ ] `default-ttls.constants.ts` exports `DEFAULT_SIGNED_URL_TTL_SECONDS = 300`, `MAX_SIGNED_URL_TTL_SECONDS = 7*24*60*60`, `DEFAULT_MULTIPART_THRESHOLD_BYTES = 5*1024*1024`, `DEFAULT_MULTIPART_PART_SIZE_BYTES = 5*1024*1024`, `DEFAULT_MULTIPART_QUEUE_SIZE = 4` (all `as const`).
- [ ] `src/shared/index.ts` re-exports the shared types and constants per the §2.2 barrel.
- [ ] `pnpm build` produces `dist/shared/index.{mjs,cjs,d.ts}` listing all exports; `STORAGE_ERROR_CODES` has 17 entries.

#### Files to create / modify

- `src/shared/constants/error-codes.constants.ts`, `src/shared/constants/mime-types.constants.ts`, `src/shared/constants/default-ttls.constants.ts`
- `src/shared/index.ts`

#### Agent prompt

````
You are a senior TypeScript API designer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS; the
`./shared` subpath is zero-dependency. Error codes are a stable public contract — host apps and
clients pattern-match on them; they must not change between minor versions.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.8 of 17

PRECONDITIONS
- Task 1.6 done: shared entry exists. (Task 1.7 may or may not be merged; this task only needs the
  constants files and the barrel — keep type re-exports consistent with §2.2.)

REQUIRED READING (only these):
- `docs/development_plan.md` §2.2 — the skeletons for the three constants files and the
  `src/shared/index.ts` barrel.
- `docs/technical_specification.md` §12.2 — the code table (the 17 codes and their HTTP statuses).

TASK
Author the three constants files and the shared barrel.

DELIVERABLES
1. `error-codes.constants.ts` — `STORAGE_ERROR_CODES` `as const` with EXACTLY these 17 keys:
   STORAGE_NOT_CONFIGURED, STORAGE_KEY_INVALID, STORAGE_BODY_MISSING,
   STORAGE_CONTENT_TYPE_REQUIRED, STORAGE_MIME_NOT_ALLOWED, STORAGE_SIZE_EXCEEDED,
   STORAGE_VALIDATION_FAILED, STORAGE_SCAN_INFECTED, STORAGE_SCAN_INCONCLUSIVE,
   STORAGE_OBJECT_NOT_FOUND, STORAGE_PROVIDER_ERROR, STORAGE_SIGNED_URL_TTL_INVALID,
   STORAGE_PART_TOO_SMALL, STORAGE_BUCKET_UNDEFINED, STORAGE_MULTIPART_ABORTED,
   STORAGE_INVALID_CONFIG, STORAGE_TIMEOUT. Plus
   `export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[keyof typeof STORAGE_ERROR_CODES]`.
2. `mime-types.constants.ts` — the three whitelists (`readonly string[]` via `as const`, no
   wildcards in the defaults).
3. `default-ttls.constants.ts` — the five TTL/multipart constants per §2.2 (all `as const`).
4. `src/shared/index.ts` — re-export the shared types (`export type { ... }`) and the constants per
   the §2.2 barrel.

Constraints:
- `@fileoverview` + `@layer` header on each file; `as const` to preserve literal types in `.d.ts`.
- Zero `@nestjs/*` or `@aws-sdk/*` imports in `src/shared/`.
- English-only; timeless comments; no roadmap/phase references.

Verification:
- `pnpm build` — expected: builds.
- `node -e "import('./dist/shared/index.mjs').then(m => { console.log(Object.keys(m).sort()); console.log('codes:', Object.keys(m.STORAGE_ERROR_CODES).length) })"` — expected: ≥ 8 exports and `codes: 17`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.8 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add shared constants (1.8)` — NO Co-Authored-By trailer.
````

---

### Task 1.9 — Server interfaces (8 contracts + barrel)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.7

#### Description

Define the eight public interfaces consumers reference or implement — `BymaxStorageModuleOptions` (+ async variants), `UploadOptions`, `DownloadOptions`, `ListOptions`/`ListResult`, the signed-URL options group, `IUploadValidator`, `IFileScanner`/`FileScanResult`, `ProviderRecipe` — plus the barrel. Apply the corrected options shape: **no `signatureVersion`**, use `maxAttempts`, include the two checksum fields.

#### Acceptance criteria

- [ ] Eight interface files + `index.ts` created, all fields documented with JSDoc.
- [ ] `BymaxStorageModuleOptions` carries every field from spec §4.1 — including `requestChecksumCalculation` and `responseChecksumValidation` (`'WHEN_SUPPORTED' | 'WHEN_REQUIRED'`) and `maxAttempts` — and **no `signatureVersion`** field anywhere.
- [ ] `defaultPublicRead` JSDoc documents the ACL dead-end (HTTP 400 `AccessControlListNotSupported` on modern AWS S3, no-op on R2; prefer bucket policy / CDN / signed URLs).
- [ ] `BymaxStorageModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'>` plus `BymaxStorageModuleOptionsFactory`; `IUploadValidator.validate` returns a discriminated union `{ ok: true } | { ok: false; reason: string }`.
- [ ] `import type` for all external types; `readonly` on arrays; no `any` in any signature; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/interfaces/storage-module-options.interface.ts`, `upload-options.interface.ts`, `download-options.interface.ts`, `list-options.interface.ts`, `signed-url-options.interface.ts`, `upload-validator.interface.ts`, `file-scanner.interface.ts`, `provider-recipe.interface.ts`, `index.ts`

#### Agent prompt

````
You are a senior TypeScript API designer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS on a
single `@aws-sdk/client-s3` engine. AWS SDK v3 is SigV4-only.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.9 of 17

PRECONDITIONS
- Task 1.7 done: shared types exist (`UploadResult`, `ListedObject` are referenced by interfaces).

REQUIRED READING (only these):
- `docs/development_plan.md` §2.3 — the full skeletons for all eight interfaces + the barrel.
- `docs/technical_specification.md` §4.1 (`BymaxStorageModuleOptions`, including the checksum/
  maxAttempts fields and the `defaultPublicRead` ACL note), §8 (`IUploadValidator`), §9
  (`IFileScanner`).

TASK
Author the eight interface files and the barrel exactly per §2.3, applying the corrected options shape.

DELIVERABLES
1. `storage-module-options.interface.ts` — `BymaxStorageModuleOptions` with EVERY field from
   spec §4.1: endpoint, region, bucket, credentials, forcePathStyle, publicBaseUrl, cdnBaseUrl,
   defaultPublicRead, keyPrefix, defaultCacheControl, defaultContentDisposition, signedUrls{},
   multipart{}, validation{}, scanner{}, serverSideEncryption, kmsKeyId,
   `requestChecksumCalculation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'`,
   `responseChecksumValidation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'`, `maxAttempts?: number`,
   requestTimeoutMs. There is NO `signatureVersion` field — AWS SDK v3 is SigV4-only. Document the
   `defaultPublicRead` ACL dead-end in its JSDoc. Add `BymaxStorageModuleAsyncOptions extends
   Pick<ModuleMetadata, 'imports'>` and `BymaxStorageModuleOptionsFactory`.
2. `upload-options.interface.ts`, `download-options.interface.ts`,
   `list-options.interface.ts` (`ListOptions` + `ListResult`),
   `signed-url-options.interface.ts` (`SignedGetUrlOptions`, `SignedPutUrlOptions`,
   `MultipartUploadUrlsOptions`, `MultipartUploadUrlsResult`) — per §2.3.
3. `upload-validator.interface.ts` — `IUploadValidator` (`readonly name`, `validate(ctx)` returning
   the discriminated union `{ ok: true } | { ok: false; reason: string }`).
4. `file-scanner.interface.ts` — `IFileScanner` + `FileScanResult` (status `'clean' | 'infected'
   | 'unknown'`).
5. `provider-recipe.interface.ts` — `ProviderRecipe<TInput> = (input: TInput) =>
   BymaxStorageModuleOptions`.
6. `index.ts` — `export type { ... }` for all of the above.

Constraints:
- NO `signatureVersion` anywhere; use `maxAttempts` (not `maxRetries`); include both checksum fields.
- `@fileoverview` + `@layer` header on each file; `import type` for external types; `readonly` on
  arrays; NO `any` in any signature.
- Do NOT export these from `src/server/index.ts` yet (the barrel is wired in a later task).
- English-only; timeless comments; no roadmap/phase references.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -rn ': any\b\|any\[\]' src/server/interfaces/` — expected: no match.
- `grep -rn 'signatureVersion\|maxRetries' src/server/interfaces/` — expected: no match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.9 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add server interfaces (1.9)` — NO Co-Authored-By trailer.
````

---

### Task 1.10 — DI tokens (Symbol) + default-options constants

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.8

#### Description

Define the six `Symbol`-based injection tokens and the internal default-options constants. Apply the corrected defaults: `DEFAULT_MAX_ATTEMPTS = 3` (no `maxRetries`), **no `signatureVersion`**, plus `DEFAULT_CHECKSUM_CALCULATION`/`DEFAULT_CHECKSUM_VALIDATION = 'WHEN_SUPPORTED'`.

#### Acceptance criteria

- [ ] `bymax-storage.constants.ts` exports six unique Symbols (`BYMAX_STORAGE_OPTIONS`, `BYMAX_STORAGE_S3_CLIENT`, `BYMAX_STORAGE_UPLOAD_VALIDATORS`, `BYMAX_STORAGE_FILE_SCANNER`, `BYMAX_STORAGE_LOGGER`, `BYMAX_STORAGE_IDEMPOTENCY_CACHE`) with JSDoc explaining the Symbol rationale.
- [ ] `constants/default-options.constants.ts` exports the defaults `as const`, including `DEFAULT_MAX_ATTEMPTS = 3`, `DEFAULT_CHECKSUM_CALCULATION = 'WHEN_SUPPORTED'`, `DEFAULT_CHECKSUM_VALIDATION = 'WHEN_SUPPORTED'`, `DEFAULT_SIGNED_URLS`, `DEFAULT_MULTIPART`, scanner defaults, and idempotency-cache defaults — and **no `DEFAULT_SIGNATURE_VERSION`**.
- [ ] `constants/default-mime-whitelist.constants.ts` re-exports the shared MIME whitelists.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/bymax-storage.constants.ts`
- `src/server/constants/default-options.constants.ts`, `src/server/constants/default-mime-whitelist.constants.ts`

#### Agent prompt

````
You are a senior NestJS architect working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS on a
single `@aws-sdk/client-s3` engine (SigV4-only). DI tokens are `Symbol` (inherited from
`@bymax-one/nest-auth`) to avoid string collisions.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.10 of 17

PRECONDITIONS
- Task 1.8 done: shared constants (`default-ttls`, MIME whitelists) exist.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.4 — the full skeletons for `bymax-storage.constants.ts` and
  `constants/default-options.constants.ts` (note the corrected `DEFAULT_MAX_ATTEMPTS` +
  `DEFAULT_CHECKSUM_*` constants and the absence of any signature-version constant).
- `docs/technical_specification.md` §4.2 — the defaults table.

TASK
Author the DI tokens and the internal default-options constants.

DELIVERABLES
1. `src/server/bymax-storage.constants.ts` — six `Symbol(...)` tokens per §2.4, with JSDoc
   explaining why Symbols are used.
2. `src/server/constants/default-options.constants.ts` — per §2.4, all `as const`:
   `DEFAULT_CACHE_CONTROL`, `DEFAULT_CONTENT_DISPOSITION`, `DEFAULT_MAX_ATTEMPTS = 3`,
   `DEFAULT_REQUEST_TIMEOUT_MS = 30_000`, `DEFAULT_FORCE_PATH_STYLE = false`,
   `DEFAULT_PUBLIC_READ = false`, `DEFAULT_CHECKSUM_CALCULATION = 'WHEN_SUPPORTED'`,
   `DEFAULT_CHECKSUM_VALIDATION = 'WHEN_SUPPORTED'`, `DEFAULT_SIGNED_URLS`, `DEFAULT_MULTIPART`,
   `DEFAULT_SCANNER_MODE = 'pre-upload'`, `DEFAULT_SCANNER_REJECT_ON_UNKNOWN = false`,
   `DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES = 1000`, `DEFAULT_IDEMPOTENCY_CACHE_TTL_MS = 24h`.
   There is NO `DEFAULT_SIGNATURE_VERSION` — AWS SDK v3 is SigV4-only.
3. `src/server/constants/default-mime-whitelist.constants.ts` — re-export the three shared MIME
   whitelists so server consumers do not cross the subpath boundary.

Constraints:
- NO signature-version constant; use `DEFAULT_MAX_ATTEMPTS` (not `DEFAULT_MAX_RETRIES`).
- `@fileoverview` + `@layer` header on each file; defaults `as const`.
- English-only; timeless comments; no roadmap/phase references.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -rn 'signatureVersion\|SIGNATURE_VERSION\|maxRetries\|MAX_RETRIES' src/server/constants src/server/bymax-storage.constants.ts` — expected: no match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.10 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add DI tokens and default-options constants (1.10)` — NO Co-Authored-By trailer.
````

---

### Task 1.11 — Error catalog: messages + status map + `StorageException` + AWS mapper

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.8

#### Description

Build the error catalog: the internal `STORAGE_ERROR_MESSAGES` (code→message) and `STORAGE_ERROR_STATUS` (code→`HttpStatus`) maps, the `StorageException extends HttpException` class whose default status comes from `STORAGE_ERROR_STATUS[code]`, and `mapAwsError` to translate AWS SDK errors. The two maps are internal — not exported.

#### Acceptance criteria

- [ ] `storage-error-messages.ts` exports `STORAGE_ERROR_MESSAGES: Record<StorageErrorCode, string>` covering all 17 codes (exhaustiveness enforced by the `Record`).
- [ ] `storage-error-status.ts` exports `STORAGE_ERROR_STATUS: Record<StorageErrorCode, HttpStatus>` covering all 17 codes with the §12.2 HTTP statuses (e.g. NOT_CONFIGURED→503, KEY_INVALID→400, MIME_NOT_ALLOWED→415, SIZE_EXCEEDED→413, SCAN_*→422, OBJECT_NOT_FOUND→404, PROVIDER_ERROR→502, MULTIPART_ABORTED→500, INVALID_CONFIG→500, TIMEOUT→504).
- [ ] `STORAGE_ERROR_MESSAGES` and `STORAGE_ERROR_STATUS` are **NOT** exported from any barrel — internal implementation details.
- [ ] `storage-exception.ts` — `StorageException extends HttpException` with a public `readonly code`, default `statusCode = STORAGE_ERROR_STATUS[code]`, body `{ error: { code, message, details? } }` (details omitted when undefined).
- [ ] `aws-error-mapper.ts` — `mapAwsError(err, context?)`: `NotFound`/404 → `STORAGE_OBJECT_NOT_FOUND` (404), `TimeoutError` → `STORAGE_TIMEOUT` (504), otherwise → `STORAGE_PROVIDER_ERROR` (502); preserves `requestId` and `awsCode` in `details`, never credentials/signed URLs.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/errors/storage-error-messages.ts`, `src/server/errors/storage-error-status.ts`, `src/server/errors/storage-exception.ts`, `src/server/errors/aws-error-mapper.ts`

#### Agent prompt

````
You are a senior NestJS security/reliability engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS.
`StorageException` extends NestJS `HttpException` so host apps' global exception filters handle it
natively. The error code is a stable public contract; the message/status maps are internal.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.11 of 17

PRECONDITIONS
- Task 1.8 done: `STORAGE_ERROR_CODES` + `StorageErrorCode` exist in `src/shared/`.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.6 — the skeletons for `storage-error-messages.ts`,
  `storage-exception.ts`, `aws-error-mapper.ts`.
- `docs/technical_specification.md` §12.1 (the `StorageException` class whose default
  `statusCode = STORAGE_ERROR_STATUS[code]`), §12.2 (the code→HTTP table), §12.3 (AWS mapping).

TASK
Author the error catalog with BOTH internal maps plus the exception class and the AWS mapper.

DELIVERABLES
1. `storage-error-messages.ts` — `STORAGE_ERROR_MESSAGES: Record<StorageErrorCode, string>`,
   human-readable English, all 17 codes (the `Record` forces exhaustiveness).
2. `storage-error-status.ts` — `STORAGE_ERROR_STATUS: Record<StorageErrorCode, HttpStatus>` with the
   §12.2 statuses: NOT_CONFIGURED 503; KEY_INVALID 400; BODY_MISSING 400; CONTENT_TYPE_REQUIRED 400;
   MIME_NOT_ALLOWED 415; SIZE_EXCEEDED 413; VALIDATION_FAILED 400; SCAN_INFECTED 422;
   SCAN_INCONCLUSIVE 422; OBJECT_NOT_FOUND 404; PROVIDER_ERROR 502; SIGNED_URL_TTL_INVALID 400;
   PART_TOO_SMALL 400; BUCKET_UNDEFINED 400; MULTIPART_ABORTED 500; INVALID_CONFIG 500; TIMEOUT 504.
3. `storage-exception.ts` — `StorageException extends HttpException` with public `readonly code`;
   constructor `(code, statusCode: HttpStatus = STORAGE_ERROR_STATUS[code], details?)`; body
   `{ error: { code, message: STORAGE_ERROR_MESSAGES[code], ...(details ? { details } : {}) } }`.
4. `aws-error-mapper.ts` — `mapAwsError(err: unknown, context?)`: read `$metadata.httpStatusCode`,
   `$metadata.requestId`, `Code`/`name`; `NotFound`/404 → OBJECT_NOT_FOUND (404); `TimeoutError`
   → TIMEOUT (504); else → PROVIDER_ERROR (502). Put `awsCode`, `httpStatus`, `requestId`,
   `awsMessage` in `details`; NEVER include credentials or signed URLs.

Constraints:
- `STORAGE_ERROR_MESSAGES` and `STORAGE_ERROR_STATUS` are INTERNAL — do not export them from any
  barrel. Only `STORAGE_ERROR_CODES` and `StorageException` are public.
- `@fileoverview` + `@layer` header on each file; NO `any` in signatures (narrow `unknown` in the
  mapper).
- English-only; timeless comments; no roadmap/phase references.

Verification:
- `pnpm typecheck` — expected: passes (exhaustiveness is compiler-enforced by both `Record`s).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.11 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add error catalog with status map and AWS mapper (1.11)` — NO Co-Authored-By trailer.
````

---

### Task 1.12 — Config: `validate-options` + `resolved-options` + `apply-defaults`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.9, 1.10, 1.11

#### Description

Manual options validation (no zod), the `ResolvedBymaxStorageOptions` interface (every optional field resolved + `hasCredentials`), and `applyDefaults`. Carry the corrected fields: both checksum options and `maxAttempts`; no `signatureVersion`.

#### Acceptance criteria

- [ ] `validate-options.ts` exports `validateOptions(options): void` throwing `StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, { reason })` for: missing/non-object options, empty `endpoint`/`region`/`bucket`, missing `credentials`, `signedUrls.maxTtlSeconds <= 0`, `multipart.partSizeBytes < 5 MB`, and `serverSideEncryption === 'aws:kms'` without `kmsKeyId`.
- [ ] `validateOptions` tolerates empty `accessKeyId`/`secretAccessKey` (does not throw — lazy `STORAGE_NOT_CONFIGURED` at runtime).
- [ ] `resolved-options.ts` exports `ResolvedBymaxStorageOptions` with all optionals resolved plus `requestChecksumCalculation`, `responseChecksumValidation`, `maxAttempts`, and `hasCredentials: boolean`; **no `signatureVersion`**.
- [ ] `apply-defaults.ts` exports `applyDefaults(options): ResolvedBymaxStorageOptions` computing `hasCredentials`, deriving `publicBaseUrl = endpoint.replace(/\/+$/, '') + '/' + bucket` when absent, shallow-merging `signedUrls`/`multipart`, and resolving the checksum/`maxAttempts` defaults; the shallow-merge semantics are documented in JSDoc.
- [ ] No external libs (only project types + `@nestjs/common`); `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/config/validate-options.ts`, `src/server/config/resolved-options.ts`, `src/server/config/apply-defaults.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS
(SigV4-only). Services consume a fully-resolved options object, never the raw consumer options.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.12 of 17

PRECONDITIONS
- Tasks 1.9 (interfaces), 1.10 (default-options constants), 1.11 (`StorageException`) are done.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.5 — the full skeletons for `validate-options.ts`,
  `resolved-options.ts`, `apply-defaults.ts` (note the corrected `requestChecksumCalculation`,
  `responseChecksumValidation`, `maxAttempts` fields and the absence of `signatureVersion`).

TASK
Author the three config files exactly per §2.5.

DELIVERABLES
1. `validate-options.ts` — `validateOptions(options): void` throwing
   `StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, { reason })` for
   the invalid cases listed in §2.5; tolerates empty credentials (no throw). No zod / no external libs.
2. `resolved-options.ts` — `ResolvedBymaxStorageOptions`: every optional field present and required,
   including `requestChecksumCalculation`, `responseChecksumValidation`, `maxAttempts`, and
   `hasCredentials: boolean`. NO `signatureVersion`.
3. `apply-defaults.ts` — `applyDefaults(options): ResolvedBymaxStorageOptions`: compute
   `hasCredentials` (both keys non-empty), derive `publicBaseUrl` when absent, shallow-merge
   `{ ...DEFAULT_SIGNED_URLS, ...(options.signedUrls ?? {}) }` and the same for `multipart`, resolve
   `requestChecksumCalculation`/`responseChecksumValidation`/`maxAttempts` from the default-options
   constants. Document the shallow-merge in JSDoc.

Constraints:
- NO `signatureVersion`; use `maxAttempts`; carry both checksum fields.
- No external validation libs (only project types + `@nestjs/common`'s `HttpStatus`).
- `@fileoverview` + `@layer` header on each file; NO `any`.
- English-only; timeless comments; no roadmap/phase references.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -rn 'signatureVersion\|maxRetries\|from .zod' src/server/config/` — expected: no match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.12 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add options validation and resolution (1.12)` — NO Co-Authored-By trailer.
````

---

### Task 1.13 — `KeyResolverService` — path-traversal guard + `keyPrefix`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.11, 1.12

#### Description

The security-critical service that centralizes key normalization, applies the global `keyPrefix`, and blocks path traversal. This is the most important security boundary in the library — mutation coverage must hold at break 95.

#### Acceptance criteria

- [ ] `@Injectable()` service injecting `@Inject(BYMAX_STORAGE_OPTIONS) options: ResolvedBymaxStorageOptions`; constructor normalizes `keyPrefix` (trim leading/trailing slashes, append a single trailing slash if non-empty — `'/tenant-x/'` → `'tenant-x/'`).
- [ ] `normalize(rawKey)` throws `STORAGE_KEY_INVALID` for non-string/empty input, leading `/`, or any segment exactly `..` (split by `/`, compare segments — not `includes('..')`, so `image..backup.png` is allowed); collapses `//`+ to `/`; then prepends `keyPrefix`.
- [ ] `stripPrefix(fullKey)` removes the global prefix when present; `getPrefix()` is a read-only accessor.
- [ ] `normalize('a//b//c')` → `'a/b/c'`; `normalize('../etc/passwd')`, `normalize('a/../b')`, `normalize('/leading')`, `normalize('')` all throw.
- [ ] 100% line/branch coverage; mutation score holds at break 95 (security-critical).

#### Files to create / modify

- `src/server/services/key-resolver.service.ts`

#### Agent prompt

````
You are a senior NestJS security engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS.
`KeyResolverService` is the single normalization point for every object key and the primary
defense against path traversal — the most security-critical class in the library.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.13 of 17

PRECONDITIONS
- Tasks 1.11 (`StorageException` + `STORAGE_ERROR_CODES`) and 1.12 (`ResolvedBymaxStorageOptions`,
  `BYMAX_STORAGE_OPTIONS`) are done.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.7 — the full `KeyResolverService` skeleton + test expectations.
- `docs/technical_specification.md` §4.1 (`keyPrefix` semantics) and §16.2 (security).

TASK
Author `src/server/services/key-resolver.service.ts` exactly per §2.7 (TDD — write the spec first).

DELIVERABLES
1. `KeyResolverService` (`@Injectable()`):
   - Constructor injects `@Inject(BYMAX_STORAGE_OPTIONS) options: ResolvedBymaxStorageOptions` and
     computes `keyPrefix = options.keyPrefix ? options.keyPrefix.replace(/^\/+|\/+$/g, '') + '/' : ''`.
   - `normalize(rawKey: string): string` — rejects non-string/empty, leading `/`, and any `..`
     path segment (split on `/`, compare each segment to `..` exactly; do NOT use
     `includes('..')`); collapse `\/{2,}` to `/`; reject empty-after-collapse; prepend `keyPrefix`.
     Throw `StorageException(STORAGE_KEY_INVALID, HttpStatus.BAD_REQUEST, { reason })`.
   - `stripPrefix(fullKey: string): string` and `getPrefix(): string`.

Constraints:
- The `..` guard MUST be segment-exact so legitimate filenames like `image..backup.png` pass.
- `@fileoverview` + `@layer` header; functions ≤ 50 lines; NO `any`.
- English-only; timeless comments; no roadmap/phase references.
- Coverage 100% line/branch; mutation must hold at break 95 — if an inherent equivalent mutant
  appears, annotate with a narrow `// Stryker disable next-line` + reason, never lower the gate.

Verification:
- `pnpm typecheck` — expected: passes.
- (After the spec from the test task) `pnpm test src/server/services/key-resolver.service.spec.ts`
  — expected: all traversal/edge cases green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.13 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add KeyResolverService with path-traversal guard (1.13)` — NO Co-Authored-By trailer.
````

---

### Task 1.14 — `S3ClientProvider` — lifecycle + lazy init

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.12

#### Description

The injectable provider that creates and destroys the singleton `S3Client`, tolerating missing credentials. Build the `S3ClientConfig` with `maxAttempts` (not `maxRetries`) and both checksum options; never reference `signatureVersion`.

#### Acceptance criteria

- [ ] `@Injectable()` implementing `OnModuleInit, OnApplicationShutdown`; injects `@Inject(BYMAX_STORAGE_OPTIONS) options: ResolvedBymaxStorageOptions`; private `Logger` + private `client?: S3Client`.
- [ ] `onModuleInit()`: when `!options.hasCredentials`, logs a warning and returns (no client); otherwise constructs `S3Client` with `endpoint`, `region`, `forcePathStyle`, `credentials` (+ `sessionToken` when present), `maxAttempts`, `requestChecksumCalculation`, and `responseChecksumValidation`. No `signatureVersion` or `maxRetries`.
- [ ] `onApplicationShutdown()` calls `client.destroy()` (synchronous in SDK v3) and clears the reference.
- [ ] `getClient()` returns the same instance and throws when unconfigured; `isConfigured()` reflects state.
- [ ] 100% line/branch coverage.

#### Files to create / modify

- `src/server/providers/s3-client.provider.ts`

#### Agent prompt

````
You are a senior NestJS architect working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS on a
single `@aws-sdk/client-s3` engine. The `S3Client` is heavy (keep-alive HTTP agent) and is a
singleton owned by this provider. AWS SDK v3 is SigV4-only; it uses `maxAttempts` (attempts =
retries + 1), and from v3.729.0 it adds default CRC32 integrity checksums that non-AWS providers
reject — hence the `requestChecksumCalculation`/`responseChecksumValidation` options.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.14 of 17

PRECONDITIONS
- Task 1.12 done: `ResolvedBymaxStorageOptions` (with `maxAttempts` + both checksum fields +
  `hasCredentials`) and `BYMAX_STORAGE_OPTIONS` exist.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.8 — the full `S3ClientProvider` skeleton (note `maxAttempts`,
  `requestChecksumCalculation`, `responseChecksumValidation`; no `signatureVersion`).
- `docs/technical_specification.md` §2.2 — the `S3Client` lifecycle (and the credential-absent
  decision: register without crashing, fail lazily with `STORAGE_NOT_CONFIGURED`).
- Re-verify the `S3Client`/`S3ClientConfig` API and `destroy()` via context7 before coding.

TASK
Author `src/server/providers/s3-client.provider.ts` exactly per §2.8 (TDD — spec first).

DELIVERABLES
1. `S3ClientProvider` (`@Injectable()` implements `OnModuleInit, OnApplicationShutdown`):
   - `onModuleInit()`: if `!options.hasCredentials` → `logger.warn(...)` and return; else build the
     `S3ClientConfig` with endpoint, region, forcePathStyle, credentials (+ sessionToken when set),
     `maxAttempts: options.maxAttempts`,
     `requestChecksumCalculation: options.requestChecksumCalculation`,
     `responseChecksumValidation: options.responseChecksumValidation`, then
     `this.client = new S3Client(config)`.
   - `onApplicationShutdown()`: if `client` → `client.destroy()` then clear the reference.
   - `getClient(): S3Client` (throws when undefined) and `isConfigured(): boolean`.

Constraints:
- NO `signatureVersion`; NO `maxRetries`. Pass both checksum options through to the config.
- `@fileoverview` + `@layer` header; functions ≤ 50 lines; NO `any`.
- English-only; timeless comments; no roadmap/phase references.
- Coverage 100% line/branch.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -n 'signatureVersion\|maxRetries' src/server/providers/s3-client.provider.ts` — expected: no match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.14 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add S3ClientProvider lifecycle (1.14)` — NO Co-Authored-By trailer.
````

---

### Task 1.15 — `BymaxStorageModule.forRoot()` synchronous + initial barrel

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.13, 1.14

#### Description

The synchronous `@Global()` dynamic module (`forRootAsync` lands in a later phase) plus the server barrel exporting only what exists so far. Internal helpers (`validateOptions`, `applyDefaults`, `ResolvedBymaxStorageOptions`, the message/status maps) are not exported.

#### Acceptance criteria

- [ ] `bymax-storage.module.ts` — `@Global() @Module({})` class with `static forRoot(options): DynamicModule` that calls `validateOptions(options)`, `applyDefaults(options)`, and registers providers: `{ provide: BYMAX_STORAGE_OPTIONS, useValue: resolved }`, `{ provide: BYMAX_STORAGE_UPLOAD_VALIDATORS, useValue: resolved.validation?.customValidators ?? [] }`, `{ provide: BYMAX_STORAGE_FILE_SCANNER, useValue: resolved.scanner?.impl ?? null }`, `S3ClientProvider`, `KeyResolverService`; exports `[BYMAX_STORAGE_OPTIONS, S3ClientProvider, KeyResolverService]`.
- [ ] `src/server/index.ts` exports `BymaxStorageModule`, the six DI tokens, the public interface types, `StorageException`, `S3ClientProvider`, `KeyResolverService`, and the shared re-exports (`UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`, `STORAGE_ERROR_CODES`, `StorageErrorCode`).
- [ ] The barrel does NOT export `validateOptions`, `applyDefaults`, `ResolvedBymaxStorageOptions`, `STORAGE_ERROR_MESSAGES`, or `STORAGE_ERROR_STATUS`.
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}` with the expected exports; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/bymax-storage.module.ts`
- `src/server/index.ts`

#### Agent prompt

````
You are a senior NestJS architect working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS,
distributed as a `@Global()` dynamic module. Only `forRoot()` (synchronous) is in scope here;
`forRootAsync()` lands in a later phase and must reuse the same provider list to avoid drift.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.15 of 17

PRECONDITIONS
- Tasks 1.13 (`KeyResolverService`) and 1.14 (`S3ClientProvider`) are done; config + error catalog
  + DI tokens exist.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.9 — the `forRoot()` skeleton.
- `docs/development_plan.md` §2.10 — the `src/server/index.ts` barrel (exactly which symbols are
  public vs internal).

TASK
Author the synchronous module and the initial server barrel.

DELIVERABLES
1. `src/server/bymax-storage.module.ts` — `@Global() @Module({})` with `static forRoot(options:
   BymaxStorageModuleOptions): DynamicModule` that validates, resolves, and registers the five
   providers and exports `[BYMAX_STORAGE_OPTIONS, S3ClientProvider, KeyResolverService]`.
2. `src/server/index.ts` — export `BymaxStorageModule`; the six DI token symbols; the public
   interface types via `export type { ... }`; `StorageException`; `S3ClientProvider`;
   `KeyResolverService`; and the shared re-exports (`UploadResult`, `ObjectMetadata`, `ListedObject`,
   `SignedUrlResult`, `STORAGE_ERROR_CODES`, `StorageErrorCode`).

Constraints:
- Do NOT export `validateOptions`, `applyDefaults`, `ResolvedBymaxStorageOptions`,
  `STORAGE_ERROR_MESSAGES`, or `STORAGE_ERROR_STATUS` — all internal.
- `@fileoverview` + `@layer` header; functions ≤ 50 lines; NO `any`.
- English-only; timeless comments; no roadmap/phase references.

Verification:
- `pnpm build` — expected: builds.
- `node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).sort()))"` —
  expected: includes `BymaxStorageModule`, `S3ClientProvider`, `KeyResolverService`,
  `StorageException`, `STORAGE_ERROR_CODES`, the six tokens; excludes the internal helpers.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.15 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add synchronous BymaxStorageModule.forRoot (1.15)` — NO Co-Authored-By trailer.
````

---

### Task 1.16 — Unit tests: config, error catalog, KeyResolver, S3ClientProvider, module

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.12, 1.13, 1.14, 1.15

#### Description

Author the unit specs that bring every file implemented in this phase to the 100% line/branch floor — AAA pattern, `it.each` for variants, descriptive `it()` names.

#### Acceptance criteria

- [ ] Seven spec files created: `key-resolver.service.spec.ts`, `validate-options.spec.ts`, `apply-defaults.spec.ts`, `storage-exception.spec.ts`, `aws-error-mapper.spec.ts`, `s3-client.provider.spec.ts`, `bymax-storage.module.spec.ts`.
- [ ] `key-resolver.service.spec.ts` covers prefix-empty/configured, the four-plus traversal variants, leading slash, empty string, slash collapse, and `stripPrefix` (security-critical — 100% + mutation break 95).
- [ ] `validate-options.spec.ts` covers valid, undefined/empty `endpoint`/`region`/`bucket`, `partSizeBytes < 5 MB`, `aws:kms` without `kmsKeyId`, and tolerated empty credentials.
- [ ] `apply-defaults.spec.ts` covers `publicBaseUrl` derivation, `hasCredentials` true/false, default `keyPrefix`, `signedUrls` merge, and the checksum/`maxAttempts` defaults.
- [ ] `storage-exception.spec.ts` covers `instanceof HttpException`, the public `code`, body serialization (including `details`), `details` omission when undefined, and that the default status comes from the status map.
- [ ] `aws-error-mapper.spec.ts` covers 404 → OBJECT_NOT_FOUND, `TimeoutError` → TIMEOUT, other → PROVIDER_ERROR, and `requestId`/`awsCode` preserved in `details`.
- [ ] `s3-client.provider.spec.ts` covers create-with-credentials, skip+warn-without-credentials, and `destroy` on shutdown.
- [ ] `bymax-storage.module.spec.ts` covers `forRoot` returning a `DynamicModule`, the provider/export set, and `@Global`.
- [ ] `pnpm test:cov` reports 100% line/branch on every file implemented in the phase.

#### Files to create / modify

- `src/server/services/key-resolver.service.spec.ts`, `src/server/config/validate-options.spec.ts`, `src/server/config/apply-defaults.spec.ts`, `src/server/errors/storage-exception.spec.ts`, `src/server/errors/aws-error-mapper.spec.ts`, `src/server/providers/s3-client.provider.spec.ts`, `src/server/bymax-storage.module.spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS. The
library floor is 100% line/branch coverage on every implemented file, with Stryker mutation
(high 100 / low 95 / break 95); `KeyResolverService` is the security-critical class.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.16 of 17

PRECONDITIONS
- Tasks 1.12-1.15 done: config, error catalog, KeyResolver, S3ClientProvider, and the module exist.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.10 — the full spec samples and the per-file coverage table (treat
  every listed file's target as 100% under the Bymax floor).

TASK
Author the seven unit spec files; bring every implemented file in this phase to 100% line/branch.

DELIVERABLES
1. `key-resolver.service.spec.ts` — prefix empty/configured, the `..` traversal variants
   (`../etc/passwd`, `a/../b`, `../..`, `./..`), leading slash, empty string, slash collapse,
   `stripPrefix`. (Security-critical: 100% + mutation break 95.)
2. `validate-options.spec.ts` — valid minimal, tolerated empty credentials, undefined/empty
   endpoint/region/bucket, `partSizeBytes < 5 MB`, `aws:kms` without `kmsKeyId`.
3. `apply-defaults.spec.ts` — `publicBaseUrl` derivation, `hasCredentials` true/false, default
   `keyPrefix`, `signedUrls` partial merge, resolved checksum + `maxAttempts` defaults.
4. `storage-exception.spec.ts` — `instanceof HttpException`, public `code`, body serialization,
   `details` omission, default status sourced from the internal status map.
5. `aws-error-mapper.spec.ts` — 404 → OBJECT_NOT_FOUND, `TimeoutError` → TIMEOUT, other →
   PROVIDER_ERROR, `requestId`/`awsCode` preserved.
6. `s3-client.provider.spec.ts` — create-with-credentials (`isConfigured()` true, `getClient()`
   instanceof `S3Client`), skip+warn without credentials (`getClient()` throws), `destroy` on
   shutdown (spy) clears the reference.
7. `bymax-storage.module.spec.ts` — `forRoot` returns a `DynamicModule` with the expected providers
   + exports; `@Global` applied.

Constraints:
- AAA pattern; `it('should ... when ...')` names; `it.each` for variants; each `it()` carries a
  short comment.
- English-only; timeless comments; no roadmap/phase references; NO `any` in test helpers.

Verification:
- `pnpm test` — expected: zero failures.
- `pnpm test:cov` — expected: 100% line/branch on every file implemented in this phase.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.16 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): add phase 1 unit tests (1.16)` — NO Co-Authored-By trailer.
````

---

### Task 1.17 — Phase validation + integration smoke

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16

#### Description

Consolidated phase gate: typecheck, lint, coverage, build, brotli size, and a NestJS bootstrap smoke test that instantiates the module and the `S3Client`. Runs `/bymax-quality:code-review` and applies findings.

#### Acceptance criteria

- [ ] `pnpm typecheck` (zero errors), `pnpm lint` (zero warnings), `pnpm test:cov` (100% line/branch on every implemented file), `pnpm build`, and `pnpm size` all pass.
- [ ] `pnpm size` confirms `server` < 30 KB brotli (well under in this phase — `StorageService` lands later) and `shared` < 3.5 KB brotli.
- [ ] A smoke script boots `BymaxStorageModule.forRoot({...})` in a NestJS application context and resolves the public `BYMAX_STORAGE_S3_CLIENT` token (the internal `KeyResolverService`/`S3ClientProvider` are NOT imported from the package), confirming the client is wired.
- [ ] **GitHub CI is green on the PR** — the `ci` (verify + e2e), `codeql`, and `scorecard` runs on the PR head all concluded `success` (confirmed via `gh run list`/`gh run view`). The phase is NOT closed with red or never-run CI.
- [ ] `/bymax-quality:code-review` has been run and its findings applied.
- [ ] Every other phase task is ✅ before this one is closed.

#### Files to create / modify

- (no library files) — a throwaway smoke script under `/tmp`; updates docs/dashboards only.

#### Agent prompt

````
You are a senior NestJS code reviewer / release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible object storage for NestJS;
two subpaths; zero direct deps. This is the phase exit gate.

CURRENT PHASE: 1 (Foundation + S3 Client + Config) — Task 1.17 of 17 (LAST)

PRECONDITIONS
- Tasks 1.1-1.16 are done: scaffold, shared layer, interfaces, DI tokens, error catalog, config,
  `KeyResolverService`, `S3ClientProvider`, synchronous `forRoot`, and unit tests all exist.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.11 — the phase-validation commands, the smoke-test script, and the
  done criteria.

TASK
Run the full phase gate, execute the bootstrap smoke test, run code review, and close the phase.

DELIVERABLES
1. Run, in order: `pnpm typecheck`, `pnpm lint`, `pnpm test:cov`, `pnpm build`, `pnpm size`. All
   must pass; coverage is 100% line/branch on every file implemented in the phase; `server` is
   well under 30 KB brotli and `shared` under 3.5 KB brotli.
2. Write a throwaway smoke script (e.g. `/tmp/smoke-storage-phase1.mjs`) that boots
   `BymaxStorageModule.forRoot({ endpoint, region, bucket, credentials })` via
   `NestFactory.createApplicationContext`, imports ONLY the public surface
   (`BymaxStorageModule`, `BYMAX_STORAGE_S3_CLIENT`), resolves the token, then closes the app.
   Expected output: `S3Client wired via BYMAX_STORAGE_S3_CLIENT token: true`.
3. Confirm GitHub CI is green on the PR: `gh run list --limit 5` + `gh run view <id>` for the `ci`,
   `codeql`, and `scorecard` runs on the PR head — all conclusion `success`. Do not close the phase
   with red or pending CI.
4. Run `/bymax-quality:code-review` and apply all findings; re-run the gate after any fix.

Constraints:
- Do NOT lower any gate to make it pass; fix the code instead. No `@ts-ignore`/`eslint-disable`.
- English-only; timeless comments; no roadmap/phase references in anything committed.
- Do NOT create `.gitkeep` or empty-directory placeholders (the smoke script lives in `/tmp`).

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size` — expected: all pass.
- `node /tmp/smoke-storage-phase1.mjs` — expected: `S3Client wired via BYMAX_STORAGE_S3_CLIENT token: true`.
- `gh run list --limit 5` — expected: the latest `ci`/`codeql`/`scorecard` runs on the PR head are `success`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 17`) in the header blockquote.
4. Append a Completion-log entry: `- 1.17 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `chore(storage): complete phase 1 validation (1.17)` — NO Co-Authored-By trailer.
````

---

## Completion log

- 1.1 ✅ 2026-06-30 — Project scaffold: package.json (zero deps, 6 peers), two-subpath exports, lockfile.
- 1.2 ✅ 2026-06-30 — tsconfig variants + tsup build (ESM+CJS+.d.ts for both subpaths).
- 1.3 ✅ 2026-06-30 — ESLint + Prettier + ignore files.
- 1.4 ✅ 2026-06-30 — Jest (4 variants, 100% global threshold, maxWorkers 50%) + Stryker config.
- 1.5 ✅ 2026-06-30 — Brotli bundle-size gate (scripts/check-size.mjs).
- 1.6 ✅ 2026-06-30 — src entries + 4 CI workflows + osv-scanner; hardened (SHA pins, harden-runner) and visibility-gated (public-ready / green-while-private).
- 1.7 ✅ 2026-06-30 — Shared types.
- 1.8 ✅ 2026-06-30 — Shared constants (STORAGE_ERROR_CODES, MIME whitelist, TTLs).
- 1.9 ✅ 2026-06-30 — Server interface contracts + barrel.
- 1.10 ✅ 2026-06-30 — Symbol DI tokens + default-options constants.
- 1.11 ✅ 2026-06-30 — Error catalog (messages + status map) + StorageException + AWS error mapper.
- 1.12 ✅ 2026-06-30 — Options validate / resolve / apply-defaults.
- 1.13 ✅ 2026-06-30 — KeyResolverService path-traversal guard + keyPrefix isolation.
- 1.14 ✅ 2026-06-30 — S3ClientProvider singleton lifecycle + lazy, credential-tolerant init.
- 1.15 ✅ 2026-06-30 — BymaxStorageModule.forRoot() synchronous + public barrel.
- 1.16 ✅ 2026-06-30 — Unit tests (8 suites, 66 tests, 100% line/branch).
- 1.17 ✅ 2026-06-30 — Phase gate: typecheck/lint/100% cov/build/size green; public-surface bootstrap resolves BYMAX_STORAGE_S3_CLIENT; grep invariant clean.
