# Phase 2 — Upload (single, multipart, stream) + Download

> **Status**: 🔄 In Progress · **Progress**: 5 / 14 tasks · **Last updated**: 2026-06-30
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) § 3
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) § 5, § 6

---

## Context

This phase turns the configured-but-inert library from the foundation phase into a working `StorageService`. It delivers the public facade and the full upload path (single-shot `PutObject`, multipart via `@aws-sdk/lib-storage`, and streaming bodies of unknown size), the download path (a Node `Readable` stream plus a small-file buffer helper), the metadata operations (`head`, `exists`), an idempotent `delete`, `getPublicUrl`, an in-memory LRU idempotency cache, and progress events. At the end it is possible to upload and download real files against a local MinIO via a manual smoke test (the formal e2e suite arrives in a later phase).

Complexity is HIGH: multipart with `@aws-sdk/lib-storage` requires correct error handling (it auto-aborts on failure with `leavePartsOnError: false`, so no manual `AbortMultipartUpload` is written for this path), the streaming `peekFirstBytes` tee must not deadlock on backpressure, and the LRU idempotency cache must evict in true least-recently-used order. Every file implemented here is a library file and must reach the Bymax library coverage floor (100% line/branch) with a Stryker mutation gate of break 95.

---

## Rules-of-phase

1. **TDD — develop test-first.** Write the spec (or the failing assertions) before or alongside each unit of new logic; the dedicated test tasks (2.11–2.13) consolidate every file to **100% line/branch coverage** and the Stryker mutation gate (high 100 / low 95 / **break 95**). No production file ships below the floor.
2. **100% line/branch coverage** on every file implemented in this phase — this is the Bymax library floor, not 80%.
3. **English-only and timeless comments.** No `Phase N` / `Task X` / roadmap-stage references inside any code, JSDoc (`@param` / `@returns` / `@throws`), inline note, or TODO. Explain *what* and *why*, never *which roadmap stage*.
4. **Per-file header.** Every new `.ts` file starts with a `@fileoverview` summary and a `@layer` tag (e.g. `@layer server/utils`, `@layer server/services`).
5. **Clean Code sizing.** Functions ≤ 50 lines; files ≤ 800 lines (the growing `storage.service.ts` must stay under the limit — split a private helper out if it approaches it).
6. **Official-docs-first.** Before using any AWS SDK v3 API (`PutObjectCommand`, `GetObjectCommand`, `HeadObjectCommand`, `DeleteObjectCommand`, the `Upload` class, the sdk-stream-mixin), re-verify the current signature via context7 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`) — do not code AWS APIs from memory.
7. **AWS SDK v3 is SigV4-only.** There is **no `signatureVersion` option** anywhere. Use **`maxAttempts`** (default `DEFAULT_MAX_ATTEMPTS = 3`), never `maxRetries`.
8. **Non-AWS checksum opt-out (the #1 provider-compat trap).** The resolved options carry `requestChecksumCalculation` and `responseChecksumValidation` (`'WHEN_SUPPORTED' | 'WHEN_REQUIRED'`, default `'WHEN_SUPPORTED'`). Against non-AWS S3-compatible providers (R2 / B2 / MinIO / Spaces / Wasabi) these must be `'WHEN_REQUIRED'`, otherwise the SDK's default streaming-checksum trailers make uploads/downloads fail. The MinIO smoke test (2.14) must set them to `'WHEN_REQUIRED'`.
9. **Multipart auto-aborts.** `@aws-sdk/lib-storage`'s `Upload` with `leavePartsOnError: false` cleans up parts on failure itself — never write a manual `AbortMultipartUpload` for the lib-storage path.
10. **`StorageException` status comes from the catalog.** Construct it as `new StorageException(code)` or `new StorageException(code, details)`; the HTTP status is resolved internally from the `STORAGE_ERROR_STATUS` map (code → `HttpStatus`). Do **not** pass an explicit `HttpStatus` argument, and do **not** import `STORAGE_ERROR_MESSAGES` / `STORAGE_ERROR_STATUS` (both are internal, not exported).
11. **`defaultPublicRead` ACL caveat.** Sending `ACL: 'public-read'` returns HTTP 400 `AccessControlListNotSupported` on modern AWS S3 (ACLs disabled / Block Public Access) and is a silent no-op on Cloudflare R2. The header builder still produces it for buckets that allow ACLs, but public delivery should normally go through `publicBaseUrl` / `cdnBaseUrl`. Document this where the ACL is applied.
12. **Zero runtime dependencies.** The idempotency cache and stream helpers are hand-rolled (no `lru-cache`, no extra deps); the AWS SDK packages stay in `peerDependencies`. The bundle budget is **brotli** (server < 30 KB brotli, shared < 3.5 KB brotli) — never "gzipped".
13. **CI stays green.** The four workflows (`ci`, `codeql`, `scorecard`, `release`) already exist from the scaffold and run on every PR; each task's commit must keep them green.
14. **Conventional Commits**, with **NO `Co-Authored-By` trailer** of any kind.
15. **Never create `.gitkeep` / `.keep` or empty-directory placeholders** — directories emerge from real files.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md) § 3 — the authoritative skeletons: § 3.1 `IdempotencyCache`, § 3.2 `stream-utils`, § 3.3 `upload-strategy`, § 3.4 `header-utils`, § 3.5 `StorageService` base, § 3.6 multipart, § 3.7 download, § 3.8 module registration + tests, § 3.9 phase validation.
- [`../technical_specification.md`](../technical_specification.md) § 5 — `StorageService` signatures, § 5.2 `UploadOptions` / `DownloadOptions`, § 5.3 `UploadResult` / `ObjectMetadata`.
- [`../technical_specification.md`](../technical_specification.md) § 6 — § 6.1 single-shot vs multipart decision, § 6.2 stream uploads, § 6.3 progress events, § 6.4 idempotency, § 6.5 automatic headers.
- Foundation-phase contracts this phase consumes (Tasks 1.x): `StorageException` + `mapAwsError` + `STORAGE_ERROR_CODES`, `KeyResolverService.normalize()`, `S3ClientProvider.getClient()` / `isConfigured()`, `ResolvedBymaxStorageOptions`, the shared `UploadResult` / `ObjectMetadata` types, and `BymaxStorageModule.forRoot()`.
- `/bymax-workflow:standards` skill — universal coding rules (TypeScript track).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 2.1 | IdempotencyCache (LRU + TTL) | ✅ Done | P0 | S | 1.8 |
| 2.2 | stream-utils (isReadable, isBufferLike, getBodySize, peekFirstBytes, bufferToReadable) | ✅ Done | P0 | M | 1.6 |
| 2.3 | upload-strategy (single-shot vs multipart decision) | ✅ Done | P1 | S | 2.2 |
| 2.4 | header-utils (Content-Disposition, Cache-Control, SSE, ACL builders) | ✅ Done | P1 | S | 1.9, 1.12 |
| 2.5 | StorageService base (assertConfigured, resolveBucket, head, exists, getPublicUrl) | ✅ Done | P0 | M | 1.13, 1.14, 2.1, 2.4 |
| 2.6 | StorageService.upload (single-shot path) | 📋 ToDo | P0 | M | 2.2, 2.3, 2.5 |
| 2.7 | StorageService.uploadMultipart (lib-storage Upload) | 📋 ToDo | P0 | M | 2.6 |
| 2.8 | StorageService.download + downloadBuffer | 📋 ToDo | P0 | M | 2.5 |
| 2.9 | StorageService.delete (idempotent) | 📋 ToDo | P1 | S | 2.5 |
| 2.10 | Module wiring — register StorageService + IdempotencyCache + barrel | 📋 ToDo | P0 | S | 1.15, 2.1, 2.6, 2.7, 2.8, 2.9 |
| 2.11 | Tests — utilities (idempotency-cache, stream-utils, upload-strategy, header-utils) | 📋 ToDo | P0 | L | 2.1, 2.2, 2.3, 2.4 |
| 2.12 | Tests — StorageService (single-shot + head/exists/delete/getPublicUrl) | 📋 ToDo | P0 | L | 2.9, 2.10 |
| 2.13 | Tests — StorageService multipart + download/downloadBuffer | 📋 ToDo | P1 | M | 2.12 |
| 2.14 | Phase validation + smoke test against MinIO | 📋 ToDo | P0 | M | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13 |

---

## Tasks

### Task 2.1 — IdempotencyCache (LRU + TTL)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.8

#### Description

An in-memory LRU cache with TTL that deduplicates uploads keyed by `idempotencyKey`. It is per-instance (a documented trade-off: in multi-replica deployments two pods may double-upload within the TTL; cross-instance dedup via `IIdempotencyStore` is a future version). No external cache dependency — hand-rolled on a `Map`.

#### Acceptance criteria

- [x] `set` then `get` returns the value for the same cache key.
- [x] `get` returns `undefined` after the TTL elapses (tested with an injected `now` clock).
- [x] Eviction happens when `size > maxEntries` (oldest insertion-ordered key removed).
- [x] LRU touch is correct: accessing A, B, C, A and then exceeding the cap removes **B**, not A.
- [x] `computeKey` is deterministic (same input → same output) and hashes via sha256 (raw `idempotencyKey` never used as the Map key).
- [x] File carries a `@fileoverview` + `@layer` header; `pnpm typecheck` passes.
- [x] 100% line/branch coverage; Stryker mutation ≥ 95.

#### Files to create / modify

- `src/server/utils/idempotency-cache.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a production-grade NestJS storage library wrapping the AWS
SDK v3 S3 client, targeting S3-compatible providers (AWS S3, Cloudflare R2, Backblaze B2, MinIO,
DigitalOcean Spaces, Wasabi). Dual entry points (server + shared); zero runtime dependencies
(AWS SDK packages are peerDependencies); a brotli bundle-size gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.1 of 14

PRECONDITIONS
- The shared `UploadResult` type exists (foundation Task 1.8 — shared constants/types).

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.1 (the complete `IdempotencyCache` skeleton + acceptance criteria).

TASK
Create `src/server/utils/idempotency-cache.ts` implementing the LRU + TTL cache exactly as the
§ 3.1 skeleton describes.

DELIVERABLES
- `class IdempotencyCache` backed by `private readonly entries = new Map<string, CacheEntry>()`
  (a `Map` preserves insertion order — the basis of the LRU).
- Constructor `(maxEntries: number, ttlMs: number, now: () => number = Date.now)` — the clock is
  injectable for deterministic tests.
- `computeKey(idempotencyKey, finalKey): string` → `createHash('sha256').update(\`${idempotencyKey}:${finalKey}\`).digest('hex')` (never use the raw idempotencyKey as a Map key — avoids leaking it during debugging).
- `get(cacheKey): UploadResult | undefined` — on hit that has not expired, perform an **LRU touch**
  (delete then re-insert to move it to "newest"); on expiry, delete and return `undefined`.
- `set(cacheKey, value): void` — delete an existing key first, insert, then evict the oldest
  (`entries.keys().next().value`) while `size > maxEntries`.
- `size(): number` test helper and `clear(): void`.
- Import `createHash` from `node:crypto`. JSDoc must state the per-instance trade-off (multi-replica
  can double-upload; cross-instance store is a future version) without naming any roadmap stage.

Constraints:
- @fileoverview + @layer header (`@layer server/utils`); functions ≤ 50 lines; English-only,
  timeless comments.
- No external cache dependency — `Map`-based only.
- Rely on the ES2015+ guarantee that `Map.keys().next().value` returns the oldest insertion-ordered key.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation are finalized in Task 2.11; the implementation must be written to be 100%
  coverable and mutation-resistant on the eviction + LRU-touch branches.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.1 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.1)` — NO Co-Authored-By trailer.
````

---

### Task 2.2 — stream-utils (isReadable, isBufferLike, getBodySize, peekFirstBytes, bufferToReadable)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.6

#### Description

Utility helpers to handle the polymorphic upload body (`Buffer | NodeJS.ReadableStream | Uint8Array`): detect its type, compute its best-effort size, peek the first N bytes (for content validators) without consuming the upload, and wrap a buffer as a `Readable`. The stream peek tees via two `PassThrough`s — the caller must use the returned `replacementBody` for the upload, otherwise the peek side blocks on backpressure.

#### Acceptance criteria

- [x] `isReadable(stream)` is `true`; `isReadable(Buffer)` and `isReadable(Uint8Array)` are `false`.
- [x] `isBufferLike(Buffer)` and `isBufferLike(Uint8Array)` are `true`; `isBufferLike(stream)` is `false`.
- [x] `getBodySize(Buffer.from('abc'))` returns `3`; `getBodySize(stream)` returns `undefined`.
- [x] `peekFirstBytes(Buffer.from('hello'), 3)` returns `head: Buffer.from('hel')` (zero-copy) plus the original body.
- [x] `peekFirstBytes(stream, 4)` returns the correct head and a `replacementBody` that is fully consumable for the upload.
- [x] `bufferToReadable(buf)` produces a `Readable`.
- [x] File carries a `@fileoverview` + `@layer` header; `pnpm typecheck` passes.
- [x] 100% line/branch coverage; Stryker mutation ≥ 95.

#### Files to create / modify

- `src/server/utils/stream-utils.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a production-grade NestJS storage library wrapping the AWS
SDK v3 S3 client for S3-compatible providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry
points (server + shared); zero runtime dependencies; brotli bundle-size gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.2 of 14

PRECONDITIONS
- The server/shared folder structure exists (foundation Task 1.6).

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.2 (the complete `stream-utils` skeleton + the backpressure note).

TASK
Create `src/server/utils/stream-utils.ts` implementing the polymorphic-body helpers exactly as the
§ 3.2 skeleton describes.

DELIVERABLES
- `export type UploadBody = Buffer | NodeJS.ReadableStream | Uint8Array`.
- `isReadable(body): body is NodeJS.ReadableStream` — checks `'pipe' in body` and that `pipe` is a function.
- `isBufferLike(body): body is Buffer | Uint8Array` — checks `body instanceof Uint8Array` (Buffer extends Uint8Array).
- `getBodySize(body): number | undefined` — `byteLength` for buffer-like bodies, `undefined` for streams.
- `peekFirstBytes(body, maxBytes): Promise<{ head: Buffer; replacementBody: UploadBody }>`:
  - Buffer/Uint8Array → `{ head: buf.subarray(0, maxBytes), replacementBody: buf }` (zero-copy).
  - Readable → tee through TWO `PassThrough`s (one for the peek, one for the upload), collect up to
    `maxBytes` from the peek side, and return the second PassThrough as `replacementBody`. The JSDoc
    MUST warn that the caller is required to consume `replacementBody` for the upload or the peek
    side deadlocks on backpressure.
- `bufferToReadable(buf): Readable` → `Readable.from(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))`.
- Import `PassThrough` and `Readable` from `node:stream`.

Constraints:
- @fileoverview + @layer header (`@layer server/utils`); functions ≤ 50 lines; English-only,
  timeless comments.
- `peekFirstBytes` must only hold up to `maxBytes` in memory — the rest keeps streaming.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.11; write the tee and the byte-counting loop to be 100%
  coverable.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.2 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.2)` — NO Co-Authored-By trailer.
````

---

### Task 2.3 — upload-strategy (single-shot vs multipart decision)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 2.2

#### Description

A pure function that decides the upload strategy from the body, the declared size, and the multipart threshold. A stream of unknown size, or any known size at/above the threshold, picks multipart; everything else is single-shot.

#### Acceptance criteria

- [x] Buffer below threshold → `'single-shot'`.
- [x] Buffer at/above threshold → `'multipart'`.
- [x] Stream with `declaredSize` below threshold → `'single-shot'`.
- [x] Stream with `declaredSize` at/above threshold → `'multipart'`.
- [x] Stream without `declaredSize` → `'multipart'`.
- [x] `Uint8Array` below threshold → `'single-shot'`.
- [x] File carries a `@fileoverview` + `@layer` header; `pnpm typecheck` passes.
- [x] 100% line/branch coverage; Stryker mutation ≥ 95.

#### Files to create / modify

- `src/server/utils/upload-strategy.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points; zero runtime deps; brotli
bundle gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.3 of 14

PRECONDITIONS
- `src/server/utils/stream-utils.ts` exists (Task 2.2) exporting `UploadBody`, `getBodySize`, `isReadable`.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.3 (the `upload-strategy` skeleton).
- `../technical_specification.md` § 6.1 (single-shot vs multipart decision rationale).

TASK
Create `src/server/utils/upload-strategy.ts` with a pure decision function.

DELIVERABLES
- `export type UploadStrategy = 'single-shot' | 'multipart'`.
- `pickUploadStrategy(body: UploadBody, declaredSize: number | undefined, thresholdBytes: number): UploadStrategy`:
  - `const size = declaredSize ?? getBodySize(body)`.
  - `isReadable(body) && size === undefined` → `'multipart'` (stream of unknown length).
  - `size !== undefined && size >= thresholdBytes` → `'multipart'`.
  - otherwise → `'single-shot'`.
- JSDoc documenting the decision table.

Constraints:
- Pure function (no I/O, no side effects). @fileoverview + @layer header (`@layer server/utils`);
  English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.11.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.3 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.3)` — NO Co-Authored-By trailer.
````

---

### Task 2.4 — header-utils (Content-Disposition, Cache-Control, SSE, ACL builders)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.9, 1.12

#### Description

Small pure builders that resolve request headers consistently with a per-call → module-default fallback: Content-Disposition, Cache-Control, server-side encryption (with the `'NONE'` sentinel that short-circuits even a global default), and the ACL flag.

#### Acceptance criteria

- [x] `buildContentDisposition(undefined, 'inline')` → `'inline'`; a per-call value wins over the default.
- [x] `buildCacheControl(undefined, 'public, max-age=300')` → `'public, max-age=300'`.
- [x] `buildSSE('NONE', undefined, { serverSideEncryption: 'AES256' })` → `{}` (sentinel omits the header even with a global default).
- [x] `buildSSE('aws:kms', 'key-id', ...)` → `{ ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'key-id' }`.
- [x] `buildACL(true, false)` → `'public-read'`; `buildACL(false, true)` → `undefined`.
- [x] File carries a `@fileoverview` + `@layer` header; `pnpm typecheck` passes.
- [x] 100% line/branch coverage; Stryker mutation ≥ 95.

#### Files to create / modify

- `src/server/utils/header-utils.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points; zero runtime deps; brotli
bundle gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.4 of 14

PRECONDITIONS
- `UploadOptions` interface (Task 1.9) and `ResolvedBymaxStorageOptions` (Task 1.12) exist.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.4 (the complete `header-utils` skeleton).
- `../technical_specification.md` § 6.5 (automatic headers).

TASK
Create `src/server/utils/header-utils.ts` with the four pure builder functions.

DELIVERABLES
- `buildContentDisposition(perCall, defaultValue): string` → `perCall ?? defaultValue`.
- `buildCacheControl(perCall, defaultValue): string` → `perCall ?? defaultValue`.
- `buildSSE(perCall, perCallKmsKeyId, module): { ServerSideEncryption?: 'AES256' | 'aws:kms'; SSEKMSKeyId?: string }`:
  - `perCall === 'NONE'` → `{}` (the lib-only sentinel; never passed to the SDK — short-circuits any global default).
  - `const sse = perCall ?? module.serverSideEncryption`; if falsy → `{}`.
  - `sse === 'aws:kms'` → `{ ServerSideEncryption: 'aws:kms', SSEKMSKeyId: perCallKmsKeyId ?? module.kmsKeyId }`.
  - else → `{ ServerSideEncryption: sse }` (AES256).
  - typed via `Pick<ResolvedBymaxStorageOptions, 'serverSideEncryption' | 'kmsKeyId'>` for the module arg.
- `buildACL(perCall: boolean | undefined, defaultValue: boolean): 'public-read' | undefined` →
  `(perCall ?? defaultValue) ? 'public-read' : undefined`. In the JSDoc, document that
  `'public-read'` returns HTTP 400 `AccessControlListNotSupported` on modern AWS S3 (ACLs disabled /
  Block Public Access) and is a silent no-op on Cloudflare R2 — public delivery should normally use
  `publicBaseUrl`/`cdnBaseUrl`; the header is still emitted for buckets that explicitly allow ACLs.

Constraints:
- All four are pure functions. @fileoverview + @layer header (`@layer server/utils`); English-only,
  timeless comments. NO `signatureVersion` anywhere.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.11.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.4 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.4)` — NO Co-Authored-By trailer.
````

---

### Task 2.5 — StorageService base (assertConfigured, resolveBucket, head, exists, getPublicUrl)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.13, 1.14, 2.1, 2.4

#### Description

The `StorageService` backbone: constructor with DI (resolved options, `S3ClientProvider`, `KeyResolverService`, the idempotency cache), the private helpers (`assertConfigured`, `resolveBucket`, `buildPublicUrl`), and the read operations `head`, `exists`, `getPublicUrl`. Upload/download/delete arrive in later tasks.

#### Acceptance criteria

- [x] `StorageService` is `@Injectable()` with the constructor dependencies wired by DI token / class (the idempotency cache joins in 2.6 where it is first used).
- [x] `assertConfigured()` throws `STORAGE_NOT_CONFIGURED` (HTTP 503, status from the catalog) when `!s3Provider.isConfigured()`.
- [x] `resolveBucket(perCall?)` returns `perCall ?? options.bucket` and throws `STORAGE_BUCKET_UNDEFINED` when both are undefined.
- [x] `head()` calls `HeadObjectCommand` and maps the response to `ObjectMetadata`; errors go through `mapAwsError`.
- [x] `head()` throws `STORAGE_OBJECT_NOT_FOUND` on 404.
- [x] `exists()` returns `false` on 404 and `false` (with a warning) on other errors.
- [x] `getPublicUrl()` normalizes the key, resolves the bucket, and uses `cdnBaseUrl ?? publicBaseUrl` without duplicating the bucket already present in the base.
- [x] File carries a `@fileoverview` + `@layer` header; `pnpm typecheck` passes.
- [x] Coverage at the library floor (finalized in 2.12).

#### Files to create / modify

- `src/server/services/storage.service.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a production-grade NestJS storage library wrapping the AWS SDK
v3 S3 client for S3-compatible providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points
(server + shared); zero runtime dependencies (AWS SDK is a peer dep); brotli bundle gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.5 of 14

PRECONDITIONS
- `KeyResolverService` (Task 1.13), `S3ClientProvider` (Task 1.14), `IdempotencyCache` (Task 2.1),
  and `header-utils` (Task 2.4) exist. `StorageException` + `mapAwsError` + `STORAGE_ERROR_CODES`
  and `ResolvedBymaxStorageOptions` exist from the foundation phase.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.5 (the StorageService base skeleton — part 1).
- `../technical_specification.md` § 5.1 (full signatures), § 5.3 (`ObjectMetadata`).
- Before calling `HeadObjectCommand`, verify its current input/output via context7 (`@aws-sdk/client-s3`).

TASK
Create `src/server/services/storage.service.ts` with the class scaffold, DI constructor, the private
helpers, and the read operations ONLY. Do NOT implement upload/download/delete yet (later tasks).

DELIVERABLES
- Imports: `Inject`, `Injectable`, `Logger` from `@nestjs/common`; `HeadObjectCommand` from
  `@aws-sdk/client-s3`; the DI tokens `BYMAX_STORAGE_OPTIONS` + `BYMAX_STORAGE_IDEMPOTENCY_CACHE`;
  `ResolvedBymaxStorageOptions`; `ObjectMetadata` from shared; `S3ClientProvider`; `KeyResolverService`;
  `StorageException`; `mapAwsError`; `STORAGE_ERROR_CODES`; `IdempotencyCache`.
- Constructor injects `@Inject(BYMAX_STORAGE_OPTIONS) options`, `S3ClientProvider`, `KeyResolverService`,
  `@Inject(BYMAX_STORAGE_IDEMPOTENCY_CACHE) idempotencyCache`; `private readonly logger = new Logger(StorageService.name)`.
- `private assertConfigured(): void` — throws `new StorageException(STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED)`
  when `!s3Provider.isConfigured()`. The HTTP status (503) is resolved internally by StorageException from
  the STORAGE_ERROR_STATUS map — DO NOT pass an explicit HttpStatus argument.
- `private resolveBucket(perCall?: string): string` — `perCall ?? options.bucket`; if undefined throws
  `new StorageException(STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED)`.
- `private buildPublicUrl(finalKey, bucket): string` — base = `options.cdnBaseUrl ?? options.publicBaseUrl`;
  strip trailing slashes; do not duplicate the bucket if the base already contains it.
- `async head(key, options?): Promise<ObjectMetadata>` — `assertConfigured`, normalize key, resolve bucket,
  `client.send(new HeadObjectCommand({ Bucket, Key }))`, map the response → `ObjectMetadata`; on error
  `throw mapAwsError(err, { key, bucket, op: 'head' })`.
- `async exists(key, options?): Promise<boolean>` — call `head()` in try/catch; return `false` when the
  caught error is a `StorageException` with code `STORAGE_OBJECT_NOT_FOUND`; otherwise log a warning and
  return `false` (best-effort).
- `getPublicUrl(key, options?): string` — normalize key + resolveBucket + buildPublicUrl.

Constraints:
- @fileoverview + @layer header (`@layer server/services`); functions ≤ 50 lines; file ≤ 800 lines
  (it will grow across later tasks — keep helpers small). English-only, timeless comments.
- StorageException is `new StorageException(code)` / `new StorageException(code, details)` — status from
  the internal catalog map; never import STORAGE_ERROR_MESSAGES / STORAGE_ERROR_STATUS (internal).
- AWS SDK v3 is SigV4-only — no `signatureVersion`. Any retry concept is `maxAttempts`, never `maxRetries`.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.12.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.5 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.5)` — NO Co-Authored-By trailer.
````

---

### Task 2.6 — StorageService.upload (single-shot path)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.2, 2.3, 2.5

#### Description

The public `upload()` entry point plus the single-shot `PutObject` path: validate body/contentType, normalize the key, resolve the bucket, run the idempotency check, pick the strategy, dispatch to single-shot (or multipart — wired in 2.7), and store the result in the idempotency cache. The single-shot path assembles all automatic headers and emits one terminal progress event.

#### Acceptance criteria

- [ ] `upload()` throws `STORAGE_NOT_CONFIGURED` when the S3 client is missing.
- [ ] `upload()` throws `STORAGE_BODY_MISSING` for a missing body and `STORAGE_CONTENT_TYPE_REQUIRED` for an empty content type.
- [ ] `upload()` applies the global `keyPrefix` via the key resolver.
- [ ] `upload()` returns `fromIdempotencyCache: true` on a dedup hit and `false` on the first call.
- [ ] `uploadSingleShot` builds `PutObjectCommandInput` with Bucket, Key, Body, ContentType, ContentLength, CacheControl, ContentDisposition, ACL, Metadata, and the SSE headers, and returns `UploadResult` with `multipart: false`.
- [ ] `uploadSingleShot` invokes `onProgress` once with `{ loaded: total ?? 0, total }` when provided.
- [ ] Errors map through `mapAwsError(err, { key, bucket, op: 'upload-single' })`.
- [ ] File header present; `pnpm typecheck` passes; coverage finalized in 2.12.

#### Files to create / modify

- `src/server/services/storage.service.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points; zero runtime deps; brotli gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.6 of 14

PRECONDITIONS
- StorageService base (Task 2.5) exists. `stream-utils` (2.2), `upload-strategy` (2.3), and
  `header-utils` (2.4) exist. `UploadOptions` / `UploadResult` exist from the foundation phase.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.5 (the `upload` + `uploadSingleShot` methods in the skeleton).
- `../technical_specification.md` § 6.5 (automatic headers), § 5.2 (`UploadOptions`).
- Verify `PutObjectCommand` / `PutObjectCommandInput` via context7 (`@aws-sdk/client-s3`) before coding it.

TASK
Add `upload()` and the private `uploadSingleShot()` to `src/server/services/storage.service.ts`.

DELIVERABLES
- `async upload(options: UploadOptions): Promise<UploadResult>`:
  1. `assertConfigured()`.
  2. Throw `STORAGE_BODY_MISSING` if no body; throw `STORAGE_CONTENT_TYPE_REQUIRED` if no contentType
     (both via `new StorageException(code)` — status from the catalog).
  3. `finalKey = keyResolver.normalize(options.key)`; `bucket = resolveBucket(options.bucket)`.
  4. Idempotency: if `options.idempotencyKey`, compute the cache key and return
     `{ ...cached, fromIdempotencyCache: true }` on a hit.
  5. `strategy = pickUploadStrategy(options.body, options.size, options.multipart?.thresholdBytes ?? this.options.multipart.thresholdBytes)`.
  6. Dispatch to `uploadMultipart` (added in the next task) or `uploadSingleShot`.
  7. If `idempotencyKey`, store the result in the cache. Return the result.
- `private async uploadSingleShot(options, finalKey, bucket): Promise<UploadResult>`:
  1. Normalize body (Buffer or stream; for `Uint8Array` use `Buffer.from(...)` for SDK safety).
  2. `sseHeaders = buildSSE(options.serverSideEncryption, options.kmsKeyId, this.options)`.
  3. Build `PutObjectCommandInput` with Bucket, Key, Body, ContentType, ContentLength
     (`options.size ?? getBodySize(options.body)`), CacheControl, ContentDisposition, ACL, Metadata, and `...sseHeaders`.
  4. `client.send(new PutObjectCommand(input))`.
  5. If `options.onProgress`, call it once with `{ loaded: total ?? 0, total }` (total = size ?? getBodySize).
  6. Return `UploadResult` with `multipart: false`, `fromIdempotencyCache: false`, etag, versionId, size,
     contentType, and `publicUrl = buildPublicUrl(finalKey, bucket)`.
  7. Wrap in try/catch → `throw mapAwsError(err, { key: finalKey, bucket, op: 'upload-single' })`.

Constraints:
- @fileoverview + @layer header already present; functions ≤ 50 lines (split the input assembly into a
  small private helper if `uploadSingleShot` would exceed it); file ≤ 800 lines. English-only, timeless comments.
- StorageException with NO explicit HttpStatus. The `ACL: 'public-read'` caveat (HTTP 400 on modern AWS
  S3, no-op on R2) is already documented in `header-utils` — do not re-explain in code beyond a one-line note.
- AWS SDK v3 SigV4-only; no `signatureVersion`.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.12.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.6 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.6)` — NO Co-Authored-By trailer.
````

---

### Task 2.7 — StorageService.uploadMultipart (lib-storage Upload)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.6

#### Description

The multipart path using the `Upload` class from `@aws-sdk/lib-storage`, configured with `leavePartsOnError: false` so the SDK auto-aborts and cleans up orphan parts on failure. It forwards progress via the `httpUploadProgress` event and surfaces failures as `STORAGE_MULTIPART_ABORTED`. No manual `AbortMultipartUpload` is written.

#### Acceptance criteria

- [ ] A body above `thresholdBytes` triggers multipart (`result.multipart === true`).
- [ ] A stream without a known `size` triggers multipart.
- [ ] `onProgress` is invoked during the upload from the `httpUploadProgress` event with `{ loaded, total, part }`.
- [ ] A failure in `uploader.done()` throws `STORAGE_MULTIPART_ABORTED` with `{ key, bucket, awsMessage }` details.
- [ ] `leavePartsOnError: false` is set (the SDK cleans up parts; no manual abort code exists).
- [ ] `queueSize` and `partSize` come from the resolved multipart options; `pnpm typecheck` passes; coverage finalized in 2.13.

#### Files to create / modify

- `src/server/services/storage.service.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points; zero runtime deps; brotli gate.
`@aws-sdk/lib-storage` is a peerDependency.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.7 of 14

PRECONDITIONS
- `upload()` + `uploadSingleShot()` (Task 2.6) exist and already dispatch to `uploadMultipart`.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.6 (the complete `uploadMultipart` skeleton).
- `../technical_specification.md` § 6.1 (multipart decision + why lib-storage auto-aborts), § 6.3 (progress events).
- Verify the `Upload` class options + the `httpUploadProgress` event shape via context7
  (`@aws-sdk/lib-storage`) before coding — the progress event signature varies across SDK versions.

TASK
Add the private `uploadMultipart(options, finalKey, bucket): Promise<UploadResult>` to the service.

DELIVERABLES
- Import `Upload` from `@aws-sdk/lib-storage`.
- Build `params: PutObjectCommandInput` (Bucket, Key, Body = `options.body`, ContentType, CacheControl,
  ContentDisposition, ACL, Metadata, and `...buildSSE(...)`).
- `const uploader = new Upload({ client: s3Provider.getClient(), params, queueSize: this.options.multipart.queueSize, partSize: this.options.multipart.partSizeBytes, leavePartsOnError: false })`.
  `leavePartsOnError: false` makes the SDK auto-abort and clean up parts on failure — DO NOT write a
  manual `AbortMultipartUpload` for this path.
- If `options.onProgress`, register `uploader.on('httpUploadProgress', (event) => options.onProgress?.({ loaded: event.loaded ?? 0, total: event.total, part: event.part }))`.
- `await uploader.done()`; return `UploadResult` with `multipart: true`, `fromIdempotencyCache: false`,
  etag, versionId, size, contentType, `publicUrl`.
- try/catch → `throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED, { key: finalKey, bucket, awsMessage: (err as Error).message })`. Do NOT route this through `mapAwsError` — multipart has its
  own cleanup semantics. The HTTP status (500) is resolved internally from the catalog — no explicit HttpStatus.

Constraints:
- @fileoverview + @layer header already present; functions ≤ 50 lines; file ≤ 800 lines. English-only,
  timeless comments. NO `signatureVersion`; retries are `maxAttempts` only.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.13 — unit coverage of multipart is partial; the gap is closed by the e2e suite in a later phase.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.7 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.7)` — NO Co-Authored-By trailer.
````

---

### Task 2.8 — StorageService.download + downloadBuffer

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.5

#### Description

`download()` returns the GetObject `Body` as a Node `Readable` (carrying the sdk-stream-mixin) plus `ObjectMetadata`, propagating `Range` / `IfNoneMatch` / `IfMatch`. `downloadBuffer()` is a small-file convenience that materializes the whole object into a `Buffer` via the sdk-stream-mixin `transformToByteArray()`.

#### Acceptance criteria

- [ ] `download()` returns `{ stream, metadata }` for an existing key.
- [ ] `download()` propagates `Range`, `IfNoneMatch`, and `IfMatch` to the GetObject command.
- [ ] `download()` throws `STORAGE_OBJECT_NOT_FOUND` when the response has no `Body`.
- [ ] The returned `stream` is a Node `Readable` consumable via `for await` / `.pipe()`.
- [ ] `downloadBuffer()` materializes the object into a `Buffer` via `transformToByteArray()`.
- [ ] Errors map through `mapAwsError(err, { key, bucket, op: 'download' })`; `downloadBuffer` JSDoc warns it is not for files > 10 MB.
- [ ] File header present; `pnpm typecheck` passes; coverage finalized in 2.13.

#### Files to create / modify

- `src/server/services/storage.service.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points; zero runtime deps; brotli gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.8 of 14

PRECONDITIONS
- StorageService base (Task 2.5) exists. `DownloadOptions` / `ObjectMetadata` exist from the foundation phase.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.7 (the complete download + downloadBuffer skeleton).
- `../technical_specification.md` § 5.1 (the `download` signature: the Body is a Node `Readable` carrying
  the sdk-stream-mixin — `transformToByteArray` / `transformToString` / `transformToWebStream`).
- Verify `GetObjectCommand` / `GetObjectCommandOutput` and the sdk-stream-mixin via context7
  (`@aws-sdk/client-s3`) before coding.

TASK
Add `download()` and `downloadBuffer()` to `src/server/services/storage.service.ts`.

DELIVERABLES
- `async download(options: DownloadOptions): Promise<{ stream: NodeJS.ReadableStream; metadata: ObjectMetadata }>`:
  1. `assertConfigured`, normalize key, resolve bucket.
  2. `client.send(new GetObjectCommand({ Bucket, Key, Range: options.range, IfNoneMatch: options.ifNoneMatch, IfMatch: options.ifMatch }))`.
  3. If `!response.Body` → `throw new StorageException(STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND, { key: finalKey, bucket })` (status from the catalog — no explicit HttpStatus).
  4. Cast `response.Body` to a Node `Readable` (it carries the sdk-stream-mixin).
  5. Build `ObjectMetadata` from the response (same field mapping as `head()`).
  6. Return `{ stream, metadata }`. try/catch → `throw mapAwsError(err, { key, bucket, op: 'download' })`.
- `async downloadBuffer(options: DownloadOptions): Promise<{ buffer: Buffer; metadata: ObjectMetadata }>`:
  1. `const { stream, metadata } = await this.download(options)`.
  2. Materialize via the sdk-stream-mixin: `const bytes = await (stream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()`, then `Buffer.from(bytes)` (a `for await` accumulation is an acceptable equivalent if the mixin is unavailable in a given path).
  3. Return `{ buffer, metadata }`. JSDoc: "NOT recommended for files > 10 MB — use download() for large objects."

Constraints:
- @fileoverview + @layer header already present; functions ≤ 50 lines (extract the response→metadata
  mapping into a small private helper shared with `head()` if it helps stay under the limit); file ≤ 800 lines.
  English-only, timeless comments. NO `signatureVersion`.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.13.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.8 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.8)` — NO Co-Authored-By trailer.
````

---

### Task 2.9 — StorageService.delete (idempotent)

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 2.5

#### Description

An idempotent `delete()` — it issues `DeleteObjectCommand` and treats a mapped 404 (`STORAGE_OBJECT_NOT_FOUND`) as a no-op (warning + return) while propagating any other error.

#### Acceptance criteria

- [ ] `delete()` calls `DeleteObjectCommand` for an existing key.
- [ ] `delete()` on a missing key does not throw (logs a warning and returns).
- [ ] `delete()` propagates non-404 errors.
- [ ] `assertConfigured` runs first; the key is normalized and the bucket resolved.
- [ ] File header present; `pnpm typecheck` passes; coverage finalized in 2.12.

#### Files to create / modify

- `src/server/services/storage.service.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points; zero runtime deps; brotli gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.9 of 14

PRECONDITIONS
- StorageService base (Task 2.5) exists with `assertConfigured`, `resolveBucket`, `mapAwsError`,
  `STORAGE_ERROR_CODES`, and the `Logger`.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.5 (the `delete` method in the skeleton).
- Verify `DeleteObjectCommand` via context7 (`@aws-sdk/client-s3`) before coding.

TASK
Add the idempotent `delete()` to `src/server/services/storage.service.ts`.

DELIVERABLES
- `async delete(key: string, options?: { bucket?: string }): Promise<void>`:
  1. `assertConfigured()`; `finalKey = keyResolver.normalize(key)`; `bucket = resolveBucket(options?.bucket)`.
  2. `await s3Provider.getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey }))`.
  3. try/catch → `const mapped = mapAwsError(err, { key: finalKey, bucket, op: 'delete' })`; if
     `mapped.code === STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND` → `logger.warn(...)` (idempotent no-op)
     and `return`; otherwise `throw mapped`.
- Import `DeleteObjectCommand` from `@aws-sdk/client-s3`.

Constraints:
- @fileoverview + @layer header already present; function ≤ 50 lines. English-only, timeless comments.
  StorageException/mapped errors carry their status from the catalog — no explicit HttpStatus.

Verification:
- `pnpm typecheck` — expected: clean.
- (Coverage/mutation finalized in Task 2.12.)

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.9 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.9)` — NO Co-Authored-By trailer.
````

---

### Task 2.10 — Module wiring — register StorageService + IdempotencyCache + barrel

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.15, 2.1, 2.6, 2.7, 2.8, 2.9

#### Description

Register `StorageService` and the `IdempotencyCache` factory in `BymaxStorageModule.forRoot()` and export `StorageService` from the server barrel so it is injectable in any feature module.

#### Acceptance criteria

- [ ] `IdempotencyCache` is provided via a factory using `DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES` and `DEFAULT_IDEMPOTENCY_CACHE_TTL_MS`.
- [ ] `StorageService` is in `providers` and `exports`, injectable in any consuming module.
- [ ] `src/server/index.ts` exports `StorageService` plus the shared `UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult` aliases (verify they are already exported from the foundation barrel).
- [ ] `pnpm build` produces a `.d.ts` with the new export; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/bymax-storage.module.ts`
- `src/server/index.ts`

#### Agent prompt

````
You are a senior NestJS architect working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points (server + shared); zero runtime
deps; brotli bundle gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.10 of 14

PRECONDITIONS
- `BymaxStorageModule.forRoot()` (Task 1.15) exists. `StorageService` (Tasks 2.5–2.9) and
  `IdempotencyCache` (2.1) exist. The DI token `BYMAX_STORAGE_IDEMPOTENCY_CACHE` and the
  `DEFAULT_IDEMPOTENCY_CACHE_*` constants exist from the foundation phase.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.8 (module registration + barrel updates).

TASK
Wire `StorageService` + `IdempotencyCache` into the module and export from the barrel.

DELIVERABLES
- In `src/server/bymax-storage.module.ts` `forRoot()`:
  - Add the `IdempotencyCache` factory provider:
    `{ provide: BYMAX_STORAGE_IDEMPOTENCY_CACHE, useFactory: () => new IdempotencyCache(DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES, DEFAULT_IDEMPOTENCY_CACHE_TTL_MS) }`.
  - Add `StorageService` to `providers` and to `exports`.
- In `src/server/index.ts`: add the `StorageService` named export and confirm the shared
  `UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult` aliases are re-exported (add any missing).

Constraints:
- @fileoverview + @layer headers already present; do not introduce a barrel that is exported-but-unused.
  English-only, timeless comments. Keep DI tokens as `Symbol`s (no string tokens).

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm build` then `node -e "import('./dist/server/index.mjs').then(m => console.log('StorageService:', typeof m.StorageService))"` — expected: prints `StorageService: function`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.10 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.10)` — NO Co-Authored-By trailer.
````

---

### Task 2.11 — Tests — utilities (idempotency-cache, stream-utils, upload-strategy, header-utils)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 2.1, 2.2, 2.3, 2.4

#### Description

Unit specs that bring all four phase utilities to 100% line/branch coverage and the Stryker mutation gate. The most mutation-sensitive case is the LRU touch ordering in the idempotency cache.

#### Acceptance criteria

- [ ] Four spec files created (one per utility).
- [ ] `idempotency-cache.spec.ts`: set/get round-trip, TTL expiry (injected clock), eviction over cap, the critical LRU-touch test (A, B, C, A → over cap removes B not A), `computeKey` determinism, `clear()`.
- [ ] `stream-utils.spec.ts`: type guards, `getBodySize` for Buffer/Uint8Array/stream, `peekFirstBytes` zero-copy for buffers, `peekFirstBytes` tee for streams with a fully consumable `replacementBody`, `bufferToReadable`.
- [ ] `upload-strategy.spec.ts`: the full decision table (small/large buffer, stream with/without size, Uint8Array).
- [ ] `header-utils.spec.ts`: each builder including the SSE `'NONE'` short-circuit and both ACL branches.
- [ ] `pnpm test src/server/utils/` passes; every util file at 100% line/branch; Stryker mutation ≥ 95 (break 95).

#### Files to create / modify

- `src/server/utils/idempotency-cache.spec.ts`
- `src/server/utils/stream-utils.spec.ts`
- `src/server/utils/upload-strategy.spec.ts`
- `src/server/utils/header-utils.spec.ts`

#### Agent prompt

````
You are a senior TypeScript test engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers. Test stack: Jest + ts-jest. The library coverage floor is 100% line/branch; the Stryker
mutation gate is high 100 / low 95 / break 95.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.11 of 14

PRECONDITIONS
- The four utilities exist: `idempotency-cache.ts` (2.1), `stream-utils.ts` (2.2),
  `upload-strategy.ts` (2.3), `header-utils.ts` (2.4).

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.1, § 3.2, § 3.3, § 3.4 (the acceptance criteria per utility).

TASK
Create the four `.spec.ts` files; reach 100% line/branch on each utility and survive the Stryker gate.

DELIVERABLES
1. `src/server/utils/idempotency-cache.spec.ts` (10+ cases): set/get round-trip; TTL expiry via an
   injected `now`; eviction when `size > maxEntries`; the CRITICAL LRU-touch test (access A, B, C, A;
   over cap the removed entry is B, not A — this is the most mutation-sensitive assertion);
   `computeKey` determinism; `clear()` empties the map.
2. `src/server/utils/stream-utils.spec.ts` (8+ cases): `isReadable` / `isBufferLike` guards;
   `getBodySize` for Buffer / Uint8Array / stream; `peekFirstBytes` zero-copy on a Buffer;
   `peekFirstBytes` tee on a stream — assert the head AND that `replacementBody` yields the FULL content;
   `bufferToReadable` returns a Readable.
3. `src/server/utils/upload-strategy.spec.ts` (6+ cases): the full decision table.
4. `src/server/utils/header-utils.spec.ts` (8+ cases): `buildContentDisposition`, `buildCacheControl`,
   `buildSSE` (including the `'NONE'` short-circuit and the `aws:kms` + AES256 branches), both `buildACL` branches.

Constraints:
- AAA pattern; every `it()` carries a short comment stating what it proves; use `it.each` for table variants.
  English-only, timeless comments. No fake assertions — exercise real branches.

Verification:
- `pnpm test src/server/utils/` — expected: green.
- `pnpm test:cov -- --testPathPattern=src/server/utils` — expected: 100% line/branch on all four files.
- Run the Stryker gate scoped to the utils — expected: mutation score ≥ 95 (break 95).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.11 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.11)` — NO Co-Authored-By trailer.
````

---

### Task 2.12 — Tests — StorageService (single-shot + head/exists/delete/getPublicUrl)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 2.9, 2.10

#### Description

Unit specs for the non-multipart `StorageService` paths, mocking `S3Client.send()` with `jest.spyOn` (DIY mock — no `aws-sdk-client-mock`) inside a `Test.createTestingModule` with overridden providers.

#### Acceptance criteria

- [ ] 15+ cases covering: `STORAGE_NOT_CONFIGURED`; `STORAGE_KEY_INVALID` via the key resolver (path traversal); `STORAGE_BODY_MISSING`; `STORAGE_CONTENT_TYPE_REQUIRED`; `PutObjectCommand` called with normalized key + metadata + contentType; SSE applied when configured; ACL `public-read` when `publicRead: true`; idempotency dedup (first `false`, second `true`); `onProgress` invoked in single-shot.
- [ ] `head()` returns a populated `ObjectMetadata`; `head()` throws `STORAGE_OBJECT_NOT_FOUND` on 404.
- [ ] `exists()` true for a present key, false on 404.
- [ ] `delete()` calls `DeleteObjectCommand`; `delete()` is idempotent on 404 (does not throw).
- [ ] `getPublicUrl()` uses the CDN when configured and avoids duplicating the bucket in the path.
- [ ] `pnpm test src/server/services/storage.service.spec.ts` passes; `storage.service.ts` at 100% line/branch for the covered paths; Stryker mutation ≥ 95.

#### Files to create / modify

- `src/server/services/storage.service.spec.ts`

#### Agent prompt

````
You are a senior TypeScript test engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers. Test stack: Jest + ts-jest. Library coverage floor 100% line/branch; Stryker break 95.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.12 of 14

PRECONDITIONS
- `StorageService` (Tasks 2.5–2.9) and the module wiring (2.10) exist.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.8 (the representative `storage.service.spec.ts` sample).
- `../technical_specification.md` § 5.1 (signatures), § 6.5 (automatic headers).

TASK
Create `src/server/services/storage.service.spec.ts` for the non-multipart paths.

DELIVERABLES
- Setup via `Test.createTestingModule` overriding providers; mock the S3 client with
  `jest.spyOn(s3Provider.getClient(), 'send')` (DIY — no `aws-sdk-client-mock`).
- 15+ cases (see the acceptance criteria): the four validation throws; `PutObjectCommand` input assertion;
  SSE applied; ACL `public-read`; idempotency dedup (first call `fromIdempotencyCache: false`, second `true`);
  `onProgress` in single-shot; `head()` populated metadata; `head()` 404 → `STORAGE_OBJECT_NOT_FOUND`;
  `exists()` true / false-on-404; `delete()` issues `DeleteObjectCommand`; `delete()` idempotent on 404;
  `getPublicUrl()` CDN + no bucket duplication.
- 404 is simulated by rejecting `send` with `{ name: 'NotFound', $metadata: { httpStatusCode: 404 } }`.

Constraints:
- AAA pattern; every `it()` carries a short comment; English-only, timeless comments; no `@ts-ignore` /
  `eslint-disable`. Assert error codes via `toMatchObject({ code: 'STORAGE_...' })`.

Verification:
- `pnpm test src/server/services/storage.service.spec.ts` — expected: green.
- `pnpm test:cov -- --testPathPattern=storage.service` — expected: 100% line/branch on the covered paths.
- Stryker scoped to the service — expected: mutation ≥ 95 (break 95).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.12 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.12)` — NO Co-Authored-By trailer.
````

---

### Task 2.13 — Tests — StorageService multipart + download/downloadBuffer

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: M
- **Depends on**: 2.12

#### Description

Unit specs for the multipart and download paths. Multipart mocks the `Upload` class from `@aws-sdk/lib-storage`; download asserts the stream/metadata, header propagation, the not-found throw, and the `downloadBuffer` materialization.

#### Acceptance criteria

- [ ] Two spec files created (multipart + download).
- [ ] Multipart: body above threshold → `result.multipart === true`; stream without size → `multipart === true`; `httpUploadProgress` event → `onProgress` invoked; error in `uploader.done()` → `STORAGE_MULTIPART_ABORTED`.
- [ ] Download: `download()` returns `{ stream, metadata }`; propagates `Range` / `IfNoneMatch` / `IfMatch`; throws `STORAGE_OBJECT_NOT_FOUND` for an empty body; `downloadBuffer()` materializes the stream into a `Buffer`.
- [ ] `pnpm test` for both specs passes; the multipart/download paths reach the library coverage floor (residual e2e-only gaps are closed in a later phase).

#### Files to create / modify

- `src/server/services/storage.service.multipart.spec.ts`
- `src/server/services/storage.service.download.spec.ts`

#### Agent prompt

````
You are a senior TypeScript test engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers. Test stack: Jest + ts-jest. Library coverage floor 100% line/branch; Stryker break 95.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.13 of 14

PRECONDITIONS
- `uploadMultipart` (2.7) and `download`/`downloadBuffer` (2.8) exist.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.6, § 3.7 (criteria for multipart and download).
- `../technical_specification.md` § 5.1 (the Body is a Node Readable carrying the sdk-stream-mixin).

TASK
Create the multipart and download spec files.

DELIVERABLES
1. `src/server/services/storage.service.multipart.spec.ts`: mock the `Upload` class via
   `jest.mock('@aws-sdk/lib-storage', ...)`. Cases: body above threshold → `result.multipart === true`;
   stream without size → `multipart === true`; emit `httpUploadProgress` → `onProgress` invoked;
   reject `uploader.done()` → throws `STORAGE_MULTIPART_ABORTED` (assert `{ code: 'STORAGE_MULTIPART_ABORTED' }`).
2. `src/server/services/storage.service.download.spec.ts`: `download()` returns stream + metadata;
   asserts `Range` / `IfNoneMatch` / `IfMatch` are forwarded to `GetObjectCommand`; an empty `Body` →
   `STORAGE_OBJECT_NOT_FOUND`; `downloadBuffer()` materializes the content (provide a mock Body exposing
   `transformToByteArray()` returning the bytes, with a `for await` fallback if the path uses one).

Constraints:
- AAA pattern; every `it()` carries a short comment; English-only, timeless comments; no `@ts-ignore`.
  Multipart unit coverage is partial by nature — close the residual gap in the e2e suite of a later
  phase; do not fake-cover the auto-abort path.

Verification:
- `pnpm test src/server/services/storage.service.multipart.spec.ts src/server/services/storage.service.download.spec.ts` — expected: green.
- `pnpm test:cov -- --testPathPattern=storage.service` — expected: at the library floor for the covered branches.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote.
4. Append a Completion-log entry: `- 2.13 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.13)` — NO Co-Authored-By trailer.
````

---

### Task 2.14 — Phase validation + smoke test against MinIO

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13

#### Description

Consolidated phase validation (typecheck + lint + coverage + build, with the brotli bundle budgets and the library coverage floor) plus a manual end-to-end smoke test against a local MinIO: upload, head, downloadBuffer, and a double delete (the second must be a no-op).

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build` all pass; coverage at the library floor (100% line/branch on phase files); the brotli bundle budgets hold (server < 30 KB brotli, shared < 3.5 KB brotli).
- [ ] The MinIO smoke test passes every step (upload → head → downloadBuffer === 'hello' → delete → delete no-op).
- [ ] The smoke `forRoot` config uses `forcePathStyle: true` and `requestChecksumCalculation`/`responseChecksumValidation` = `'WHEN_REQUIRED'` (the non-AWS checksum trap) and NO `signatureVersion`.
- [ ] **GitHub CI is green on the PR** — the `ci` (verify + e2e), `codeql`, and `scorecard` runs on the PR head all concluded `success` (`gh run list`/`gh run view`). The phase is not closed with red or pending CI.
- [ ] `/bymax-quality:code-review` has been run and its findings applied.

#### Files to create / modify

- `/tmp/smoke-storage-phase2.mjs` (throwaway smoke script — not committed)

#### Agent prompt

````
You are a senior NestJS release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a NestJS storage library over AWS SDK v3 S3 for S3-compatible
providers (AWS S3, R2, B2, MinIO, Spaces, Wasabi). Dual entry points; zero runtime deps; brotli gate.

CURRENT PHASE: 2 (Upload (single, multipart, stream) + Download) — Task 2.14 of 14 (LAST)

PRECONDITIONS
- Tasks 2.1–2.13 are done: the full upload/download/metadata/delete surface is implemented, wired, and tested.

REQUIRED READING (only these — token economy):
- `../development_plan.md` § 3.9 (phase validation + the MinIO smoke procedure).

TASK
Run the consolidated phase gate and a manual smoke test against a local MinIO.

DELIVERABLES
1. Run, from the repo root:
   `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build`
   Validate: coverage at the library floor (100% line/branch on phase files); the brotli bundle budgets
   hold (server < 30 KB brotli, shared < 3.5 KB brotli); build OK.
2. Bring up MinIO and a bucket:
   - `docker run -d --name minio-smoke -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data --console-address ':9001'`
   - create `test-bucket` via `minio/mc` (`mc alias set local http://localhost:9000 minioadmin minioadmin && mc mb local/test-bucket`).
3. Write `/tmp/smoke-storage-phase2.mjs` (NOT committed): import `BymaxStorageModule` + `StorageService`
   from `dist/server/index.mjs`; `forRoot` with the MinIO endpoint, `forcePathStyle: true`, and
   `requestChecksumCalculation: 'WHEN_REQUIRED'` + `responseChecksumValidation: 'WHEN_REQUIRED'` (the #1
   non-AWS provider-compat trap — without it MinIO uploads/downloads fail on the SDK's default streaming
   checksum trailers); NO `signatureVersion` (SigV4-only). Bootstrap a Nest application context, then:
   upload `smoke/hello.txt` (`Buffer.from('hello')`, `text/plain`); `head` (assert size + contentType);
   `downloadBuffer` (assert the buffer equals 'hello'); `delete`; `delete` again (must be a no-op);
   `await app.close()`. Print a success line per step.
4. Clean up: `docker rm -f minio-smoke`.
5. Run `/bymax-quality:code-review` over the phase changes and apply every finding.

Constraints:
- Do NOT commit `/tmp/smoke-storage-phase2.mjs`. English-only output. NO `signatureVersion`; retries are
  `maxAttempts` (default 3), never `maxRetries`. Never create `.gitkeep` / empty-dir placeholders.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build` — expected: all green, budgets + floor met.
- `node /tmp/smoke-storage-phase2.mjs` — expected: every step prints success, no error.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (`X / 14`) in the header blockquote (this task completes the phase → mark the phase ✅).
4. Append a Completion-log entry: `- 2.14 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `<type>(storage): <subject> (2.14)` — NO Co-Authored-By trailer.
````

---

## Completion log

_Append `- <id> ✅ <YYYY-MM-DD> — <summary>` as each task completes._

- 2.1 ✅ 2026-06-30 — IdempotencyCache: hand-rolled LRU + TTL on a Map (sha256 cache key, injectable clock, oldest-first eviction).
- 2.2 ✅ 2026-06-30 — stream-utils: body type guards, best-effort sizing, memory-bounded two-PassThrough peek, and a buffer-to-Readable adapter.
- 2.3 ✅ 2026-06-30 — upload-strategy: pure single-shot vs multipart decision from body, declared size, and threshold.
- 2.4 ✅ 2026-06-30 — header-utils: Content-Disposition, Cache-Control, SSE (with the NONE sentinel), and ACL builders.
- 2.5 ✅ 2026-06-30 — StorageService base: DI constructor, assertConfigured/resolveBucket/buildPublicUrl helpers, head/exists/getPublicUrl.
