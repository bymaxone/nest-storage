# @bymax-one/nest-storage — Agent Quick Reference

This file gives AI coding assistants a concise orientation to the repository. `AGENTS.md` carries the code-review rules — the shared Bymax block plus the ones specific to this library. For a full architecture deep-dive, read `docs/architecture.md`.

---

## Repository at a Glance

| Item | Value |
|---|---|
| **Package** | `@bymax-one/nest-storage` |
| **npm** | `https://www.npmjs.com/package/@bymax-one/nest-storage` |
| **Repo** | `https://github.com/bymaxone/nest-storage` |
| **Runtime deps** | **zero** — `"dependencies": {}` |
| **Peer deps** | `@nestjs/common ^11`, `@nestjs/core ^11`, `@aws-sdk/client-s3 ^3.700.0`, `@aws-sdk/lib-storage ^3.700.0`, `@aws-sdk/s3-request-presigner ^3.700.0`, `reflect-metadata ^0.2` |
| **Stack** | TypeScript 5, NestJS 11, AWS SDK v3 |
| **Node** | ≥ 24 |
| **Test runner** | Jest 30 (ts-jest) |
| **Bundler** | tsup |
| **Subpath exports** | `.` (server) · `./shared` |

---

## Critical Rules

Follow these unconditionally. Violating any of them is a HIGH finding in code review.

### 1 — S3 client lifecycle

The `S3Client` instance is a **singleton** created in `onModuleInit` and destroyed in `onApplicationShutdown` (via `s3Client.destroy()`). Never instantiate a new `S3Client` per request or per operation. Never call `destroy()` before shutdown.

### 2 — Signed URLs are secrets

A presigned URL is a temporary credential. **Never log it**, never include it in `StorageException.details`, and never return it in a response that is itself logged. Treat it the same way you would treat an access key.

### 3 — MIME validation is header-only

`ValidationService.checkMime()` validates the `Content-Type` header supplied by the caller. It cannot detect a file whose true type differs from its declared type. Always plug an `IUploadValidator` with a `readBytes(n)` magic-byte check for untrusted upload sources.

### 4 — Path-traversal guard is mandatory and non-negotiable

`KeyResolverService` blocks `..`, leading `/`, and empty-after-normalize keys. It must be the first thing called before any key reaches the AWS SDK. Never bypass it; never relax its guards.

### 5 — Idempotency cache is in-memory and per-instance

The LRU idempotency cache is not shared across process replicas. Two pods can each accept the same `idempotencyKey` simultaneously. This is a documented v0.1 limitation; a cross-instance `IIdempotencyStore` is planned for v0.2.

### 6 — Non-AWS providers MUST opt out of integrity checksums

`@aws-sdk/client-s3` ≥ 3.729.0 sends `x-amz-checksum-crc32` headers by default. R2, B2, MinIO, DigitalOcean Spaces, and Wasabi **reject** these headers. Every non-AWS provider recipe sets `requestChecksumCalculation`/`responseChecksumValidation` to `'WHEN_REQUIRED'`. If you touch a provider recipe or add a new one, this opt-out is not optional.

### 7 — `publicRead` via ACL fails on modern AWS S3 and is a no-op on R2

Do not route users to `publicRead: true` for general public access. Modern AWS S3 buckets return HTTP 400 `AccessControlListNotSupported`. R2 ignores ACLs. Steer to bucket policies, CDN, or signed URLs instead.

### 8 — Use `maxAttempts`, never `maxRetries` or `signatureVersion`

AWS SDK v3 is SigV4-only. There is no `signatureVersion` option. The retry knob is `maxAttempts` (default `3`), not `maxRetries` (SDK v2). Never introduce either removed name.

### 9 — Internal services are internal

`KeyResolverService`, `ValidationService`, `FileScannerService`, and `S3ClientProvider` are **not** exported from the package barrel. Only `StorageService`, `SignedUrlService`, `providerRecipes`, the DI tokens, the public types, `StorageException`, `NoOpUploadValidator`, and `NoOpFileScanner` are public.

---

## Subpath Exports

| Subpath | Entry | Contents |
|---|---|---|
| `.` | `dist/server/index.{mjs,cjs,d.ts}` | Module, services, provider recipes, DI tokens, interfaces, errors |
| `./shared` | `dist/shared/index.{mjs,cjs,d.ts}` | Framework-free types, `STORAGE_ERROR_CODES`, `StorageErrorCode` |

---

## Common Commands

```bash
pnpm typecheck           # TypeScript strict check (server + shared)
pnpm lint                # ESLint (0 warnings expected)
pnpm test:cov            # Unit tests with 100% line/branch coverage gate
pnpm build               # tsup — produces dist/ with ESM + CJS + .d.ts for both subpaths
pnpm size                # Brotli bundle budget check (server < 30 KB, shared < 3.5 KB)
pnpm test:e2e            # E2E against real MinIO (Testcontainers — needs Docker)
pnpm mutation            # Stryker mutation gate (break 95 — run manually pre-release)
pnpm prepublishOnly      # Full release gate: clean + typecheck + lint + test:cov:all + build
```

---

## Architecture (Summary)

```
BymaxStorageModule (forRoot / forRootAsync)
├── S3ClientProvider          (singleton S3Client — internal)
├── KeyResolverService        (path-traversal guard + keyPrefix — internal)
├── ValidationService         (MIME wildcard + size + IUploadValidator chain — internal)
├── FileScannerService        (IFileScanner pre/post-upload — internal)
├── StorageService            (public — upload / download / head / list / copy / delete)
└── SignedUrlService          (public — presigned GET / PUT / multipart)
```

Full diagram and component descriptions: `docs/architecture.md`.

---

## Context7 Guidelines

Use context7 (`mcp__context7__resolve-library-id` + `mcp__context7__query-docs`) to verify **any** library API before using it in code. Never write AWS SDK option names, NestJS DI patterns, Testcontainers APIs, or MinIO APIs from memory.

| Library | When to query |
|---|---|
| `NESTJS` | Dynamic modules, DI tokens, lifecycle hooks, interceptors |
| `TYPESCRIPT` | Complex generics, utility types, `exactOptionalPropertyTypes` edge cases |
| `TESTING` | Jest matchers, `@nestjs/testing` `TestingModule`, supertest |
| `AWS_SDK` | Any `S3Client` config field, `Upload`, `getSignedUrl`, presigner options |
| `MINIO` | `MinioContainer` API in Testcontainers |
| `TESTCONTAINERS` | Container lifecycle, network, `GenericContainer` |

---

## Quality Gates (all must pass before any commit)

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors, 0 warnings (no `eslint-disable` or `@ts-ignore`)
- `pnpm test:cov` — all tests pass, 100% line/branch coverage on every implemented file
- `pnpm build` — `dist/server/index.{mjs,cjs,d.ts}` and `dist/shared/index.{mjs,cjs,d.ts}` present
- `pnpm size` — server < 30 KB brotli, shared < 3.5 KB brotli
- `/bymax-quality:code-review` — 0 CRITICAL, 0 HIGH
- `/security-review` — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW

---

## Code Standards

- **TypeScript strict** — `"strict": true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; zero `any`
- **JSDoc** on every export: `@param`, `@returns`, `@throws`, `@example` where applicable
- **`@fileoverview` + `@layer`** header on every source file
- **English-only, timeless comments** — no phase/task references in committed source or workflow configs
- **Functions ≤ 50 lines, files ≤ 800 lines** — split by responsibility when exceeded
- **Conventional Commits** — `feat/fix/chore/docs/refactor/test/ci(storage): …`; **no** `Co-Authored-By` trailer
- **`git switch -c`** to create branches — never `git checkout -b` (hook-blocked)
- **No `.gitkeep`** / empty-directory placeholders
