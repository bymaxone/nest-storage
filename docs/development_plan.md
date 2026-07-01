# Development Plan — @bymax-one/nest-storage

> **Version:** 1.0.0
> **Last updated:** 2026-06-24
> **Status:** Draft for execution
> **Reference spec:** [`docs/technical_specification.md`](./technical_specification.md)
> **Target engine:** `@aws-sdk/client-s3 ^3.700.0` + `@aws-sdk/lib-storage` + `@aws-sdk/s3-request-presigner`
> **Derived documents:** `docs/tasks/phase-NN-<slug>.md` (Layer 3 — one file per phase, generated from this plan) + `docs/tasks/README.md` (folder index)

---

## Table of Contents

1. [Plan Overview](#1-plan-overview)
2. [Phase 1 — Foundation + S3 Client + Config](#2-phase-1--foundation--s3-client--config)
3. [Phase 2 — Upload (single, multipart, stream) + Download](#3-phase-2--upload-single-multipart-stream--download)
4. [Phase 3 — Signed URLs + Validation hooks + Virus scan hook](#4-phase-3--signed-urls--validation-hooks--virus-scan-hook)
5. [Phase 4 — Listing + Pagination + forRootAsync + E2E + Mutation](#5-phase-4--listing--pagination--forrootasync--e2e--mutation)
6. [Phase 5 — Release v0.1.0](#6-phase-5--release-v010)
7. [Appendix A — Dependency Graph](#appendix-a--dependency-graph)
8. [Appendix B — Complexity Matrix](#appendix-b--complexity-matrix)
9. [Appendix C — Reference Configs (mirror of nest-auth)](#appendix-c--reference-configs-mirror-of-nest-auth)
10. [Appendix D — Glossary and term mapping](#appendix-d--glossary-and-term-mapping)

---

## 1. Plan Overview

### 1.1 Development strategy

The implementation follows the **TDD red-green-refactor** protocol with vertically sliced phases:
- Each phase delivers **usable functionality** (not just "ready code") — at the end of each phase, the lib can be installed in a NestJS fixture app and exercised against local MinIO
- **Tests precede implementation** in every file with non-trivial logic (services, utils, validators, scanners, providers)
- **Per-phase coverage gate**: **100% line/branch on every file implemented in the phase** (Bymax lib floor), with extra mutation focus on critical paths (key resolver, validation pipeline, AWS SDK → `StorageException` error mapping, TTL clamp). The published artifact is gated at 100% global by `jest.coverage.config.ts` (`prepublishOnly`)
- **Mutation testing** runs as a **pre-release** gate only (not on per-commit CI — Stryker takes 10-20 min); release gate is mutation score **≥ 95% (break 95)**
- **Refactor pass** at the end of each phase, with `/bymax-quality:code-review` before marking the phase as done
- **Real E2E (Testcontainers + MinIO)** only kicks in at Phase 4 — before that, `S3Client` mocks are used

The phase order respects the dependency graph (Appendix A): S3 client before upload, single upload before multipart, validation before scanner, signed URLs independent of the upload pipeline.

### 1.2 Guiding principles

| Principle | Practical application |
|---|---|
| **TS strict, zero `any`** | Compiler in `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No exceptions: the AWS SDK API is strongly typed, so no `any` is needed. |
| **JSDoc on every exported symbol** | Every `export` of class, function, interface, constant carries JSDoc with `@example` when applicable. |
| **English in code and comments** | Identifiers, internal messages, comments, JSDoc — all in English. Documentation (`docs/`) in English. |
| **Zero `dependencies`** | `package.json` ships `"dependencies": {}`. Everything via peer dep. Reduces supply chain. |
| **Provider-agnostic by design** | No provider-specific code (DigitalOcean, R2, B2) leaks into the public API. Specifics live in `provider-recipes.ts` (config snippets). |
| **Stream-first** | APIs accept `Buffer | NodeJS.ReadableStream | Uint8Array`. Multipart uses `@aws-sdk/lib-storage` to never load large files into memory. |
| **Security by default** | SSE recommended, short default TTL on signed URLs, silent clamp on `maxTtlSeconds`, mandatory path traversal guard, opt-in validation. |
| **Dependency inversion** | `IUploadValidator` and `IFileScanner` define the contracts. The consumer plugs in implementations (ClamAV, AWS Macie, magic-byte sniffing). |
| **Silent failure on init when credentials are missing** | Preserves the original `SpacesService` behavior — module registers, operations fail with `STORAGE_NOT_CONFIGURED` (HTTP 503). Allows dev without credentials. |
| **Idempotent delete** | `delete()` does not throw on 404 — just a warning. Preserves canonical REST semantics. |
| **Conventional Commits** | `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Drives the semver bump on release. |

### 1.3 Status legend

| Symbol | Meaning |
| --- | --- |
| 📋 | ToDo |
| 🔄 | In Progress |
| 👀 | Review |
| ✅ | Done |
| ⛔ | Blocked |
| 🟡 | Partial |

### 1.4 Progress

- **Overall progress:** ✅ 4 / 5 phases done (80%) — 55 / 64 tasks
- **Active phase:** **Phase 5** (Release) — 🔄 In Progress
- **Blocked:** none

### 1.5 Phase dashboard

| ID | Phase | Status | Progress | Complexity | Last updated |
| --- | --- | --- | --- | --- | --- |
| 1 | [Foundation + S3 Client + Config](./tasks/phase-01-foundation-s3-client-config.md) | ✅ Done | 17/17 | MEDIUM | 2026-06-30 |
| 2 | [Upload (single, multipart, stream) + Download](./tasks/phase-02-upload-download.md) | ✅ Done | 14/14 | HIGH | 2026-06-30 |
| 3 | [Signed URLs + Validation + Scanner](./tasks/phase-03-signed-urls-validation-scanner.md) | ✅ Done | 12/12 | MEDIUM | 2026-06-30 |
| 4 | [Listing + Pagination + forRootAsync + E2E + Mutation](./tasks/phase-04-listing-async-e2e-mutation.md) | ✅ Done | 12/12 | HIGH | 2026-07-01 |
| 5 | [Release v0.1.0](./tasks/phase-05-release.md) | 🔄 In Progress | 2/9 | LOW | 2026-07-01 |
| | **Total** | ✅ **4 / 5 phases** | **55 / 64 tasks** | — | — |

> Each phase links to its task file in [`docs/tasks/`](./tasks/) (one file per phase). Per-sub-step detail is in §2–§6; dependency graph in Appendix A, complexity matrix in Appendix B. The **sub-step** counts in the prose (11/9/8/8/7 = 43) are finer-grained than the **task** counts (17/14/12/12/9 = 64): one plan sub-step expands into one or more executable tasks (§1.9).

> **Phase mapping to spec §15.** The spec's §15 "Implementation Phases" mirrors this exact 5-phase split (P1 Foundation · P2 Upload+Download · P3 Signed URLs+Validation+Scanner · P4 Listing+Async+E2E · P5 Release). `forRootAsync()` ships in **Phase 4** in both documents.

> **No time estimate** — this plan is intended for execution by AI agents. Duration in human days does not apply. Use the per-phase **Complexity** signal to prioritize more careful human review on HIGH phases (Phase 2 — multipart and streams; Phase 4 — real E2E against MinIO).

### 1.6 Update protocol

When a phase or task changes state, keep the dashboard consistent:

1. Set the phase row's **Status** emoji + **Last updated** date and bump its **Progress** (`X/Y` tasks) in the §1.5 dashboard.
2. Recompute **Overall progress** (`N / 5` phases + percentage, `M / 64` tasks) and update **Active phase** / **Blocked** in §1.4.
3. Mirror the per-task status inside the phase's task file (`docs/tasks/phase-NN-*.md` — Task index row + Completion log).
4. Never mark a phase ✅ while any §1.7 Done-criteria bullet is unmet — use 🟡 Partial until all are satisfied.
5. Commit the update with a `docs(plan): …` Conventional Commit (no `Co-Authored-By` trailer).

### 1.7 Global per-phase Done criteria

A phase is only marked **Done** (✅) when, **cumulatively**:

- [ ] `pnpm typecheck` passes without errors
- [ ] `pnpm lint` passes without warnings (no `eslint-disable`)
- [ ] `pnpm test:cov` passes with **100% line/branch coverage on every file implemented in the phase** (Bymax lib floor)
- [ ] `pnpm build` produces `dist/` with `.mjs`, `.cjs`, `.d.ts` for every declared subpath
- [ ] CI is green on the PR (the `ci`/`codeql`/`scorecard` workflows created in Phase 1)
- [ ] All sub-step acceptance criteria checked off
- [ ] JSDoc present on all new exports; every new file has an `@fileoverview` + `@layer` header
- [ ] Clean Code sizing respected (no function > 50 lines, no file > 800 lines)
- [ ] Official docs re-verified (context7) for every library touched this phase
- [ ] `git status` clean (commits made with Conventional Commits, no `Co-Authored-By` trailer)
- [ ] `/bymax-quality:code-review` executed and findings applied

> The published artifact is additionally gated at **100% global** coverage by `jest.coverage.config.ts` (run via `prepublishOnly`) and **mutation score ≥ 95% (break 95)** at release. The per-phase 100%-per-file gate above is the development-time floor; both must hold before v0.1.0 ships.

### 1.8 Expected end file structure (after Phase 5)

The `nest-storage/` repo root directory mirrors the canonical layout of the sibling libs (`bymax-one/nest-auth`, `bymax-one/nest-cache`); the monorepo-level `bymax-one/EXTRACTION_ROADMAP.md` (outside this repo) is the original template.

```
nest-storage/
├── .github/workflows/      # ci.yml, codeql.yml, release.yml, scorecard.yml  (created in Phase 1)
├── docs/
│   ├── technical_specification.md
│   ├── development_plan.md          ← this file
│   ├── tasks/                       ← one file per phase (phase-01-*.md … phase-05-*.md) + README.md
│   ├── mutation_testing_plan.md
│   └── mutation_testing_results.md
├── scripts/check-size.mjs
├── src/server/              # main entry — see §3.1 of the spec
├── src/shared/              # zero deps — types & constants
├── test/e2e/                # e2e specs with Testcontainers + MinIO
├── package.json
├── tsup.config.ts
├── tsconfig.json (+ build / server / e2e / jest variants)
├── jest.config.ts (+ coverage / e2e / stryker variants)
├── stryker.config.json
├── eslint.config.mjs
├── README.md / CHANGELOG.md / SECURITY.md / LICENSE / CLAUDE.md / AGENTS.md
```

### 1.9 How this plan feeds `docs/tasks/`

The executable tasks live in [`docs/tasks/`](./tasks/) — **one file per phase** (`phase-NN-<slug>.md`), generated from this plan via the `/bymax-workflow:phase-tasks` standard. Each numbered **sub-step** in this plan (§2.X, §3.X, etc.) becomes **one or more executable tasks**. The derivation rule:

- Sub-step with **a single file + logic < 100 LoC** → **1 task**
- Sub-step with **multiple related files** → **grouped task** with a per-file checklist
- Sub-step with **logic > 200 LoC** → **task split** into red (test), green (impl), refactor

Each task carries the full self-contained prompt for AI agent execution (Role / PROJECT / CURRENT PHASE / PRECONDITIONS / REQUIRED READING / TASK / DELIVERABLES / Constraints / Verification / Completion Protocol — `/bymax-workflow:phase-tasks` standard). The **canonical phase status lives in the §1.5 dashboard above**; each task's Completion Protocol updates that dashboard and the task file's own index/Completion log.

---

## 2. Phase 1 — Foundation + S3 Client + Config

> **Phase objective:** Establish the full project scaffold, define public contracts (interfaces, types, constants), implement `S3ClientProvider` with correct lifecycle, `KeyResolverService` with path traversal guard, and register the synchronous `BymaxStorageModule.forRoot()`. At the end of the phase, the lib can be installed in a NestJS fixture app, credentials configured, and `S3Client` is instantiated (without making calls yet).
>
> **Complexity:** MEDIUM.
>
> **Critical paths for 95% coverage:** `src/server/services/key-resolver.service.ts`, `src/server/config/resolved-options.ts`, `src/server/providers/s3-client.provider.ts`, `src/server/errors/storage-exception.ts`.

### 2.1 Project scaffold

**Objective:** Create the folder structure, configuration files, base dependencies, **and the four CI workflows** (front-loaded so every PR is gated from the first one), mirroring the canonical `nest-auth` configs.

**Files to create:**

```
nest-storage/
├── .github/workflows/ci.yml          # verify job (dependency-review + typecheck + lint + test:cov 100% + build-integrity[2 subpaths] + brotli size) + e2e job (Docker/MinIO); incremental-safe via passWithNoTests
├── .github/workflows/codeql.yml      # static analysis, per-PR + weekly
├── .github/workflows/scorecard.yml   # OpenSSF Scorecard
├── .github/workflows/release.yml     # tag-driven (inert until a v*.*.* tag); npm publish --provenance
├── .gitignore
├── .prettierrc
├── .npmignore
├── eslint.config.mjs
├── jest.config.ts
├── jest.coverage.config.ts
├── jest.e2e.config.ts
├── jest.stryker.config.ts
├── stryker.config.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.server.json
├── tsconfig.e2e.json
├── tsconfig.jest.json
├── tsup.config.ts
├── package.json
├── scripts/check-size.mjs
├── src/server/index.ts          # empty at this step — structure only
└── src/shared/index.ts          # empty at this step
```

> `test/e2e/` is created later (Phase 4) when the first e2e spec is written — do NOT pre-create it with a `.gitkeep` placeholder (directories emerge from real files).

**Reference content:**

Copy from `../nest-auth/` (`/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/`) and adapt (replace `nest-auth` with `nest-storage`):

| Source (nest-auth) | Destination (nest-storage) | Adaptation |
|---|---|---|
| `tsconfig.json` | `tsconfig.json` | Swap path aliases: 2 subpaths instead of 5 (`@bymax-one/nest-storage`, `@bymax-one/nest-storage/shared`) |
| `tsconfig.build.json` | `tsconfig.build.json` | Identical (extends tsconfig.json, excludes `**/*.spec.ts`, `test/`) |
| `tsconfig.server.json` | `tsconfig.server.json` | `include: ['src/server/**/*']` |
| `tsconfig.e2e.json` | `tsconfig.e2e.json` | Includes `test/e2e/`; more permissive (no strict null checks in e2e helpers) |
| `tsconfig.jest.json` | `tsconfig.jest.json` | Identical |
| `jest.config.ts` | `jest.config.ts` | Swap `moduleNameMapper` to 2 subpaths; `coverageThreshold.global` = **100%** branches/functions/lines/statements (Bymax floor — same hard gate as the release `test:cov:all`, no drift) |
| `jest.coverage.config.ts` | `jest.coverage.config.ts` | Threshold 100% global (release gate) — see §6.5 |
| `jest.e2e.config.ts` | `jest.e2e.config.ts` | `rootDir: test/e2e`; `testTimeout: 60_000` (Testcontainers takes 10-30s to spin up MinIO) |
| `jest.stryker.config.ts` | `jest.stryker.config.ts` | Identical |
| `stryker.config.json` | `stryker.config.json` | Swap `tsconfig.json`; thresholds: high 100, low 95, break 95 (Bymax floor) — document inherent equivalent mutants of the I/O surface via `// Stryker disable next-line` rather than lowering the gate |
| `tsup.config.ts` | `tsup.config.ts` | **Rewrite** — 2 entries (`server`, `shared`); externals: peer deps from package.json (see §2.1.3 below) |
| `eslint.config.mjs` | `eslint.config.mjs` | Copy; remove rules specific to `oauth/`, `crypto/`; keep `eslint-plugin-security`, `eslint-plugin-import` |
| `.prettierrc` | `.prettierrc` | Identical |
| `.gitignore` | `.gitignore` | Identical |
| `scripts/check-size.mjs` | `scripts/check-size.mjs` | **Rewrite** — 2 entries: `server` budget 30_000 brotli (AWS SDK is heavy), `shared` budget 3_500 brotli (see §6.5) |

**Detail — `package.json` for this phase:**

```json
{
  "name": "@bymax-one/nest-storage",
  "version": "0.1.0-alpha.0",
  "description": "Provider-agnostic S3-compatible object storage for NestJS. Works with AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, MinIO, Wasabi.",
  "author": "Bymax One <support@bymax.one>",
  "license": "MIT",
  "homepage": "https://github.com/bymaxone/nest-storage#readme",
  "repository": { "type": "git", "url": "https://github.com/bymaxone/nest-storage.git" },
  "bugs": { "url": "https://github.com/bymaxone/nest-storage/issues" },
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"],
  "exports": {
    ".": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.mjs",
      "require": "./dist/server/index.cjs"
    },
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "import": "./dist/shared/index.mjs",
      "require": "./dist/shared/index.cjs"
    }
  },
  "scripts": {
    "build": "pnpm clean && tsup",
    "lint": "eslint src",
    "lint:fix": "eslint src --fix",
    "test": "jest",
    "test:cov": "jest --coverage",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config jest.e2e.config.ts",
    "test:all": "pnpm test && pnpm test:e2e",
    "test:cov:all": "jest --config jest.coverage.config.ts --coverage",
    "mutation": "stryker run",
    "mutation:incremental": "stryker run --incremental",
    "mutation:dry-run": "stryker run --dryRunOnly",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.server.json",
    "size": "node scripts/check-size.mjs",
    "clean": "rm -rf dist coverage",
    "prepublishOnly": "pnpm clean && pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build",
    "release": "pnpm publish --provenance"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/lib-storage": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "reflect-metadata": "^0.2.0"
  },
  "peerDependenciesMeta": {
    "@nestjs/common": { "optional": false },
    "@nestjs/core": { "optional": false },
    "@aws-sdk/client-s3": { "optional": false },
    "@aws-sdk/lib-storage": { "optional": false },
    "@aws-sdk/s3-request-presigner": { "optional": false },
    "reflect-metadata": { "optional": false }
  },
  "devDependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/lib-storage": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "@nestjs/common": "^11.1.20",
    "@nestjs/core": "^11.1.20",
    "@nestjs/platform-express": "^11.1.20",
    "@nestjs/testing": "^11.1.20",
    "@stryker-mutator/core": "^9",
    "@stryker-mutator/jest-runner": "^9",
    "@stryker-mutator/typescript-checker": "^9",
    "@testcontainers/minio": "^10.x",
    "@types/express": "^5.0.6",
    "@types/jest": "^30.0.0",
    "@types/node": "^25.7.0",
    "@types/supertest": "^7.2.0",
    "@typescript-eslint/eslint-plugin": "^8.59.3",
    "@typescript-eslint/parser": "^8.59.3",
    "eslint": "^9.39.4",
    "eslint-config-prettier": "^10.1.8",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import": "^2.32.0",
    "eslint-plugin-prettier": "^5.5.5",
    "eslint-plugin-security": "^4.0.0",
    "jest": "^30.4.2",
    "prettier": "^3.8.3",
    "reflect-metadata": "^0.2.2",
    "supertest": "^7.2.2",
    "testcontainers": "^10.x",
    "ts-jest": "^29.4.9",
    "ts-node": "^10.9.2",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3"
  },
  "packageManager": "pnpm@10.8.1",
  "engines": { "node": ">=24.0.0" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }
}
```

**Detail — `tsup.config.ts`:**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig([
  // Server entry (main) — Node.js + NestJS + AWS SDK
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: [
      /^@nestjs\//,
      /^@aws-sdk\//,
      'reflect-metadata',
    ],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
  },
  // Shared entry — types + constants (zero deps)
  {
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
  },
])
```

**Acceptance criteria:**

- [ ] Directory structure created per the tree above
- [ ] `package.json` with all scripts, peer deps and devDeps listed
- [ ] `tsconfig.json` inherits strict settings from nest-auth (target ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [ ] `tsup.config.ts` configured with 2 entries and externals for `@aws-sdk/*`
- [ ] `eslint.config.mjs` in flat config v9 is functional (zero warnings on the empty folder)
- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes with empty `src/server/index.ts` and `src/shared/index.ts` (placeholder comment only)
- [ ] `pnpm lint` passes without warnings
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}` and `dist/shared/index.{mjs,cjs,d.ts}` even with source empty

**Validation commands:**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
ls -la dist/server/  # confirma .mjs, .cjs, .d.ts
ls -la dist/shared/
```

**Dependencies:** In the prior sub-step. This is the phase entry point.

**Risks/Notes:**

- `pnpm@10.8.1` is a requirement; using a different version can break lockfile resolution
- Node 24 LTS is the minimum
- `@aws-sdk/*` is large (~5 MB unpacked). tsup treeshake must be correct so the consumer doesn't load unnecessary commands. Validate the end bundle with `pnpm size`
- `@testcontainers/minio` is devDep only (e2e); never import in production code

### 2.2 Shared types and constants (`src/shared/`)

**Objective:** Define the public types and constants without NestJS or AWS SDK dependencies. These modules can be imported in the frontend (e.g., MIME validation on the upload input) without bringing overhead.

**Files to create:**

```
src/shared/
├── types/
│   ├── storage-types.ts
│   ├── signed-url-types.ts
│   └── error-types.ts
├── constants/
│   ├── error-codes.constants.ts
│   ├── mime-types.constants.ts
│   └── default-ttls.constants.ts
└── index.ts
```

**Skeleton — `src/shared/types/storage-types.ts`:**

```typescript
/**
 * Pure data shapes returned by storage operations. Zero NestJS or AWS SDK deps.
 * Safe to import in frontends, edge functions, or non-Node environments.
 */

/** Outcome of an upload — returned to the caller. */
export interface UploadResult {
  /** Final key after normalization and global keyPrefix. */
  key: string
  bucket: string
  etag: string
  /** Only set on versioned buckets. */
  versionId?: string
  size?: number
  contentType: string
  publicUrl: string
  /** True when multipart pathway was used. */
  multipart: boolean
  /** True when result was returned from the idempotency cache. */
  fromIdempotencyCache: boolean
}

/** Object metadata as returned by `head()` and `download()`. */
export interface ObjectMetadata {
  key: string
  bucket: string
  size: number
  contentType: string
  etag: string
  lastModified: Date
  cacheControl?: string
  contentDisposition?: string
  /** `x-amz-meta-*` custom metadata. */
  metadata: Record<string, string>
  /** S3 storage class (STANDARD, GLACIER, etc.). */
  storageClass?: string
  versionId?: string
}

/** Result row returned by `list()`. */
export interface ListedObject {
  key: string
  size: number
  etag: string
  lastModified: Date
  storageClass?: string
}
```

**Skeleton — `src/shared/types/signed-url-types.ts`:**

```typescript
/** Result of a signed URL request — caller forwards `url` to a client. */
export interface SignedUrlResult {
  /** The presigned URL. NEVER LOG this — it is a temporary credential. */
  url: string
  /** Absolute deadline after which the URL stops being accepted by the provider. */
  expiresAt: Date
  /** HTTP method the client must use. */
  method: 'GET' | 'PUT'
  /**
   * Headers the client MUST include verbatim — they are part of the signature.
   * Example: `{ 'Content-Type': 'image/png' }`.
   */
  requiredHeaders: Record<string, string>
}
```

**Skeleton — `src/shared/types/error-types.ts`:**

```typescript
import type { STORAGE_ERROR_CODES } from '../constants/error-codes.constants'

/**
 * JSON shape emitted by `StorageException` — what the host application's
 * HTTP error handler receives in `response.body`.
 */
export interface StorageErrorResponse {
  error: {
    code: keyof typeof STORAGE_ERROR_CODES
    message: string
    details?: Record<string, unknown>
  }
}
```

**Skeleton — `src/shared/constants/error-codes.constants.ts`:**

```typescript
/**
 * Stable string codes returned in error responses.
 * Host apps and clients pattern-match on these — they MUST NOT change between
 * minor versions.
 *
 * Use `as const` to preserve literal types in `.d.ts`.
 */
export const STORAGE_ERROR_CODES = {
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  STORAGE_KEY_INVALID: 'STORAGE_KEY_INVALID',
  STORAGE_BODY_MISSING: 'STORAGE_BODY_MISSING',
  STORAGE_CONTENT_TYPE_REQUIRED: 'STORAGE_CONTENT_TYPE_REQUIRED',
  STORAGE_MIME_NOT_ALLOWED: 'STORAGE_MIME_NOT_ALLOWED',
  STORAGE_SIZE_EXCEEDED: 'STORAGE_SIZE_EXCEEDED',
  STORAGE_VALIDATION_FAILED: 'STORAGE_VALIDATION_FAILED',
  STORAGE_SCAN_INFECTED: 'STORAGE_SCAN_INFECTED',
  STORAGE_SCAN_INCONCLUSIVE: 'STORAGE_SCAN_INCONCLUSIVE',
  STORAGE_OBJECT_NOT_FOUND: 'STORAGE_OBJECT_NOT_FOUND',
  STORAGE_PROVIDER_ERROR: 'STORAGE_PROVIDER_ERROR',
  STORAGE_SIGNED_URL_TTL_INVALID: 'STORAGE_SIGNED_URL_TTL_INVALID',
  STORAGE_PART_TOO_SMALL: 'STORAGE_PART_TOO_SMALL',
  STORAGE_BUCKET_UNDEFINED: 'STORAGE_BUCKET_UNDEFINED',
  STORAGE_MULTIPART_ABORTED: 'STORAGE_MULTIPART_ABORTED',
  STORAGE_INVALID_CONFIG: 'STORAGE_INVALID_CONFIG',
  STORAGE_TIMEOUT: 'STORAGE_TIMEOUT',
} as const

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[keyof typeof STORAGE_ERROR_CODES]
```

**Skeleton — `src/shared/constants/mime-types.constants.ts`:**

```typescript
/**
 * Curated MIME whitelists for common upload domains.
 * Consumers may merge with their own or pass directly to
 * `validation.mimeWhitelist`.
 *
 * Wildcards ARE NOT used here — consumers can add `'image/*'` themselves if they
 * trust any image subtype.
 */
export const DEFAULT_IMAGE_MIME_WHITELIST: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
] as const

export const DEFAULT_VIDEO_MIME_WHITELIST: readonly string[] = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const

export const DEFAULT_DOC_MIME_WHITELIST: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const
```

**Skeleton — `src/shared/constants/default-ttls.constants.ts`:**

```typescript
/**
 * Default TTLs (in seconds) for signed URLs.
 * Short by default — prefer issuing a new URL over caching long-lived ones.
 */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300 as const
export const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60 as const // 7 days (S3 hard limit)

/** Multipart upload threshold — files >= this are sent via `@aws-sdk/lib-storage`. */
export const DEFAULT_MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024 as const // 5 MB

/** Default size of each part in a multipart upload. S3 minimum is 5 MB. */
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024 as const // 5 MB

/** Number of parts uploaded concurrently. */
export const DEFAULT_MULTIPART_QUEUE_SIZE = 4 as const
```

**Skeleton — `src/shared/index.ts`:**

```typescript
// Types
export type { UploadResult, ObjectMetadata, ListedObject } from './types/storage-types'
export type { SignedUrlResult } from './types/signed-url-types'
export type { StorageErrorResponse } from './types/error-types'

// Constants
export { STORAGE_ERROR_CODES } from './constants/error-codes.constants'
export type { StorageErrorCode } from './constants/error-codes.constants'
export {
  DEFAULT_IMAGE_MIME_WHITELIST,
  DEFAULT_VIDEO_MIME_WHITELIST,
  DEFAULT_DOC_MIME_WHITELIST,
} from './constants/mime-types.constants'
export {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  MAX_SIGNED_URL_TTL_SECONDS,
  DEFAULT_MULTIPART_THRESHOLD_BYTES,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_MULTIPART_QUEUE_SIZE,
} from './constants/default-ttls.constants'
```

**Acceptance criteria:**

- [ ] All files created per the tree
- [ ] JSDoc present on each export
- [ ] `pnpm build` generates `dist/shared/index.d.ts` listando all exports
- [ ] `pnpm typecheck` passes
- [ ] Bundle `dist/shared/index.mjs` < 3.5 KB brotli (validate with `pnpm size` in the §2.10)
- [ ] Subpath `import('@bymax-one/nest-storage/shared')` resolves correctly in a consumer fixture
- [ ] Zero imports de `@nestjs/*` or `@aws-sdk/*` in `src/shared/`

**Validation commands:**

```bash
pnpm build
node -e "import('./dist/shared/index.mjs').then(m => console.log(Object.keys(m)))"
# Expected list: STORAGE_ERROR_CODES, DEFAULT_IMAGE_MIME_WHITELIST, ...
grep -r '@nestjs\|@aws-sdk' src/shared/  # expected: no match
```

**Dependencies:** §2.1 complete.

**Risks/Notes:**

- `import type` is mandatory for types — avoids inclusion in the JS bundle
- Constants must be `as const` to preserve literal types in the `dist/.d.ts`
- Do not add logic in `shared/` — only pure types and constants

### 2.3 Configuration interfaces and contracts (`src/server/interfaces/`)

**Objective:** Define all public interfaces that the consumer can implement or reference — `BymaxStorageModuleOptions`, `UploadOptions`, `DownloadOptions`, `ListOptions`, `SignedGetUrlOptions`, `SignedPutUrlOptions`, `IUploadValidator`, `IFileScanner`, `ProviderRecipe`.

**Files to create:**

```
src/server/interfaces/
├── storage-module-options.interface.ts
├── upload-options.interface.ts
├── download-options.interface.ts
├── list-options.interface.ts
├── signed-url-options.interface.ts
├── upload-validator.interface.ts
├── file-scanner.interface.ts
├── provider-recipe.interface.ts
└── index.ts
```

**Skeleton — `src/server/interfaces/storage-module-options.interface.ts`:**

```typescript
import type { ModuleMetadata, Type } from '@nestjs/common'
import type { IUploadValidator } from './upload-validator.interface'
import type { IFileScanner } from './file-scanner.interface'

/**
 * Sync configuration for `BymaxStorageModule.forRoot()`.
 * See `docs/technical_specification.md` §4.1 for full semantics of every field.
 */
export interface BymaxStorageModuleOptions {
  /** S3-compatible endpoint. See Provider Recipes (§4.3 of spec). REQUIRED. */
  endpoint: string
  /** Region — `'auto'` for R2, any non-empty string for MinIO. REQUIRED. */
  region: string
  /** Default bucket — overridable per call. REQUIRED. */
  bucket: string
  /** Credentials — inject via ConfigService, never hardcode. REQUIRED. */
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    /** STS / OIDC temporary session token. */
    sessionToken?: string
  }
  /** false = virtual-hosted, true = path-style (MinIO). Default: false. */
  forcePathStyle?: boolean
  /** Public base URL for direct links. Fallback: endpoint + bucket. */
  publicBaseUrl?: string
  /** When set, `getPublicUrl()` returns the CDN URL instead. */
  cdnBaseUrl?: string
  /** Apply ACL `public-read` on uploads. Default: false. NOTE: fails (400 AccessControlListNotSupported) on modern AWS S3 buckets with ACLs disabled, and is a no-op on R2 — prefer bucket policy / CDN / signed URLs (spec §16.1). */
  defaultPublicRead?: boolean
  /** Global key prefix applied to every operation. Useful for multi-tenant isolation. */
  keyPrefix?: string
  /** Default Cache-Control header on uploads. */
  defaultCacheControl?: string
  /** Default Content-Disposition. */
  defaultContentDisposition?: 'inline' | 'attachment'

  signedUrls?: {
    /** Default GET TTL (seconds). Default: 300. */
    defaultGetTtlSeconds?: number
    /** Default PUT TTL (seconds). Default: 300. */
    defaultPutTtlSeconds?: number
    /** Hard cap — TTLs above are silently clamped. Default: 604_800 (7 days). */
    maxTtlSeconds?: number
  }

  multipart?: {
    /** Bytes threshold to switch to multipart. Default: 5_242_880 (5 MB). */
    thresholdBytes?: number
    /** Size per part (S3 minimum: 5 MB). Default: 5 MB. */
    partSizeBytes?: number
    /** Concurrent parts. Default: 4. */
    queueSize?: number
  }

  /** Enables ValidationService when present. */
  validation?: {
    /** MIME whitelist — supports wildcards like 'image/*'. */
    mimeWhitelist?: readonly string[]
    /** Max upload size in bytes. */
    maxSizeBytes?: number
    /** Custom validators run in order; first rejection short-circuits. */
    customValidators?: readonly IUploadValidator[]
  }

  /** Enables FileScannerService when present. */
  scanner?: {
    impl: IFileScanner
    /** 'pre-upload' (default) scans before; 'post-upload' scans after. */
    mode?: 'pre-upload' | 'post-upload'
    /** Reject when scanner returns `'unknown'`. Default: false. */
    rejectOnUnknown?: boolean
  }

  /** Server-side encryption. */
  serverSideEncryption?: 'AES256' | 'aws:kms'
  /** Required when `serverSideEncryption === 'aws:kms'`. */
  kmsKeyId?: string
  /** S3Client `requestChecksumCalculation` (AWS SDK v3.729.0+ default CRC32 integrity headers). Non-AWS providers (R2/B2/MinIO/Spaces) require `'WHEN_REQUIRED'`; provider recipes set it. Default: `'WHEN_SUPPORTED'`. */
  requestChecksumCalculation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  /** S3Client `responseChecksumValidation` (checksum-mode on GET). Same provider caveat. Default: `'WHEN_SUPPORTED'`. */
  responseChecksumValidation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  /** AWS SDK v3 total attempts incl. the first try (maps to `maxAttempts`; attempts = retries + 1). Default: 3. */
  maxAttempts?: number
  /** Per-request timeout. Default: 30_000 ms. */
  requestTimeoutMs?: number
}

/**
 * Async configuration for `BymaxStorageModule.forRootAsync()`.
 * Standard NestJS dynamic module async options shape.
 */
export interface BymaxStorageModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: unknown[]) => BymaxStorageModuleOptions | Promise<BymaxStorageModuleOptions>
  inject?: readonly (string | symbol | Type<unknown>)[]
  useExisting?: Type<BymaxStorageModuleOptionsFactory>
  useClass?: Type<BymaxStorageModuleOptionsFactory>
}

export interface BymaxStorageModuleOptionsFactory {
  createStorageOptions(): BymaxStorageModuleOptions | Promise<BymaxStorageModuleOptions>
}
```

**Skeleton — `src/server/interfaces/upload-options.interface.ts`:**

```typescript
export interface UploadOptions {
  key: string
  /** Buffer (small/medium), Readable (large), or Uint8Array. */
  body: Buffer | NodeJS.ReadableStream | Uint8Array
  contentType: string
  bucket?: string
  /** Required for validation and optimal multipart sizing. */
  size?: number
  cacheControl?: string
  contentDisposition?: 'inline' | 'attachment' | string
  /** Default: `defaultPublicRead` from module options. */
  publicRead?: boolean
  /** 'NONE' forces in the SSE even when default is set globally. */
  serverSideEncryption?: 'AES256' | 'aws:kms' | 'NONE'
  kmsKeyId?: string
  /** Custom `x-amz-meta-*` headers. */
  metadata?: Record<string, string>
  /**
   * If the same idempotencyKey was seen within the 24h cache TTL, returns the
   * cached UploadResult without re-uploading.
   */
  idempotencyKey?: string
  /** Progress callback fired after each multipart UploadPart (or once for single). */
  onProgress?: (event: { loaded: number; total?: number; part?: number }) => void
}
```

**Skeleton — `src/server/interfaces/download-options.interface.ts`:**

```typescript
export interface DownloadOptions {
  key: string
  bucket?: string
  /** S3 Range header — e.g., 'bytes=0-1023' for partial downloads. */
  range?: string
  /** Conditional GET — only return if ETag does NOT match. */
  ifNoneMatch?: string
  /** Conditional GET — only return if ETag matches. */
  ifMatch?: string
}
```

**Skeleton — `src/server/interfaces/list-options.interface.ts`:**

```typescript
import type { ListedObject } from '../../shared/types/storage-types'

export interface ListOptions {
  /** Filter prefix (applied AFTER global keyPrefix). */
  prefix?: string
  bucket?: string
  /** Page size. Default: 1000 (S3 hard max). */
  maxKeys?: number
  /** Token from previous page. */
  continuationToken?: string
  /**
   * Delimiter for pseudo-hierarchical listing. When `'/'`, objects under
   * sub-prefixes are aggregated into `commonPrefixes`.
   */
  delimiter?: string
}

export interface ListResult {
  objects: ListedObject[]
  commonPrefixes: string[]
  isTruncated: boolean
  nextContinuationToken?: string
}
```

**Skeleton — `src/server/interfaces/signed-url-options.interface.ts`:**

```typescript
export interface SignedGetUrlOptions {
  key: string
  bucket?: string
  /** Silently clamped to `signedUrls.maxTtlSeconds`. */
  ttlSeconds?: number
  /** e.g., 'attachment; filename="invoice.pdf"' — overrides on download. */
  responseContentDisposition?: string
  responseContentType?: string
}

export interface SignedPutUrlOptions {
  key: string
  bucket?: string
  /** Content-Type the client MUST send (becomes part of the signature). */
  contentType: string
  ttlSeconds?: number
  /** Adds Content-Length-Range policy — S3 rejects PUTs larger than this. */
  maxSizeBytes?: number
  publicRead?: boolean
  metadata?: Record<string, string>
}

export interface MultipartUploadUrlsOptions {
  key: string
  bucket?: string
  contentType: string
  /** Number of parts to presign. */
  parts: number
  ttlSeconds?: number
}

export interface MultipartUploadUrlsResult {
  uploadId: string
  partUrls: Array<{ partNumber: number; url: string }>
  completeUrl: string
}
```

**Skeleton — `src/server/interfaces/upload-validator.interface.ts`:**

```typescript
/**
 * Pluggable upload validator. Implementations are run in order before the
 * S3 PutObject — the first that returns `{ ok: false }` aborts the upload.
 *
 * @example
 *   class PdfMagicByteValidator implements IUploadValidator {
 *     readonly name = 'pdf-magic-byte'
 *     async validate(ctx) {
 *       if (ctx.contentType !== 'application/pdf' || !ctx.readBytes) return { ok: true }
 *       const head = await ctx.readBytes(4)
 *       return head.toString('ascii') === '%PDF'
 *         ? { ok: true }
 *         : { ok: false, reason: 'Declared as PDF but missing magic bytes' }
 *     }
 *   }
 */
export interface IUploadValidator {
  /** Unique name — used in error logs. */
  readonly name: string
  validate(context: {
    key: string
    contentType: string
    size?: number
    metadata?: Record<string, string>
    /**
     * Reads up to `maxBytes` from the body without consuming it for the actual
     * upload. Useful for magic-byte sniffing on streams.
     */
    readBytes?: (maxBytes: number) => Promise<Buffer>
  }): Promise<{ ok: true } | { ok: false; reason: string }>
}
```

**Skeleton — `src/server/interfaces/file-scanner.interface.ts`:**

```typescript
/**
 * Pluggable file scanner — virus, malware, content moderation, etc.
 * Receives bytes in pre-upload mode, only metadata in post-upload mode.
 */
export interface IFileScanner {
  scan(input: {
    /** 'pre-upload' includes `body`; 'post-upload' has only key/bucket/contentType. */
    mode: 'pre-upload' | 'post-upload'
    body?: Buffer | NodeJS.ReadableStream
    key: string
    bucket: string
    contentType: string
    size?: number
  }): Promise<FileScanResult>
}

export interface FileScanResult {
  status: 'clean' | 'infected' | 'unknown'
  /** Engine name — e.g., 'clamav-0.103', 'aws-macie'. */
  engine: string
  /** Threat name when `status === 'infected'`. */
  threat?: string
  details?: Record<string, unknown>
}
```

**Skeleton — `src/server/interfaces/provider-recipe.interface.ts`:**

```typescript
import type { BymaxStorageModuleOptions } from './storage-module-options.interface'

/**
 * Provider Recipe — a factory function that produces a `BymaxStorageModuleOptions`
 * pre-tuned for a specific S3-compatible provider.
 */
export type ProviderRecipe<TInput> = (input: TInput) => BymaxStorageModuleOptions
```

**Skeleton — `src/server/interfaces/index.ts`:**

```typescript
export type {
  BymaxStorageModuleOptions,
  BymaxStorageModuleAsyncOptions,
  BymaxStorageModuleOptionsFactory,
} from './storage-module-options.interface'
export type { UploadOptions } from './upload-options.interface'
export type { DownloadOptions } from './download-options.interface'
export type { ListOptions, ListResult } from './list-options.interface'
export type {
  SignedGetUrlOptions,
  SignedPutUrlOptions,
  MultipartUploadUrlsOptions,
  MultipartUploadUrlsResult,
} from './signed-url-options.interface'
export type { IUploadValidator } from './upload-validator.interface'
export type { IFileScanner, FileScanResult } from './file-scanner.interface'
export type { ProviderRecipe } from './provider-recipe.interface'
```

**Acceptance criteria:**

- [ ] All interfaces created with complete JSDoc
- [ ] `readonly` on arrays to prevent accidental mutation (consistent with `exactOptionalPropertyTypes`)
- [ ] `BymaxStorageModuleAsyncOptions` segue pattern oficial NestJS de async dynamic module
- [ ] `pnpm typecheck` passes
- [ ] No `any` in any assinatura

**Validation commands:**

```bash
pnpm typecheck
grep -n ': any\b\|any\[\]' src/server/interfaces/  # expected: no match
```

**Dependencies:** §2.2 (needs `UploadResult`, `ListedObject` in shared).

**Risks/Notes:**

- Do not export these interfaces directly from the server `index.ts` yet — wait for Phase 1 to complete
- Keep `BymaxStorageModuleOptions` separate from `BymaxStorageModuleAsyncOptions` (do not merge into a union)
- `IUploadValidator.validate` returns a **discriminated union** — `{ ok: true } | { ok: false; reason: string }` — to force type narrowing in the consumer

### 2.4 DI tokens and internal constants

**Objective:** Define the injection tokens (`Symbol()`) and internal constants (default options).

**Files to create:**

```
src/server/
├── bymax-storage.constants.ts          # Injection tokens (Symbol)
└── constants/
    ├── default-mime-whitelist.constants.ts
    └── default-options.constants.ts
```

**Skeleton — `src/server/bymax-storage.constants.ts`:**

```typescript
/**
 * Dependency injection tokens.
 *
 * Symbols are used instead of strings to avoid collision with tokens from other
 * libraries. This pattern is inherited from `@bymax-one/nest-auth`.
 */
export const BYMAX_STORAGE_OPTIONS = Symbol('BYMAX_STORAGE_OPTIONS')
export const BYMAX_STORAGE_S3_CLIENT = Symbol('BYMAX_STORAGE_S3_CLIENT')
export const BYMAX_STORAGE_UPLOAD_VALIDATORS = Symbol('BYMAX_STORAGE_UPLOAD_VALIDATORS')
export const BYMAX_STORAGE_FILE_SCANNER = Symbol('BYMAX_STORAGE_FILE_SCANNER')
export const BYMAX_STORAGE_LOGGER = Symbol('BYMAX_STORAGE_LOGGER')
export const BYMAX_STORAGE_IDEMPOTENCY_CACHE = Symbol('BYMAX_STORAGE_IDEMPOTENCY_CACHE')
```

**Skeleton — `src/server/constants/default-options.constants.ts`:**

```typescript
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  MAX_SIGNED_URL_TTL_SECONDS,
  DEFAULT_MULTIPART_THRESHOLD_BYTES,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_MULTIPART_QUEUE_SIZE,
} from '../../shared/constants/default-ttls.constants'

/**
 * Internal default values — applied by `applyDefaults()` when options are
 * partially provided by the consumer.
 */
export const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable' as const
export const DEFAULT_CONTENT_DISPOSITION = 'inline' as const
export const DEFAULT_MAX_ATTEMPTS = 3 as const
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000 as const
export const DEFAULT_FORCE_PATH_STYLE = false as const
export const DEFAULT_PUBLIC_READ = false as const
// AWS SDK v3 default; non-AWS provider recipes override to 'WHEN_REQUIRED' (spec §16.1).
export const DEFAULT_CHECKSUM_CALCULATION = 'WHEN_SUPPORTED' as const
export const DEFAULT_CHECKSUM_VALIDATION = 'WHEN_SUPPORTED' as const

export const DEFAULT_SIGNED_URLS = {
  defaultGetTtlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  defaultPutTtlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  maxTtlSeconds: MAX_SIGNED_URL_TTL_SECONDS,
} as const

export const DEFAULT_MULTIPART = {
  thresholdBytes: DEFAULT_MULTIPART_THRESHOLD_BYTES,
  partSizeBytes: DEFAULT_MULTIPART_PART_SIZE_BYTES,
  queueSize: DEFAULT_MULTIPART_QUEUE_SIZE,
} as const

export const DEFAULT_SCANNER_MODE = 'pre-upload' as const
export const DEFAULT_SCANNER_REJECT_ON_UNKNOWN = false as const

/**
 * In-memory idempotency cache defaults.
 * Trade-off: per-instance cache; multi-replica deployments may double-upload
 * if requests hit different pods within the TTL window. Cross-instance
 * deduplication is tracked as `IIdempotencyStore` for v0.2.
 */
export const DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES = 1000 as const
export const DEFAULT_IDEMPOTENCY_CACHE_TTL_MS = 24 * 60 * 60 * 1000 as const // 24h
```

**Skeleton — `src/server/constants/default-mime-whitelist.constants.ts`:**

```typescript
/**
 * Re-exports the curated MIME whitelists from `shared/` so that server-side
 * consumers can import them without crossing the subpath boundary.
 */
export {
  DEFAULT_IMAGE_MIME_WHITELIST,
  DEFAULT_VIDEO_MIME_WHITELIST,
  DEFAULT_DOC_MIME_WHITELIST,
} from '../../shared/constants/mime-types.constants'
```

**Acceptance criteria:**

- [ ] Unique Symbols (verifiable: `BYMAX_STORAGE_OPTIONS === BYMAX_STORAGE_OPTIONS` is `true`; `BYMAX_STORAGE_OPTIONS !== BYMAX_STORAGE_S3_CLIENT` is `true`)
- [ ] Defaults `as const` to preserve literal types
- [ ] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
node -e "import('./dist/server/index.mjs').then(m => console.log(typeof m.BYMAX_STORAGE_OPTIONS))"
# Expected: symbol
```

**Dependencies:** §2.2 (constants in shared).

### 2.5 Options validation and merge

**Objective:** Implement `validate-options.ts` (manual validation with clear messages) and `apply-defaults.ts` (merge defaults with consumer options).

**Files to create:**

```
src/server/config/
├── apply-defaults.ts
├── validate-options.ts
└── resolved-options.ts
```

**Skeleton — `src/server/config/validate-options.ts`:**

```typescript
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { StorageException } from '../errors/storage-exception'
import { HttpStatus } from '@nestjs/common'

/**
 * Validates options at module bootstrap. Throws `StorageException` with code
 * `STORAGE_INVALID_CONFIG` carrying actionable details.
 *
 * Best-effort validation — runtime issues from custom validators / scanners are
 * caught lazily and surfaced via `StorageException` on first call.
 *
 * Note on missing credentials: this function tolerates empty
 * `accessKeyId`/`secretAccessKey`. The decision (carried over from the original
 * SpacesService) is that the module registers without crashing, and individual
 * operations throw `STORAGE_NOT_CONFIGURED` lazily. This enables dev workflows
 * without storage credentials in the env.
 */
export function validateOptions(options: BymaxStorageModuleOptions): void {
  if (!options || typeof options !== 'object') {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'options object is required',
    })
  }
  if (!options.endpoint || typeof options.endpoint !== 'string') {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'options.endpoint must be a non-empty string',
    })
  }
  if (!options.region || typeof options.region !== 'string') {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'options.region must be a non-empty string',
    })
  }
  if (!options.bucket || typeof options.bucket !== 'string') {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'options.bucket must be a non-empty string',
    })
  }
  if (!options.credentials || typeof options.credentials !== 'object') {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'options.credentials is required',
    })
  }
  // Credentials may be empty strings (handled lazily — see comment above).

  if (options.signedUrls?.maxTtlSeconds !== undefined && options.signedUrls.maxTtlSeconds <= 0) {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'signedUrls.maxTtlSeconds must be > 0',
    })
  }
  if (options.multipart?.partSizeBytes !== undefined && options.multipart.partSizeBytes < 5 * 1024 * 1024) {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'multipart.partSizeBytes must be >= 5 MB (S3 hard limit)',
    })
  }
  if (options.serverSideEncryption === 'aws:kms' && !options.kmsKeyId) {
    throw new StorageException('STORAGE_INVALID_CONFIG', HttpStatus.INTERNAL_SERVER_ERROR, {
      reason: 'kmsKeyId is required when serverSideEncryption === "aws:kms"',
    })
  }
}
```

**Skeleton — `src/server/config/resolved-options.ts`:**

```typescript
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

/**
 * Resolved options: every optional field is present and typed as required.
 * Used internally by services so they never have to deal with `undefined`.
 */
export interface ResolvedBymaxStorageOptions {
  endpoint: string
  region: string
  bucket: string
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  forcePathStyle: boolean
  publicBaseUrl: string
  cdnBaseUrl?: string
  defaultPublicRead: boolean
  keyPrefix: string
  defaultCacheControl: string
  defaultContentDisposition: 'inline' | 'attachment'
  signedUrls: {
    defaultGetTtlSeconds: number
    defaultPutTtlSeconds: number
    maxTtlSeconds: number
  }
  multipart: {
    thresholdBytes: number
    partSizeBytes: number
    queueSize: number
  }
  validation?: BymaxStorageModuleOptions['validation']
  scanner?: BymaxStorageModuleOptions['scanner']
  serverSideEncryption?: 'AES256' | 'aws:kms'
  kmsKeyId?: string
  requestChecksumCalculation: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  responseChecksumValidation: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  maxAttempts: number
  requestTimeoutMs: number
  /** True when both accessKeyId and secretAccessKey are non-empty. */
  hasCredentials: boolean
}
```

**Skeleton — `src/server/config/apply-defaults.ts`:**

```typescript
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { ResolvedBymaxStorageOptions } from './resolved-options'
import {
  DEFAULT_CACHE_CONTROL,
  DEFAULT_CHECKSUM_CALCULATION,
  DEFAULT_CHECKSUM_VALIDATION,
  DEFAULT_CONTENT_DISPOSITION,
  DEFAULT_FORCE_PATH_STYLE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MULTIPART,
  DEFAULT_PUBLIC_READ,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SIGNED_URLS,
} from '../constants/default-options.constants'

/**
 * Merges consumer options with library defaults. Returns a fully-resolved
 * options object — services consume this, never the raw `BymaxStorageModuleOptions`.
 */
export function applyDefaults(options: BymaxStorageModuleOptions): ResolvedBymaxStorageOptions {
  const hasCredentials =
    Boolean(options.credentials?.accessKeyId) && Boolean(options.credentials?.secretAccessKey)

  const publicBaseUrl =
    options.publicBaseUrl ?? `${options.endpoint.replace(/\/+$/, '')}/${options.bucket}`

  const resolved: ResolvedBymaxStorageOptions = {
    endpoint: options.endpoint,
    region: options.region,
    bucket: options.bucket,
    credentials: { ...options.credentials },
    forcePathStyle: options.forcePathStyle ?? DEFAULT_FORCE_PATH_STYLE,
    publicBaseUrl,
    cdnBaseUrl: options.cdnBaseUrl,
    defaultPublicRead: options.defaultPublicRead ?? DEFAULT_PUBLIC_READ,
    keyPrefix: options.keyPrefix ?? '',
    defaultCacheControl: options.defaultCacheControl ?? DEFAULT_CACHE_CONTROL,
    defaultContentDisposition: options.defaultContentDisposition ?? DEFAULT_CONTENT_DISPOSITION,
    signedUrls: { ...DEFAULT_SIGNED_URLS, ...(options.signedUrls ?? {}) },
    multipart: { ...DEFAULT_MULTIPART, ...(options.multipart ?? {}) },
    validation: options.validation,
    scanner: options.scanner,
    serverSideEncryption: options.serverSideEncryption,
    kmsKeyId: options.kmsKeyId,
    requestChecksumCalculation: options.requestChecksumCalculation ?? DEFAULT_CHECKSUM_CALCULATION,
    responseChecksumValidation: options.responseChecksumValidation ?? DEFAULT_CHECKSUM_VALIDATION,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    hasCredentials,
  }
  return resolved
}
```

**Acceptance criteria:**

- [ ] `validateOptions` throws `StorageException` (not a generic Error) with `code: STORAGE_INVALID_CONFIG`
- [ ] `validateOptions` tolerates empty credentials (does not throw) — only runtime operations fail with `STORAGE_NOT_CONFIGURED`
- [ ] `applyDefaults` returns objeto with `hasCredentials: false` when credenciais ausentes/vazias
- [ ] `applyDefaults` derives `publicBaseUrl` when not provided
- [ ] Coverage 100% in these 3 files
- [ ] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm test src/server/config/
pnpm typecheck
```

**Dependencies:** §2.3 (interfaces), §2.4 (constants), §2.6 (`StorageException`).

**Risks/Notes:**

- `applyDefaults` is a shallow merge for `signedUrls` and `multipart`; nested objects from the consumer **completely override** the defaults via `{ ...DEFAULT, ...consumer }`. Document this in the JSDoc.
- Do not use `zod` — adds an unnecessary dep for simple validation

### 2.6 Error catalog and `StorageException`

**Objective:** Define human-readable messages for each error code and the `StorageException` class (extends `HttpException` do NestJS).

**Files to create:**

```
src/server/errors/
├── storage-error-messages.ts
├── storage-error-status.ts
├── storage-exception.ts
└── aws-error-mapper.ts
```

**Skeleton — `src/server/errors/storage-error-messages.ts`:**

```typescript
import { STORAGE_ERROR_CODES, type StorageErrorCode } from '../../shared/constants/error-codes.constants'

/**
 * Human-readable English messages for each error code.
 * Consumers can override these via `messages: { ... }` (planned i18n in v0.2).
 */
export const STORAGE_ERROR_MESSAGES: Record<StorageErrorCode, string> = {
  [STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED]: 'Storage credentials are not configured',
  [STORAGE_ERROR_CODES.STORAGE_KEY_INVALID]: 'Invalid storage key',
  [STORAGE_ERROR_CODES.STORAGE_BODY_MISSING]: 'Upload body is missing',
  [STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED]: 'Content-Type is required',
  [STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED]: 'MIME type is not allowed',
  [STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED]: 'File size exceeds the allowed maximum',
  [STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED]: 'Custom validation failed',
  [STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED]: 'File scan reported the content as infected',
  [STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE]: 'File scan was inconclusive and rejection-on-unknown is enabled',
  [STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND]: 'Object not found',
  [STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR]: 'Storage provider returned an error',
  [STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID]: 'Signed URL TTL is invalid',
  [STORAGE_ERROR_CODES.STORAGE_PART_TOO_SMALL]: 'Multipart part size is below the 5 MB minimum',
  [STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED]: 'Bucket is undefined (no default configured and none provided per call)',
  [STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED]: 'Multipart upload was aborted',
  [STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG]: 'Module configuration is invalid',
  [STORAGE_ERROR_CODES.STORAGE_TIMEOUT]: 'Storage request timed out',
}
```

**Skeleton — `src/server/errors/storage-error-status.ts`:**

```typescript
import { HttpStatus } from '@nestjs/common'
import { STORAGE_ERROR_CODES, type StorageErrorCode } from '../../shared/constants/error-codes.constants'

/**
 * HTTP status per error code — the §12.2 catalog column. `Record<StorageErrorCode, HttpStatus>`
 * forces exhaustiveness at compile time. Internal: `StorageException` derives its default status
 * from this map; consumers never read it directly.
 */
export const STORAGE_ERROR_STATUS: Record<StorageErrorCode, HttpStatus> = {
  [STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED]: HttpStatus.SERVICE_UNAVAILABLE,      // 503
  [STORAGE_ERROR_CODES.STORAGE_KEY_INVALID]: HttpStatus.BAD_REQUEST,                 // 400
  [STORAGE_ERROR_CODES.STORAGE_BODY_MISSING]: HttpStatus.BAD_REQUEST,                // 400
  [STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED]: HttpStatus.BAD_REQUEST,       // 400
  [STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED]: HttpStatus.UNSUPPORTED_MEDIA_TYPE, // 415
  [STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED]: HttpStatus.PAYLOAD_TOO_LARGE,         // 413
  [STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,           // 400
  [STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED]: HttpStatus.UNPROCESSABLE_ENTITY,      // 422
  [STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE]: HttpStatus.UNPROCESSABLE_ENTITY,  // 422
  [STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND]: HttpStatus.NOT_FOUND,              // 404
  [STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR]: HttpStatus.BAD_GATEWAY,              // 502
  [STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID]: HttpStatus.BAD_REQUEST,      // 400
  [STORAGE_ERROR_CODES.STORAGE_PART_TOO_SMALL]: HttpStatus.BAD_REQUEST,              // 400
  [STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED]: HttpStatus.BAD_REQUEST,            // 400
  [STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED]: HttpStatus.INTERNAL_SERVER_ERROR, // 500
  [STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG]: HttpStatus.INTERNAL_SERVER_ERROR,    // 500
  [STORAGE_ERROR_CODES.STORAGE_TIMEOUT]: HttpStatus.GATEWAY_TIMEOUT,                 // 504
}
```

**Skeleton — `src/server/errors/storage-exception.ts`:**

```typescript
import { HttpException, HttpStatus } from '@nestjs/common'
import type { StorageErrorCode } from '../../shared/constants/error-codes.constants'
import { STORAGE_ERROR_MESSAGES } from './storage-error-messages'
import { STORAGE_ERROR_STATUS } from './storage-error-status'

/**
 * Standard exception thrown by the library.
 * Extends NestJS `HttpException` so it integrates seamlessly with global
 * exception filters in host applications.
 *
 * @example
 *   throw new StorageException('STORAGE_OBJECT_NOT_FOUND', undefined, { key }) // 404 from the status map
 */
export class StorageException extends HttpException {
  readonly code: StorageErrorCode

  constructor(
    code: StorageErrorCode,
    /** Defaults to STORAGE_ERROR_STATUS[code] (the §12.2 column). Pass only to override. */
    statusCode: HttpStatus = STORAGE_ERROR_STATUS[code],
    details?: Record<string, unknown>,
  ) {
    super(
      {
        error: {
          code,
          message: STORAGE_ERROR_MESSAGES[code],
          ...(details ? { details } : {}),
        },
      },
      statusCode,
    )
    this.code = code
  }
}
```

**Skeleton — `src/server/errors/aws-error-mapper.ts`:**

```typescript
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * Maps AWS SDK errors to `StorageException`. Preserves request id and AWS error
 * code in `details` for observability.
 *
 * Heuristics:
 *   - `name === 'NotFound'` or HTTP 404  → STORAGE_OBJECT_NOT_FOUND (404)
 *   - `name === 'TimeoutError'`           → STORAGE_TIMEOUT (504)
 *   - HTTP 403 (AccessDenied)             → STORAGE_PROVIDER_ERROR (502)
 *   - HTTP 503 (SlowDown)                 → STORAGE_PROVIDER_ERROR (502, retryable)
 *   - Any other HTTP 5xx                  → STORAGE_PROVIDER_ERROR (502)
 *   - Anything else                       → STORAGE_PROVIDER_ERROR (502)
 */
export function mapAwsError(err: unknown, context?: Record<string, unknown>): StorageException {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number; requestId?: string }; message?: string; Code?: string }
  const httpStatus = e?.$metadata?.httpStatusCode
  const awsCode = e?.Code ?? e?.name
  const requestId = e?.$metadata?.requestId
  const details: Record<string, unknown> = {
    ...(context ?? {}),
    awsCode,
    httpStatus,
    requestId,
    awsMessage: e?.message,
  }

  if (e?.name === 'NotFound' || httpStatus === 404) {
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND, HttpStatus.NOT_FOUND, details)
  }
  if (e?.name === 'TimeoutError') {
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, HttpStatus.GATEWAY_TIMEOUT, details)
  }
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR, HttpStatus.BAD_GATEWAY, details)
}
```

**Acceptance criteria:**

- [ ] `STORAGE_ERROR_MESSAGES` covers **all** 17 codes in the catalog (verifiable via type-check: `Record<StorageErrorCode, string>` forces exhaustiveness)
- [ ] `STORAGE_ERROR_STATUS` covers **all** 17 codes with the §12.2 HTTP status (`Record<StorageErrorCode, HttpStatus>` forces exhaustiveness); `STORAGE_ERROR_MESSAGES`/`STORAGE_ERROR_STATUS` are internal (not exported from the barrel)
- [ ] `new StorageException('STORAGE_NOT_CONFIGURED')` (no explicit status) yields HTTP 503; `'STORAGE_OBJECT_NOT_FOUND'` yields 404 (status derived from `STORAGE_ERROR_STATUS[code]`)
- [ ] `StorageException` extends `HttpException` correctly (assertion: `new StorageException(...) instanceof HttpException` === true)
- [ ] `StorageException.code` exposed as a public property so filters can read without deserializing body
- [ ] `mapAwsError` returns `STORAGE_OBJECT_NOT_FOUND` for erro 404 and `NotFound`
- [ ] `mapAwsError` preserves `requestId` in `details`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/errors/
```

**Dependencies:** §2.2 (`STORAGE_ERROR_CODES` in shared).

**Risks/Notes:**

- The interface between AWS SDK v3 and Node `Error` carries `$metadata` on a non-enumerable property in some versions — check via `(err as ServiceException).$metadata` which is the SDK's public type
- Never include credentials or signed URLs in `details`

### 2.7 `KeyResolverService` — normalization + path traversal guard

**Objective:** Centralize all key manipulation. Applies global `keyPrefix`, normalizes separators, **blocks path traversal** (`..`, leading `/`).

**Files to create:**

```
src/server/services/key-resolver.service.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { HttpStatus } from '@nestjs/common'

@Injectable()
export class KeyResolverService {
  private readonly keyPrefix: string

  constructor(@Inject(BYMAX_STORAGE_OPTIONS) options: ResolvedBymaxStorageOptions) {
    // Normalize prefix: trim leading/trailing slashes, then add a single trailing slash if non-empty.
    this.keyPrefix = options.keyPrefix ? options.keyPrefix.replace(/^\/+|\/+$/g, '') + '/' : ''
  }

  /**
   * Normalizes a raw key into the end S3 object key.
   *   - Rejects empty keys
   *   - Rejects leading `/` (would create a weird key in S3)
   *   - Rejects any segment containing `..` (path traversal)
   *   - Collapses multiple slashes to one
   *   - Prepends the configured `keyPrefix`
   *
   * @throws StorageException with code `STORAGE_KEY_INVALID`
   */
  normalize(rawKey: string): string {
    if (typeof rawKey !== 'string' || rawKey.length === 0) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_KEY_INVALID, HttpStatus.BAD_REQUEST, {
        reason: 'Key must be a non-empty string',
      })
    }
    if (rawKey.startsWith('/')) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_KEY_INVALID, HttpStatus.BAD_REQUEST, {
        reason: 'Key must not start with "/"',
      })
    }
    // Path traversal guard — reject `..` as any path segment.
    const segments = rawKey.split('/')
    if (segments.some((segment) => segment === '..')) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_KEY_INVALID, HttpStatus.BAD_REQUEST, {
        reason: 'Key must not contain ".." path segments',
      })
    }
    // Collapse `//` → `/`. After collapsing the key MUST still be non-empty.
    const collapsed = rawKey.replace(/\/{2,}/g, '/')
    if (collapsed === '') {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_KEY_INVALID, HttpStatus.BAD_REQUEST, {
        reason: 'Key is empty after normalization',
      })
    }
    return `${this.keyPrefix}${collapsed}`
  }

  /**
   * Strips the global keyPrefix from a key — useful when returning keys to
   * the consumer so they don't have to know the prefix exists.
   */
  stripPrefix(fullKey: string): string {
    if (this.keyPrefix && fullKey.startsWith(this.keyPrefix)) {
      return fullKey.slice(this.keyPrefix.length)
    }
    return fullKey
  }

  /** Read-only accessor for the resolved prefix (used by SignedUrlService). */
  getPrefix(): string {
    return this.keyPrefix
  }
}
```

**Acceptance criteria:**

- [ ] `normalize('users/123/avatar.png')` returns a key prepended with the prefix (or the key itself if the prefix is empty)
- [ ] `normalize('../etc/passwd')` throws `STORAGE_KEY_INVALID`
- [ ] `normalize('a/../b')` throws `STORAGE_KEY_INVALID` (path traversal in the middle)
- [ ] `normalize('/leading-slash')` throws `STORAGE_KEY_INVALID`
- [ ] `normalize('')` throws `STORAGE_KEY_INVALID`
- [ ] `normalize('a//b//c')` returns `'a/b/c'` (colapsa slashes duplos)
- [ ] `keyPrefix: 'tenant-x/'` in options resulta in `normalize('a.txt')` → `'tenant-x/a.txt'`
- [ ] `keyPrefix: '/tenant-x/'` (with leading/trailing slash) is normalized to `'tenant-x/'`
- [ ] `stripPrefix('tenant-x/a.txt')` returns `'a.txt'` when prefix is `'tenant-x/'`
- [ ] Coverage 100%
- [ ] Mutation score ≥ 95% (security-critical)

**Validation commands:**

```bash
pnpm test src/server/services/key-resolver.service.spec.ts
```

**Dependencies:** §2.4 (`BYMAX_STORAGE_OPTIONS` token), §2.5 (`ResolvedBymaxStorageOptions`), §2.6 (`StorageException`).

**Risks/Notes:**

- Path traversal is the biggest security risk here — test exhaustively. Variants: `..`, `./..`, `a/../b`, URL-encoded `%2e%2e` (we do not decode — caller must have decoded already), null bytes (Node strings don't support inline null, but validate `\0`)
- Mutation testing on this class is critical — any mutation that relaxes the guard is high-impact

### 2.8 `S3ClientProvider` — lifecycle of `S3Client`

**Objective:** Injectable provider that creates, maintains, and destroys the singleton `S3Client`.

**Files to create:**

```
src/server/providers/s3-client.provider.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Logger } from '@nestjs/common'
import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'

/**
 * Owns the singleton `S3Client`. Lifecycle:
 *   - `onModuleInit()`  — instantiates the client (or skips if credentials are absent)
 *   - per call          — `getClient()` returns the same instance
 *   - `onApplicationShutdown()` — `client.destroy()` releases TCP connections
 *
 * Why we skip instantiation without credentials: the original `SpacesService`
 * behavior — the module registers without crashing and operations throw
 * `STORAGE_NOT_CONFIGURED` lazily. This lets dev workflows run without storage.
 */
@Injectable()
export class S3ClientProvider implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(S3ClientProvider.name)
  private client?: S3Client

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.hasCredentials) {
      this.logger.warn(
        `Storage credentials are missing — module is registered but operations will throw STORAGE_NOT_CONFIGURED.`,
      )
      return
    }

    const config: S3ClientConfig = {
      endpoint: this.options.endpoint,
      region: this.options.region,
      forcePathStyle: this.options.forcePathStyle,
      credentials: {
        accessKeyId: this.options.credentials.accessKeyId,
        secretAccessKey: this.options.credentials.secretAccessKey,
        ...(this.options.credentials.sessionToken
          ? { sessionToken: this.options.credentials.sessionToken }
          : {}),
      },
      maxAttempts: this.options.maxAttempts,
      // Data-integrity checksums: AWS SDK v3.729.0+ defaults to 'WHEN_SUPPORTED' (CRC32 headers),
      // which non-AWS S3-compatible providers reject. Provider recipes pass 'WHEN_REQUIRED'.
      requestChecksumCalculation: this.options.requestChecksumCalculation,
      responseChecksumValidation: this.options.responseChecksumValidation,
      // requestTimeoutMs is wired into a NodeHttpHandler in Phase 2 (§3.1), when StorageService
      // first issues requests; left off the client here to avoid passing an empty handler.
    }

    this.client = new S3Client(config)
    this.logger.log(`S3Client initialized: endpoint=${this.options.endpoint} region=${this.options.region}`)
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client) {
      this.client.destroy()
      this.client = undefined
    }
  }

  /**
   * Returns the singleton client. Throws if storage is not configured —
   * services should check `isConfigured()` first and throw a typed
   * `STORAGE_NOT_CONFIGURED` exception.
   */
  getClient(): S3Client {
    if (!this.client) {
      throw new Error('S3Client is not available — storage is not configured')
    }
    return this.client
  }

  isConfigured(): boolean {
    return Boolean(this.client)
  }
}
```

**Acceptance criteria:**

- [ ] `onModuleInit` creates `S3Client` when `hasCredentials: true`
- [ ] `onModuleInit` **does not** create `S3Client` when `hasCredentials: false` (logs warning)
- [ ] `getClient()` returns the same client across multiple calls
- [ ] `isConfigured()` reflects the state
- [ ] `onApplicationShutdown` calls `client.destroy()` and clears reference
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/providers/s3-client.provider.spec.ts
```

**Dependencies:** §2.4, §2.5.

**Risks/Notes:**

- `S3Client.destroy()` is synchronous in AWS SDK v3 — no need to await
- `requestHandler` for custom timeout is configured via `NodeHttpHandler` — technical detail postponed to Phase 2 §3.1 when StorageService needs to honor `requestTimeoutMs`

### 2.9 `BymaxStorageModule.forRoot()` synchronous

**Objective:** Implement the NestJS dynamic module — synchronous only in this phase. `forRootAsync()` comes in §5.5 of Phase 4.

**Files to create:**

```
src/server/bymax-storage.module.ts
```

**Skeleton:**

```typescript
import { DynamicModule, Global, Module, Provider } from '@nestjs/common'
import {
  BYMAX_STORAGE_OPTIONS,
  BYMAX_STORAGE_S3_CLIENT,
  BYMAX_STORAGE_UPLOAD_VALIDATORS,
  BYMAX_STORAGE_FILE_SCANNER,
} from './bymax-storage.constants'
import type { BymaxStorageModuleOptions } from './interfaces/storage-module-options.interface'
import { validateOptions } from './config/validate-options'
import { applyDefaults } from './config/apply-defaults'
import { S3ClientProvider } from './providers/s3-client.provider'
import { KeyResolverService } from './services/key-resolver.service'

@Global()
@Module({})
export class BymaxStorageModule {
  /**
   * Sync configuration.
   *
   * @example
   *   BymaxStorageModule.forRoot({
   *     endpoint: 'https://s3.us-east-1.amazonaws.com',
   *     region: 'us-east-1',
   *     bucket: 'my-bucket',
   *     credentials: { accessKeyId, secretAccessKey },
   *   })
   */
  static forRoot(options: BymaxStorageModuleOptions): DynamicModule {
    validateOptions(options)
    const resolved = applyDefaults(options)

    const providers: Provider[] = [
      { provide: BYMAX_STORAGE_OPTIONS, useValue: resolved },
      {
        provide: BYMAX_STORAGE_UPLOAD_VALIDATORS,
        useValue: resolved.validation?.customValidators ?? [],
      },
      {
        provide: BYMAX_STORAGE_FILE_SCANNER,
        useValue: resolved.scanner?.impl ?? null,
      },
      S3ClientProvider,
      KeyResolverService,
      {
        // Public raw-client token (spec §11.2). Null-tolerant so the module still
        // registers without credentials (returns null until configured).
        provide: BYMAX_STORAGE_S3_CLIENT,
        useFactory: (p: S3ClientProvider) => (p.isConfigured() ? p.getClient() : null),
        inject: [S3ClientProvider],
      },
    ]

    return {
      module: BymaxStorageModule,
      providers,
      // Public DI surface (spec §3.3): the options + the raw-client token. S3ClientProvider
      // and KeyResolverService stay internal — not exported, not in the package barrel.
      exports: [
        BYMAX_STORAGE_OPTIONS,
        BYMAX_STORAGE_S3_CLIENT,
      ],
    }
  }
}
```

**Acceptance criteria:**

- [ ] `BymaxStorageModule.forRoot(options)` returns `DynamicModule`
- [ ] Provides `S3ClientProvider` and `KeyResolverService` injectables
- [ ] Provides tokens `BYMAX_STORAGE_OPTIONS`, `BYMAX_STORAGE_UPLOAD_VALIDATORS`, `BYMAX_STORAGE_FILE_SCANNER`
- [ ] `@Global()` — available in any feature module without reimport
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/bymax-storage.module.spec.ts
```

**Dependencies:** §2.3 a §2.8.

**Risks/Notes:**

- `@Global()` is a class-level decorator but the module only registers the entry when `forRoot()` is called — standard NestJS behavior
- In Phase 4 (§5.5), `forRootAsync()` needs to replicate the same provider list via factories — keep a single provider reference to avoid drift

### 2.10 Phase 1 tests + Barrel export

**Objective:** Achieve 100% line/branch coverage on every file implemented in this phase (with extra mutation focus on the critical paths). Expose the public API via `src/server/index.ts`.

**Files to create (tests):**

```
src/server/services/key-resolver.service.spec.ts
src/server/config/validate-options.spec.ts
src/server/config/apply-defaults.spec.ts
src/server/errors/storage-exception.spec.ts
src/server/errors/aws-error-mapper.spec.ts
src/server/providers/s3-client.provider.spec.ts
src/server/bymax-storage.module.spec.ts
```

**File to update:** `src/server/index.ts`

```typescript
// Module
export { BymaxStorageModule } from './bymax-storage.module'

// DI Tokens
export {
  BYMAX_STORAGE_OPTIONS,
  BYMAX_STORAGE_S3_CLIENT,
  BYMAX_STORAGE_UPLOAD_VALIDATORS,
  BYMAX_STORAGE_FILE_SCANNER,
  BYMAX_STORAGE_LOGGER,
  BYMAX_STORAGE_IDEMPOTENCY_CACHE,
} from './bymax-storage.constants'

// Interfaces
export type {
  BymaxStorageModuleOptions,
  BymaxStorageModuleAsyncOptions,
  BymaxStorageModuleOptionsFactory,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  ListResult,
  SignedGetUrlOptions,
  SignedPutUrlOptions,
  MultipartUploadUrlsOptions,
  MultipartUploadUrlsResult,
  IUploadValidator,
  IFileScanner,
  FileScanResult,
  ProviderRecipe,
} from './interfaces'

// Errors
export { StorageException } from './errors/storage-exception'

// Raw S3Client access for advanced ops (spec §11.2) is via the BYMAX_STORAGE_S3_CLIENT
// token (exported with the DI tokens above). S3ClientProvider and KeyResolverService are
// internal implementation details (spec §3.3) and are NOT part of the public surface.

// Re-export from shared for convenience
export type { UploadResult, ObjectMetadata, ListedObject, SignedUrlResult } from '../shared'
export { STORAGE_ERROR_CODES } from '../shared'
export type { StorageErrorCode } from '../shared'
```

**AAA pattern + descriptive name:** each `it()` follows:
```typescript
it('should <do something> when <condition>', () => {
  // Arrange — setup
  // Act     — execute
  // Assert  — verify
})
```

**Critical cases:**

#### `key-resolver.service.spec.ts`

```typescript
describe('KeyResolverService', () => {
  function makeService(keyPrefix = ''): KeyResolverService {
    const options = applyDefaults({
      endpoint: 'http://localhost', region: 'us-east-1', bucket: 'b',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      keyPrefix,
    })
    return new KeyResolverService(options)
  }

  describe('normalize', () => {
    it('should return the key as-is when in the prefix is configured', () => {
      expect(makeService().normalize('a/b.txt')).toBe('a/b.txt')
    })

    it('should prepend the configured prefix', () => {
      expect(makeService('tenant-x').normalize('a.txt')).toBe('tenant-x/a.txt')
    })

    it('should strip leading/trailing slashes from the prefix', () => {
      expect(makeService('/tenant-x/').normalize('a.txt')).toBe('tenant-x/a.txt')
    })

    it.each([
      ['../etc/passwd'],
      ['a/../b'],
      ['../..'],
      ['./..'],
    ])('should reject path traversal: %s', (input) => {
      expect(() => makeService().normalize(input)).toThrow(StorageException)
    })

    it('should reject empty string', () => {
      expect(() => makeService().normalize('')).toThrow(StorageException)
    })

    it('should reject leading slash', () => {
      expect(() => makeService().normalize('/foo')).toThrow(StorageException)
    })

    it('should collapse multiple slashes', () => {
      expect(makeService().normalize('a//b///c')).toBe('a/b/c')
    })
  })

  describe('stripPrefix', () => {
    it('should remove the prefix when present', () => {
      expect(makeService('tenant-x').stripPrefix('tenant-x/a.txt')).toBe('a.txt')
    })

    it('should return the key unchanged when in the prefix', () => {
      expect(makeService().stripPrefix('a.txt')).toBe('a.txt')
    })
  })
})
```

#### `validate-options.spec.ts`

```typescript
describe('validateOptions', () => {
  const valid: BymaxStorageModuleOptions = {
    endpoint: 'http://localhost', region: 'us-east-1', bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  }

  it('should accept valid minimal options', () => {
    expect(() => validateOptions(valid)).not.toThrow()
  })

  it('should tolerate empty credentials (lazy STORAGE_NOT_CONFIGURED)', () => {
    expect(() => validateOptions({
      ...valid,
      credentials: { accessKeyId: '', secretAccessKey: '' },
    })).not.toThrow()
  })

  it.each([
    ['endpoint undefined', { ...valid, endpoint: undefined as never }],
    ['endpoint empty', { ...valid, endpoint: '' }],
    ['region empty', { ...valid, region: '' }],
    ['bucket empty', { ...valid, bucket: '' }],
  ])('should throw STORAGE_INVALID_CONFIG when %s', (_label, opts) => {
    expect(() => validateOptions(opts)).toThrow(StorageException)
  })

  it('should throw when partSizeBytes is below 5 MB', () => {
    expect(() => validateOptions({
      ...valid,
      multipart: { partSizeBytes: 1024 },
    })).toThrow(/5 MB/)
  })

  it('should throw when aws:kms is set without kmsKeyId', () => {
    expect(() => validateOptions({
      ...valid,
      serverSideEncryption: 'aws:kms',
    })).toThrow(/kmsKeyId/)
  })
})
```

#### `apply-defaults.spec.ts`

```typescript
describe('applyDefaults', () => {
  const base: BymaxStorageModuleOptions = {
    endpoint: 'http://localhost', region: 'us-east-1', bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  }

  it('should derive publicBaseUrl from endpoint + bucket when not provided', () => {
    const r = applyDefaults(base)
    expect(r.publicBaseUrl).toBe('http://localhost/b')
  })

  it('should mark hasCredentials true when both keys present', () => {
    expect(applyDefaults(base).hasCredentials).toBe(true)
  })

  it('should mark hasCredentials false when either key empty', () => {
    expect(applyDefaults({ ...base, credentials: { accessKeyId: '', secretAccessKey: 's' } }).hasCredentials).toBe(false)
    expect(applyDefaults({ ...base, credentials: { accessKeyId: 'k', secretAccessKey: '' } }).hasCredentials).toBe(false)
  })

  it('should default keyPrefix to empty string', () => {
    expect(applyDefaults(base).keyPrefix).toBe('')
  })

  it('should merge signedUrls partials with defaults', () => {
    const r = applyDefaults({ ...base, signedUrls: { defaultGetTtlSeconds: 60 } })
    expect(r.signedUrls.defaultGetTtlSeconds).toBe(60)
    expect(r.signedUrls.maxTtlSeconds).toBe(604_800)
  })
})
```

#### `storage-exception.spec.ts`

```typescript
describe('StorageException', () => {
  it('should extend HttpException', () => {
    expect(new StorageException('STORAGE_KEY_INVALID') instanceof HttpException).toBe(true)
  })

  it('should expose code property', () => {
    expect(new StorageException('STORAGE_KEY_INVALID').code).toBe('STORAGE_KEY_INVALID')
  })

  it('should serialize details into the response body', () => {
    const e = new StorageException('STORAGE_KEY_INVALID', HttpStatus.BAD_REQUEST, { reason: 'X' })
    const body = e.getResponse() as { error: { code: string; details: { reason: string } } }
    expect(body.error.code).toBe('STORAGE_KEY_INVALID')
    expect(body.error.details.reason).toBe('X')
  })

  it('should omit details key when undefined', () => {
    const body = new StorageException('STORAGE_KEY_INVALID').getResponse() as { error: { details?: unknown } }
    expect(body.error.details).toBeUndefined()
  })
})
```

#### `s3-client.provider.spec.ts`

```typescript
describe('S3ClientProvider', () => {
  it('should create S3Client when credentials are present', () => {
    const provider = new S3ClientProvider(applyDefaults({
      endpoint: 'http://localhost', region: 'us-east-1', bucket: 'b',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    }))
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(true)
    expect(provider.getClient()).toBeInstanceOf(S3Client)
  })

  it('should skip creation and warn when credentials are missing', () => {
    const provider = new S3ClientProvider(applyDefaults({
      endpoint: 'http://localhost', region: 'us-east-1', bucket: 'b',
      credentials: { accessKeyId: '', secretAccessKey: '' },
    }))
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(false)
    expect(() => provider.getClient()).toThrow()
  })

  it('should call destroy on shutdown', async () => {
    const provider = new S3ClientProvider(applyDefaults({
      endpoint: 'http://localhost', region: 'us-east-1', bucket: 'b',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    }))
    provider.onModuleInit()
    const destroySpy = jest.spyOn(provider.getClient(), 'destroy')
    await provider.onApplicationShutdown()
    expect(destroySpy).toHaveBeenCalled()
    expect(provider.isConfigured()).toBe(false)
  })
})
```

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files created
- [ ] `pnpm test:cov` reports 100% line/branch coverage on every file implemented in the phase
- [ ] Coverage per file:
  - `key-resolver.service.ts`: ≥ 100% (security-critical)
  - `validate-options.ts`: ≥ 100%
  - `apply-defaults.ts`: 100%
  - `storage-exception.ts`: ≥ 100%
  - `aws-error-mapper.ts`: 100%
  - `s3-client.provider.ts`: 100%
- [ ] `src/server/index.ts` exports all public Phase 1 symbols
- [ ] No internal-only (`_internal*`) symbol or implementation detail is leaked

**Validation commands:**

```bash
pnpm test:cov
pnpm build
node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).sort()))"
```

**Dependencies:** §2.3 a §2.9.

### 2.11 Phase 1 validation

**Final commands to validate the phase:**

```bash
# 1. Type safety
pnpm typecheck

# 2. Lint
pnpm lint

# 3. Tests + coverage
pnpm test:cov

# 4. Build
pnpm build

# 5. Bundle size (informational in this phase — budget enforced in §6.5)
pnpm size

# 6. Smoke test — import and bootstrap the NestJS module
cat <<'EOF' > /tmp/smoke-test.mjs
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
// Import ONLY the public surface (spec §3.3): the module + the raw-client token.
// KeyResolverService / S3ClientProvider are internal and are not exported.
import { BymaxStorageModule, BYMAX_STORAGE_S3_CLIENT } from './dist/server/index.mjs'

@Module({
  imports: [
    BymaxStorageModule.forRoot({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'test',
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
    }),
  ],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
// Public smoke: the module bootstraps and the raw-client token resolves to a live S3Client.
const s3 = app.get(BYMAX_STORAGE_S3_CLIENT)
console.log('S3Client wired via BYMAX_STORAGE_S3_CLIENT token:', s3 !== null)
await app.close()
EOF
node /tmp/smoke-test.mjs
```

**Expected:**

```
S3Client wired via BYMAX_STORAGE_S3_CLIENT token: true
```

**Done criteria to close Phase 1:**

- [ ] All commands above pass
- [ ] Coverage thresholds met
- [ ] `git status` clean after commits with Conventional Commits (`feat(storage): scaffold project structure`, `feat(storage): add shared types and constants`, `feat(storage): implement KeyResolverService`, etc.)
- [ ] `/bymax-quality:code-review` run and findings applied
- [ ] Pull request opened with label `phase-1`

---

## 3. Phase 2 — Upload (single, multipart, stream) + Download

> **Phase objective:** Implement `StorageService` with the complete upload (single-shot and multipart, with streams), download (stream + buffer), `head`, `exists`, idempotent `delete`, `getPublicUrl`, idempotency cache LRU, progress events. At the end, it is possible to send and receive real files against a local MinIO (via a manual smoke test — formal e2e comes in Phase 4).
>
> **Complexity:** HIGH — multipart with `@aws-sdk/lib-storage` requires care in error handling (abort on failure, avoid orphan parts), streams must be consumed under `requestTimeoutMs`, idempotency cache needs correct LRU eviction.
>
> **Critical paths for 95% coverage:** `src/server/services/storage.service.ts`, `src/server/utils/upload-strategy.ts`, `src/server/utils/idempotency-cache.ts`, `src/server/utils/stream-utils.ts`.

### 3.1 `IdempotencyCache` — LRU in-memory store

**Objective:** LRU cache with TTL to deduplicate uploads based on `idempotencyKey`. In-memory per instance (documented trade-off).

**Files to create:**

```
src/server/utils/idempotency-cache.ts
```

**Skeleton:**

```typescript
import { createHash } from 'node:crypto'
import type { UploadResult } from '../../shared/types/storage-types'

interface CacheEntry {
  value: UploadResult
  /** Epoch ms when the entry expires. */
  expiresAt: number
}

/**
 * In-memory LRU cache for idempotent upload deduplication.
 *
 * Implementation: `Map` preserves insertion order in JS. We approximate LRU by
 * deleting+reinserting on hit (moves to "newest" position). Eviction removes
 * the oldest insertion (first key in the iterator).
 *
 * Trade-off (acknowledged in spec §6.4): per-instance cache; multi-replica
 * deployments may double-upload if requests hit different pods within the TTL.
 * Cross-instance dedup is tracked as `IIdempotencyStore` for v0.2.
 */
export class IdempotencyCache {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Computes a deterministic cache key from caller-provided idempotencyKey + finalKey.
   * Using sha256 to avoid leaking the raw idempotencyKey into a Map key (which could
   * be inspected during debugging).
   */
  computeKey(idempotencyKey: string, finalKey: string): string {
    return createHash('sha256').update(`${idempotencyKey}:${finalKey}`).digest('hex')
  }

  get(cacheKey: string): UploadResult | undefined {
    const entry = this.entries.get(cacheKey)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(cacheKey)
      return undefined
    }
    // LRU touch — move to newest.
    this.entries.delete(cacheKey)
    this.entries.set(cacheKey, entry)
    return entry.value
  }

  set(cacheKey: string, value: UploadResult): void {
    if (this.entries.has(cacheKey)) {
      this.entries.delete(cacheKey)
    }
    this.entries.set(cacheKey, { value, expiresAt: this.now() + this.ttlMs })

    // Eviction — drop oldest while over capacity.
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) break
      this.entries.delete(oldestKey)
    }
  }

  /** Test helper — current size. */
  size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }
}
```

**Acceptance criteria:**

- [ ] `set` then `get` returns the value for the same cacheKey
- [ ] `get` returns `undefined` when TTL expirou (testado with `now` injetado)
- [ ] Eviction acontece when `size > maxEntries` (oldest key removed)
- [ ] Hit on `get` moves entry to "newest" (LRU touch) — tested by verifying that after accessing A, then B, then C, then A, when exceeding cap the removed entry is B (not A)
- [ ] `computeKey` is deterministic (same input → same output)
- [ ] Coverage 100%
- [ ] Mutation score ≥ 95% (eviction logic is subtle)

**Validation commands:**

```bash
pnpm test src/server/utils/idempotency-cache.spec.ts
```

**Dependencies:** §2.2 (`UploadResult` in shared).

**Risks/Notes:**

- `Map.keys().next().value` returns the first insertion-ordered key — rely on this ES2015+ guarantee
- Do not use `lru-cache` or similar to keep `dependencies: {}`. This impl is ~50 LoC, simple enough

### 3.2 `stream-utils.ts` — helpers for Buffer/stream/Uint8Array

**Objective:** Utility functions to handle polymorphic body (`Buffer | Readable | Uint8Array`) — detect type, read first N bytes (for validators), convert to stream.

**Files to create:**

```
src/server/utils/stream-utils.ts
```

**Skeleton:**

```typescript
import { PassThrough, Readable } from 'node:stream'

export type UploadBody = Buffer | NodeJS.ReadableStream | Uint8Array

/** True when the body is a Node Readable stream. */
export function isReadable(body: UploadBody): body is NodeJS.ReadableStream {
  return (
    body !== null &&
    typeof body === 'object' &&
    'pipe' in body &&
    typeof (body as { pipe?: unknown }).pipe === 'function'
  )
}

/** True when the body is a Buffer (Node) or Uint8Array. */
export function isBufferLike(body: UploadBody): body is Buffer | Uint8Array {
  return body instanceof Uint8Array
}

/** Best-effort body size — returns undefined for streams. */
export function getBodySize(body: UploadBody): number | undefined {
  if (isBufferLike(body)) return body.byteLength
  return undefined
}

/**
 * Reads the first `maxBytes` from a body without consuming it for the actual upload.
 *
 * For Buffer/Uint8Array: returns a sliced Buffer view (zero copy).
 * For Readable: tees the stream via `PassThrough`, returns a Promise that resolves
 * with up to `maxBytes` AND mutates the original `body` reference to the second
 * passthrough — the caller MUST use the returned `replacementBody` for the upload.
 *
 * @example
 *   const { head, replacementBody } = await peekFirstBytes(body, 4)
 *   // head: Buffer with up to 4 bytes
 *   // replacementBody: same logical stream — pass this to S3
 */
export async function peekFirstBytes(
  body: UploadBody,
  maxBytes: number,
): Promise<{ head: Buffer; replacementBody: UploadBody }> {
  if (isBufferLike(body)) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    return { head: buf.subarray(0, maxBytes), replacementBody: buf }
  }

  // For streams, tee into two PassThroughs — one for the peek, one for the upload.
  const source = body as NodeJS.ReadableStream
  const peekPT = new PassThrough()
  const uploadPT = new PassThrough()
  source.on('data', (chunk: Buffer | string) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    peekPT.write(buf)
    uploadPT.write(buf)
  })
  source.on('end', () => {
    peekPT.end()
    uploadPT.end()
  })
  source.on('error', (err) => {
    peekPT.destroy(err)
    uploadPT.destroy(err)
  })

  // Collect up to maxBytes from peekPT.
  const chunks: Buffer[] = []
  let collected = 0
  for await (const chunk of peekPT) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    const remaining = maxBytes - collected
    if (remaining <= 0) break
    chunks.push(buf.subarray(0, remaining))
    collected += Math.min(buf.byteLength, remaining)
    if (collected >= maxBytes) break
  }
  return { head: Buffer.concat(chunks), replacementBody: uploadPT }
}

/** Wraps a Buffer as a Readable — for the AWS SDK Upload class that accepts streams. */
export function bufferToReadable(buf: Buffer | Uint8Array): Readable {
  return Readable.from(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
}
```

**Acceptance criteria:**

- [ ] `isReadable(stream)` true; `isReadable(Buffer)` false; `isReadable(Uint8Array)` false
- [ ] `isBufferLike(Buffer)` true; `isBufferLike(Uint8Array)` true; `isBufferLike(stream)` false
- [ ] `getBodySize(Buffer.from('abc'))` returns `3`
- [ ] `getBodySize(stream)` returns `undefined`
- [ ] `peekFirstBytes(Buffer.from('hello'), 3)` returns `head: Buffer.from('hel')`
- [ ] `peekFirstBytes(stream, 4)` returns correct head AND `replacementBody` consumable for upload
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/utils/stream-utils.spec.ts
```

**Dependencies:** None (pure utility).

**Risks/Notes:**

- Stream tee is delicate — if the consumer drops `replacementBody` (does not consume it), `peekPT` also blocks on backpressure. Document in JSDoc
- For very large files, `peekFirstBytes` only loads `maxBytes` into memory; the rest keeps streaming

### 3.3 `upload-strategy.ts` — single-shot vs multipart decision

**Objective:** Pure function that decides the upload strategy based on body and options.

**Files to create:**

```
src/server/utils/upload-strategy.ts
```

**Skeleton:**

```typescript
import { getBodySize, isReadable, type UploadBody } from './stream-utils'

export type UploadStrategy = 'single-shot' | 'multipart'

/**
 * Picks the upload strategy:
 *   - 'multipart' when body is a Readable without known size (stream of unknown length)
 *   - 'multipart' when known size >= multipart.thresholdBytes
 *   - 'single-shot' otherwise
 */
export function pickUploadStrategy(
  body: UploadBody,
  declaredSize: number | undefined,
  thresholdBytes: number,
): UploadStrategy {
  const size = declaredSize ?? getBodySize(body)

  if (isReadable(body) && size === undefined) {
    return 'multipart'
  }
  if (size !== undefined && size >= thresholdBytes) {
    return 'multipart'
  }
  return 'single-shot'
}
```

**Acceptance criteria:**

- [ ] Buffer < threshold → `'single-shot'`
- [ ] Buffer >= threshold → `'multipart'`
- [ ] Stream with `declaredSize` < threshold → `'single-shot'`
- [ ] Stream with `declaredSize` >= threshold → `'multipart'`
- [ ] Stream without `declaredSize` → `'multipart'`
- [ ] Uint8Array < threshold → `'single-shot'`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/utils/upload-strategy.spec.ts
```

**Dependencies:** §3.2.

### 3.4 `header-utils.ts` — content-disposition + cache-control assembly

**Objective:** Pequenos helpers for montar headers consistentemente.

**Files to create:**

```
src/server/utils/header-utils.ts
```

**Skeleton:**

```typescript
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'

/**
 * Returns the Content-Disposition header string to send to S3.
 * If the input is the special token 'inline' or 'attachment', uses RFC 6266 form.
 * Otherwise treats the input as already-formed (e.g., 'attachment; filename="x.pdf"').
 */
export function buildContentDisposition(
  perCall: UploadOptions['contentDisposition'],
  defaultValue: 'inline' | 'attachment',
): string {
  const value = perCall ?? defaultValue
  return value
}

/** Resolves Cache-Control from per-call → module default. */
export function buildCacheControl(
  perCall: UploadOptions['cacheControl'],
  defaultValue: string,
): string {
  return perCall ?? defaultValue
}

/**
 * Resolves SSE settings from per-call → module default.
 * 'NONE' on perCall short-circuits — in the SSE applied even with a global default.
 */
export function buildSSE(
  perCall: UploadOptions['serverSideEncryption'],
  perCallKmsKeyId: UploadOptions['kmsKeyId'],
  module: Pick<ResolvedBymaxStorageOptions, 'serverSideEncryption' | 'kmsKeyId'>,
): { ServerSideEncryption?: 'AES256' | 'aws:kms'; SSEKMSKeyId?: string } {
  if (perCall === 'NONE') return {}
  const sse = perCall ?? module.serverSideEncryption
  if (!sse) return {}
  if (sse === 'aws:kms') {
    return { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: perCallKmsKeyId ?? module.kmsKeyId }
  }
  return { ServerSideEncryption: sse }
}

/** Decides the end ACL string for S3 PutObjectCommand. */
export function buildACL(
  perCall: UploadOptions['publicRead'],
  defaultValue: boolean,
): 'public-read' | undefined {
  const publicRead = perCall ?? defaultValue
  return publicRead ? 'public-read' : undefined
}
```

**Acceptance criteria:**

- [ ] `buildContentDisposition(undefined, 'inline')` → `'inline'`
- [ ] `buildContentDisposition('attachment; filename="x"', 'inline')` → `'attachment; filename="x"'`
- [ ] `buildCacheControl(undefined, 'public, max-age=300')` → `'public, max-age=300'`
- [ ] `buildSSE('NONE', undefined, { serverSideEncryption: 'AES256' })` → `{}`
- [ ] `buildSSE('aws:kms', 'key-id', { ... })` → `{ ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'key-id' }`
- [ ] `buildACL(true, false)` → `'public-read'`
- [ ] `buildACL(false, true)` → `undefined`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/utils/header-utils.spec.ts
```

**Dependencies:** §2.3, §2.5.

### 3.5 `StorageService` — base implementation (upload single, head, exists, delete, getPublicUrl)

**Objective:** Implement the main facade covering single-shot operations. Multipart and stream download in separate sub-steps.

**Files to create:**

```
src/server/services/storage.service.ts
```

**Skeleton (parte 1 — single-shot upload + simple ops):**

```typescript
import { Inject, Injectable, Logger, HttpStatus } from '@nestjs/common'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_IDEMPOTENCY_CACHE } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import type { DownloadOptions } from '../interfaces/download-options.interface'
import type { UploadResult, ObjectMetadata } from '../../shared/types/storage-types'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { StorageException } from '../errors/storage-exception'
import { mapAwsError } from '../errors/aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { buildACL, buildCacheControl, buildContentDisposition, buildSSE } from '../utils/header-utils'
import { getBodySize, isBufferLike } from '../utils/stream-utils'
import { pickUploadStrategy } from '../utils/upload-strategy'
import { IdempotencyCache } from '../utils/idempotency-cache'

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    private readonly s3Provider: S3ClientProvider,
    private readonly keyResolver: KeyResolverService,
    @Inject(BYMAX_STORAGE_IDEMPOTENCY_CACHE) private readonly idempotencyCache: IdempotencyCache,
  ) {}

  private assertConfigured(): void {
    if (!this.s3Provider.isConfigured()) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED, HttpStatus.SERVICE_UNAVAILABLE)
    }
  }

  private resolveBucket(perCall?: string): string {
    const bucket = perCall ?? this.options.bucket
    if (!bucket) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED, HttpStatus.BAD_REQUEST)
    }
    return bucket
  }

  /**
   * Single-entry upload. Picks strategy (single-shot vs multipart) automatically.
   * See spec §6.1 for the decision matrix.
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    this.assertConfigured()
    if (!options.body) throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BODY_MISSING)
    if (!options.contentType) throw new StorageException(STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED)

    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = this.resolveBucket(options.bucket)

    // Idempotency check.
    if (options.idempotencyKey) {
      const cacheKey = this.idempotencyCache.computeKey(options.idempotencyKey, finalKey)
      const cached = this.idempotencyCache.get(cacheKey)
      if (cached) return { ...cached, fromIdempotencyCache: true }
    }

    const strategy = pickUploadStrategy(options.body, options.size, this.options.multipart.thresholdBytes)
    const result = strategy === 'multipart'
      ? await this.uploadMultipart(options, finalKey, bucket)  // §3.6
      : await this.uploadSingleShot(options, finalKey, bucket)

    if (options.idempotencyKey) {
      const cacheKey = this.idempotencyCache.computeKey(options.idempotencyKey, finalKey)
      this.idempotencyCache.set(cacheKey, result)
    }
    return result
  }

  private async uploadSingleShot(options: UploadOptions, finalKey: string, bucket: string): Promise<UploadResult> {
    const body = isBufferLike(options.body)
      ? Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body as Uint8Array)
      : (options.body as NodeJS.ReadableStream)
    const sseHeaders = buildSSE(options.serverSideEncryption, options.kmsKeyId, this.options)
    const input: PutObjectCommandInput = {
      Bucket: bucket,
      Key: finalKey,
      Body: body as PutObjectCommandInput['Body'],
      ContentType: options.contentType,
      ContentLength: options.size ?? getBodySize(options.body),
      CacheControl: buildCacheControl(options.cacheControl, this.options.defaultCacheControl),
      ContentDisposition: buildContentDisposition(options.contentDisposition, this.options.defaultContentDisposition),
      ACL: buildACL(options.publicRead, this.options.defaultPublicRead),
      Metadata: options.metadata,
      ...sseHeaders,
    }
    try {
      const response = await this.s3Provider.getClient().send(new PutObjectCommand(input))
      if (options.onProgress) {
        const total = options.size ?? getBodySize(options.body)
        options.onProgress({ loaded: total ?? 0, total })
      }
      return {
        key: finalKey, bucket,
        etag: response.ETag ?? '',
        versionId: response.VersionId,
        size: options.size ?? getBodySize(options.body),
        contentType: options.contentType,
        publicUrl: this.buildPublicUrl(finalKey, bucket),
        multipart: false, fromIdempotencyCache: false,
      }
    } catch (err) {
      throw mapAwsError(err, { key: finalKey, bucket, op: 'upload-single' })
    }
  }

  /** HEAD — metadata without downloading. */
  async head(key: string, options?: { bucket?: string }): Promise<ObjectMetadata> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options?.bucket)
    try {
      const response = await this.s3Provider.getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }))
      return {
        key: finalKey, bucket,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        etag: response.ETag ?? '',
        lastModified: response.LastModified ?? new Date(0),
        cacheControl: response.CacheControl,
        contentDisposition: response.ContentDisposition,
        metadata: response.Metadata ?? {},
        storageClass: response.StorageClass,
        versionId: response.VersionId,
      }
    } catch (err) {
      throw mapAwsError(err, { key: finalKey, bucket, op: 'head' })
    }
  }

  /** Best-effort existence check — false on 404, warning on other errors. */
  async exists(key: string, options?: { bucket?: string }): Promise<boolean> {
    try {
      await this.head(key, options)
      return true
    } catch (err) {
      if (err instanceof StorageException && err.code === STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND) return false
      this.logger.warn(`exists() — non-404 error treated as "false": ${(err as Error).message}`)
      return false
    }
  }

  /** Idempotent delete — does NOT throw on 404, just logs a warning. */
  async delete(key: string, options?: { bucket?: string }): Promise<void> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options?.bucket)
    try {
      await this.s3Provider.getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey }))
    } catch (err) {
      const mapped = mapAwsError(err, { key: finalKey, bucket, op: 'delete' })
      if (mapped.code === STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND) {
        this.logger.warn(`delete() — key not found (idempotent no-op): ${finalKey}`)
        return
      }
      throw mapped
    }
  }

  /** Public URL — CDN if configured, otherwise `publicBaseUrl`. NOT validated. */
  getPublicUrl(key: string, options?: { bucket?: string }): string {
    const finalKey = this.keyResolver.normalize(key)
    const bucket = this.resolveBucket(options?.bucket)
    return this.buildPublicUrl(finalKey, bucket)
  }

  private buildPublicUrl(finalKey: string, bucket: string): string {
    const base = this.options.cdnBaseUrl ?? this.options.publicBaseUrl
    if (base.includes(bucket)) return `${base.replace(/\/+$/, '')}/${finalKey}`
    return `${base.replace(/\/+$/, '')}/${bucket}/${finalKey}`
  }

  // download(), downloadBuffer(), uploadMultipart() — §3.6, §3.7
}
```

**Acceptance criteria:**

- [ ] `upload()` throws `STORAGE_NOT_CONFIGURED` (HTTP 503) when S3Client was not initialized
- [ ] `upload()` throws `STORAGE_BODY_MISSING` for undefined body
- [ ] `upload()` throws `STORAGE_CONTENT_TYPE_REQUIRED` for empty contentType
- [ ] `upload()` applies `keyPrefix` global in the key end
- [ ] `upload()` propaga `metadata` for `x-amz-meta-*`
- [ ] `upload()` returns `UploadResult` with `multipart: false` for single-shot
- [ ] `upload()` returns `fromIdempotencyCache: true` when dedup hit
- [ ] `head()` returns a correctly populated `ObjectMetadata`
- [ ] `head()` throws `STORAGE_OBJECT_NOT_FOUND` for nonexistent key
- [ ] `exists()` returns `false` in 404
- [ ] `delete()` is idempotent (does not throw on 404)
- [ ] `getPublicUrl()` uses CDN when configured
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/storage.service.spec.ts
```

**Dependencies:** §2.7 (`KeyResolver`), §2.8 (`S3ClientProvider`), §3.1 (`IdempotencyCache`), §3.4 (header utils).

**Risks/Notes:**

- Mock `S3Client.send()` in tests — use `aws-sdk-client-mock` (devDep) or DIY with `jest.spyOn(client, 'send')`. To Phase 2 unit tests, DIY mock is sufficient. Real E2E goes in Phase 4
- When `body` is `Uint8Array` (not `Buffer`), AWS SDK accepts it directly — but some versions warn about `Body must be Buffer or Stream`. Validate with `Buffer.from(uint8)` for safety

### 3.6 Multipart upload via `@aws-sdk/lib-storage`

**Objective:** Implement `uploadMultipart()` using the `Upload` class from `@aws-sdk/lib-storage`, with progress events and abort on error.

**Files to modify:**

```
src/server/services/storage.service.ts  (add uploadMultipart method)
```

**Skeleton — added method:**

```typescript
import { Upload } from '@aws-sdk/lib-storage'

// inside StorageService:

private async uploadMultipart(options: UploadOptions, finalKey: string, bucket: string): Promise<UploadResult> {
  const sseHeaders = buildSSE(options.serverSideEncryption, options.kmsKeyId, this.options)
  const params: PutObjectCommandInput = {
    Bucket: bucket, Key: finalKey,
    Body: options.body as PutObjectCommandInput['Body'],
    ContentType: options.contentType,
    CacheControl: buildCacheControl(options.cacheControl, this.options.defaultCacheControl),
    ContentDisposition: buildContentDisposition(options.contentDisposition, this.options.defaultContentDisposition),
    ACL: buildACL(options.publicRead, this.options.defaultPublicRead),
    Metadata: options.metadata,
    ...sseHeaders,
  }

  const uploader = new Upload({
    client: this.s3Provider.getClient(),
    params,
    queueSize: this.options.multipart.queueSize,
    partSize: this.options.multipart.partSizeBytes,
    leavePartsOnError: false,  // abort + cleanup on error
  })

  if (options.onProgress) {
    uploader.on('httpUploadProgress', (event) => {
      options.onProgress?.({ loaded: event.loaded ?? 0, total: event.total, part: event.part })
    })
  }

  try {
    const response = await uploader.done()
    return {
      key: finalKey, bucket,
      etag: (response as { ETag?: string }).ETag ?? '',
      versionId: (response as { VersionId?: string }).VersionId,
      size: options.size,
      contentType: options.contentType,
      publicUrl: this.buildPublicUrl(finalKey, bucket),
      multipart: true, fromIdempotencyCache: false,
    }
  } catch (err) {
    // `lib-storage` already attempts AbortMultipartUpload when leavePartsOnError: false.
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED, HttpStatus.INTERNAL_SERVER_ERROR, {
      key: finalKey, bucket, awsMessage: (err as Error).message,
    })
  }
}
```

**Acceptance criteria:**

- [ ] Body > `thresholdBytes` triggers multipart (verifiable via `result.multipart === true`)
- [ ] Stream without `size` triggers multipart
- [ ] `onProgress` is called during upload (mockar `Upload.on('httpUploadProgress')`)
- [ ] Erro during multipart resulta in `STORAGE_MULTIPART_ABORTED`
- [ ] `leavePartsOnError: false` ensures orphan parts are cleaned up by the SDK
- [ ] Coverage 100% (multipart edge branches are hard to unit-test — use mocks; e2e in Phase 4 covers the real path)

**Validation commands:**

```bash
pnpm test src/server/services/storage.service.multipart.spec.ts
```

**Dependencies:** §3.5.

**Risks/Notes:**

- `@aws-sdk/lib-storage` is a separate peer dep — verify it is in `peerDependencies`
- The `Upload` class emits `httpUploadProgress` — the event handler signature varies across SDK versions. Check with `pnpm typecheck`

### 3.7 Download (stream + buffer)

**Objective:** Implement `download()` returning stream + metadata, and `downloadBuffer()` for small files.

**Files to modify:**

```
src/server/services/storage.service.ts  (add download and downloadBuffer)
```

**Skeleton — added methods:**

```typescript
import { type GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'

// inside StorageService:

async download(options: DownloadOptions): Promise<{ stream: NodeJS.ReadableStream; metadata: ObjectMetadata }> {
  this.assertConfigured()
  const finalKey = this.keyResolver.normalize(options.key)
  const bucket = this.resolveBucket(options.bucket)
  try {
    const response: GetObjectCommandOutput = await this.s3Provider.getClient().send(
      new GetObjectCommand({
        Bucket: bucket, Key: finalKey,
        Range: options.range,
        IfNoneMatch: options.ifNoneMatch,
        IfMatch: options.ifMatch,
      }),
    )
    if (!response.Body) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND, HttpStatus.NOT_FOUND, { key: finalKey, bucket })
    }
    const stream = response.Body as Readable
    const metadata: ObjectMetadata = {
      key: finalKey, bucket,
      size: response.ContentLength ?? 0,
      contentType: response.ContentType ?? 'application/octet-stream',
      etag: response.ETag ?? '',
      lastModified: response.LastModified ?? new Date(0),
      cacheControl: response.CacheControl,
      contentDisposition: response.ContentDisposition,
      metadata: response.Metadata ?? {},
      storageClass: response.StorageClass,
      versionId: response.VersionId,
    }
    return { stream, metadata }
  } catch (err) {
    throw mapAwsError(err, { key: finalKey, bucket, op: 'download' })
  }
}

/** Pulls entire content into memory. NOT recommended for files > 10 MB. */
async downloadBuffer(options: DownloadOptions): Promise<{ buffer: Buffer; metadata: ObjectMetadata }> {
  const { stream, metadata } = await this.download(options)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return { buffer: Buffer.concat(chunks), metadata }
}
```

**Acceptance criteria:**

- [ ] `download()` returns `{ stream, metadata }` for key existente
- [ ] `download()` propaga `Range`, `IfNoneMatch`, `IfMatch` headers
- [ ] `download()` throws `STORAGE_OBJECT_NOT_FOUND` for nonexistent key
- [ ] `downloadBuffer()` accumulates the stream into a Buffer correctly
- [ ] Stream from `download()` is consumable (`for await` or `.pipe()` works)
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/storage.service.download.spec.ts
```

**Dependencies:** §3.5.

### 3.8 Phase 2 module registration + tests

**Objective:** Register `StorageService` and `IdempotencyCache` in the module. Full test battery.

**Files to modify:**

```
src/server/bymax-storage.module.ts
src/server/index.ts
```

**Modification — `bymax-storage.module.ts`:** add providers `StorageService` and factory for `IdempotencyCache`, export `StorageService`.

**Test files:**

```
src/server/services/storage.service.spec.ts             # single-shot + head + exists + delete
src/server/services/storage.service.multipart.spec.ts   # multipart
src/server/services/storage.service.download.spec.ts    # download stream + buffer
src/server/utils/idempotency-cache.spec.ts
src/server/utils/stream-utils.spec.ts
src/server/utils/upload-strategy.spec.ts
src/server/utils/header-utils.spec.ts
```

**Representative critical cases for `storage.service.spec.ts`:**

```typescript
describe('StorageService — upload single-shot', () => {
  let service: StorageService
  let s3Mock: jest.Mocked<S3Client>
  // ... setup with Test.createTestingModule and overridden providers

  it('should throw STORAGE_NOT_CONFIGURED when S3Client is missing', async () => {
    // arrange S3ClientProvider.isConfigured returns false
    await expect(service.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' }))
      .rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
  })

  it('should reject empty key (path traversal guard via KeyResolver)', async () => {
    await expect(service.upload({ key: '', body: Buffer.from('x'), contentType: 'text/plain' }))
      .rejects.toMatchObject({ code: 'STORAGE_KEY_INVALID' })
  })

  it('should call PutObjectCommand with normalized key, contentType, metadata', async () => {
    const sendSpy = jest.spyOn(s3Mock, 'send').mockResolvedValue({ ETag: '"abc"' } as never)
    await service.upload({
      key: 'avatars/1.png', body: Buffer.from('x'), contentType: 'image/png',
      metadata: { originalName: 'me.png' },
    })
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        Key: 'avatars/1.png',
        ContentType: 'image/png',
        Metadata: { originalName: 'me.png' },
      }),
    }))
  })

  it('should dedupe via idempotencyKey within TTL', async () => {
    jest.spyOn(s3Mock, 'send').mockResolvedValue({ ETag: '"abc"' } as never)
    const first = await service.upload({
      key: 'a.txt', body: Buffer.from('x'), contentType: 'text/plain', idempotencyKey: 'req-123',
    })
    const second = await service.upload({
      key: 'a.txt', body: Buffer.from('x'), contentType: 'text/plain', idempotencyKey: 'req-123',
    })
    expect(first.fromIdempotencyCache).toBe(false)
    expect(second.fromIdempotencyCache).toBe(true)
  })

  it('should map 404 from HeadObject to STORAGE_OBJECT_NOT_FOUND', async () => {
    jest.spyOn(s3Mock, 'send').mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })
    await expect(service.head('missing')).rejects.toMatchObject({ code: 'STORAGE_OBJECT_NOT_FOUND' })
  })

  it('should return false from exists() on 404', async () => {
    jest.spyOn(s3Mock, 'send').mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })
    expect(await service.exists('missing')).toBe(false)
  })

  it('should not throw from delete() on 404 (idempotent)', async () => {
    jest.spyOn(s3Mock, 'send').mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })
    await expect(service.delete('missing')).resolves.toBeUndefined()
  })
})
```

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files created
- [ ] `pnpm test:cov` reports 100% line/branch coverage on every file implemented in the phase
- [ ] `pnpm test` zero falhas
- [ ] Smoke test against local MinIO (manual — instructions in §3.9) works

**Validation commands:**

```bash
pnpm test:cov
```

**Dependencies:** §3.1 a §3.7.

### 3.9 Phase 2 validation

**Commands finais:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build
```

**Manual smoke test against local MinIO:**

```bash
# 1. Start local MinIO
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ':9001'

# 2. Create bucket via console (http://localhost:9001) or mc:
docker run --network host -it --entrypoint sh minio/mc -c \
  "mc alias set local http://localhost:9000 minioadmin minioadmin && mc mb local/test-bucket"

# 3. Run smoke test (script /tmp/smoke-phase2.mjs):
#    - import BymaxStorageModule + StorageService
#    - upload Buffer
#    - head, exists, downloadBuffer
#    - delete (idempotent — call 2x)
node /tmp/smoke-phase2.mjs
```

**Done criteria:**

- [ ] Smoke test passes against MinIO
- [ ] Coverage gate ok
- [ ] PR `phase-2` with `/bymax-quality:code-review` applied

---

## 4. Phase 3 — Signed URLs + Validation hooks + Virus scan hook

> **Phase objective:** Implement `SignedUrlService` (GET/PUT/multipart), `ValidationService` (MIME whitelist with wildcards, size, custom validators) and `FileScannerService` (integration with `IFileScanner`, pre/post modes, reject-on-unknown). At the end, real signed URLs can be issued, uploads validated against customizable policies, and an external scanner plugged in (ClamAV via consumer).
>
> **Complexity:** MEDIUM.
>
> **Critical paths for 95% coverage:** `src/server/services/signed-url.service.ts`, `src/server/utils/ttl-clamp.ts`, `src/server/services/validation.service.ts`, `src/server/utils/mime-match.ts`, `src/server/services/file-scanner.service.ts`.

### 4.1 `ttl-clamp.ts` — clamp utility for TTL

**Objective:** Pure function that validates and silently clamps TTL to `maxTtlSeconds`.

**Files to create:**

```
src/server/utils/ttl-clamp.ts
```

**Skeleton:**

```typescript
import { HttpStatus } from '@nestjs/common'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * Validates and clamps the TTL for a signed URL.
 *
 * Semantics:
 *   - Negative or zero TTL → throws STORAGE_SIGNED_URL_TTL_INVALID (400)
 *   - TTL above max → silently clamped to max (no throw — consumer-friendly)
 *   - Undefined TTL → uses the provided default
 *
 * Rationale for silent clamp: it's the same semantic as AWS SDK's behavior;
 * apps composing TTLs from user inputs benefit from this not-throwing default.
 */
export function clampTtl(
  ttlSeconds: number | undefined,
  defaultTtl: number,
  maxTtl: number,
): number {
  const ttl = ttlSeconds ?? defaultTtl
  if (ttl <= 0) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID, HttpStatus.BAD_REQUEST, {
      reason: 'TTL must be > 0',
      provided: ttl,
    })
  }
  return Math.min(ttl, maxTtl)
}
```

**Acceptance criteria:**

- [ ] `clampTtl(undefined, 300, 604800)` → `300`
- [ ] `clampTtl(60, 300, 604800)` → `60`
- [ ] `clampTtl(999999, 300, 604800)` → `604800` (clamp)
- [ ] `clampTtl(0, 300, 604800)` throws `STORAGE_SIGNED_URL_TTL_INVALID`
- [ ] `clampTtl(-10, 300, 604800)` throws `STORAGE_SIGNED_URL_TTL_INVALID`
- [ ] Coverage 100%
- [ ] Mutation score ≥ 100% (security boundary)

**Validation commands:**

```bash
pnpm test src/server/utils/ttl-clamp.spec.ts
```

**Dependencies:** §2.6 (`StorageException`).

### 4.2 `SignedUrlService` — GET / PUT / multipart

**Objective:** Service that emits signed URLs using `@aws-sdk/s3-request-presigner`.

**Files to create:**

```
src/server/services/signed-url.service.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable, HttpStatus } from '@nestjs/common'
import {
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type {
  SignedGetUrlOptions,
  SignedPutUrlOptions,
  MultipartUploadUrlsOptions,
  MultipartUploadUrlsResult,
} from '../interfaces/signed-url-options.interface'
import type { SignedUrlResult } from '../../shared/types/signed-url-types'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { StorageException } from '../errors/storage-exception'
import { mapAwsError } from '../errors/aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { clampTtl } from '../utils/ttl-clamp'
import { buildACL } from '../utils/header-utils'

@Injectable()
export class SignedUrlService {
  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    private readonly s3Provider: S3ClientProvider,
    private readonly keyResolver: KeyResolverService,
  ) {}

  private assertConfigured(): void {
    if (!this.s3Provider.isConfigured()) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED, HttpStatus.SERVICE_UNAVAILABLE)
    }
  }

  /** GET URL — client downloads without credentials until TTL expires. */
  async getDownloadUrl(options: SignedGetUrlOptions): Promise<SignedUrlResult> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = options.bucket ?? this.options.bucket
    const ttl = clampTtl(
      options.ttlSeconds,
      this.options.signedUrls.defaultGetTtlSeconds,
      this.options.signedUrls.maxTtlSeconds,
    )

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: finalKey,
      ResponseContentDisposition: options.responseContentDisposition,
      ResponseContentType: options.responseContentType,
    })

    try {
      const url = await getSignedUrl(this.s3Provider.getClient(), command, { expiresIn: ttl })
      return {
        url,
        expiresAt: new Date(Date.now() + ttl * 1000),
        method: 'GET',
        requiredHeaders: {},
      }
    } catch (err) {
      throw mapAwsError(err, { key: finalKey, bucket, op: 'signed-get' })
    }
  }

  /**
   * PUT URL — client uploads directly without going through the backend.
   * IMPORTANT: local MIME/size validation does NOT apply. Use `maxSizeBytes`
   * (Content-Length-Range policy) and post-upload HEAD + scanner.
   */
  async getUploadUrl(options: SignedPutUrlOptions): Promise<SignedUrlResult> {
    this.assertConfigured()
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = options.bucket ?? this.options.bucket
    const ttl = clampTtl(
      options.ttlSeconds,
      this.options.signedUrls.defaultPutTtlSeconds,
      this.options.signedUrls.maxTtlSeconds,
    )

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: finalKey,
      ContentType: options.contentType,
      ContentLength: options.maxSizeBytes,
      ACL: buildACL(options.publicRead, this.options.defaultPublicRead),
      Metadata: options.metadata,
    })

    try {
      const url = await getSignedUrl(this.s3Provider.getClient(), command, { expiresIn: ttl })
      return {
        url,
        expiresAt: new Date(Date.now() + ttl * 1000),
        method: 'PUT',
        requiredHeaders: {
          'Content-Type': options.contentType,
        },
      }
    } catch (err) {
      throw mapAwsError(err, { key: finalKey, bucket, op: 'signed-put' })
    }
  }

  /** Multipart via signed URLs — uploadId + N part URLs + complete URL. */
  async getMultipartUploadUrls(options: MultipartUploadUrlsOptions): Promise<MultipartUploadUrlsResult> {
    this.assertConfigured()
    if (options.parts <= 0) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID, HttpStatus.BAD_REQUEST, {
        reason: 'parts must be > 0',
      })
    }
    const finalKey = this.keyResolver.normalize(options.key)
    const bucket = options.bucket ?? this.options.bucket
    const ttl = clampTtl(
      options.ttlSeconds,
      this.options.signedUrls.defaultPutTtlSeconds,
      this.options.signedUrls.maxTtlSeconds,
    )

    try {
      // 1. Initiate the multipart upload (server-side, gets uploadId).
      const initResponse = await this.s3Provider.getClient().send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: finalKey,
          ContentType: options.contentType,
        }),
      )
      const uploadId = initResponse.UploadId
      if (!uploadId) {
        throw new Error('Provider did not return UploadId')
      }

      // 2. Presign one UploadPart URL per part.
      const partUrls = await Promise.all(
        Array.from({ length: options.parts }, async (_, i) => {
          const partNumber = i + 1
          const url = await getSignedUrl(
            this.s3Provider.getClient(),
            new UploadPartCommand({ Bucket: bucket, Key: finalKey, UploadId: uploadId, PartNumber: partNumber }),
            { expiresIn: ttl },
          )
          return { partNumber, url }
        }),
      )

      // 3. Presign the complete URL.
      const completeUrl = await getSignedUrl(
        this.s3Provider.getClient(),
        new CompleteMultipartUploadCommand({ Bucket: bucket, Key: finalKey, UploadId: uploadId }),
        { expiresIn: ttl },
      )

      return { uploadId, partUrls, completeUrl }
    } catch (err) {
      throw mapAwsError(err, { key: finalKey, bucket, op: 'signed-multipart' })
    }
  }
}
```

**Acceptance criteria:**

- [ ] `getDownloadUrl` returns a URL with `X-Amz-Signature` and `X-Amz-Expires` query params (verifiable via URL parsing)
- [ ] `getDownloadUrl` clampa TTL above de `maxTtlSeconds`
- [ ] `getDownloadUrl` throws `STORAGE_SIGNED_URL_TTL_INVALID` for TTL ≤ 0
- [ ] `getUploadUrl` returns `requiredHeaders` with `Content-Type` casando with options.contentType
- [ ] `getUploadUrl` applies `ACL=public-read` when `publicRead: true`
- [ ] `getMultipartUploadUrls` returns `uploadId`, `parts` URLs with partNumbers 1..N, and `completeUrl`
- [ ] `getMultipartUploadUrls` rejects `parts <= 0`
- [ ] `expiresAt` is correct `Date` based on `ttl`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/signed-url.service.spec.ts
```

**Dependencies:** §2.4, §2.5, §2.7, §2.8, §4.1.

**Risks/Notes:**

- `getSignedUrl` is the helper name from `@aws-sdk/s3-request-presigner` — check peer dep version
- NEVER log the returned `url` — it's a temporary credential. Add JSDoc reinforcing this

### 4.3 `mime-match.ts` — wildcard MIME matching

**Objective:** Pure function that compares MIME against a whitelist with wildcard support.

**Files to create:**

```
src/server/utils/mime-match.ts
```

**Skeleton:**

```typescript
/**
 * Returns true when `mime` matches at least one pattern in `whitelist`.
 *
 * Pattern semantics:
 *   - Exact match: 'image/jpeg' matches 'image/jpeg' (case-insensitive)
 *   - Subtype wildcard: 'image/*' matches any 'image/...'
 *   - Full wildcard: '* /*' matches anything (use sparingly)
 *
 * Parameters after `;` (e.g., 'text/plain; charset=utf-8') are stripped before matching.
 */
export function mimeMatches(mime: string, whitelist: readonly string[]): boolean {
  const normalized = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!normalized || !normalized.includes('/')) return false

  const [type, subtype] = normalized.split('/')
  return whitelist.some((pattern) => {
    const p = pattern.trim().toLowerCase()
    if (p === normalized) return true
    if (p === '*/*') return true
    const [patternType, patternSubtype] = p.split('/')
    if (patternSubtype === '*' && patternType === type) return true
    return false
  })
}
```

**Acceptance criteria:**

- [ ] `mimeMatches('image/jpeg', ['image/jpeg'])` → `true`
- [ ] `mimeMatches('IMAGE/JPEG', ['image/jpeg'])` → `true` (case-insensitive)
- [ ] `mimeMatches('image/png', ['image/*'])` → `true` (subtype wildcard)
- [ ] `mimeMatches('video/mp4', ['image/*'])` → `false`
- [ ] `mimeMatches('text/plain; charset=utf-8', ['text/plain'])` → `true` (strip params)
- [ ] `mimeMatches('anything', ['*/*'])` → `false` (anything without /)
- [ ] `mimeMatches('image/jpeg', ['*/*'])` → `true`
- [ ] `mimeMatches('', ['image/*'])` → `false`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/utils/mime-match.spec.ts
```

**Dependencies:** No.

### 4.4 `ValidationService` — MIME + size + custom validators

**Objective:** Centralize the validation pipeline. Runs in order: MIME → size → custom validators.

**Files to create:**

```
src/server/services/validation.service.ts
src/server/providers/no-op-validator.ts
```

**Skeleton — `validation.service.ts`:**

```typescript
import { Inject, Injectable, HttpStatus } from '@nestjs/common'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_UPLOAD_VALIDATORS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { IUploadValidator } from '../interfaces/upload-validator.interface'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { mimeMatches } from '../utils/mime-match'
import { peekFirstBytes, type UploadBody } from '../utils/stream-utils'

@Injectable()
export class ValidationService {
  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    @Inject(BYMAX_STORAGE_UPLOAD_VALIDATORS) private readonly validators: readonly IUploadValidator[],
  ) {}

  /**
   * Runs the validation pipeline. Returns the (possibly tee'd) body that
   * MUST be used for the actual upload — when a custom validator uses
   * `readBytes()` on a stream, the original stream is consumed and a
   * replacement PassThrough is returned.
   */
  async validate(input: UploadOptions): Promise<{ body: UploadBody }> {
    // 1. MIME check.
    const whitelist = this.options.validation?.mimeWhitelist
    if (whitelist && whitelist.length > 0) {
      if (!mimeMatches(input.contentType, whitelist)) {
        throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED, HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
          contentType: input.contentType,
          whitelist,
        })
      }
    }

    // 2. Size check (best-effort — undefined for streams without declared size).
    const maxSize = this.options.validation?.maxSizeBytes
    if (maxSize !== undefined && input.size !== undefined && input.size > maxSize) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED, HttpStatus.PAYLOAD_TOO_LARGE, {
        size: input.size,
        maxSize,
      })
    }

    // 3. Custom validators — pass through, mutating `body` if any validator peeks.
    let body: UploadBody = input.body
    for (const validator of this.validators) {
      const result = await validator.validate({
        key: input.key,
        contentType: input.contentType,
        size: input.size,
        metadata: input.metadata,
        readBytes: async (maxBytes: number) => {
          const { head, replacementBody } = await peekFirstBytes(body, maxBytes)
          body = replacementBody
          return head
        },
      })
      if (!result.ok) {
        throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, HttpStatus.BAD_REQUEST, {
          validator: validator.name,
          reason: result.reason,
        })
      }
    }
    return { body }
  }
}
```

**Skeleton — `no-op-validator.ts`:**

```typescript
import type { IUploadValidator } from '../interfaces/upload-validator.interface'

/**
 * Validator that accepts everything. Used as the placeholder when in the custom
 * validators are configured.
 */
export class NoOpUploadValidator implements IUploadValidator {
  readonly name = 'no-op'
  async validate(): Promise<{ ok: true }> {
    return { ok: true }
  }
}
```

**Acceptance criteria:**

- [ ] Empty or undefined MIME whitelist → does not block
- [ ] MIME outside do whitelist → `STORAGE_MIME_NOT_ALLOWED` (HTTP 415)
- [ ] MIME wildcard `image/*` aceita `image/png`
- [ ] Size > `maxSizeBytes` → `STORAGE_SIZE_EXCEEDED` (HTTP 413)
- [ ] Size undefined (stream without size) → passes the size check (best-effort)
- [ ] Custom validator rejeitando → `STORAGE_VALIDATION_FAILED` with `validator.name` in details
- [ ] Validator with `readBytes()` in stream consome bytes uma time; subsequente upload uses o replacement body
- [ ] Execution order: MIME → size → custom (verifiable via spy)
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/validation.service.spec.ts
```

**Dependencies:** §2.4, §2.5, §3.2 (`peekFirstBytes`), §4.3 (`mimeMatches`).

### 4.5 `FileScannerService` — virus scan integration

**Objective:** Service that wraps the consumer-injected `IFileScanner`, implementing pre/post logic + reject-on-unknown + post-upload removal in case of infected.

**Files to create:**

```
src/server/services/file-scanner.service.ts
src/server/providers/no-op-scanner.ts
```

**Skeleton — `file-scanner.service.ts`:**

```typescript
import { Inject, Injectable, Logger, HttpStatus } from '@nestjs/common'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_FILE_SCANNER } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { IFileScanner, FileScanResult } from '../interfaces/file-scanner.interface'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

@Injectable()
export class FileScannerService {
  private readonly logger = new Logger(FileScannerService.name)

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    @Inject(BYMAX_STORAGE_FILE_SCANNER) private readonly scanner: IFileScanner | null,
  ) {}

  isEnabled(): boolean {
    return this.scanner !== null && this.options.scanner !== undefined
  }

  /**
   * Returns the configured mode; defaults to 'pre-upload'. Returns null when
   * the scanner is disabled — callers MUST check `isEnabled()` first.
   */
  getMode(): 'pre-upload' | 'post-upload' | null {
    if (!this.isEnabled()) return null
    return this.options.scanner?.mode ?? 'pre-upload'
  }

  /**
   * Invokes the scanner and applies reject/cleanup logic.
   * For pre-upload mode, callers invoke this BEFORE sending to S3.
   * For post-upload mode, callers invoke this AFTER sending to S3 and pass
   * `removeOnInfected` so this service can request deletion.
   *
   * Returns the FileScanResult on 'clean' (or 'unknown' when rejectOnUnknown
   * is false) — caller decides what to do next.
   *
   * Throws `STORAGE_SCAN_INFECTED` on 'infected'.
   * Throws `STORAGE_SCAN_INCONCLUSIVE` on 'unknown' when rejectOnUnknown.
   */
  async scan(input: {
    mode: 'pre-upload' | 'post-upload'
    body?: Buffer | NodeJS.ReadableStream
    key: string
    bucket: string
    contentType: string
    size?: number
  }): Promise<FileScanResult> {
    if (!this.scanner) {
      throw new Error('FileScannerService.scan called without a configured scanner — guard with isEnabled()')
    }
    const result = await this.scanner.scan(input)

    if (result.status === 'infected') {
      this.logger.warn(`Scanner flagged infected: key=${input.key} engine=${result.engine} threat=${result.threat}`)
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, HttpStatus.UNPROCESSABLE_ENTITY, {
        engine: result.engine,
        threat: result.threat,
        details: result.details,
      })
    }

    if (result.status === 'unknown' && (this.options.scanner?.rejectOnUnknown ?? false)) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INCONCLUSIVE, HttpStatus.UNPROCESSABLE_ENTITY, {
        engine: result.engine,
        details: result.details,
      })
    }

    if (result.status === 'unknown') {
      this.logger.warn(`Scanner inconclusive (accepted): key=${input.key} engine=${result.engine}`)
    }
    return result
  }
}
```

**Skeleton — `no-op-scanner.ts`:**

```typescript
import type { IFileScanner, FileScanResult } from '../interfaces/file-scanner.interface'

/**
 * Scanner that returns 'clean' for everything. Convenient export for consumers
 * that want to disable scanning explicitly while keeping their wiring uniform.
 */
export class NoOpFileScanner implements IFileScanner {
  async scan(): Promise<FileScanResult> {
    return { status: 'clean', engine: 'no-op' }
  }
}
```

**Acceptance criteria:**

- [ ] `isEnabled()` correctly reflects when scanner is not configured
- [ ] `getMode()` returns `'pre-upload'` default or o mode configured
- [ ] `scan()` returns result when status is `'clean'`
- [ ] `scan()` throws `STORAGE_SCAN_INFECTED` (HTTP 422) when status is `'infected'`
- [ ] `scan()` throws `STORAGE_SCAN_INCONCLUSIVE` (HTTP 422) when `'unknown'` and `rejectOnUnknown: true`
- [ ] `scan()` returns result with warning when `'unknown'` and `rejectOnUnknown: false`
- [ ] `details.threat` is preserved in the exception
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/file-scanner.service.spec.ts
```

**Dependencies:** §2.3, §2.4, §2.5, §2.6.

### 4.6 Integration in `StorageService.upload()`

**Objective:** Plug `ValidationService` and `FileScannerService` into the upload pipeline. Logic:
1. KeyResolver (already covered in §3.5)
2. ValidationService.validate (MIME, size, custom)
3. FileScannerService.scan (pre-upload mode)
4. PutObject / Upload (multipart)
5. FileScannerService.scan (post-upload mode) — with removal in case of infected

**Files to modify:**

```
src/server/services/storage.service.ts
```

**Modification — inject additional deps and use in `upload()`:**

```typescript
import { ValidationService } from './validation.service'
import { FileScannerService } from './file-scanner.service'

// Add in the constructor:
constructor(
  // ... existentes
  private readonly validation: ValidationService,
  private readonly scanner: FileScannerService,
) {}

// Modificar upload():
async upload(options: UploadOptions): Promise<UploadResult> {
  this.assertConfigured()
  if (!options.body) throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BODY_MISSING)
  if (!options.contentType) throw new StorageException(STORAGE_ERROR_CODES.STORAGE_CONTENT_TYPE_REQUIRED)

  const finalKey = this.keyResolver.normalize(options.key)
  const bucket = this.resolveBucket(options.bucket)

  // Idempotency check (unchanged)
  if (options.idempotencyKey) {
    const cacheKey = this.idempotencyCache.computeKey(options.idempotencyKey, finalKey)
    const cached = this.idempotencyCache.get(cacheKey)
    if (cached) return { ...cached, fromIdempotencyCache: true }
  }

  // NEW: Validation
  const validated = await this.validation.validate(options)
  const validatedOptions = { ...options, body: validated.body }

  // NEW: Pre-upload scan
  if (this.scanner.isEnabled() && this.scanner.getMode() === 'pre-upload') {
    await this.scanner.scan({
      mode: 'pre-upload',
      body: validated.body as Buffer | NodeJS.ReadableStream,
      key: finalKey, bucket,
      contentType: options.contentType,
      size: options.size,
    })
  }

  // Strategy + upload (unchanged path through uploadSingleShot / uploadMultipart)
  const strategy = pickUploadStrategy(validated.body, options.size, this.options.multipart.thresholdBytes)
  const result = strategy === 'multipart'
    ? await this.uploadMultipart(validatedOptions, finalKey, bucket)
    : await this.uploadSingleShot(validatedOptions, finalKey, bucket)

  // NEW: Post-upload scan
  if (this.scanner.isEnabled() && this.scanner.getMode() === 'post-upload') {
    try {
      await this.scanner.scan({
        mode: 'post-upload',
        key: finalKey, bucket,
        contentType: options.contentType,
        size: options.size,
      })
    } catch (err) {
      // If post-upload scan rejects, delete the object that was just uploaded.
      this.logger.warn(`post-upload scan failed for ${finalKey} — deleting`)
      await this.delete(finalKey, { bucket }).catch((deleteErr) => {
        this.logger.error(`Failed to delete infected object ${finalKey}: ${(deleteErr as Error).message}`)
      })
      throw err
    }
  }

  // Idempotency store
  if (options.idempotencyKey) {
    const cacheKey = this.idempotencyCache.computeKey(options.idempotencyKey, finalKey)
    this.idempotencyCache.set(cacheKey, result)
  }
  return result
}
```

**Acceptance criteria:**

- [ ] Upload with `mimeWhitelist` rejects MIME outside the list before calling S3
- [ ] Upload with `maxSizeBytes` rejects exceeded size before calling S3
- [ ] Upload with `validation.customValidators` calls each validator in order
- [ ] Scanner in `pre-upload` mode is called before PutObject (verifiable via spy ordering)
- [ ] Scanner in `pre-upload` mode returning `infected` prevents the PutObject
- [ ] Scanner in `post-upload` mode called after o PutObject
- [ ] Scanner in `post-upload` mode returning `infected` triggers `delete()` of the uploaded object
- [ ] Coverage 100% in the `storage.service.ts` (paths new covered)

**Validation commands:**

```bash
pnpm test src/server/services/storage.service.spec.ts
pnpm test:cov
```

**Dependencies:** §4.4, §4.5.

### 4.7 Module registration + barrel updates

**Objective:** Register the 3 new services in the module and exportar publicamente.

**Files to modify:**

```
src/server/bymax-storage.module.ts
src/server/index.ts
```

**Modification — `bymax-storage.module.ts`:**

```typescript
import { SignedUrlService } from './services/signed-url.service'
import { ValidationService } from './services/validation.service'
import { FileScannerService } from './services/file-scanner.service'

// Add nos providers:
SignedUrlService,
ValidationService,
FileScannerService,

// Add nos exports:
SignedUrlService,
```

> `ValidationService` and `FileScannerService` are internal — do not export (consumer should not inject them directly; uses them via `StorageService.upload()`).

**Modification — `src/server/index.ts`:**

```typescript
export { SignedUrlService } from './services/signed-url.service'
export { NoOpUploadValidator } from './providers/no-op-validator'
export { NoOpFileScanner } from './providers/no-op-scanner'
```

**Acceptance criteria:**

- [ ] `SignedUrlService` injectable in any feature module
- [ ] `NoOpUploadValidator` and `NoOpFileScanner` exported for consumer poder use
- [ ] `ValidationService` and `FileScannerService` are **not** in `index.ts` (internal)
- [ ] `pnpm build` produces `dist/server/index.d.ts` with os new exports

### 4.8 Phase 3 validation

**Additional test files:**

```
src/server/utils/ttl-clamp.spec.ts
src/server/services/signed-url.service.spec.ts
src/server/utils/mime-match.spec.ts
src/server/services/validation.service.spec.ts
src/server/services/file-scanner.service.spec.ts
```

**Commands finais:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build
```

**Manual smoke test against MinIO:**

```bash
# Prerequisite: local MinIO running (§3.9)
# Script /tmp/smoke-phase3.mjs:
#   - configure BymaxStorageModule with validation.mimeWhitelist: ['image/png']
#     and validation.maxSizeBytes: 1024
#   - try upload 'text/plain' → expect STORAGE_MIME_NOT_ALLOWED
#   - try upload with 2 KB → expect STORAGE_SIZE_EXCEEDED
#   - upload OK with 'image/png' and a small Buffer.from(...)
#   - signedUrlService.getDownloadUrl({ key, ttlSeconds: 60 }) → run curl → 200
#   - signedUrlService.getUploadUrl({ key, contentType: 'image/png', ttlSeconds: 60 })
#     → curl PUT with Content-Type → upload via signed URL
node /tmp/smoke-phase3.mjs
```

**Done criteria:**

- [ ] Validation pipeline rejects correctly
- [ ] Signed URLs (GET/PUT) work with real curl against MinIO
- [ ] Coverage gate ok
- [ ] PR `phase-3` with `/bymax-quality:code-review` applied

---

## 5. Phase 4 — Listing + Pagination + forRootAsync + E2E + Mutation

> **Phase objective:** Close the public API with `list()`, `copy()`, `deleteMany()`, expose preconfigured Provider Recipes for the main providers, add suporte a `forRootAsync()`, set up real E2E suite against MinIO via Testcontainers, and run mutation testing baseline.
>
> **Complexity:** HIGH — `list()` needs correct pagination, `deleteMany()` needs batching up to 1000 keys (limite S3), `forRootAsync()` requires replicar all providers via factories, and Testcontainers has timing/cleanup tricky.
>
> **Critical paths for 95% coverage:** `src/server/services/storage.service.ts` (list/copy/deleteMany), `src/server/config/provider-recipes.ts`, `src/server/bymax-storage.module.ts` (forRootAsync).

### 5.1 `list()` — pagination and commonPrefixes

**Objective:** Add `list()` to `StorageService` using `ListObjectsV2Command`.

**Files to modify:**

```
src/server/services/storage.service.ts
```

**Skeleton — added method:**

```typescript
import { ListObjectsV2Command, type ListObjectsV2CommandOutput } from '@aws-sdk/client-s3'
import type { ListOptions, ListResult } from '../interfaces/list-options.interface'

// inside StorageService:

async list(options: ListOptions): Promise<ListResult> {
  this.assertConfigured()
  const bucket = this.resolveBucket(options.bucket)
  const maxKeys = Math.min(options.maxKeys ?? 1000, 1000)  // S3 hard cap

  // Apply global keyPrefix to user-provided prefix.
  const fullPrefix = options.prefix
    ? this.keyResolver.normalize(options.prefix)
    : this.keyResolver.getPrefix()

  try {
    const response: ListObjectsV2CommandOutput = await this.s3Provider.getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fullPrefix,
        MaxKeys: maxKeys,
        ContinuationToken: options.continuationToken,
        Delimiter: options.delimiter,
      }),
    )

    return {
      objects: (response.Contents ?? []).map((obj) => ({
        key: this.keyResolver.stripPrefix(obj.Key ?? ''),
        size: obj.Size ?? 0,
        etag: obj.ETag ?? '',
        lastModified: obj.LastModified ?? new Date(0),
        storageClass: obj.StorageClass,
      })),
      commonPrefixes: (response.CommonPrefixes ?? [])
        .map((cp) => cp.Prefix ?? '')
        .filter((p) => p.length > 0)
        .map((p) => this.keyResolver.stripPrefix(p)),
      isTruncated: response.IsTruncated ?? false,
      nextContinuationToken: response.NextContinuationToken,
    }
  } catch (err) {
    throw mapAwsError(err, { bucket, prefix: fullPrefix, op: 'list' })
  }
}
```

**Acceptance criteria:**

- [ ] `list({ prefix: 'avatars/' })` returns only objetos with prefix matching
- [ ] `list({ delimiter: '/' })` returns `commonPrefixes` for subdirs simulados
- [ ] `list({ maxKeys: 50 })` returns at most 50; `maxKeys: 5000` is clamped at 1000
- [ ] `list({ continuationToken })` returns next page
- [ ] Keys retornadas have `keyPrefix` global removed (via `stripPrefix`)
- [ ] `isTruncated: true` when there are more results
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/storage.service.list.spec.ts
```

**Dependencies:** §3.5.

### 5.2 `copy()` — server-side copy

**Objective:** Add `copy()` to `StorageService` using `CopyObjectCommand`.

**Files to modify:**

```
src/server/services/storage.service.ts
```

**Skeleton:**

```typescript
import { CopyObjectCommand } from '@aws-sdk/client-s3'

async copy(options: {
  sourceKey: string
  destinationKey: string
  sourceBucket?: string
  destinationBucket?: string
  publicRead?: boolean
  cacheControl?: string
}): Promise<{ etag: string }> {
  this.assertConfigured()
  const sourceKey = this.keyResolver.normalize(options.sourceKey)
  const destKey = this.keyResolver.normalize(options.destinationKey)
  const sourceBucket = this.resolveBucket(options.sourceBucket)
  const destBucket = this.resolveBucket(options.destinationBucket)

  try {
    const response = await this.s3Provider.getClient().send(
      new CopyObjectCommand({
        Bucket: destBucket,
        Key: destKey,
        CopySource: `/${sourceBucket}/${sourceKey}`,
        CacheControl: options.cacheControl ?? this.options.defaultCacheControl,
        ACL: buildACL(options.publicRead, this.options.defaultPublicRead),
        MetadataDirective: 'COPY',  // preserve original metadata unless overridden
      }),
    )
    return { etag: response.CopyObjectResult?.ETag ?? '' }
  } catch (err) {
    throw mapAwsError(err, { sourceKey, destKey, op: 'copy' })
  }
}
```

**Acceptance criteria:**

- [ ] `copy({ sourceKey, destinationKey })` calls `CopyObjectCommand` with `CopySource` in the formato `/bucket/key`
- [ ] Same-bucket copy works when `sourceBucket` and `destinationBucket` omitidos
- [ ] Cross-bucket copy when both are provided
- [ ] `publicRead: true` applies `ACL: 'public-read'`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/storage.service.copy.spec.ts
```

**Dependencies:** §3.5.

### 5.3 `deleteMany()` — batch delete

**Objective:** Add `deleteMany()` using `DeleteObjectsCommand`. S3 accepts up to 1000 keys per request — implement chunking.

**Files to modify:**

```
src/server/services/storage.service.ts
```

**Skeleton:**

```typescript
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'

async deleteMany(keys: string[], options?: { bucket?: string }): Promise<{
  deleted: string[]
  failed: Array<{ key: string; error: string }>
}> {
  this.assertConfigured()
  if (keys.length === 0) return { deleted: [], failed: [] }

  const bucket = this.resolveBucket(options?.bucket)
  const normalized = keys.map((k) => this.keyResolver.normalize(k))

  // S3 DeleteObjects accepts up to 1000 per call — chunk if more.
  const CHUNK = 1000
  const deleted: string[] = []
  const failed: Array<{ key: string; error: string }> = []

  for (let i = 0; i < normalized.length; i += CHUNK) {
    const chunk = normalized.slice(i, i + CHUNK)
    try {
      const response = await this.s3Provider.getClient().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((k) => ({ Key: k })),
            Quiet: false,  // we want both success and failure reports
          },
        }),
      )
      for (const ok of response.Deleted ?? []) {
        if (ok.Key) deleted.push(this.keyResolver.stripPrefix(ok.Key))
      }
      for (const err of response.Errors ?? []) {
        if (err.Key) failed.push({
          key: this.keyResolver.stripPrefix(err.Key),
          error: `${err.Code ?? 'Unknown'}: ${err.Message ?? ''}`,
        })
      }
    } catch (err) {
      // If the whole batch fails, mark all chunk keys as failed.
      const message = (err as Error).message
      for (const k of chunk) {
        failed.push({ key: this.keyResolver.stripPrefix(k), error: message })
      }
    }
  }
  return { deleted, failed }
}
```

**Acceptance criteria:**

- [ ] `deleteMany([])` returns `{ deleted: [], failed: [] }` without calling S3
- [ ] `deleteMany([k1, k2])` calls `DeleteObjectsCommand` with `Quiet: false`
- [ ] `deleteMany` with > 1000 keys makes multiple calls (chunks of 1000)
- [ ] Individual failures grouped in `failed` with readable `error`
- [ ] Sucesso individual in `deleted`
- [ ] Keys retornadas have `keyPrefix` global removed
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/storage.service.delete-many.spec.ts
```

**Dependencies:** §3.5.

### 5.4 Provider Recipes

**Objective:** Expose preconfigured factories for AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, MinIO and Wasabi.

**Files to create:**

```
src/server/config/provider-recipes.ts
```

**Skeleton:**

```typescript
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

interface BaseInput {
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

interface R2Input extends Omit<BaseInput, 'region'> {
  accountId: string
  /** Optional Cloudflare R2 Custom Domain — overrides default URL. */
  customDomain?: string
}

interface B2Input extends BaseInput {
  /** B2 endpoint host — e.g., 's3.us-west-002.backblazeb2.com'. */
  endpointHost: string
}

interface MinIOInput {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** MinIO region is arbitrary — default 'us-east-1'. */
  region?: string
}

/**
 * Provider Recipes — pre-tuned configs for each S3-compatible provider.
 * Consumer overrides any field as needed by spreading the result:
 *
 * @example
 *   BymaxStorageModule.forRoot({
 *     ...providerRecipes.cloudflareR2({ accountId, bucket, accessKeyId, secretAccessKey }),
 *     keyPrefix: 'tenant-x/',
 *     validation: { mimeWhitelist: ['image/*'] },
 *   })
 */
export const providerRecipes = {
  awsS3(input: BaseInput): BymaxStorageModuleOptions {
    return {
      endpoint: `https://s3.${input.region}.amazonaws.com`,
      region: input.region,
      bucket: input.bucket,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
      },
      forcePathStyle: false,
      publicBaseUrl: `https://${input.bucket}.s3.${input.region}.amazonaws.com`,
      serverSideEncryption: 'AES256',
    }
  },

  digitalOceanSpaces(input: BaseInput): BymaxStorageModuleOptions {
    return {
      endpoint: `https://${input.region}.digitaloceanspaces.com`,
      region: input.region,
      bucket: input.bucket,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
      },
      forcePathStyle: false,
      publicBaseUrl: `https://${input.bucket}.${input.region}.digitaloceanspaces.com`,
      cdnBaseUrl: `https://${input.bucket}.${input.region}.cdn.digitaloceanspaces.com`,
      defaultPublicRead: true,
      // Spaces rejects the SDK's default CRC32 integrity headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }
  },

  /** Cloudflare R2 — ACLs ignored; getPublicUrl needs an r2.dev or custom domain. */
  cloudflareR2(input: R2Input): BymaxStorageModuleOptions {
    return {
      endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      bucket: input.bucket,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
      forcePathStyle: false,
      // The *.r2.cloudflarestorage.com host is the S3 API endpoint and does NOT serve public reads.
      publicBaseUrl: input.customDomain,   // REQUIRED for public reads (no working default)
      // R2 rejects the SDK's default CRC32 integrity headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }
  },

  /** Backblaze B2 — S3-compatible API supports both addressing styles. */
  backblazeB2(input: B2Input): BymaxStorageModuleOptions {
    return {
      endpoint: `https://${input.endpointHost}`,
      region: input.region,
      bucket: input.bucket,
      credentials: {
        accessKeyId: input.accessKeyId,   // Backblaze applicationKeyId
        secretAccessKey: input.secretAccessKey,  // Backblaze applicationKey
      },
      forcePathStyle: false,   // B2 supports both styles; virtual-hosted matches publicBaseUrl
      publicBaseUrl: `https://${input.bucket}.${input.endpointHost}`,
      // B2 rejects the SDK's default CRC32 integrity headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }
  },

  /** MinIO — dev / CI / self-hosted. */
  minio(input: MinIOInput): BymaxStorageModuleOptions {
    return {
      endpoint: input.endpoint,
      region: input.region ?? 'us-east-1',
      bucket: input.bucket,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
      forcePathStyle: true,
      publicBaseUrl: `${input.endpoint.replace(/\/+$/, '')}/${input.bucket}`,
      // Older MinIO builds reject the SDK's default CRC32 integrity headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }
  },

  /** Wasabi — Hot Cloud Storage. */
  wasabi(input: BaseInput): BymaxStorageModuleOptions {
    return {
      endpoint: `https://s3.${input.region}.wasabisys.com`,
      region: input.region,
      bucket: input.bucket,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
      },
      forcePathStyle: false,
      publicBaseUrl: `https://${input.bucket}.s3.${input.region}.wasabisys.com`,
      // Wasabi rejects the SDK's default CRC32 integrity headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }
  },
} as const
```

**Acceptance criteria:**

- [ ] `providerRecipes.awsS3({ region: 'us-east-1', bucket: 'b', ... })` produces endpoint `https://s3.us-east-1.amazonaws.com`
- [ ] `providerRecipes.digitalOceanSpaces({ region: 'nyc3', ... })` produces endpoint `https://nyc3.digitaloceanspaces.com` and a populated `cdnBaseUrl`
- [ ] `providerRecipes.cloudflareR2({ accountId: 'abc', ... })` produces `region: 'auto'`
- [ ] `providerRecipes.cloudflareR2({ ..., customDomain: 'https://cdn.example.com' })` uses the custom domain as `publicBaseUrl`
- [ ] `providerRecipes.backblazeB2({ endpointHost: 's3.us-west-002.backblazeb2.com', ... })` produces `forcePathStyle: false`
- [ ] `providerRecipes.minio({ endpoint: 'http://localhost:9000', ... })` produces `forcePathStyle: true`
- [ ] Every non-AWS recipe sets `requestChecksumCalculation`/`responseChecksumValidation` to `'WHEN_REQUIRED'`
- [ ] `providerRecipes.wasabi({ region: 'us-east-1', ... })` produces the Wasabi endpoint
- [ ] Each recipe is purely a reference — calling it twice with the same input returns deep-equal output
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/config/provider-recipes.spec.ts
```

**Dependencies:** §2.3.

**Risks/Notes:**

- Special AWS regions (us-east-1) have a different endpoint — the recipe assumes the regional format (`s3.us-east-1.amazonaws.com`). The consumer can override it
- B2 endpoint host varies by region; document in README how to discover it

### 5.5 `forRootAsync()`

**Objective:** Add async configuration support (canonical NestJS pattern).

**Files to modify:**

```
src/server/bymax-storage.module.ts
```

**Skeleton:**

```typescript
import type {
  BymaxStorageModuleAsyncOptions,
  BymaxStorageModuleOptionsFactory,
} from './interfaces/storage-module-options.interface'

// Add a static method to the @Module class:

static forRootAsync(asyncOptions: BymaxStorageModuleAsyncOptions): DynamicModule {
  const asyncOptionsProvider: Provider = this.createAsyncOptionsProvider(asyncOptions)

  return {
    module: BymaxStorageModule,
    imports: asyncOptions.imports ?? [],
    providers: [
      asyncOptionsProvider,
      // Validators / scanner derived from resolved options:
      {
        provide: BYMAX_STORAGE_UPLOAD_VALIDATORS,
        useFactory: (resolved: ResolvedBymaxStorageOptions) => resolved.validation?.customValidators ?? [],
        inject: [BYMAX_STORAGE_OPTIONS],
      },
      {
        provide: BYMAX_STORAGE_FILE_SCANNER,
        useFactory: (resolved: ResolvedBymaxStorageOptions) => resolved.scanner?.impl ?? null,
        inject: [BYMAX_STORAGE_OPTIONS],
      },
      {
        provide: BYMAX_STORAGE_IDEMPOTENCY_CACHE,
        useFactory: () => new IdempotencyCache(DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES, DEFAULT_IDEMPOTENCY_CACHE_TTL_MS),
      },
      S3ClientProvider,
      KeyResolverService,
      StorageService,
      SignedUrlService,
      ValidationService,
      FileScannerService,
    ],
    exports: [
      BYMAX_STORAGE_OPTIONS,
      S3ClientProvider,
      KeyResolverService,
      StorageService,
      SignedUrlService,
    ],
  }
}

private static createAsyncOptionsProvider(asyncOptions: BymaxStorageModuleAsyncOptions): Provider {
  if (asyncOptions.useFactory) {
    return {
      provide: BYMAX_STORAGE_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const opts = await asyncOptions.useFactory!(...args)
        validateOptions(opts)
        return applyDefaults(opts)
      },
      inject: [...(asyncOptions.inject ?? [])],
    }
  }
  if (asyncOptions.useClass || asyncOptions.useExisting) {
    const useClass = asyncOptions.useClass ?? asyncOptions.useExisting!
    return {
      provide: BYMAX_STORAGE_OPTIONS,
      useFactory: async (factory: BymaxStorageModuleOptionsFactory) => {
        const opts = await factory.createStorageOptions()
        validateOptions(opts)
        return applyDefaults(opts)
      },
      inject: [useClass],
    }
  }
  throw new Error('BymaxStorageModule.forRootAsync requires useFactory, useClass, or useExisting')
}
```

**Acceptance criteria:**

- [ ] `forRootAsync({ useFactory, inject: [ConfigService] })` resolve options de ConfigService
- [ ] `forRootAsync({ useClass: MyOptionsFactory })` instancia a factory and calls `createStorageOptions()`
- [ ] `forRootAsync({ useExisting: ExistingFactory })` reuses existing instance
- [ ] Without `useFactory`, `useClass`, or `useExisting`, throws Error
- [ ] Validation and applyDefaults run in the factory (not in the consumer)
- [ ] StorageService injectable after async bootstrap
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/bymax-storage.module.async.spec.ts
```

**Dependencies:** §2.5, §2.9, §5.1-5.3.

### 5.6 E2E suite with Testcontainers + MinIO

**Objective:** Real end-to-end suite — Jest starts a MinIO container, performs upload/download/list/copy/delete, and validates signatures via real fetch.

**Files to create:**

```
test/e2e/
├── fixtures/
│   ├── minio-container.ts          # Helper to start MinIO via testcontainers
│   └── test-app.module.ts
├── storage-basic.e2e-spec.ts
├── storage-multipart.e2e-spec.ts
├── storage-list.e2e-spec.ts
├── storage-signed-urls.e2e-spec.ts
└── storage-validation.e2e-spec.ts
```

**Skeleton — `minio-container.ts`:**

```typescript
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

export interface MinioHandle {
  container: StartedTestContainer
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/**
 * Spawns a MinIO container, creates the test bucket, and returns connection info.
 * Tests MUST call `await handle.container.stop()` in afterAll.
 */
export async function startMinio(bucket = 'test-bucket'): Promise<MinioHandle> {
  const container = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({
      MINIO_ROOT_USER: 'minioadmin',
      MINIO_ROOT_PASSWORD: 'minioadmin',
    })
    .withExposedPorts(9000)
    .start()

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`

  // Create bucket via raw HTTP PUT (faster than spawning mc).
  const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  })
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  client.destroy()

  return { container, endpoint, accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin', bucket }
}
```

**Skeleton — `storage-basic.e2e-spec.ts`:**

```typescript
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, StorageService } from '../../src/server'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — basic ops', () => {
  let minio: MinioHandle
  let module: TestingModule
  let storage: StorageService

  beforeAll(async () => {
    minio = await startMinio()
    module = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: minio.endpoint,
          region: 'us-east-1',
          bucket: minio.bucket,
          credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: minio.secretAccessKey },
          forcePathStyle: true,
        }),
      ],
    }).compile()
    await module.init()
    storage = module.get(StorageService)
  }, 60_000)

  afterAll(async () => {
    await module.close()
    await minio.container.stop()
  })

  it('should upload, head, download, and delete a small file', async () => {
    const body = Buffer.from('e2e content', 'utf-8')
    const uploaded = await storage.upload({ key: 'e2e/a.txt', body, contentType: 'text/plain' })
    expect(uploaded.multipart).toBe(false)
    expect(uploaded.etag).toBeTruthy()

    const head = await storage.head('e2e/a.txt')
    expect(head.size).toBe(body.byteLength)
    expect(head.contentType).toBe('text/plain')

    const { buffer } = await storage.downloadBuffer({ key: 'e2e/a.txt' })
    expect(buffer.toString('utf-8')).toBe('e2e content')

    await storage.delete('e2e/a.txt')
    await storage.delete('e2e/a.txt')  // idempotent
    expect(await storage.exists('e2e/a.txt')).toBe(false)
  })

  it('should reject path traversal', async () => {
    await expect(storage.upload({ key: '../etc/passwd', body: Buffer.from('x'), contentType: 'text/plain' }))
      .rejects.toMatchObject({ code: 'STORAGE_KEY_INVALID' })
  })

  it('should preserve metadata', async () => {
    await storage.upload({
      key: 'e2e/meta.txt',
      body: Buffer.from('x'),
      contentType: 'text/plain',
      metadata: { author: 'tester' },
    })
    const head = await storage.head('e2e/meta.txt')
    expect(head.metadata['author']).toBe('tester')
  })
})
```

**Skeleton — `storage-multipart.e2e-spec.ts`:**

```typescript
import { Readable } from 'node:stream'

describe('Storage E2E — multipart', () => {
  // ... setup MinIO + storage

  it('should switch to multipart for body >= 5 MB', async () => {
    const size = 6 * 1024 * 1024
    const body = Buffer.alloc(size, 'a')
    const result = await storage.upload({
      key: 'e2e/multipart-6mb.bin',
      body,
      contentType: 'application/octet-stream',
      size,
    })
    expect(result.multipart).toBe(true)
    const head = await storage.head('e2e/multipart-6mb.bin')
    expect(head.size).toBe(size)
  }, 30_000)

  it('should accept Readable stream without declared size', async () => {
    const chunks = Array.from({ length: 6 }, () => Buffer.alloc(1024 * 1024, 'b'))
    const stream = Readable.from(chunks)
    const result = await storage.upload({
      key: 'e2e/stream.bin', body: stream, contentType: 'application/octet-stream',
    })
    expect(result.multipart).toBe(true)
  }, 30_000)

  it('should fire progress events', async () => {
    const events: Array<{ loaded: number }> = []
    const size = 8 * 1024 * 1024
    await storage.upload({
      key: 'e2e/progress.bin',
      body: Buffer.alloc(size, 'c'),
      contentType: 'application/octet-stream',
      size,
      onProgress: (e) => events.push({ loaded: e.loaded }),
    })
    expect(events.length).toBeGreaterThan(0)
    expect(events[events.length - 1]?.loaded).toBe(size)
  }, 30_000)
})
```

**Skeleton — `storage-signed-urls.e2e-spec.ts`:**

```typescript
import { SignedUrlService } from '../../src/server'

describe('Storage E2E — signed URLs', () => {
  // ... setup MinIO + storage + signedUrls

  it('should issue a GET signed URL that fetches the object', async () => {
    await storage.upload({ key: 'e2e/signed-get.txt', body: Buffer.from('hello'), contentType: 'text/plain' })
    const { url } = await signedUrls.getDownloadUrl({ key: 'e2e/signed-get.txt', ttlSeconds: 60 })
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
  })

  it('should issue a PUT signed URL that uploads', async () => {
    const { url, requiredHeaders } = await signedUrls.getUploadUrl({
      key: 'e2e/signed-put.txt', contentType: 'text/plain', ttlSeconds: 60,
    })
    const response = await fetch(url, { method: 'PUT', headers: requiredHeaders, body: 'signed-put-body' })
    expect(response.status).toBe(200)
    const { buffer } = await storage.downloadBuffer({ key: 'e2e/signed-put.txt' })
    expect(buffer.toString()).toBe('signed-put-body')
  })

  it('should reject PUT with wrong Content-Type', async () => {
    const { url } = await signedUrls.getUploadUrl({
      key: 'e2e/signed-put-wrong.txt', contentType: 'text/plain', ttlSeconds: 60,
    })
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: 'x' })
    expect(response.status).toBeGreaterThanOrEqual(400)  // S3 rejects signature mismatch
  })
})
```

**Skeleton — `storage-list.e2e-spec.ts`:**

```typescript
describe('Storage E2E — list + copy + deleteMany', () => {
  // ... setup

  beforeEach(async () => {
    // Seed 5 objects
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        storage.upload({ key: `list-test/${i}.txt`, body: Buffer.from(String(i)), contentType: 'text/plain' }),
      ),
    )
  })

  it('should list with prefix', async () => {
    const result = await storage.list({ prefix: 'list-test/' })
    expect(result.objects.length).toBe(5)
    expect(result.isTruncated).toBe(false)
  })

  it('should paginate with maxKeys', async () => {
    const page1 = await storage.list({ prefix: 'list-test/', maxKeys: 2 })
    expect(page1.objects.length).toBe(2)
    expect(page1.isTruncated).toBe(true)
    expect(page1.nextContinuationToken).toBeTruthy()

    const page2 = await storage.list({ prefix: 'list-test/', maxKeys: 2, continuationToken: page1.nextContinuationToken })
    expect(page2.objects.length).toBe(2)
  })

  it('should copy a key', async () => {
    await storage.upload({ key: 'src.txt', body: Buffer.from('src'), contentType: 'text/plain' })
    await storage.copy({ sourceKey: 'src.txt', destinationKey: 'dst.txt' })
    const { buffer } = await storage.downloadBuffer({ key: 'dst.txt' })
    expect(buffer.toString()).toBe('src')
  })

  it('should deleteMany in batches', async () => {
    const result = await storage.deleteMany(['list-test/0.txt', 'list-test/1.txt', 'list-test/missing.txt'])
    expect(result.deleted.length).toBeGreaterThanOrEqual(2)  // missing may be reported as deleted by S3
  })
})
```

**Skeleton — `storage-validation.e2e-spec.ts`:**

```typescript
describe('Storage E2E — validation pipeline', () => {
  let module: TestingModule
  let storage: StorageService

  beforeAll(async () => {
    const minio = await startMinio()
    module = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: minio.endpoint, region: 'us-east-1', bucket: minio.bucket,
          credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: minio.secretAccessKey },
          forcePathStyle: true,
          validation: { mimeWhitelist: ['image/*'], maxSizeBytes: 1024 },
        }),
      ],
    }).compile()
    storage = module.get(StorageService)
  }, 60_000)

  it('should reject MIME outside whitelist', async () => {
    await expect(storage.upload({ key: 'a.txt', body: Buffer.from('x'), contentType: 'text/plain' }))
      .rejects.toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
  })

  it('should reject size > maxSizeBytes', async () => {
    await expect(storage.upload({
      key: 'a.png', body: Buffer.alloc(2048), contentType: 'image/png', size: 2048,
    })).rejects.toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
  })
})
```

**Acceptance criteria:**

- [ ] Each `*.e2e-spec.ts` creates its own container (isolation) or shares one (single beforeAll). Design decision: **share** within the same spec file, **separate** across spec files (each file is an isolated Jest worker)
- [ ] `pnpm test:e2e` passes on a machine with Docker running
- [ ] `jest.e2e.config.ts` has `testTimeout: 60_000`
- [ ] `afterAll` calls `container.stop()` correctly (no container leaks)
- [ ] CI workflow has step for `docker pull minio/minio:latest` (cache)

**Validation commands:**

```bash
pnpm test:e2e
```

**Dependencies:** §5.1, §5.2, §5.3, §5.5, all outras phases.

**Risks/Notes:**

- Testcontainers has sensitive timing in CI. Add retry in `beforeAll` if the container isn't ready
- The `minio/minio:latest` image changes over time — pin a stable tag (e.g. `RELEASE.2024-01-01T00-00-00Z`) in CI for reproducibility

### 5.7 Mutation testing baseline

**Objective:** Establish a mutation score baseline. Not a per-commit CI gate, but run once at the end of Phase 4 to identify weak tests.

**Command:**

```bash
pnpm mutation:dry-run    # first guarantees config ok
pnpm mutation            # full run, ~15-25 min for this lib
```

**Output expected:** `reports/mutation/mutation.html` + `reports/stryker-incremental.json`.

**Acceptance criteria:**

- [ ] Mutation score ≥ 95% (Stryker break 95)
- [ ] Mutation score ≥ 95% on identified critical paths (key-resolver, validate-options, ttl-clamp, mime-match, idempotency-cache, header-utils)
- [ ] Equivalent mutants documented inline with `// Stryker disable next-line <Mutator>: <reason>` (especially in try/catch that maps AWS errors — some mutants on messages are equivalent)

**Validation commands:**

```bash
pnpm mutation
```

**Dependencies:** All tests previous.

### 5.8 Phase 4 validation

**Final commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm test:e2e && pnpm build && pnpm size && pnpm mutation
```

**Done criteria:**

- [ ] Coverage 100% (release gate via `jest.coverage.config.ts`)
- [ ] Bundle within the budgets (see §6.5)
- [ ] Mutation score ≥ 95% (Stryker break 95)
- [ ] E2E suite passes (all 5 specs)
- [ ] PR `phase-4` aprovado

---

## 6. Phase 5 — Release v0.1.0

> **Phase objective:** Complete documentation, final validation, tagging, and publication on npm with provenance. (The CI workflows were created in Phase 1.)
>
> **Complexity:** LOW — predominantly mechanical (copy + adapt configs from nest-auth, write README based on spec, run release workflow). Residual risk: fine-tuning the bundle budgets once the real `dist/` is measured.

### 6.1 README

**Files to create:**

- `README.md` (~12-18 KB)

**Estrutura (mirrors `nest-auth/README.md`):**

```markdown
<p align="center">badges</p>
<h1 align="center">@bymax-one/nest-storage</h1>

## Overview
## Features
## Subpath Exports
## Quick Start (AWS S3, Cloudflare R2, MinIO dev)
## Configuration (link for spec §4)
## Provider Recipes
## Upload (single, multipart, stream, progress, idempotency)
## Download (stream + buffer)
## Signed URLs (GET, PUT, multipart)
## Validation (MIME, size, custom validators)
## Virus Scanning (IFileScanner hook)
## Lifecycle Operations (advanced — raw S3Client access)
## Error Codes
## Testing
## Contributing
## License
```

**Acceptance criteria:**

- [ ] 4+ complete copy-pasteable usage scenarios (AWS, R2, DO, MinIO local)
- [ ] Badges npm version, CI status, coverage, mutation, scorecard, license
- [ ] Complete table of the 17 error codes with HTTP status
- [ ] Example of `IUploadValidator` (magic-byte check)
- [ ] Example of `IFileScanner` (ClamAV stub)
- [ ] Links for SECURITY.md, CHANGELOG.md, spec, plan

### 6.2 CHANGELOG.md

```markdown
# Changelog

## [0.1.0] - 2026-XX-XX

### Added
- Initial release
- Provider-agnostic S3-compatible storage with single `@aws-sdk/client-s3` engine
- Works with AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, MinIO, Wasabi
- `StorageService` (upload single/multipart/stream, download stream/buffer, head, exists, delete, deleteMany, list, copy, getPublicUrl)
- `SignedUrlService` (presigned GET, PUT, multipart URLs with TTL clamp)
- `IUploadValidator` interface (MIME whitelist with wildcards, size limit, custom validators)
- `IFileScanner` interface (virus scan hook with pre/post modes)
- Provider Recipes for 6 providers
- 17 error codes catalog (`StorageException`)
- `keyPrefix` global for multi-tenant isolation
- Path traversal guard mandatory
- LRU idempotency cache (in-memory, per-instance)
- Server-side encryption (AES256, aws:kms)
- Subpaths: `.` (server), `./shared`
```

### 6.3 SECURITY.md, CLAUDE.md, AGENTS.md

Copy from `../nest-auth/` and adapt the name + scope.

**SECURITY.md** — highlight:
- Path traversal mitigation in `KeyResolverService`
- Signed URL TTL clamping
- Never logging signed URLs
- SSE recommended in production
- Credentials handling guidance

**CLAUDE.md** — adapted to the storage scope (not auth).

**AGENTS.md** — full architecture deep-dive.

### 6.4 CI workflows

> The four workflows are **created in Phase 1** (§2.1), not here — they gate every PR from the first one (the agent-built-lib standard). This step only confirms the suite is green for the release tag and that `release.yml`'s publish trigger is wired.

The workflows live in `.github/workflows/` (adapted from `../nest-auth/.github/workflows/`). The full YAML is specified in **Phase 1, Task 1.6**:

- `ci.yml` — a `verify` job (PR-only `dependency-review`; `typecheck`/`lint`/`test:cov` at the 100% global floor; coverage-artifact upload; a **2-subpath build-integrity loop** over `server`/`shared`; brotli `size`) plus a front-loaded `e2e` job (`needs: verify`, Docker on `ubuntu-latest`, pinned `minio/minio` tag, `pnpm test:e2e`). `passWithNoTests` keeps both jobs green from the first PR; the e2e job auto-gates the Phase 4 specs.
- `codeql.yml` — JS/TS CodeQL (`security-extended`), PR + push + weekly schedule.
- `release.yml` — OIDC Trusted Publishing (NO `NPM_TOKEN`), `npm-publish` environment gate, tag↔version check, `prepublishOnly`, `pnpm publish --provenance` (tag-driven; inert until a `v*.*.*` tag).
- `scorecard.yml` — OpenSSF Scorecard (scheduled + push), `publish_results: true`, `persist-credentials: false`.

**Adaptations:**
- Replace `nest-auth` with `nest-storage` in references; reduce the build-integrity loop from 5 subpaths to the 2 storage subpaths (`server`, `shared`), checking `index.{mjs,cjs,d.ts}`.
- Ensure Docker is available on the runner for E2E (`runs-on: ubuntu-latest` already comes with Docker); pin the MinIO image tag (do not use `:latest`).

### 6.5 Bundle size budgets

**File:** `scripts/check-size.mjs`

```javascript
const BUDGETS = [
  // AWS SDK is large — generous budget considering tsup treeshake
  { name: 'server (NestJS module + AWS SDK externals)', path: 'dist/server/index.mjs', brotli: 30_000 },
  { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 3_500 },
]
```

**Note:** The AWS SDK is a peer dep (externalized in tsup). `dist/server/index.mjs` contains only lib code + types — the final bundle size for the **consumer** is dominated by the AWS SDK it imports separately.

**Acceptance:**

- [ ] `pnpm size` shows `server` < 30 KB brotli, `shared` < 3.5 KB brotli
- [ ] Treeshake confirmed — end consumer bundle only loads the S3 commands it uses

### 6.6 Final mutation testing run

```bash
pnpm mutation
```

- [ ] Mutation score ≥ 95% global (Stryker break 95)
- [ ] Update `docs/mutation_testing_results.md` with timestamp and score

### 6.7 Tag + publish

```bash
# 1. Bump
pnpm version 0.1.0

# 2. Push tag
git push --follow-tags

# 3. release.yml fires → publishes with --provenance
```

**Acceptance:**

- [ ] Tag `v0.1.0` created
- [ ] Workflow `release.yml` green
- [ ] Package available at `https://www.npmjs.com/package/@bymax-one/nest-storage`
- [ ] "Provenance" badge appears on npm
- [ ] README badges populated (npm version, downloads, scorecard, mutation)

**Post-publish smoke test:**

```bash
# In a clean directory:
mkdir /tmp/nest-storage-smoke && cd /tmp/nest-storage-smoke
pnpm init
pnpm add @bymax-one/nest-storage @nestjs/common @nestjs/core @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner reflect-metadata
# Run a small script importing providerRecipes.minio() and listing the module
```

---

## Appendix A — Dependency Graph

```
                  Phase 1 — Foundation + S3 Client
                          │
                          ▼
            ┌─────────────────────────────────────┐
            │  S3ClientProvider                   │ ← §2.8
            │  KeyResolverService                 │ ← §2.7
            │  StorageException + AWS mapper      │ ← §2.6
            │  BymaxStorageModule.forRoot()       │ ← §2.9
            └────────────┬────────────────────────┘
                         │
                         ▼
                  Phase 2 — Upload + Download
                         │
            ┌─────────────────────────────────────┐
            │  IdempotencyCache (LRU + TTL)       │ ← §3.1
            │  stream-utils, upload-strategy      │ ← §3.2, §3.3
            │  header-utils                       │ ← §3.4
            │  StorageService (single + multi)    │ ← §3.5, §3.6
            │  download / downloadBuffer          │ ← §3.7
            └────────────┬────────────────────────┘
                         │
                         ▼
                  Phase 3 — Signed URLs + Validation + Scanner
                         │
            ┌─────────────────────────────────────┐
            │  ttl-clamp utility                  │ ← §4.1
            │  SignedUrlService (GET/PUT/multi)   │ ← §4.2
            │  mime-match utility                 │ ← §4.3
            │  ValidationService                  │ ← §4.4
            │  FileScannerService                 │ ← §4.5
            └────────────┬────────────────────────┘
                         │
                         ▼
                  Phase 4 — Listing + Async + E2E
                         │
            ┌─────────────────────────────────────┐
            │  list + copy + deleteMany           │ ← §5.1, §5.2, §5.3
            │  Provider Recipes (6 providers)     │ ← §5.4
            │  forRootAsync                       │ ← §5.5
            │  E2E suite (Testcontainers+MinIO)   │ ← §5.6
            │  Mutation baseline                  │ ← §5.7
            └────────────┬────────────────────────┘
                         │
                         ▼
                  Phase 5 — Release
```

**Cross-phase dependencies:**

- `StorageException` (§2.6) is used by **all** services in later phases
- `KeyResolverService` (§2.7) is dep of `StorageService` and `SignedUrlService`
- `S3ClientProvider` (§2.8) is dep of `StorageService` and `SignedUrlService`
- `peekFirstBytes` (§3.2) is dep of `ValidationService` (§4.4) when custom validators use `readBytes()`

---

## Appendix B — Complexity Matrix

| Phase | Sub-step | LoC est. | Complexity | Risk |
|---|---|---|---|---|
| 1 | 2.1 Scaffold | ~30 LoC + configs | LOW | Tooling version |
| 1 | 2.2 Shared types + constants | ~150 LoC | LOW | — |
| 1 | 2.3 Interfaces | ~250 LoC | LOW | — |
| 1 | 2.4 DI tokens + defaults | ~80 LoC | LOW | — |
| 1 | 2.5 Validate + applyDefaults | ~150 LoC | MEDIUM | Mutation score baixo se tests superficiais |
| 1 | 2.6 StorageException + AWS mapper | ~100 LoC | MEDIUM | AWS SDK error shape varia por command |
| 1 | 2.7 KeyResolverService | ~80 LoC | HIGH | Security boundary — path traversal must be tight |
| 1 | 2.8 S3ClientProvider | ~70 LoC | MEDIUM | Lifecycle + lazy init without credenciais |
| 1 | 2.9 BymaxStorageModule.forRoot | ~80 LoC | MEDIUM | DI graph correct |
| 1 | 2.10 Tests Phase 1 | ~700 LoC | MEDIUM | Mock S3Client adequadamente |
| 2 | 3.1 IdempotencyCache | ~80 LoC | MEDIUM | LRU eviction sutil |
| 2 | 3.2 stream-utils | ~100 LoC | MEDIUM | Tee of streams is tricky |
| 2 | 3.3 upload-strategy | ~30 LoC | LOW | — |
| 2 | 3.4 header-utils | ~70 LoC | LOW | — |
| 2 | 3.5 StorageService base | ~250 LoC | HIGH | Multiple paths (upload, head, exists, delete) |
| 2 | 3.6 Multipart upload | ~60 LoC additional | HIGH | `@aws-sdk/lib-storage` semantics, abort in erro |
| 2 | 3.7 Download (stream + buffer) | ~70 LoC | MEDIUM | Stream response handling |
| 2 | 3.8 Module + tests Phase 2 | ~900 LoC tests | HIGH | Mock setup complexo |
| 3 | 4.1 ttl-clamp | ~30 LoC | LOW | Security boundary — mutation 100% |
| 3 | 4.2 SignedUrlService | ~180 LoC | MEDIUM | Multipart presigning is 3-step |
| 3 | 4.3 mime-match | ~30 LoC | LOW | Wildcard regex precision |
| 3 | 4.4 ValidationService | ~110 LoC | MEDIUM | Validator with readBytes in stream |
| 3 | 4.5 FileScannerService | ~90 LoC | MEDIUM | Pre/post mode + cleanup in infected |
| 3 | 4.6 Upload pipeline integration | ~80 LoC modification | MEDIUM | Do not break existing paths |
| 3 | 4.8 Tests Phase 3 | ~700 LoC | MEDIUM | — |
| 4 | 5.1 list + pagination | ~70 LoC | MEDIUM | continuationToken correct |
| 4 | 5.2 copy | ~50 LoC | LOW | CopySource formato |
| 4 | 5.3 deleteMany | ~80 LoC | MEDIUM | Chunking 1000-per-call |
| 4 | 5.4 Provider Recipes | ~150 LoC | LOW | Validate endpoints with provider docs |
| 4 | 5.5 forRootAsync | ~100 LoC | MEDIUM | Replicar providers via factories |
| 4 | 5.6 E2E suite (Testcontainers) | ~600 LoC | HIGH | Container lifecycle + timing in CI |
| 4 | 5.7 Mutation baseline | manual | MEDIUM | Equivalentes in try/catch |
| 5 | 6.1-6.7 Docs+CI+release | manual | LOW | — |

**Total estimated LoC (source + tests):** ~5,500 LoC.

**Areas of greater attention in human review:**

1. **§2.7 `KeyResolverService`** — security boundary, any mutation that relaxes the guard is high-impact
2. **§3.5 + §3.6 `StorageService.upload` (multipart)** — error handling sutil
3. **§4.2 `SignedUrlService.getMultipartUploadUrls`** — three steps with cleanup on failure
4. **§5.6 E2E suite** — flakiness in CI

---

## Appendix C — Reference Configs (mirror of nest-auth)

| File | Source to copy (and adapt) |
|---|---|
| `tsconfig.json` | [nest-auth/tsconfig.json](/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/tsconfig.json) |
| `tsconfig.build.json` | nest-auth/tsconfig.build.json |
| `tsconfig.server.json` | nest-auth/tsconfig.server.json |
| `tsconfig.e2e.json` | nest-auth/tsconfig.e2e.json |
| `tsconfig.jest.json` | nest-auth/tsconfig.jest.json |
| `jest.config.ts` | nest-auth/jest.config.ts (adapt moduleNameMapper for 2 subpaths) |
| `jest.coverage.config.ts` | nest-auth/jest.coverage.config.ts (threshold 100% release) |
| `jest.e2e.config.ts` | nest-auth/jest.e2e.config.ts (testTimeout 60s for Testcontainers) |
| `jest.stryker.config.ts` | nest-auth/jest.stryker.config.ts |
| `stryker.config.json` | nest-auth/stryker.config.json (thresholds high 100, low 95, break 95) |
| `eslint.config.mjs` | nest-auth/eslint.config.mjs (remove regras crypto/oauth) |
| `.prettierrc` | nest-auth/.prettierrc |
| `.gitignore` | nest-auth/.gitignore |
| `scripts/check-size.mjs` | nest-auth/scripts/check-size.mjs (adapt BUDGETS for 2 entries; server 30 KB, shared 3.5 KB brotli) |
| `.github/workflows/*.yml` | nest-auth/.github/workflows/*.yml (replace name do repo; add Docker step for E2E) |

---

## Appendix D — Glossary and term mapping

| Term | Meaning in this plan |
|---|---|
| **Phase** | Cohesive block of functionality that delivers a vertical slice of the lib |
| **Sub-step** | §N.M within a phase — atomic; becomes 1+ task in `docs/tasks/phase-NN-*.md` |
| **Acceptance criteria** | Binary (yes/no) checklist for closing the sub-step |
| **Validation command** | Exact command to run to validate acceptance |
| **Done criteria** | Aggregate set of gates to close the entire phase |
| **AAA pattern** | Arrange/Act/Assert — convention in tests |
| **TDD red-green-refactor** | Write failing test → implement minimal → refactor |
| **Mutation score** | % of mutations detected by tests (Stryker) |
| **Coverage gate** | Minimum coverage limit per file / global |
| **Provider Recipe** | Factory that preconfigures `BymaxStorageModuleOptions` for a specific provider (AWS, R2, etc.) |
| **Path traversal guard** | Block `..` in keys to prevent escaping the logical prefix |
| **Multipart upload** | S3 strategy for files > 5 MB — splits into parallel parts with abort on error |
| **Signed URL** | URL with `X-Amz-Signature` that allows temporary access without credentials |
| **TTL clamp** | Silent maximum cap applied to TTLs above the allowed limit |
| **Idempotency cache** | LRU cache that deduplicates uploads based on `idempotencyKey` |
| **SSE-S3 / SSE-KMS** | Server-Side Encryption — key managed by the provider (S3) or KMS |
| **Testcontainers** | Library that spins up Docker containers for e2e tests (`@testcontainers/minio`) |
| **`@aws-sdk/lib-storage`** | AWS wrapper for multipart uploads — encapsulates Create+UploadPart+Complete |
| **`@aws-sdk/s3-request-presigner`** | AWS package to generate signed URLs |

---

> **Next phase of this document:** generation of the per-phase task files in [`docs/tasks/`](./tasks/) (Layer 3 — tasks executable by AI agents) using this plan as input and the `/bymax-workflow:phase-tasks` standard.
