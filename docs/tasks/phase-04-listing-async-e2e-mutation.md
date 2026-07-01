# Phase 4 — Listing + Pagination + forRootAsync + E2E + Mutation

> **Status**: 🔄 In Progress · **Progress**: 3 / 12 tasks · **Last updated**: 2026-07-01
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) §5
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §10, §4.3, §4.4

---

## Context

This phase closes the public API surface. It adds the three remaining `StorageService` methods — `list()` (paginated listing with `commonPrefixes`), `copy()` (server-side copy), and `deleteMany()` (batch delete chunked at the S3 hard limit of 1000 keys per request) — then ships the consumer-facing ergonomics: a set of preconfigured **Provider Recipes** for the six S3-compatible providers we support (AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, MinIO, Wasabi) and `BymaxStorageModule.forRootAsync()` for `ConfigService`-driven bootstrap.

It also stands up the real **end-to-end** suite: Jest spins up a MinIO container via Testcontainers and exercises upload (single + multipart) → list → head → download → delete, real signed `GET`/`PUT` via `fetch`, and the validation pipeline against a live S3-compatible server. The phase finishes with a **mutation-testing baseline** (Stryker, break 95) and the **release gate** (`test:cov:all` at 100% global). The single biggest provider-compatibility trap lives here: every **non-AWS** provider must opt out of the SDK's default integrity checksums (`requestChecksumCalculation`/`responseChecksumValidation` = `'WHEN_REQUIRED'`); AWS keeps the SDK default (`'WHEN_SUPPORTED'`).

---

## Rules-of-phase

1. **TDD — test-first.** For every implementation file (or method added to `storage.service.ts`), write the co-located `*.spec.ts` seed first, watch it fail, then implement to green. The implementation tasks drive each file to **100% line/branch coverage**; the dedicated test task (4.7) hardens those specs with the full edge-case matrix, and the e2e tasks (4.8, 4.9, 4.11) prove behaviour against live MinIO.
2. **Coverage floor = 100% line/branch on every file implemented in this phase** (the Bymax library floor — not 80%, not 95%). The phase release gate `test:cov:all` enforces **100% global** via `jest.coverage.config.ts`.
3. **Mutation testing baseline this phase.** Stryker thresholds **high 100 / low 95 / break 95**; establish the baseline and document any provably-equivalent mutant inline with `// Stryker disable next-line <Mutator>: <reason>` (notably the AWS-error message strings in `try/catch` blocks).
4. **English-only and timeless comments.** No `Phase N` / `Task X` / roadmap-stage references inside any source, JSDoc (`@param`/`@returns`/`@throws`), inline note, or TODO. Explain *what* and *why*, never *which roadmap stage*.
5. **`@fileoverview` + `@layer` header on every new file** (config recipes → `@layer server/config`, services → `@layer server/services`, e2e fixtures → `@layer test/e2e`).
6. **Clean Code sizing.** Functions ≤ 50 lines; files ≤ 800 lines (200–400 typical). One responsibility per file/function.
7. **Official-docs-first (context7) before any AWS SDK API.** Re-verify `@aws-sdk/client-s3` (`ListObjectsV2Command`, `CopyObjectCommand`, `DeleteObjectsCommand`, `paginateListObjectsV2`, `CreateBucketCommand`) and `@aws-sdk/lib-storage` against the current docs before coding.
8. **`maxAttempts`, never `maxRetries`; no `signatureVersion`.** AWS SDK v3 is **SigV4-only** — there is no `signatureVersion` option anywhere, and client retry configuration uses **`maxAttempts`** (default `3`), never the v2 name `maxRetries`.
9. **Non-AWS provider checksum opt-out (the #1 provider-compat trap).** Every **non-AWS** Provider Recipe (DigitalOcean Spaces, Cloudflare R2, Backblaze B2, MinIO, Wasabi) MUST set `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'`; the **AWS S3** recipe leaves both unset (SDK default `'WHEN_SUPPORTED'`).
10. **Recipe specifics.** Backblaze B2 uses `forcePathStyle: false` (B2 supports both addressing styles; virtual-hosted matches `publicBaseUrl`). Cloudflare R2's `publicBaseUrl` **must** be the `customDomain` — the `*.r2.cloudflarestorage.com` host is the S3 API endpoint and does **not** serve public object reads, so there is no working default. MinIO and dev/self-hosted setups use `forcePathStyle: true`.
11. **Pagination semantics.** `list()` is a single-page method: it caps `maxKeys` at **1000** (S3 hard limit), threads `ContinuationToken` in / `NextContinuationToken` out, and reports `IsTruncated`. The `paginateListObjectsV2` paginator is the idiomatic full-iteration helper — reference it in tests/docs, but the public `list()` returns one page so callers control paging.
12. **Batch delete semantics.** `deleteMany()` chunks keys at **≤ 1000 per `DeleteObjectsCommand`**, uses `Quiet: false` to receive both successes and per-key errors, and returns `{ deleted, failed }` with the global `keyPrefix` stripped from every returned key.
13. **`forRootAsync()` ships in this phase** and must replicate **all** providers/exports of `forRoot()`, running `validateOptions` + `applyDefaults` inside the async factory (not in the consumer). Absence of `useFactory`/`useClass`/`useExisting` throws.
14. **E2E uses Testcontainers + MinIO.** Each `*.e2e-spec.ts` boots its own container (Jest-worker isolation), shares it within the file via a single `beforeAll`, and stops it in `afterAll` (no container leaks). Pin a **stable** MinIO image tag (e.g. `RELEASE.2024-01-01T00-00-00Z`) for CI reproducibility. **The CI workflows already exist (created earlier) — do NOT create or modify them here.**
15. **Conventional Commits**, one per task, **with NO `Co-Authored-By` (or any AI-attribution) trailer**.
16. **Never create `.gitkeep` / `.keep` or empty-directory placeholders** — directories emerge from the first real file written into them.

---

## Reference docs

- [`../technical_specification.md`](../technical_specification.md) — § 10 "Listing and Pagination" (§ 10.1 `ListOptions` / `ListResult` shapes), § 4.3 "Provider Recipes" (the six provider configs + the non-AWS checksum opt-out), § 4.4 "`forRootAsync` example" (the canonical `ConfigService` factory).
- [`../development_plan.md`](../development_plan.md) — § 5.1 (`list()`), § 5.2 (`copy()`), § 5.3 (`deleteMany()`), § 5.4 (Provider Recipes — the corrected skeleton with checksum opt-out), § 5.5 (`forRootAsync()`), § 5.6 (E2E suite + `minio-container.ts` fixture), § 5.7 (mutation baseline), § 5.8 (phase validation). Treat the skeletons as guidance; apply the corrections in Rules-of-phase 8–14 over any stale skeleton text.
- `/bymax-workflow:standards` skill — universal TypeScript coding rules (type/lint discipline, JSDoc on exports, layered architecture, typed errors).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 4.1 | `StorageService.list()` — paginated listing + `commonPrefixes` | ✅ Done | P0 | M | 2.5 |
| 4.2 | `StorageService.copy()` — server-side copy | ✅ Done | P1 | S | 2.5 |
| 4.3 | `StorageService.deleteMany()` — batch delete (chunked ≤ 1000) | ✅ Done | P0 | M | 2.5 |
| 4.4 | Provider Recipes (AWS, DO Spaces, R2, B2, MinIO, Wasabi) | 📋 ToDo | P1 | M | 1.9 |
| 4.5 | Barrel — export `providerRecipes` | 📋 ToDo | P1 | S | 4.1, 4.2, 4.3, 4.4 |
| 4.6 | `BymaxStorageModule.forRootAsync()` | 📋 ToDo | P0 | M | 1.15, 2.10, 3.7 |
| 4.7 | Unit tests — list / copy / deleteMany / recipes / forRootAsync | 📋 ToDo | P0 | L | 4.1, 4.2, 4.3, 4.4, 4.6 |
| 4.8 | E2E fixtures — MinIO via Testcontainers | 📋 ToDo | P0 | S | 4.6 |
| 4.9 | E2E specs against MinIO (basic / multipart / signed / list / validation) | 📋 ToDo | P0 | L | 4.8 |
| 4.10 | Mutation testing baseline (Stryker) | 📋 ToDo | P1 | S | 4.7, 4.9 |
| 4.11 | `forRootAsync` E2E async-config spec | 📋 ToDo | P1 | S | 4.6, 4.8 |
| 4.12 | Phase validation + release gate (`test:cov:all` 100%) | 📋 ToDo | P0 | M | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11 |

---

## Tasks

### Task 4.1 — `StorageService.list()` — paginated listing + `commonPrefixes`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.5

#### Description

Add `list(options: ListOptions): Promise<ListResult>` to `StorageService` using `ListObjectsV2Command`. It is a single-page method: it applies the global `keyPrefix` to the caller's `prefix`, caps `maxKeys` at the S3 hard limit of 1000, threads `ContinuationToken` in / `NextContinuationToken` out, aggregates subprefixes into `commonPrefixes` when a `delimiter` is supplied, and strips the global `keyPrefix` from every returned key.

#### Acceptance criteria

- [x] `list({ prefix: 'avatars/' })` returns only objects whose key matches the (prefixed) filter.
- [x] `list({ delimiter: '/' })` returns `commonPrefixes` for the simulated subdirectories.
- [x] `list({ maxKeys: 50 })` returns at most 50; `maxKeys: 5000` is clamped to 1000.
- [x] `list({ continuationToken })` returns the next page; `nextContinuationToken` is surfaced from `NextContinuationToken`.
- [x] Returned `objects[].key` and `commonPrefixes[]` have the global `keyPrefix` removed (via `stripPrefix`).
- [x] `isTruncated: true` when there are more results.
- [x] AWS failures pass through `mapAwsError`; the method carries `@fileoverview`/`@layer server/services` (file-level) and is ≤ 50 lines.
- [x] Co-located seed spec drives the new branch to 100% line/branch; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/services/storage.service.ts` (add `list()`)
- `src/server/services/storage.service.list.spec.ts` (TDD seed; the exhaustive matrix is owned by Task 4.7)

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — a production-grade NestJS storage library over an
S3-compatible API (AWS SDK v3, SigV4-only), published to npm. Strict TypeScript, a 100%
line/branch coverage floor on every file, and Stryker mutation testing (break 95).

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.1 of 12

PRECONDITIONS
- StorageService base exists (assertConfigured, resolveBucket, head, exists, getPublicUrl) plus
  KeyResolverService (normalize / getPrefix / stripPrefix), S3ClientProvider (lazy client),
  and mapAwsError.
- The ListOptions / ListResult interfaces are already defined in src/server/interfaces.

REQUIRED READING (only these — do not load whole files):
- `docs/technical_specification.md` § 10.1 (ListOptions / ListResult shapes).
- `docs/development_plan.md` § 5.1 (the list() skeleton + acceptance criteria).

BEFORE CODING: verify `ListObjectsV2Command` (and the `paginateListObjectsV2` paginator) from
`@aws-sdk/client-s3` against the current docs via context7. Confirm the response fields are
`Contents`, `CommonPrefixes`, `IsTruncated`, `NextContinuationToken`.

TASK
Add the single-page `list()` method to StorageService, test-first.

DELIVERABLES
1. `storage.service.list.spec.ts` (TDD seed): prefix filter, delimiter → commonPrefixes, maxKeys
   clamp to 1000, continuationToken paging, stripPrefix on returned keys, isTruncated propagation.
   Mock the S3 client `send`.
2. `storage.service.ts` — `async list(options: ListOptions): Promise<ListResult>`:
   - `this.assertConfigured()`; resolve the bucket; `const maxKeys = Math.min(options.maxKeys ?? 1000, 1000)`.
   - `fullPrefix = options.prefix ? keyResolver.normalize(options.prefix) : keyResolver.getPrefix()`.
   - Send `ListObjectsV2Command` with Bucket / Prefix / MaxKeys / ContinuationToken / Delimiter.
   - Map `Contents` → objects (key via stripPrefix, size/etag/lastModified/storageClass with safe
     defaults), `CommonPrefixes` → stripped prefixes (filter empties), pass through `IsTruncated`
     and `NextContinuationToken`.
   - Wrap in try/catch → `throw mapAwsError(err, { bucket, prefix: fullPrefix, op: 'list' })`.

Constraints:
- Method ≤ 50 lines; English-only, timeless comments (no roadmap/phase/task references).
- maxKeys is the S3 hard cap (1000) — never raise it. Do not create any placeholder/`.gitkeep` files.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/services/storage.service.list.spec.ts` — expected: green, 100% line/branch on the new path.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.1 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add StorageService.list paginated (4.1)` — NO Co-Authored-By trailer.
````

---

### Task 4.2 — `StorageService.copy()` — server-side copy

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 2.5

#### Description

Add `copy()` to `StorageService` using `CopyObjectCommand`. It performs a server-side copy (no bytes through the app), supports same-bucket and cross-bucket copies, builds the canonical `CopySource` (`/{bucket}/{key}`), applies the public-read ACL when requested, and defaults the cache-control to the configured value with `MetadataDirective: 'COPY'`.

#### Acceptance criteria

- [x] `copy({ sourceKey, destinationKey })` calls `CopyObjectCommand` with `CopySource` in the form `/{bucket}/{key}`.
- [x] Same-bucket copy works when `sourceBucket`/`destinationBucket` are omitted (both resolve to the default bucket).
- [x] Cross-bucket copy works when both buckets are provided.
- [x] `publicRead: true` applies the public-read ACL (via `buildACL`); `cacheControl` falls back to the configured default.
- [x] Returns `{ etag }` sourced from `CopyObjectResult.ETag`; AWS failures pass through `mapAwsError`.
- [x] Method ≤ 50 lines; English-only, timeless comments; `pnpm typecheck` passes.
- [x] Co-located seed spec drives the new path to 100% line/branch.

#### Files to create / modify

- `src/server/services/storage.service.ts` (add `copy()`)
- `src/server/services/storage.service.copy.spec.ts` (TDD seed; the full matrix is owned by Task 4.7)

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.2 of 12

PRECONDITIONS
- StorageService base, KeyResolverService (normalize), S3ClientProvider, `buildACL`
  (src/server/utils/header-utils.ts), and mapAwsError all exist.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.2 (the copy() skeleton + acceptance criteria).

BEFORE CODING: verify `CopyObjectCommand` from `@aws-sdk/client-s3` via context7 — confirm
`CopySource` is the `/{bucket}/{key}` form and the response field is `CopyObjectResult.ETag`.

TASK
Add the `copy()` method to StorageService, test-first.

DELIVERABLES
1. `storage.service.copy.spec.ts` (TDD seed): same-bucket, cross-bucket, ACL on publicRead,
   CopySource format assertion, error mapping. Mock the S3 client `send`.
2. `storage.service.ts` — `async copy(options): Promise<{ etag: string }>`:
   - `this.assertConfigured()`; normalize source/dest keys; resolve source/dest buckets.
   - Send `CopyObjectCommand` with Bucket=destBucket, Key=destKey, CopySource=`/${sourceBucket}/${sourceKey}`,
     CacheControl=`options.cacheControl ?? this.options.defaultCacheControl`,
     ACL=`buildACL(options.publicRead, this.options.defaultPublicRead)`, MetadataDirective='COPY'.
   - Return `{ etag: response.CopyObjectResult?.ETag ?? '' }`.
   - try/catch → `throw mapAwsError(err, { sourceKey, destKey, op: 'copy' })`.

Constraints:
- Method ≤ 50 lines; English-only, timeless comments. No `.gitkeep`/placeholder files.

Verification:
- `pnpm typecheck` — clean.
- `pnpm test src/server/services/storage.service.copy.spec.ts` — green, 100% line/branch on the new path.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.2 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add StorageService.copy (4.2)` — NO Co-Authored-By trailer.
````

---

### Task 4.3 — `StorageService.deleteMany()` — batch delete (chunked ≤ 1000)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.5

#### Description

Add `deleteMany(keys, options?)` to `StorageService` using `DeleteObjectsCommand`. S3 accepts at most 1000 keys per request, so the method chunks the input at 1000, uses `Quiet: false` to receive both successes and per-key failures, aggregates results across chunks, and returns `{ deleted, failed }` with the global `keyPrefix` stripped from every returned key. An empty input short-circuits without calling S3, and a whole-chunk failure marks every key in that chunk as failed.

#### Acceptance criteria

- [x] `deleteMany([])` returns `{ deleted: [], failed: [] }` without calling S3.
- [x] `deleteMany([k1, k2])` calls `DeleteObjectsCommand` with `Quiet: false`.
- [x] More than 1000 keys produces multiple calls (chunks of 1000).
- [x] Per-key failures are grouped into `failed` with a readable `error` (`Code: Message`); successes land in `deleted`.
- [x] A whole-chunk send failure marks every key in that chunk as failed with the error message.
- [x] Returned keys have the global `keyPrefix` removed (via `stripPrefix`).
- [x] Method ≤ 50 lines; English-only, timeless comments; `pnpm typecheck` passes; seed spec at 100% line/branch on the new path.

#### Files to create / modify

- `src/server/services/storage.service.ts` (add `deleteMany()`)
- `src/server/services/storage.service.delete-many.spec.ts` (TDD seed; the full matrix is owned by Task 4.7)

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.3 of 12

PRECONDITIONS
- StorageService base, KeyResolverService (normalize / stripPrefix), S3ClientProvider exist.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.3 (the deleteMany() skeleton + acceptance criteria).

BEFORE CODING: verify `DeleteObjectsCommand` from `@aws-sdk/client-s3` via context7 — confirm the
1000-key-per-request limit, the `Delete.Objects[].Key` request shape, `Delete.Quiet`, and the
`Deleted` / `Errors` response arrays.

TASK
Add the chunked `deleteMany()` method to StorageService, test-first.

DELIVERABLES
1. `storage.service.delete-many.spec.ts` (TDD seed): empty-array no-op (assert no send),
   two-key success, mixed success+failure, >1000 keys → two chunked sends (assert send call count),
   whole-batch send failure marks all chunk keys failed. Mock the S3 client `send`.
2. `storage.service.ts` — `async deleteMany(keys, options?): Promise<{ deleted: string[]; failed: Array<{ key: string; error: string }> }>`:
   - `this.assertConfigured()`; if `keys.length === 0` return `{ deleted: [], failed: [] }`.
   - Resolve bucket; normalize keys; loop in chunks of `CHUNK = 1000`.
   - Per chunk: send `DeleteObjectsCommand` with `Delete: { Objects: chunk.map((k) => ({ Key: k })), Quiet: false }`.
     Push `Deleted[].Key` (stripped) to `deleted`; push `Errors[]` (stripped key + `Code: Message`) to `failed`.
   - On a chunk send error, push every chunk key (stripped) to `failed` with `(err as Error).message`.

Constraints:
- Method ≤ 50 lines; English-only, timeless comments. The 1000 chunk size is the S3 hard limit.
- No `.gitkeep`/placeholder files.

Verification:
- `pnpm typecheck` — clean.
- `pnpm test src/server/services/storage.service.delete-many.spec.ts` — green, 100% line/branch on the new path.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.3 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add StorageService.deleteMany batched (4.3)` — NO Co-Authored-By trailer.
````

---

### Task 4.4 — Provider Recipes (AWS, DO Spaces, R2, B2, MinIO, Wasabi)

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.9

#### Description

Create `providerRecipes` — a frozen object of six strongly-typed factories that each return a ready-to-spread `BymaxStorageModuleOptions` for one S3-compatible provider. Each factory is a pure reference: the same input deep-equals the same output. The decisive correctness detail is the **non-AWS checksum opt-out** — every provider except AWS sets `requestChecksumCalculation`/`responseChecksumValidation` to `'WHEN_REQUIRED'`.

#### Acceptance criteria

- [ ] `awsS3({ region: 'us-east-1', bucket, ... })` → endpoint `https://s3.us-east-1.amazonaws.com`, `forcePathStyle: false`, `publicBaseUrl: https://${bucket}.s3.us-east-1.amazonaws.com`, `serverSideEncryption: 'AES256'`, and **no** checksum overrides (SDK default `'WHEN_SUPPORTED'`).
- [ ] `digitalOceanSpaces({ region: 'nyc3', ... })` → endpoint `https://nyc3.digitaloceanspaces.com`, a populated `cdnBaseUrl`, `defaultPublicRead: true`.
- [ ] `cloudflareR2({ accountId: 'abc', ... })` → `region: 'auto'`; `cloudflareR2({ ..., customDomain })` sets `publicBaseUrl = customDomain` (REQUIRED — no working default for the `*.r2.cloudflarestorage.com` host).
- [ ] `backblazeB2({ endpointHost: 's3.us-west-002.backblazeb2.com', ... })` → `forcePathStyle: false`.
- [ ] `minio({ endpoint: 'http://localhost:9000', ... })` → `forcePathStyle: true`, `region` default `'us-east-1'`.
- [ ] `wasabi({ region: 'us-east-1', ... })` → endpoint `https://s3.us-east-1.wasabisys.com`.
- [ ] **Every non-AWS recipe** sets `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'`.
- [ ] `sessionToken` is forwarded into `credentials` only when provided (AWS, DO, Wasabi inputs).
- [ ] Each recipe is deterministic (same input → deep-equal output); object exported `as const` with a JSDoc `@example` showing spread + override; 100% line/branch coverage; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/config/provider-recipes.ts`
- `src/server/config/provider-recipes.spec.ts` (TDD seed; the per-recipe matrix is owned by Task 4.7)

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.4 of 12

PRECONDITIONS
- The BymaxStorageModuleOptions interface (incl. requestChecksumCalculation /
  responseChecksumValidation / serverSideEncryption / cdnBaseUrl / publicBaseUrl / defaultPublicRead)
  exists in src/server/interfaces.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 4.3 (Provider Recipes — the six provider configs).
- `docs/development_plan.md` § 5.4 (the corrected recipe skeleton with the non-AWS checksum opt-out).

TASK
Create the `providerRecipes` factory object (pure, deterministic), test-first.

DELIVERABLES
1. `provider-recipes.spec.ts` (TDD seed): one assertion block per recipe verifying
   endpoint / region / forcePathStyle / publicBaseUrl, plus R2 customDomain → publicBaseUrl,
   DO cdnBaseUrl populated, and the non-AWS checksum opt-out present on all five non-AWS recipes
   (and ABSENT on awsS3). Assert determinism (call twice → toEqual).
2. `provider-recipes.ts`:
   - `@fileoverview` + `@layer server/config` header. Define typed inputs (BaseInput, R2Input with
     accountId+customDomain, B2Input with endpointHost, MinIOInput with optional region).
   - `export const providerRecipes = { awsS3, digitalOceanSpaces, cloudflareR2, backblazeB2, minio, wasabi } as const`.
   - awsS3: endpoint `https://s3.${region}.amazonaws.com`, forcePathStyle:false,
     publicBaseUrl `https://${bucket}.s3.${region}.amazonaws.com`, serverSideEncryption:'AES256',
     NO checksum overrides.
   - digitalOceanSpaces: endpoint `https://${region}.digitaloceanspaces.com`, forcePathStyle:false,
     publicBaseUrl + cdnBaseUrl (`...cdn.digitaloceanspaces.com`), defaultPublicRead:true, checksum opt-out.
   - cloudflareR2: endpoint `https://${accountId}.r2.cloudflarestorage.com`, region:'auto',
     forcePathStyle:false, publicBaseUrl = input.customDomain (REQUIRED, no default), checksum opt-out.
   - backblazeB2: endpoint `https://${endpointHost}`, forcePathStyle:false (B2 supports both styles),
     publicBaseUrl `https://${bucket}.${endpointHost}`, checksum opt-out.
   - minio: endpoint as given, region ?? 'us-east-1', forcePathStyle:true,
     publicBaseUrl `${endpoint trimmed}/${bucket}`, checksum opt-out.
   - wasabi: endpoint `https://s3.${region}.wasabisys.com`, forcePathStyle:false,
     publicBaseUrl `https://${bucket}.s3.${region}.wasabisys.com`, checksum opt-out.
   - Forward sessionToken into credentials only when provided. JSDoc `@example` shows spread + override
     (e.g. `{ ...providerRecipes.minio({...}), keyPrefix: 'tenant-x/' }`).

Constraints:
- Each factory is a pure function ≤ 50 lines; English-only, timeless comments (no `Phase`/`Task` refs).
- maxAttempts is the only retry knob; never emit `signatureVersion` or `maxRetries`.
- No `.gitkeep`/placeholder files.

Verification:
- `pnpm typecheck` — clean.
- `pnpm test src/server/config/provider-recipes.spec.ts` — green, 100% line/branch.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.4 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add Provider Recipes for six providers (4.4)` — NO Co-Authored-By trailer.
````

---

### Task 4.5 — Barrel — export `providerRecipes`

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 4.1, 4.2, 4.3, 4.4

#### Description

Expose `providerRecipes` from the server barrel and confirm the public type surface. The `list`/`copy`/`deleteMany` methods are already part of the exported `StorageService`; this task adds the recipe export and verifies the built `.d.ts` carries the three new method signatures.

#### Acceptance criteria

- [ ] `src/server/index.ts` re-exports `providerRecipes` from `./config/provider-recipes`.
- [ ] `pnpm build` produces `dist/server/index.d.ts` containing the `list` / `copy` / `deleteMany` signatures on `StorageService`.
- [ ] The built module exports the six recipe keys: `awsS3`, `digitalOceanSpaces`, `cloudflareR2`, `backblazeB2`, `minio`, `wasabi`.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/index.ts` (add the `providerRecipes` re-export)

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.5 of 12

PRECONDITIONS
- providerRecipes exists (Task 4.4); StorageService already exposes list/copy/deleteMany (Tasks 4.1–4.3)
  and is already exported from the barrel.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 3.3 (Public exports).

TASK
Add the providerRecipes export and verify the public type surface.

DELIVERABLES
1. `src/server/index.ts`: add `export { providerRecipes } from './config/provider-recipes'`
   (keep the barrel alphabetised/grouped consistently with the existing exports).

Constraints:
- Barrel-only change; English-only, timeless comments. No `.gitkeep`/placeholder files.

Verification:
- `pnpm typecheck` — clean.
- `pnpm build` then confirm `dist/server/index.d.ts` contains list/copy/deleteMany on StorageService, and:
  `node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m.providerRecipes)))"`
  → expected: [ 'awsS3', 'digitalOceanSpaces', 'cloudflareR2', 'backblazeB2', 'minio', 'wasabi' ].

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.5 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): export providerRecipes from server barrel (4.5)` — NO Co-Authored-By trailer.
````

---

### Task 4.6 — `BymaxStorageModule.forRootAsync()`

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.15, 2.10, 3.7

#### Description

Add the canonical NestJS `forRootAsync()` to `BymaxStorageModule`, supporting `useFactory` (with `inject`), `useClass`, and `useExisting`. A private `createAsyncOptionsProvider` builds the `BYMAX_STORAGE_OPTIONS` provider, running `validateOptions` + `applyDefaults` inside the async factory. The returned `DynamicModule` replicates **every** provider and export of `forRoot()` (S3ClientProvider, KeyResolverService, StorageService, SignedUrlService, ValidationService, FileScannerService, and the validators/scanner/idempotency-cache factories derived from the resolved options).

#### Acceptance criteria

- [ ] `forRootAsync({ useFactory, inject: [ConfigService] })` resolves options asynchronously from the injected dependencies.
- [ ] `forRootAsync({ useClass: MyOptionsFactory })` instantiates the factory and calls `createStorageOptions()`.
- [ ] `forRootAsync({ useExisting: ExistingFactory })` reuses the existing instance.
- [ ] Absent all three (`useFactory`/`useClass`/`useExisting`) → throws `Error('BymaxStorageModule.forRootAsync requires useFactory, useClass, or useExisting')`.
- [ ] `validateOptions` + `applyDefaults` run inside the factory (not in the consumer).
- [ ] The returned module replicates all `forRoot()` providers/exports; `StorageService` is injectable after async bootstrap.
- [ ] `asyncOptions.imports` are forwarded; each method ≤ 50 lines; `pnpm typecheck` passes; seed spec at 100% line/branch on the new paths.

#### Files to create / modify

- `src/server/bymax-storage.module.ts` (add `forRootAsync` + `createAsyncOptionsProvider`)
- `src/server/bymax-storage.module.async.spec.ts` (TDD seed; the full matrix is owned by Task 4.7)

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.6 of 12

PRECONDITIONS
- forRoot() exists and wires S3ClientProvider, KeyResolverService, StorageService, SignedUrlService,
  ValidationService, FileScannerService plus the BYMAX_STORAGE_UPLOAD_VALIDATORS /
  BYMAX_STORAGE_FILE_SCANNER / BYMAX_STORAGE_IDEMPOTENCY_CACHE factories.
- validateOptions, applyDefaults, the DI tokens, ResolvedBymaxStorageOptions, and the
  BymaxStorageModuleAsyncOptions / BymaxStorageModuleOptionsFactory interfaces all exist.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 4.4 (the forRootAsync ConfigService example).
- `docs/development_plan.md` § 5.5 (the forRootAsync skeleton + createAsyncOptionsProvider).

BEFORE CODING: confirm the DynamicModule / Provider / useFactory+inject contracts against the
current `@nestjs/common` docs via context7.

TASK
Add `forRootAsync()` + the private `createAsyncOptionsProvider()`, test-first.

DELIVERABLES
1. `bymax-storage.module.async.spec.ts` (TDD seed): useFactory with inject resolves options;
   useClass instantiates the factory and calls createStorageOptions; useExisting reuses; absence of
   all three throws; validateOptions + applyDefaults run in the factory; StorageService is resolvable.
2. `bymax-storage.module.ts`:
   - `static forRootAsync(asyncOptions: BymaxStorageModuleAsyncOptions): DynamicModule` returning
     `{ module, imports: asyncOptions.imports ?? [], providers: [...], exports: [...] }` — providers and
     exports identical to forRoot() (S3ClientProvider, KeyResolverService, StorageService,
     SignedUrlService, ValidationService, FileScannerService, and the validators/scanner/idempotency
     factories injecting BYMAX_STORAGE_OPTIONS).
   - `private static createAsyncOptionsProvider(asyncOptions): Provider`:
     - useFactory branch → `{ provide: BYMAX_STORAGE_OPTIONS, useFactory: async (...args) => applyDefaults(validateOptions-checked await useFactory(...args)), inject: [...(asyncOptions.inject ?? [])] }`.
     - useClass/useExisting branch → factory injects the class token, awaits `createStorageOptions()`,
       runs validateOptions + applyDefaults.
     - else → `throw new Error('BymaxStorageModule.forRootAsync requires useFactory, useClass, or useExisting')`.

Constraints:
- Each method ≤ 50 lines; English-only, timeless comments. No `.gitkeep`/placeholder files.

Verification:
- `pnpm typecheck` — clean.
- `pnpm test src/server/bymax-storage.module.async.spec.ts` — green, 100% line/branch on the new paths.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.6 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add BymaxStorageModule.forRootAsync (4.6)` — NO Co-Authored-By trailer.
````

---

### Task 4.7 — Unit tests — list / copy / deleteMany / recipes / forRootAsync

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 4.1, 4.2, 4.3, 4.4, 4.6

#### Description

Harden the five seed specs into the full edge-case matrix and drive every file added in this phase to the 100% line/branch floor: the three `StorageService` methods, the Provider Recipes, and `forRootAsync`.

#### Acceptance criteria

- [ ] `storage.service.list.spec.ts` (~8 cases): prefix filter, delimiter → commonPrefixes, maxKeys clamp to 1000, continuationToken paging, stripPrefix on keys, isTruncated true/false, empty `Contents`/`CommonPrefixes` defaults, `mapAwsError` on send failure.
- [ ] `storage.service.copy.spec.ts` (~5 cases): same-bucket, cross-bucket, ACL on publicRead, CopySource `/{bucket}/{key}` assertion, error mapping.
- [ ] `storage.service.delete-many.spec.ts` (~6 cases): empty no-op (no send), two-key success, mixed success+failure, >1000 keys chunking (assert two sends), whole-batch failure marks all failed, stripPrefix on returned keys.
- [ ] `provider-recipes.spec.ts` (~10 cases): one per recipe + R2 customDomain + DO cdnBaseUrl + non-AWS checksum opt-out present (and absent on awsS3) + determinism.
- [ ] `bymax-storage.module.async.spec.ts` (~5 cases): useFactory+inject, useClass, useExisting, missing-all throws, validateOptions+applyDefaults run.
- [ ] 30+ cases total; every spec is green; the five implemented files hit 100% line/branch; every `it()` carries a short comment.

#### Files to create / modify

- `src/server/services/storage.service.list.spec.ts` (extend)
- `src/server/services/storage.service.copy.spec.ts` (extend)
- `src/server/services/storage.service.delete-many.spec.ts` (extend)
- `src/server/config/provider-recipes.spec.ts` (extend)
- `src/server/bymax-storage.module.async.spec.ts` (extend)

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.7 of 12

PRECONDITIONS
- list(), copy(), deleteMany(), providerRecipes, and forRootAsync() are implemented with passing
  TDD seed specs.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.1, § 5.2, § 5.3, § 5.4, § 5.5 (the acceptance matrices).
- `docs/technical_specification.md` § 10.1 (ListResult), § 4.3 (recipes), § 4.4 (forRootAsync).

TASK
Extend the five specs to the full matrix and reach the 100% line/branch floor on every file
implemented in this phase.

DELIVERABLES
1. storage.service.list.spec.ts (~8): prefix filter, delimiter→commonPrefixes, maxKeys clamp 1000,
   continuationToken paging, stripPrefix on keys, isTruncated true/false, empty defaults, mapAwsError.
2. storage.service.copy.spec.ts (~5): same-bucket, cross-bucket, ACL, CopySource format, error mapping.
3. storage.service.delete-many.spec.ts (~6): empty no-op, two-key success, mixed, >1000 chunking
   (assert two sends), whole-batch failure marks all failed, stripPrefix.
4. provider-recipes.spec.ts (~10): one per recipe verifying endpoint/region/forcePathStyle/publicBaseUrl,
   R2 customDomain, DO cdnBaseUrl, checksum opt-out present on all five non-AWS recipes and ABSENT on
   awsS3, determinism (call twice → toEqual).
5. bymax-storage.module.async.spec.ts (~5): useFactory+inject, useClass, useExisting, missing-all throws,
   validateOptions+applyDefaults run.

Constraints:
- Mock the S3 client `send`; no real network calls. Every `it()` carries a short comment.
  English-only, timeless comments. Do NOT raise maxKeys above 1000 in any test expectation.

Verification:
- `pnpm test src/server/services/storage.service.list src/server/services/storage.service.copy src/server/services/storage.service.delete-many src/server/config/provider-recipes src/server/bymax-storage.module.async`
  — expected: green, 100% line/branch on all five files.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.7 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): add unit tests for list/copy/deleteMany/recipes/forRootAsync (4.7)` — NO Co-Authored-By trailer.
````

---

### Task 4.8 — E2E fixtures — MinIO via Testcontainers

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 4.6

#### Description

Create the e2e fixture that starts a MinIO container via Testcontainers, creates the test bucket, and returns the connection handle. The e2e specs build their `TestingModule` directly via `Test.createTestingModule(...)`, so only `minio-container.ts` is required (a `test-app.module.ts` is optional and omitted). Confirm `jest.e2e.config.ts` carries `testTimeout: 60_000`.

#### Acceptance criteria

- [ ] `test/e2e/fixtures/minio-container.ts` exports `MinioHandle` and `async function startMinio(bucket?)`.
- [ ] `startMinio` boots `GenericContainer` with `withCommand(['server', '/data'])`, the MinIO root env vars, and `withExposedPorts(9000)`; computes the endpoint from `getHost()` + `getMappedPort(9000)`.
- [ ] The test bucket is created inside the container automatically (via a dynamically imported `S3Client` + `CreateBucketCommand`, then `client.destroy()`).
- [ ] The MinIO image tag is pinned to a stable release (e.g. `RELEASE.2024-01-01T00-00-00Z`) rather than `latest`.
- [ ] `jest.e2e.config.ts` has `testTimeout: 60_000`.
- [ ] The container is started and stopped without leaks (verifiable via `docker ps` before/after a smoke run).

#### Files to create / modify

- `test/e2e/fixtures/minio-container.ts`
- `jest.e2e.config.ts` (set/confirm `testTimeout: 60_000`)

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.8 of 12

PRECONDITIONS
- `testcontainers` is a devDependency; jest.e2e.config.ts exists; forRoot()/StorageService are wired.
- The CI workflows already exist — do NOT create or modify any workflow here.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.6 (the minio-container.ts skeleton).

BEFORE CODING: confirm the `GenericContainer` API (withCommand / withEnvironment / withExposedPorts /
start / getHost / getMappedPort / stop) against the current `testcontainers` docs via context7, and
`CreateBucketCommand` from `@aws-sdk/client-s3`.

TASK
Create the MinIO Testcontainers fixture.

DELIVERABLES
1. `test/e2e/fixtures/minio-container.ts`:
   - `@fileoverview` + `@layer test/e2e` header.
   - `export interface MinioHandle { container: StartedTestContainer; endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string }`.
   - `export async function startMinio(bucket = 'test-bucket'): Promise<MinioHandle>`:
     - `new GenericContainer('minio/minio:RELEASE.2024-01-01T00-00-00Z')` (pinned tag, NOT `latest`)
       `.withCommand(['server', '/data']).withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' }).withExposedPorts(9000).start()`.
     - endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`.
     - dynamically import `{ S3Client, CreateBucketCommand }`; create the bucket (forcePathStyle:true,
       region us-east-1, minioadmin creds); `client.destroy()`.
     - return the handle. JSDoc reminds callers to `await handle.container.stop()` in afterAll.
2. Confirm `jest.e2e.config.ts` has `testTimeout: 60_000` (set it if missing).

Constraints:
- English-only, timeless comments. No `.gitkeep`/placeholder files. Do not touch CI workflows.

Verification:
- `pnpm typecheck` — clean.
- Smoke (Docker running): a minimal spec that calls startMinio() then handle.container.stop() boots and
  tears down with no leftover container (check `docker ps`).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.8 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): add e2e fixtures (Testcontainers MinIO) (4.8)` — NO Co-Authored-By trailer.
````

---

### Task 4.9 — E2E specs against MinIO (basic / multipart / signed / list / validation)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 4.8

#### Description

Five end-to-end spec files exercising the full library against a live MinIO container — no `aws-sdk-client-mock` here. Each file owns its container via a single `beforeAll` (and stops it in `afterAll`), giving Jest-worker isolation across files.

#### Acceptance criteria

- [ ] `storage-basic.e2e-spec.ts`: upload a small Buffer → head → downloadBuffer → delete (idempotent twice); path traversal rejected with `STORAGE_KEY_INVALID`; metadata preserved.
- [ ] `storage-multipart.e2e-spec.ts`: a 6 MB body switches to `multipart: true`; a `Readable` stream without declared size goes multipart; progress events fire during an 8 MB upload (count > 0, last `loaded` equals total).
- [ ] `storage-signed-urls.e2e-spec.ts`: a GET signed URL fetched via real `fetch` returns 200 with the body; a PUT signed URL uploads via real `fetch`; a PUT with the wrong `Content-Type` returns ≥ 400 (signature mismatch).
- [ ] `storage-list.e2e-spec.ts`: seed 5 objects in `beforeEach`; `list({ prefix })` returns 5; `list({ maxKeys: 2 })` paginates with a `nextContinuationToken`; `copy()` round-trips; `deleteMany()` handles a mixed batch.
- [ ] `storage-validation.e2e-spec.ts`: a fixture with `mimeWhitelist: ['image/*'], maxSizeBytes: 1024` rejects a `text/plain` upload (`STORAGE_MIME_NOT_ALLOWED`) and an oversize upload (`STORAGE_SIZE_EXCEEDED`).
- [ ] `pnpm test:e2e` is green on a machine with Docker running; every `afterAll` stops its container (no leaks); each `beforeAll` uses the 60 s timeout.

#### Files to create / modify

- `test/e2e/storage-basic.e2e-spec.ts`
- `test/e2e/storage-multipart.e2e-spec.ts`
- `test/e2e/storage-signed-urls.e2e-spec.ts`
- `test/e2e/storage-list.e2e-spec.ts`
- `test/e2e/storage-validation.e2e-spec.ts`

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.9 of 12

PRECONDITIONS
- `startMinio()` / MinioHandle fixture exists (Task 4.8); the full public API (upload, multipart,
  download, delete, head, exists, list, copy, deleteMany, SignedUrlService, validation) is implemented.
- Docker must be running for the suite. The CI workflows already exist — do NOT touch them.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.6 (the five e2e spec skeletons + the isolation/cleanup pattern).

TASK
Create the five MinIO e2e spec files in `test/e2e/`.

DELIVERABLES
1. storage-basic.e2e-spec.ts — upload small Buffer → head → downloadBuffer → delete (idempotent x2);
   path traversal rejected with STORAGE_KEY_INVALID; metadata preserved.
2. storage-multipart.e2e-spec.ts — 6 MB body → multipart:true; Readable stream without size → multipart;
   progress events fire during an 8 MB upload (count > 0, last loaded == total).
3. storage-signed-urls.e2e-spec.ts — GET signed URL via real fetch → 200 + body; PUT signed URL via real
   fetch uploads; PUT with wrong Content-Type → status >= 400.
4. storage-list.e2e-spec.ts — beforeEach seeds 5 objects; list({prefix}) → 5; list({maxKeys:2}) paginates
   (nextContinuationToken truthy, page2 fetched); copy() round-trips; deleteMany() mixed batch.
5. storage-validation.e2e-spec.ts — fixture mimeWhitelist:['image/*'], maxSizeBytes:1024 rejects
   text/plain (STORAGE_MIME_NOT_ALLOWED) and oversize (STORAGE_SIZE_EXCEEDED).

Pattern for every file:
- `beforeAll(async () => { minio = await startMinio(); module = await Test.createTestingModule({ imports: [BymaxStorageModule.forRoot({ endpoint: minio.endpoint, region: 'us-east-1', bucket: minio.bucket, credentials: {...}, forcePathStyle: true })] }).compile(); await module.init(); }, 60_000)`.
- `afterAll(async () => { await module.close(); await minio.container.stop() })`.
- Each spec file boots its OWN container (Jest-worker isolation). Do NOT use aws-sdk-client-mock — this
  runs against real MinIO. Every `it()` carries a short comment.

Constraints:
- English-only, timeless comments. No `.gitkeep`/placeholder files. Do not modify CI workflows.

Verification:
- `pnpm test:e2e` — expected: green with Docker running; no leftover containers afterwards.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.9 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): add e2e specs against MinIO (4.9)` — NO Co-Authored-By trailer.
````

---

### Task 4.10 — Mutation testing baseline (Stryker)

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 4.7, 4.9

#### Description

Run Stryker to establish the mutation-testing baseline for the library. Validate the global score and the higher bar on the security-critical paths, document any provably-equivalent mutants inline, and record the result. Stryker thresholds are high 100 / low 95 / **break 95**.

#### Acceptance criteria

- [ ] `pnpm mutation:dry-run` validates the config; `pnpm mutation` completes a full run.
- [ ] Global mutation score meets the baseline (Stryker break 95 — the run does not fall below the break threshold).
- [ ] Critical paths reach ≥ 95% (and the security boundaries `key-resolver.service.ts`, `validate-options.ts`, `ttl-clamp.ts`, `mime-match.ts`, `idempotency-cache.ts`, `header-utils.ts` stay at their 100% target).
- [ ] Provably-equivalent mutants are documented inline with `// Stryker disable next-line <Mutator>: <reason>` (notably AWS-error message strings in `try/catch`).
- [ ] `reports/mutation/mutation.html` is generated; `docs/mutation_testing_results.md` is created/updated with a timestamp, the score, and observations.

#### Files to create / modify

- `docs/mutation_testing_results.md` (create or update with timestamp + score + notes)
- Inline `// Stryker disable next-line ...` annotations in source where mutants are provably equivalent

#### Agent prompt

````
You are a senior test/release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.10 of 12

PRECONDITIONS
- The full unit suite (Task 4.7) and e2e suite (Task 4.9) are green; the Stryker config exists with
  thresholds high 100 / low 95 / break 95.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.7 (the mutation baseline objective + critical paths).

TASK
Establish the mutation-testing baseline and record it.

DELIVERABLES
1. Run `pnpm mutation:dry-run` (config sanity), then `pnpm mutation` (full run, ~15–25 min).
2. Confirm the global score does not breach the break-95 threshold and the listed critical/security
   paths hold ≥ 95% (the six security boundaries at 100%).
3. Annotate any surviving but provably-equivalent mutant inline with
   `// Stryker disable next-line <Mutator>: <reason>` — especially message strings in the AWS-error
   try/catch blocks where the mutant is semantically equivalent.
4. Create/update `docs/mutation_testing_results.md` with: run timestamp, global score, per-critical-path
   scores, and a short notes section (equivalent mutants documented, follow-ups if any).

Constraints:
- Do NOT lower any Stryker threshold to make the run pass. Only suppress provably-equivalent mutants,
  each with a written reason. English-only, timeless comments (no roadmap/phase/task references in any
  suppression reason). No `.gitkeep`/placeholder files.

Verification:
- `pnpm mutation` — expected: completes without breaching break 95; `reports/mutation/mutation.html` exists.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.10 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): establish mutation testing baseline (4.10)` — NO Co-Authored-By trailer.
````

---

### Task 4.11 — `forRootAsync` E2E async-config spec

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 4.6, 4.8

#### Description

An end-to-end spec proving `forRootAsync()` works against live MinIO: a stub `ConfigService` feeds the async factory, and a real upload + head round-trip confirms the async-bootstrapped `StorageService` is fully wired.

#### Acceptance criteria

- [ ] `test/e2e/storage-async-config.e2e-spec.ts` boots MinIO, registers a `StubConfigService`, and imports `BymaxStorageModule.forRootAsync({ useFactory, inject: [StubConfigService] })`.
- [ ] The factory reads endpoint/region/bucket/credentials from the stub config; `validateOptions` + `applyDefaults` run inside it.
- [ ] A real `storage.upload(...)` + `storage.head(...)` round-trip succeeds against MinIO.
- [ ] `afterAll` stops the container (no leaks); the `beforeAll` uses the 60 s timeout.
- [ ] `pnpm test:e2e` (filtered to `async-config`) is green with Docker running.

#### Files to create / modify

- `test/e2e/storage-async-config.e2e-spec.ts`

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.11 of 12

PRECONDITIONS
- forRootAsync() is implemented (Task 4.6); the startMinio() fixture exists (Task 4.8).
- Docker must be running. The CI workflows already exist — do NOT touch them.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.5 (forRootAsync) and § 5.6 (e2e pattern).
- `docs/technical_specification.md` § 4.4 (the ConfigService factory example).

TASK
Create the forRootAsync e2e spec.

DELIVERABLES
1. `test/e2e/storage-async-config.e2e-spec.ts`:
   - A `class StubConfigService { get(key: string) { ... } }` returning the MinIO endpoint/region/
     bucket/credentials from the started container.
   - `Test.createTestingModule({ providers: [StubConfigService], imports: [BymaxStorageModule.forRootAsync({ useFactory: (cfg: StubConfigService) => ({ endpoint: cfg.get('endpoint'), region: 'us-east-1', bucket: cfg.get('bucket'), credentials: { accessKeyId: cfg.get('accessKeyId'), secretAccessKey: cfg.get('secretAccessKey') }, forcePathStyle: true }), inject: [StubConfigService] })] }).compile()`.
   - Smoke: `await storage.upload({ key, body, contentType })` then `await storage.head(key)` asserts size.
   - `beforeAll(..., 60_000)` boots MinIO; `afterAll` closes the module and stops the container.

Constraints:
- Run against real MinIO (no aws-sdk-client-mock). Every `it()` carries a short comment.
  English-only, timeless comments. No `.gitkeep`/placeholder files. Do not modify CI workflows.

Verification:
- `pnpm test:e2e -- --testPathPattern=async-config` — expected: green with Docker running, no leaks.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.11 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): add forRootAsync e2e async-config spec (4.11)` — NO Co-Authored-By trailer.
````

---

### Task 4.12 — Phase validation + release gate (`test:cov:all` 100%)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11

#### Description

Consolidated gate for the phase: the full static + coverage + e2e + build + size + mutation pipeline must be green, with the release gate `test:cov:all` enforcing **100% global** coverage. Close with a code review and apply all findings.

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm test:e2e && pnpm build && pnpm size && pnpm mutation` all pass.
- [ ] `test:cov:all` reports 100% global coverage (release gate via `jest.coverage.config.ts`).
- [ ] `pnpm size` passes the brotli budgets (server ≤ 30 KB, shared ≤ 3.5 KB).
- [ ] `pnpm test:e2e` is green for all six e2e specs (the five from Task 4.9 + the async-config spec from Task 4.11).
- [ ] `pnpm mutation` does not breach the break-95 threshold; critical paths ≥ 95%.
- [ ] **GitHub CI is green on the PR** — the `ci` (verify + e2e against MinIO), `codeql`, and `scorecard` runs on the PR head all concluded `success` (`gh run list`/`gh run view`); the e2e specs added this phase now run in the front-loaded ci.yml e2e job. The phase is not closed with red or pending CI.
- [ ] `/bymax-quality:code-review` run for the phase and all findings applied.

#### Files to create / modify

- `/tmp/smoke-storage-phase4.mjs` (scratch validation script — not committed), if a manual smoke is useful
- No library source changes expected beyond applying code-review findings

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 4 (Listing + Pagination + forRootAsync + E2E + Mutation) — Task 4.12 of 12

PRECONDITIONS
- Tasks 4.1–4.11 are complete: list/copy/deleteMany, providerRecipes, the barrel export, forRootAsync,
  the unit suite, the e2e suite, the mutation baseline, and the async-config e2e spec are all in place.
- Docker is running (required for the e2e step). The CI workflows already exist — do NOT touch them.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.8 (the phase validation checklist).

TASK
Run the consolidated release gate and close the phase.

DELIVERABLES
1. Run, in sequence:
   `pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm test:e2e && pnpm build && pnpm size && pnpm mutation`.
   - test:cov:all = 100% global (release gate via jest.coverage.config.ts).
   - test:e2e = all six e2e specs green (five storage-*.e2e-spec.ts + storage-async-config.e2e-spec.ts).
   - size = server ≤ 30 KB brotli, shared ≤ 3.5 KB brotli.
   - mutation = does not breach break 95; critical paths ≥ 95%.
2. Run `/bymax-quality:code-review` for the phase and APPLY every finding.

Constraints:
- Do NOT lower any coverage / size / mutation threshold to make the gate pass. Fix the code or the
  tests instead. English-only, timeless comments. No `.gitkeep`/placeholder files. Do not modify CI workflows.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm test:e2e && pnpm build && pnpm size` — expected: all green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 4.12 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update Phase 4's row in the §1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `chore(storage): finalize listing/async/e2e/mutation gate (4.12)` — NO Co-Authored-By trailer.
````

---

## Completion log

_Append `- <id> ✅ <YYYY-MM-DD> — <summary>` as each task completes._

- 4.1 ✅ 2026-07-01 — Added `StorageService.list()` with maxKeys clamp, prefix normalization/stripping, commonPrefixes, and continuation-token paging.
- 4.2 ✅ 2026-07-01 — Added `StorageService.copy()` server-side copy with canonical `/{bucket}/{key}` CopySource, ACL, and cache-control fallback.
- 4.3 ✅ 2026-07-01 — Added `StorageService.deleteMany()` chunked at ≤1000 keys with per-key success/failure aggregation and prefix stripping.
