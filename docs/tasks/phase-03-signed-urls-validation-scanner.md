# Phase 3 — Signed URLs + Validation + Scanner

> **Status**: ✅ Done · **Progress**: 12 / 12 tasks · **Last updated**: 2026-06-30
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) § 4
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) § 7, § 8, § 9

---

## Context

This phase makes the library able to issue **presigned URLs**, enforce **upload policies**, and plug in a **virus scanner**. It delivers `SignedUrlService` (GET / PUT / multipart presign via `@aws-sdk/s3-request-presigner`), `ValidationService` (a fixed pipeline: MIME whitelist with wildcards → size → custom `IUploadValidator` chain), and `FileScannerService` (a thin wrapper over the consumer-injected `IFileScanner` with pre/post modes, reject-on-unknown, and post-upload cleanup-on-infected). The three services are then wired into `StorageService.upload()` so every upload runs validation and scanning before (and, when configured, after) it touches the bucket.

Two pure security utilities underpin the phase: `clampTtl` (validates and silently clamps a presign TTL — the SigV4 presign hard ceiling is **7 days / 604800 s**) and `mimeMatches` (case-insensitive wildcard MIME matching). Both are security boundaries and carry a **mutation-100%** gate. When the phase is done, real GET/PUT signed URLs work end-to-end against MinIO, uploads are rejected against configurable MIME/size/custom policies, and an external scanner (e.g. ClamAV via the consumer) can be injected without touching library code.

---

## Rules-of-phase

1. **TDD — test-first.** For every implementation file, write the co-located `*.spec.ts` first, watch it fail, then implement to green. Implementation tasks drive each file to **100% line/branch coverage**; the dedicated test tasks (3.8–3.11) harden those specs with the full edge-case matrix and the mutation gate.
2. **Coverage floor = 100% line/branch on every file implemented in this phase** (the Bymax library floor — not 80%, not 95%). **Mutation**: Stryker thresholds high 100 / low 95 / **break 95**; `clampTtl` and `mimeMatches` are security boundaries and must reach **mutation score 100%** (document any provably-equivalent mutant inline).
3. **English-only and timeless comments.** No `Phase N` / `Task X` / roadmap-stage references inside any source, JSDoc (`@param`/`@returns`/`@throws`), inline note, or TODO. Explain *what* and *why*, never *which roadmap stage*.
4. **`@fileoverview` + `@layer` header on every new file** (utilities → `@layer server/utils`, services → `@layer server/services`, providers → `@layer server/providers`).
5. **Clean Code sizing.** Functions ≤ 50 lines; files ≤ 800 lines (200–400 typical). One responsibility per file/function.
6. **Official-docs-first (context7) before any AWS SDK API.** Re-verify `@aws-sdk/client-s3` (the command classes) and `@aws-sdk/s3-request-presigner` (`getSignedUrl`) against the current docs before coding. **AWS SDK v3 is SigV4-only** — there is **no `signatureVersion` option** anywhere. Any client configuration uses **`maxAttempts`** (default `3`), never `maxRetries`.
7. **`StorageException` is constructed from the error code (+ optional details) only** — its HTTP status is resolved from the internal `STORAGE_ERROR_STATUS` map (`code → HttpStatus`). **Never pass an explicit `HttpStatus` argument** and never import `HttpStatus` to set a status. `STORAGE_ERROR_MESSAGES` and `STORAGE_ERROR_STATUS` are internal (not exported). The plan skeletons that pass `HttpStatus.BAD_REQUEST` predate this — follow the real signature in `src/server/errors/storage-exception.ts`.
8. **Signed URLs are temporary credentials.** NEVER log a returned `url`; every method that returns one carries JSDoc reinforcing "never log this URL". Never cache a signed URL across users.
9. **TTL semantics.** `clampTtl` silently clamps to `maxTtlSeconds` (consumer-friendly, parity with the SDK) and rejects TTL ≤ 0 with `STORAGE_SIGNED_URL_TTL_INVALID`. The presign hard ceiling is 604800 s (7 days).
10. **No-op providers (exact shapes).** `NoOpUploadValidator.validate()` returns `{ ok: true }`; `NoOpFileScanner.scan()` returns `{ status: 'clean', engine: 'noop' }`.
11. **`defaultPublicRead` ACL caveat.** ACL-based public-read (`ACL: 'public-read'`) **fails on modern AWS S3** (HTTP 400 `AccessControlListNotSupported` under Block Public Access / BucketOwnerEnforced) and is a **no-op on Cloudflare R2**. Document this in `getUploadUrl` JSDoc; do not rely on ACLs for public access.
12. **Conventional Commits**, one per task, **with NO `Co-Authored-By` (or any AI-attribution) trailer**.
13. **Never create `.gitkeep` / `.keep` or empty-directory placeholders** — directories emerge from real files.
14. **Bundle budget is brotli.** New server code stays within the ceilings (server < 30 KB brotli, shared < 3.5 KB brotli) — verified via `scripts/check-size.mjs` at phase close.

---

## Reference docs

- [`../technical_specification.md`](../technical_specification.md) — § 7 "Signed URLs (GET, PUT, multipart)" (§ 7.1 service shape, § 7.2 types, § 7.3 security), § 8 "Validation" (§ 8.1 pipeline order, § 8.2 wildcard MIME, § 8.3 size, § 8.4 `IUploadValidator` + `NoOpUploadValidator`), § 9 "Virus Scan Hook" (§ 9.1 interface, § 9.2 modes, § 9.3 behavior + `NoOpFileScanner`).
- [`../development_plan.md`](../development_plan.md) — § 4.1 (`ttl-clamp`), § 4.2 (`SignedUrlService`), § 4.3 (`mime-match`), § 4.4 (`ValidationService`), § 4.5 (`FileScannerService`), § 4.6 (upload integration), § 4.7 (module/barrel), § 4.8 (phase validation). Treat the skeletons as guidance only — apply the corrections in Rules-of-phase 6–11 over any stale skeleton text.
- `/bymax-workflow:standards` skill — universal TypeScript coding rules (type/lint discipline, JSDoc on exports, layered architecture, typed errors).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 3.1 | `ttl-clamp` utility (TTL validation + silent clamp) | ✅ Done | P0 | S | 1.11 |
| 3.2 | `SignedUrlService` (GET, PUT, multipart) | ✅ Done | P0 | L | 1.13, 1.14, 2.4, 3.1 |
| 3.3 | `mime-match` utility (wildcard MIME matching) | ✅ Done | P0 | S | 1.6 |
| 3.4 | `ValidationService` (MIME → size → custom validators) | ✅ Done | P0 | M | 2.2, 3.3 |
| 3.5 | `FileScannerService` (pre/post + reject-on-unknown) | ✅ Done | P0 | M | 1.9, 1.10, 1.11 |
| 3.6 | Integrate validation + scanner into `StorageService.upload()` | ✅ Done | P0 | M | 2.6, 3.4, 3.5 |
| 3.7 | Module wiring + barrel update | ✅ Done | P0 | S | 3.2, 3.4, 3.5, 3.6 |
| 3.8 | Tests — `ttl-clamp` + `mime-match` (mutation 100%) | ✅ Done | P0 | M | 3.1, 3.3 |
| 3.9 | Tests — `SignedUrlService` | ✅ Done | P1 | M | 3.2 |
| 3.10 | Tests — `ValidationService` + `FileScannerService` | ✅ Done | P1 | M | 3.4, 3.5 |
| 3.11 | Tests — `StorageService` validation/scanner integration | ✅ Done | P1 | M | 3.6 |
| 3.12 | Phase validation + signed-URL smoke test | ✅ Done | P1 | M | 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11 |

---

## Tasks

### Task 3.1 — `ttl-clamp` utility (TTL validation + silent clamp)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.11

#### Description

A pure function `clampTtl(ttlSeconds, defaultTtl, maxTtl)` that resolves the effective presign TTL: substitutes the default for `undefined`, rejects non-positive TTLs, and silently clamps anything above the maximum. This is a security boundary — every signed URL TTL flows through it.

#### Acceptance criteria

- [x] `clampTtl(undefined, 300, 604800)` → `300`.
- [x] `clampTtl(60, 300, 604800)` → `60`.
- [x] `clampTtl(999999, 300, 604800)` → `604800` (silent clamp, no throw).
- [x] `clampTtl(0, 300, 604800)` throws `STORAGE_SIGNED_URL_TTL_INVALID`.
- [x] `clampTtl(-10, 300, 604800)` throws `STORAGE_SIGNED_URL_TTL_INVALID`.
- [x] Boundary `ttl === maxTtl` returns `maxTtl` (no off-by-one).
- [x] JSDoc states the silent-clamp rationale (consumer-friendly, parity with the SDK) and that non-positive TTL throws.
- [x] File carries `@fileoverview` + `@layer server/utils`; the function is ≤ 50 lines.
- [x] `StorageException` is thrown with the code (+ details) only — no explicit `HttpStatus` argument.
- [x] Co-located spec drives the file to 100% line/branch coverage; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/utils/ttl-clamp.ts`
- `src/server/utils/ttl-clamp.spec.ts` (TDD; the exhaustive matrix + mutation gate is owned by Task 3.8)

#### Agent prompt

````
You are a senior NestJS security/release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — a production-grade NestJS storage library over an
S3-compatible API (AWS SDK v3, SigV4-only), published to npm. Strict TypeScript, a 100%
line/branch coverage floor on every file, and Stryker mutation testing (break 95).

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.1 of 12

PRECONDITIONS
- The error catalog exists: `src/server/errors/storage-exception.ts` (StorageException) and
  `src/shared/constants/error-codes.constants.ts` (STORAGE_ERROR_CODES) are implemented.
- StorageException resolves its HTTP status internally from a code→HttpStatus map; its
  constructor takes the error code and an OPTIONAL details object — it does NOT take an
  HttpStatus argument.

REQUIRED READING (only these — do not load whole files):
- `docs/technical_specification.md` § 7.3 "Security" (silent-clamp rule, smallest-viable-TTL).
- `docs/development_plan.md` § 4.1 (the `clampTtl` objective and acceptance criteria — treat its
  skeleton as guidance; correct it per the constraint below).

TASK
Create the pure `clampTtl` utility test-first.

DELIVERABLES
1. `src/server/utils/ttl-clamp.spec.ts` written FIRST: undefined→default, value<max→same,
   value>max→clamp, 0→throws, negative→throws, boundary ttl===max→max. Assert the thrown
   error code is `STORAGE_SIGNED_URL_TTL_INVALID`.
2. `src/server/utils/ttl-clamp.ts`:
   - `@fileoverview` + `@layer server/utils` header.
   - `export function clampTtl(ttlSeconds: number | undefined, defaultTtl: number, maxTtl: number): number`.
   - Resolve `const ttl = ttlSeconds ?? defaultTtl`; if `ttl <= 0` throw
     `new StorageException(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID, { reason: 'TTL must be > 0', provided: ttl })`;
     otherwise `return Math.min(ttl, maxTtl)`.
   - JSDoc: negative/zero throws; above-max is silently clamped (intentional, consumer-friendly,
     parity with the SDK); undefined uses the default. The presign hard ceiling is 604800 s (7 days).

Constraints:
- Construct StorageException with the code (+ details) ONLY — do NOT pass HttpStatus and do NOT
  import HttpStatus. Follow the real signature in `src/server/errors/storage-exception.ts`.
- Function ≤ 50 lines; English-only, timeless comments (no roadmap/phase/task references).
- Do not create any placeholder/`.gitkeep` files.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/utils/ttl-clamp.spec.ts` — expected: green, 100% line/branch on ttl-clamp.ts.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.1 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add ttl-clamp utility (3.1)` — NO Co-Authored-By trailer.
````

---

### Task 3.2 — `SignedUrlService` (GET, PUT, multipart)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.13, 1.14, 2.4, 3.1

#### Description

The service that issues presigned URLs via `@aws-sdk/s3-request-presigner`. Three public methods: `getDownloadUrl` (GET), `getUploadUrl` (PUT, returning the `Content-Type` the client must echo), and `getMultipartUploadUrls` (server-side `CreateMultipartUpload` + N presigned `UploadPart` URLs + a presigned `Complete` URL). Every TTL flows through `clampTtl`; every AWS failure is normalized through `mapAwsError`.

#### Acceptance criteria

- [x] `getDownloadUrl` returns a URL carrying `X-Amz-Signature` and `X-Amz-Expires` query params (verifiable via URL parsing) and a correct `expiresAt`.
- [x] `getDownloadUrl` clamps TTL above `maxTtlSeconds` and throws `STORAGE_SIGNED_URL_TTL_INVALID` for TTL ≤ 0.
- [x] `getDownloadUrl` forwards `ResponseContentDisposition` / `ResponseContentType` when provided.
- [x] `getUploadUrl` returns `requiredHeaders['Content-Type']` equal to `options.contentType`, and forwards `Metadata` + `ContentLength: maxSizeBytes`.
- [x] `getUploadUrl` applies `ACL: 'public-read'` (via `buildACL`) when `publicRead: true`; its JSDoc documents the ACL caveat (fails on modern AWS S3, no-op on R2).
- [x] `getMultipartUploadUrls` calls `CreateMultipartUploadCommand` first, returns `uploadId` + N `partUrls` (partNumbers 1..N) + `completeUrl`.
- [x] `getMultipartUploadUrls` rejects `parts <= 0` and throws when the provider returns no `UploadId`.
- [x] `assertConfigured()` throws `STORAGE_NOT_CONFIGURED` when the client is not configured.
- [x] Every method JSDoc reinforces "never log the returned URL"; all AWS errors pass through `mapAwsError`.
- [x] File carries `@fileoverview` + `@layer server/services`; each method ≤ 50 lines; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/services/signed-url.service.ts`
- `src/server/services/signed-url.service.spec.ts` (TDD; the full 12+ case matrix is owned by Task 3.9)

#### Agent prompt

````
You are a senior NestJS security/release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.2 of 12

PRECONDITIONS
- `clampTtl` (src/server/utils/ttl-clamp.ts) exists.
- KeyResolverService (key normalization + traversal guard), S3ClientProvider (lazy client +
  isConfigured()/getClient()), `buildACL` (src/server/utils/header-utils.ts), `mapAwsError`,
  StorageException, STORAGE_ERROR_CODES, the signed-url option interfaces and SignedUrlResult all exist.
- StorageException takes the error code (+ optional details) only; status comes from an internal map.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 7 (all of it — § 7.1 method shapes, § 7.2 SignedGetUrlOptions/
  SignedPutUrlOptions/SignedUrlResult, § 7.3 security: never log a URL, never cache across users).
- `docs/development_plan.md` § 4.2 (the SignedUrlService skeleton + acceptance — apply the
  corrections in the Constraints below).

BEFORE CODING: verify `getSignedUrl` from `@aws-sdk/s3-request-presigner` and the
Get/Put/CreateMultipartUpload/UploadPart/CompleteMultipartUpload command classes from
`@aws-sdk/client-s3` against current docs via context7.

TASK
Implement `SignedUrlService` test-first.

DELIVERABLES
1. `signed-url.service.spec.ts` (TDD seed covering each method's happy path + the TTL guards;
   mock `getSignedUrl` via `jest.mock('@aws-sdk/s3-request-presigner')` and mock the client `send`
   for CreateMultipartUpload).
2. `src/server/services/signed-url.service.ts`:
   - `@fileoverview` + `@layer server/services`; `@Injectable()`.
   - Constructor injects `@Inject(BYMAX_STORAGE_OPTIONS) options: ResolvedBymaxStorageOptions`,
     `S3ClientProvider`, `KeyResolverService`.
   - `private assertConfigured()` → throws `STORAGE_NOT_CONFIGURED` when `!s3Provider.isConfigured()`.
   - `getDownloadUrl(options: SignedGetUrlOptions): Promise<SignedUrlResult>` — normalize key,
     resolve bucket, `ttl = clampTtl(options.ttlSeconds, signedUrls.defaultGetTtlSeconds, signedUrls.maxTtlSeconds)`,
     presign a `GetObjectCommand` (forward ResponseContentDisposition/ResponseContentType),
     return `{ url, expiresAt: new Date(Date.now() + ttl * 1000), method: 'GET', requiredHeaders: {} }`.
   - `getUploadUrl(options: SignedPutUrlOptions): Promise<SignedUrlResult>` — clamp with
     `defaultPutTtlSeconds`; presign a `PutObjectCommand` with ContentType, `ContentLength: maxSizeBytes`,
     `ACL: buildACL(publicRead, defaultPublicRead)`, Metadata; return
     `requiredHeaders: { 'Content-Type': options.contentType }`. JSDoc: the client MUST send exactly
     that Content-Type (part of the signature); document the ACL caveat (ACL public-read fails on
     modern AWS S3 / no-op on R2 — do not rely on it).
   - `getMultipartUploadUrls(options): Promise<MultipartUploadUrlsResult>` — reject `parts <= 0`;
     `send(CreateMultipartUploadCommand)` → require `UploadId` (throw if missing); `Promise.all` of N
     presigned `UploadPartCommand` (PartNumber 1..N); presign `CompleteMultipartUploadCommand`;
     return `{ uploadId, partUrls, completeUrl }`.
   - Wrap each method body in try/catch → `mapAwsError(err, { key, bucket, op })`.
   - Every method JSDoc reinforces: NEVER log the returned URL; never cache across users.

Constraints:
- AWS SDK v3 is SigV4-only — no `signatureVersion` anywhere. Construct StorageException with the
  code (+ details) only — never pass HttpStatus.
- Methods ≤ 50 lines (extract a private presign helper if needed). English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/services/signed-url.service.spec.ts` — expected: green.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.2 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add SignedUrlService GET/PUT/multipart (3.2)` — NO Co-Authored-By trailer.
````

---

### Task 3.3 — `mime-match` utility (wildcard MIME matching)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.6

#### Description

A pure function `mimeMatches(mime, whitelist)` that decides whether a content type matches at least one whitelist pattern: exact (case-insensitive), subtype wildcard (`image/*`), and full wildcard (`*/*`). Parameters after `;` (e.g. `charset=utf-8`) are stripped before matching. Security boundary — carries a mutation-100% gate.

#### Acceptance criteria

- [x] `mimeMatches('image/jpeg', ['image/jpeg'])` → `true`.
- [x] `mimeMatches('IMAGE/JPEG', ['image/jpeg'])` → `true` (case-insensitive).
- [x] `mimeMatches('image/png', ['image/*'])` → `true` (subtype wildcard).
- [x] `mimeMatches('video/mp4', ['image/*'])` → `false`.
- [x] `mimeMatches('text/plain; charset=utf-8', ['text/plain'])` → `true` (params stripped).
- [x] `mimeMatches('anything', ['*/*'])` → `false` (no `/` in the input).
- [x] `mimeMatches('image/jpeg', ['*/*'])` → `true`.
- [x] `mimeMatches('', ['image/*'])` → `false`.
- [x] File carries `@fileoverview` + `@layer server/utils`; function ≤ 50 lines; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/utils/mime-match.ts`
- `src/server/utils/mime-match.spec.ts` (TDD; the exhaustive matrix + mutation gate is owned by Task 3.8)

#### Agent prompt

````
You are a senior NestJS security/release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.3 of 12

PRECONDITIONS
- The src/server and src/shared folder structure exists.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 8.2 "MIME whitelist (supports wildcards)" (case-insensitive,
  `*` in subtype).
- `docs/development_plan.md` § 4.3 (the `mimeMatches` skeleton + acceptance).

TASK
Create the pure `mimeMatches` utility test-first.

DELIVERABLES
1. `src/server/utils/mime-match.spec.ts` FIRST — cover all eight acceptance cases plus:
   whitespace-padded pattern `' image/png '` matches, mixed-case pattern, empty whitelist → false,
   multiple patterns where a later one matches.
2. `src/server/utils/mime-match.ts`:
   - `@fileoverview` + `@layer server/utils` header.
   - `export function mimeMatches(mime: string, whitelist: readonly string[]): boolean`.
   - Normalize: `const normalized = mime.split(';')[0]?.trim().toLowerCase() ?? ''`; return false when
     empty or missing `/`. Split into `[type, subtype]`. A pattern matches when: trimmed/lowered pattern
     equals normalized, OR pattern is `*/*`, OR pattern subtype is `*` and its type equals `type`.
   - JSDoc documents the three match modes + the parameter-stripping behavior.

Constraints:
- Pure function, no side effects, no external deps. Function ≤ 50 lines.
- English-only, timeless comments (no roadmap/phase/task references).

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/utils/mime-match.spec.ts` — expected: green, 100% line/branch on mime-match.ts.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.3 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add mime-match utility (3.3)` — NO Co-Authored-By trailer.
````

---

### Task 3.4 — `ValidationService` (MIME → size → custom validators)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.2, 3.3

#### Description

The service that runs the upload validation pipeline in a fixed order: MIME whitelist (when configured), then best-effort size check, then the injected `IUploadValidator[]` chain. It returns the (possibly tee'd) body that must be used for the actual upload — when a validator peeks bytes via `readBytes`, the original stream is consumed and a replacement `PassThrough` is returned. Ships the exported `NoOpUploadValidator` default.

#### Acceptance criteria

- [x] Empty/undefined MIME whitelist → does not block.
- [x] MIME outside the whitelist → `STORAGE_MIME_NOT_ALLOWED` (resolves to HTTP 415 via the status map), details `{ contentType, whitelist }`.
- [x] Wildcard `image/*` accepts `image/png`.
- [x] `size > maxSizeBytes` → `STORAGE_SIZE_EXCEEDED` (HTTP 413).
- [x] `size` undefined (stream without declared size) → passes the size check (best-effort).
- [x] A custom validator returning `{ ok: false, reason }` → `STORAGE_VALIDATION_FAILED` (HTTP 400) with `{ validator: validator.name, reason }` in details.
- [x] A validator that calls `readBytes()` on a stream consumes bytes once; the returned `body` (replacement) is what gets uploaded.
- [x] Execution order is MIME → size → custom (verifiable via spy).
- [x] `NoOpUploadValidator.name === 'no-op'` and its `validate()` returns `{ ok: true }`.
- [x] Both files carry `@fileoverview` + `@layer`; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/services/validation.service.ts`
- `src/server/providers/no-op-validator.ts`
- `src/server/services/validation.service.spec.ts` (TDD; the full matrix is owned by Task 3.10)

#### Agent prompt

````
You are a senior NestJS security/release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.4 of 12

PRECONDITIONS
- `mimeMatches` (src/server/utils/mime-match.ts) exists.
- `peekFirstBytes` + the `UploadBody` type (src/server/utils/stream-utils.ts), the
  `IUploadValidator` and `UploadOptions` interfaces, the DI tokens
  `BYMAX_STORAGE_OPTIONS` / `BYMAX_STORAGE_UPLOAD_VALIDATORS`, StorageException, and
  STORAGE_ERROR_CODES all exist.
- StorageException takes the error code (+ optional details) only; status comes from an internal map.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 8.1 (pipeline order), § 8.4 (`IUploadValidator` + the
  `readBytes` magic-byte pattern + the `NoOpUploadValidator` description).
- `docs/development_plan.md` § 4.4 (ValidationService + no-op-validator skeletons + acceptance).

TASK
Implement `ValidationService` and `NoOpUploadValidator` test-first.

DELIVERABLES
1. `validation.service.spec.ts` (TDD seed for each acceptance case; use a spy to assert MIME→size→custom order).
2. `src/server/services/validation.service.ts`:
   - `@fileoverview` + `@layer server/services`; `@Injectable()`.
   - Constructor injects `@Inject(BYMAX_STORAGE_OPTIONS) options`, `@Inject(BYMAX_STORAGE_UPLOAD_VALIDATORS) validators: readonly IUploadValidator[]`.
   - `async validate(input: UploadOptions): Promise<{ body: UploadBody }>`:
     1. MIME: if `options.validation?.mimeWhitelist` is non-empty and `!mimeMatches(input.contentType, whitelist)`
        → throw `STORAGE_MIME_NOT_ALLOWED` with `{ contentType, whitelist }`.
     2. Size: if `maxSizeBytes` is defined and `input.size` is defined and `input.size > maxSizeBytes`
        → throw `STORAGE_SIZE_EXCEEDED` with `{ size, maxSize }`.
     3. Custom: iterate validators in order; pass `{ key, contentType, size, metadata, readBytes }`
        where `readBytes(maxBytes)` tees the body via `peekFirstBytes` and reassigns the local `body`
        to the returned `replacementBody`. On `{ ok: false }` throw `STORAGE_VALIDATION_FAILED` with
        `{ validator: validator.name, reason }`.
     4. Return `{ body }` (possibly tee'd).
3. `src/server/providers/no-op-validator.ts`:
   - `@fileoverview` + `@layer server/providers`.
   - `export class NoOpUploadValidator implements IUploadValidator { readonly name = 'no-op'; async validate(): Promise<{ ok: true }> { return { ok: true } } }`.

Constraints:
- Construct StorageException with the code (+ details) only — never pass HttpStatus.
- The size check is best-effort: undefined size must NOT block. Keep `validate()` ≤ 50 lines
  (extract a private `runCustomValidators` if it grows). English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/services/validation.service.spec.ts` — expected: green.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.4 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add ValidationService pipeline (3.4)` — NO Co-Authored-By trailer.
````

---

### Task 3.5 — `FileScannerService` (pre/post + reject-on-unknown)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.9, 1.10, 1.11

#### Description

The service that wraps the consumer-injected `IFileScanner` and applies the library's policy: `isEnabled()`, `getMode()` (default `'pre-upload'`), and `scan()` which throws `STORAGE_SCAN_INFECTED` on `'infected'`, throws `STORAGE_SCAN_INCONCLUSIVE` on `'unknown'` when `rejectOnUnknown` is set, and otherwise passes (warning on inconclusive). Ships the exported `NoOpFileScanner` default.

#### Acceptance criteria

- [x] `isEnabled()` is `false` when the scanner is `null` or `options.scanner` is undefined; `true` otherwise.
- [x] `getMode()` returns `null` when disabled, else `options.scanner.mode ?? 'pre-upload'`.
- [x] `scan()` returns the result when status is `'clean'`.
- [x] `scan()` throws `STORAGE_SCAN_INFECTED` (HTTP 422) on `'infected'`, with `{ engine, threat, details }` preserved, and emits a warning log.
- [x] `scan()` throws `STORAGE_SCAN_INCONCLUSIVE` (HTTP 422) on `'unknown'` when `rejectOnUnknown: true`.
- [x] `scan()` returns the result (with a warning log) on `'unknown'` when `rejectOnUnknown` is false/unset.
- [x] `scan()` throws a programmatic `Error` if invoked with no configured scanner (caller must guard with `isEnabled()`).
- [x] `NoOpFileScanner.scan()` returns `{ status: 'clean', engine: 'noop' }`.
- [x] Both files carry `@fileoverview` + `@layer`; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/services/file-scanner.service.ts`
- `src/server/providers/no-op-scanner.ts`
- `src/server/services/file-scanner.service.spec.ts` (TDD; the full matrix is owned by Task 3.10)

#### Agent prompt

````
You are a senior NestJS security/release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.5 of 12

PRECONDITIONS
- The `IFileScanner` + `FileScanResult` interfaces, the DI tokens
  `BYMAX_STORAGE_OPTIONS` / `BYMAX_STORAGE_FILE_SCANNER`, StorageException, and
  STORAGE_ERROR_CODES all exist.
- StorageException takes the error code (+ optional details) only; status comes from an internal map.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 9 (all of it — § 9.1 interface/FileScanResult, § 9.2 modes,
  § 9.3 behavior, the `NoOpFileScanner` description).
- `docs/development_plan.md` § 4.5 (FileScannerService + no-op-scanner skeletons + acceptance).

TASK
Implement `FileScannerService` and `NoOpFileScanner` test-first.

DELIVERABLES
1. `file-scanner.service.spec.ts` (TDD seed for each acceptance case; verify the warning log on
   inconclusive-accepted via a Logger spy).
2. `src/server/services/file-scanner.service.ts`:
   - `@fileoverview` + `@layer server/services`; `@Injectable()`; a private `Logger`.
   - Constructor injects `@Inject(BYMAX_STORAGE_OPTIONS) options`, `@Inject(BYMAX_STORAGE_FILE_SCANNER) scanner: IFileScanner | null`.
   - `isEnabled(): boolean` → `scanner !== null && options.scanner !== undefined`.
   - `getMode(): 'pre-upload' | 'post-upload' | null` → `null` when `!isEnabled()`, else `options.scanner?.mode ?? 'pre-upload'`.
   - `async scan(input): Promise<FileScanResult>` (input: `{ mode, body?, key, bucket, contentType, size? }`):
     - if `!scanner` → throw a programmatic `Error` telling the caller to guard with `isEnabled()`.
     - `const result = await scanner.scan(input)`.
     - `'infected'` → warn-log `{ key, engine, threat }`; throw `STORAGE_SCAN_INFECTED` with `{ engine, threat, details }`.
     - `'unknown'` AND `options.scanner?.rejectOnUnknown` → throw `STORAGE_SCAN_INCONCLUSIVE` with `{ engine, details }`.
     - `'unknown'` (not rejecting) → warn-log inconclusive-accepted; return `result`.
     - `'clean'` → return `result`.
3. `src/server/providers/no-op-scanner.ts`:
   - `@fileoverview` + `@layer server/providers`.
   - `export class NoOpFileScanner implements IFileScanner { async scan(): Promise<FileScanResult> { return { status: 'clean', engine: 'noop' } } }`.

Constraints:
- Construct StorageException with the code (+ details) only — never pass HttpStatus.
- `scan()` ≤ 50 lines. English-only, timeless comments. The no-op engine string is exactly `'noop'`.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/services/file-scanner.service.spec.ts` — expected: green.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.5 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): add FileScannerService virus scan hook (3.5)` — NO Co-Authored-By trailer.
````

---

### Task 3.6 — Integrate validation + scanner into `StorageService.upload()`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.6, 3.4, 3.5

#### Description

Wire `ValidationService` and `FileScannerService` into `StorageService.upload()` in the canonical order: KeyResolver → Validation → pre-upload scan → upload (single-shot/multipart) → post-upload scan (with delete-on-infected cleanup). The idempotency store runs only after a fully successful pipeline.

#### Acceptance criteria

- [x] Upload with `mimeWhitelist` rejects a disallowed MIME **before** any `client.send` (no PutObject).
- [x] Upload with `maxSizeBytes` rejects an oversize body before S3.
- [x] Custom validators are invoked in order before S3.
- [x] A `pre-upload` scanner runs before PutObject (verifiable via spy ordering).
- [x] A `pre-upload` scanner returning `'infected'` prevents the PutObject.
- [x] A `post-upload` scanner runs after PutObject.
- [x] A `post-upload` scanner returning `'infected'` triggers `delete()` of the just-uploaded object; a delete failure is logged (error) but the original scan exception is re-thrown.
- [x] The upload uses the validated (possibly tee'd) body for the strategy decision and the actual send; the idempotency store runs only after validation + scan succeed.
- [x] `pnpm typecheck` passes and `storage.service.ts` stays ≤ 800 lines with each method ≤ 50 lines.

#### Files to create / modify

- `src/server/services/storage.service.ts` (modify)

#### Agent prompt

````
You are a senior NestJS engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.6 of 12

PRECONDITIONS
- `StorageService.upload()` (single-shot + multipart paths), `pickUploadStrategy`,
  `uploadSingleShot`/`uploadMultipart`, the idempotency cache, `delete()`, and the existing
  assert/resolveBucket helpers all exist from the upload phase.
- `ValidationService` and `FileScannerService` exist (their unit specs are green).

REQUIRED READING (only these):
- `docs/development_plan.md` § 4.6 (the upload() integration skeleton + acceptance).
- `docs/technical_specification.md` § 8.1 (the canonical pipeline order).

TASK
Inject the two services and rewire `upload()` to run validation + scanning in order, without
changing the public method signature or the existing single-shot/multipart behavior.

DELIVERABLES
1. Add `private readonly validation: ValidationService` and `private readonly scanner: FileScannerService`
   to the StorageService constructor.
2. In `upload()`, after key/bucket resolution and the idempotency lookup, before the strategy:
   - `const validated = await this.validation.validate(options)` and
     `const validatedOptions = { ...options, body: validated.body }`.
   - Pre-upload scan: `if (this.scanner.isEnabled() && this.scanner.getMode() === 'pre-upload')`
     → `await this.scanner.scan({ mode: 'pre-upload', body: validated.body as Buffer | NodeJS.ReadableStream, key: finalKey, bucket, contentType: options.contentType, size: options.size })`.
   - Use `validatedOptions` (and `validated.body`) for `pickUploadStrategy` and the single-shot/multipart send.
   - Post-upload scan: `if (this.scanner.isEnabled() && this.scanner.getMode() === 'post-upload')`
     → try the scan; on throw, warn-log, `await this.delete(finalKey, { bucket }).catch(...)` (error-log a delete
     failure but swallow it), then re-throw the original scan error.
3. Move the idempotency store so it runs only after a fully successful pipeline (end of upload()).

Constraints:
- Do not log object bodies or signed URLs. Keep each method ≤ 50 lines (extract private helpers
  such as `runPreUploadScan` / `runPostUploadScan` if needed). `storage.service.ts` ≤ 800 lines.
- English-only, timeless comments (no roadmap/phase/task references).

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/services/storage.service.spec.ts` — expected: green (existing tests still pass;
  the new integration cases are added in a later task).

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.6 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): integrate validation and scanner into upload (3.6)` — NO Co-Authored-By trailer.
````

---

### Task 3.7 — Module wiring + barrel update

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 3.2, 3.4, 3.5, 3.6

#### Description

Register the three new services in `BymaxStorageModule.forRoot()` and expose the correct public surface in the server barrel. `SignedUrlService` and the two no-op providers are public; `ValidationService` and `FileScannerService` are internal (used only via `StorageService.upload()`).

#### Acceptance criteria

- [x] `SignedUrlService`, `ValidationService`, `FileScannerService` are all registered as providers in `forRoot()`.
- [x] `SignedUrlService` is exported from the module (injectable in consumer feature modules).
- [x] `src/server/index.ts` re-exports `SignedUrlService`, `NoOpUploadValidator`, `NoOpFileScanner`.
- [x] `ValidationService` and `FileScannerService` are **not** in the barrel (internal).
- [x] `pnpm build` produces `dist/server/index.d.ts` containing the new public exports; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/bymax-storage.module.ts` (modify)
- `src/server/index.ts` (modify)

#### Agent prompt

````
You are a senior NestJS architect working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.7 of 12

PRECONDITIONS
- `BymaxStorageModule.forRoot()` exists and already registers StorageService + supporting providers.
- `SignedUrlService`, `ValidationService`, `FileScannerService`, `NoOpUploadValidator`,
  `NoOpFileScanner` all exist and their unit specs are green.

REQUIRED READING (only these):
- `docs/development_plan.md` § 4.7 (the module/barrel modifications + acceptance).

TASK
Register the three services and curate the public barrel.

DELIVERABLES
1. `src/server/bymax-storage.module.ts`:
   - Add `SignedUrlService`, `ValidationService`, `FileScannerService` to `providers` in `forRoot()`.
   - Add `SignedUrlService` to `exports` (consumer-injectable). Do NOT export `ValidationService`
     or `FileScannerService` — they are internal, consumed only via `StorageService.upload()`.
2. `src/server/index.ts`:
   - `export { SignedUrlService } from './services/signed-url.service'`
   - `export { NoOpUploadValidator } from './providers/no-op-validator'`
   - `export { NoOpFileScanner } from './providers/no-op-scanner'`
   - Do NOT export `ValidationService` / `FileScannerService`.

Constraints:
- A barrel re-export must be both exported here AND meant for consumers — keep internal services out.
- English-only, timeless comments.

Verification:
- `pnpm build` — expected: succeeds.
- `node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).filter(k => k.includes('Url') || k.includes('Validator') || k.includes('Scanner'))))"`
  — expected: lists `SignedUrlService`, `NoOpUploadValidator`, `NoOpFileScanner`; NOT ValidationService/FileScannerService.
- `pnpm typecheck` — expected: clean.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.7 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `feat(storage): wire SignedUrlService + validators + scanners (3.7)` — NO Co-Authored-By trailer.
````

---

### Task 3.8 — Tests — `ttl-clamp` + `mime-match` (mutation 100%)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.1, 3.3

#### Description

Harden the co-located specs for the two security-critical pure utilities to the full edge-case matrix and enforce a **mutation score of 100%** on both. Any surviving mutant must be eliminated by a new assertion or documented inline as provably equivalent.

#### Acceptance criteria

- [x] `ttl-clamp.spec.ts` covers: undefined→default, value<max→same, value>max→silent clamp, `0`→throws, `-10`→throws, boundary `ttl === maxTtl`→max, and `defaultTtl === maxTtl` boundary.
- [x] `mime-match.spec.ts` covers all § 4.3 acceptance cases plus whitespace-padded pattern, mixed-case pattern, empty whitelist→false, multiple patterns, and a non-string input coerced via a type assertion.
- [x] 25+ cases total across the two files; both files at 100% line/branch coverage.
- [x] Stryker mutation score is **100%** on `ttl-clamp.ts` and `mime-match.ts` (or each surviving mutant is documented inline as provably equivalent).

#### Files to create / modify

- `src/server/utils/ttl-clamp.spec.ts` (extend)
- `src/server/utils/mime-match.spec.ts` (extend)

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API,
published to npm. Strict TS, 100% coverage floor, Stryker mutation (high 100 / low 95 / break 95).

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.8 of 12

PRECONDITIONS
- `clampTtl` and `mimeMatches` are implemented with TDD seed specs that already pass.

REQUIRED READING (only these):
- `docs/development_plan.md` § 4.1 and § 4.3 (the acceptance matrices for both utilities).

TASK
Extend the two co-located specs to the full edge-case matrix and drive the Stryker mutation gate
to 100% on both security utilities.

DELIVERABLES
1. `src/server/utils/ttl-clamp.spec.ts` (~10 cases): undefined→default, value<max→same, value>max→clamp,
   0→throws, -10→throws, boundary ttl===max→max, defaultTtl===max boundary. Assert the thrown error code.
2. `src/server/utils/mime-match.spec.ts` (~15 cases): all acceptance cases + ` ' image/png ' ` whitespace
   pattern matches, mixed-case pattern, empty whitelist→false, multiple patterns where a later one matches,
   a non-string input coerced via a type assertion.
3. Run the mutation gate on exactly these two files at the end and reach score 100%, or document each
   provably-equivalent surviving mutant with an inline comment.

Constraints:
- Every `it()` carries a short comment stating what behavior it pins. No fake assertions.
- English-only, timeless comments.

Verification:
- `pnpm test src/server/utils/ttl-clamp src/server/utils/mime-match` — expected: green, 100% line/branch.
- `pnpm mutation -- --files src/server/utils/ttl-clamp.ts,src/server/utils/mime-match.ts` — expected: 100%.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.8 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): ttl-clamp + mime-match mutation gate (3.8)` — NO Co-Authored-By trailer.
````

---

### Task 3.9 — Tests — `SignedUrlService`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 3.2

#### Description

Unit specs covering the GET / PUT / multipart paths of `SignedUrlService`, mocking `getSignedUrl` and the client `send` for the multipart commands. Drives the service to the 100% line/branch floor.

#### Acceptance criteria

- [x] 12+ cases: download URL + correct `expiresAt`; TTL silent clamp above max; TTL ≤ 0 throws `STORAGE_SIGNED_URL_TTL_INVALID`; `ResponseContentDisposition` forwarded; PUT `requiredHeaders['Content-Type']` matches; PUT applies ACL when `publicRead`; PUT forwards `Metadata` + `ContentLength: maxSizeBytes`; multipart calls `CreateMultipartUploadCommand` first; multipart returns N partUrls with partNumbers 1..N; multipart returns `completeUrl`; multipart rejects `parts: 0` and `parts: -1`; multipart throws when no `UploadId` is returned.
- [x] `getSignedUrl` is mocked via `jest.mock('@aws-sdk/s3-request-presigner')`; the client `send` is mocked for the multipart commands.
- [x] `signed-url.service.ts` at 100% line/branch coverage.

#### Files to create / modify

- `src/server/services/signed-url.service.spec.ts` (extend)

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.9 of 12

PRECONDITIONS
- `SignedUrlService` is implemented with a passing TDD seed spec.

REQUIRED READING (only these):
- `docs/development_plan.md` § 4.2 (the SignedUrlService acceptance matrix).
- `docs/technical_specification.md` § 7.2 (the option/result types).

TASK
Extend `signed-url.service.spec.ts` to the full 12+ case matrix and reach the 100% coverage floor.

DELIVERABLES
A spec covering, at minimum:
1. getDownloadUrl returns a URL + correct expiresAt.
2. getDownloadUrl silently clamps TTL above max.
3. getDownloadUrl throws STORAGE_SIGNED_URL_TTL_INVALID for TTL ≤ 0.
4. getDownloadUrl forwards ResponseContentDisposition when provided.
5. getUploadUrl returns requiredHeaders['Content-Type'] matching options.contentType.
6. getUploadUrl applies ACL=public-read when publicRead: true.
7. getUploadUrl forwards Metadata and ContentLength: maxSizeBytes.
8. getMultipartUploadUrls calls CreateMultipartUploadCommand first.
9. getMultipartUploadUrls returns N partUrls with partNumbers 1..N.
10. getMultipartUploadUrls returns completeUrl.
11. getMultipartUploadUrls rejects parts: 0 and parts: -1.
12. getMultipartUploadUrls throws when CreateMultipartUpload returns no UploadId.

Constraints:
- Mock `getSignedUrl` via `jest.mock('@aws-sdk/s3-request-presigner')`; mock client `send` for the
  three multipart commands. Assert URL query params via URL parsing where relevant.
- Every `it()` carries a short comment. No real network calls. English-only, timeless comments.

Verification:
- `pnpm test src/server/services/signed-url.service.spec.ts` — expected: green, 100% line/branch.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.9 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): SignedUrlService unit tests (3.9)` — NO Co-Authored-By trailer.
````

---

### Task 3.10 — Tests — `ValidationService` + `FileScannerService`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 3.4, 3.5

#### Description

Unit specs for the two policy services, driving both to the 100% line/branch floor and pinning the pipeline order, the tee/replacement-body behavior, and the full scanner status matrix.

#### Acceptance criteria

- [x] `validation.service.spec.ts` (~10 cases): MIME accepted/rejected; wildcard `image/*` accepts variants; undefined whitelist→no block; `size > max`→`STORAGE_SIZE_EXCEEDED`; undefined size→passes; custom validator OK→continues; custom validator failing→`STORAGE_VALIDATION_FAILED` carrying `validator.name`; `readBytes` on a stream tees once and the replacement body is consumable; order MIME→size→custom verified via spies.
- [x] `file-scanner.service.spec.ts` (~8 cases): `isEnabled` false when scanner null; `getMode` default `'pre-upload'`; `getMode` returns configured `'post-upload'`; `scan` clean→returns; `scan` infected→`STORAGE_SCAN_INFECTED`; `scan` unknown + rejectOnUnknown→`STORAGE_SCAN_INCONCLUSIVE`; `scan` unknown without rejectOnUnknown→returns with a warning log; `details.threat` preserved in the infected exception.
- [x] 18+ cases total; both services at 100% line/branch coverage.

#### Files to create / modify

- `src/server/services/validation.service.spec.ts` (extend)
- `src/server/services/file-scanner.service.spec.ts` (extend)

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API,
published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.10 of 12

PRECONDITIONS
- `ValidationService` (+ NoOpUploadValidator) and `FileScannerService` (+ NoOpFileScanner) are
  implemented with passing TDD seed specs.

REQUIRED READING (only these):
- `docs/development_plan.md` § 4.4 and § 4.5 (the two acceptance matrices).
- `docs/technical_specification.md` § 8.4 (readBytes/tee semantics), § 9.3 (scanner behavior).

TASK
Extend both specs to the full case matrix and reach the 100% coverage floor.

DELIVERABLES
1. `validation.service.spec.ts` (~10 cases): MIME accepted/rejected, wildcard accepts variants,
   undefined whitelist→no block, size>max→SIZE_EXCEEDED, undefined size→passes, custom OK→continues,
   custom fails→VALIDATION_FAILED with validator.name, readBytes tees once and the replacement body is
   consumable, order MIME→size→custom (spy on mimeMatches + a custom validator to assert ordering).
2. `file-scanner.service.spec.ts` (~8 cases): isEnabled false when scanner null, getMode default
   'pre-upload', getMode configured 'post-upload', scan clean→returns, scan infected→SCAN_INFECTED,
   scan unknown+rejectOnUnknown→SCAN_INCONCLUSIVE, scan unknown without rejectOnUnknown→result+warning,
   details.threat preserved. Verify the warning log via a Logger spy.

Constraints:
- Every `it()` carries a short comment. NoOpFileScanner returns `{ status: 'clean', engine: 'noop' }`
  and NoOpUploadValidator returns `{ ok: true }` — assert these exact shapes. English-only, timeless comments.

Verification:
- `pnpm test src/server/services/validation.service.spec.ts src/server/services/file-scanner.service.spec.ts`
  — expected: green, 100% line/branch on both services.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.10 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): ValidationService + FileScannerService tests (3.10)` — NO Co-Authored-By trailer.
````

---

### Task 3.11 — Tests — `StorageService` validation/scanner integration

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 3.6

#### Description

Integration specs that exercise the rewired `upload()` end-to-end (with mocked S3), asserting the validation/scanner ordering, the pre-upload short-circuit, and the post-upload delete-on-infected cleanup.

#### Acceptance criteria

- [x] Upload with `mimeWhitelist` rejects before any `client.send` (spy asserts no send).
- [x] Upload with `maxSizeBytes` rejects before S3.
- [x] A custom validator rejection happens before S3.
- [x] A `pre-upload` scanner is called before PutObject (spy ordering).
- [x] A `pre-upload` `'infected'` result prevents PutObject (assert `client.send` not called).
- [x] A `post-upload` scanner is called after PutObject.
- [x] A `post-upload` `'infected'` result triggers `delete()` (spy on the delete path / `DeleteObjectCommand`).
- [x] A delete failure during post-upload cleanup logs an error but re-throws the original scan exception.
- [x] `storage.service.ts` stays at 100% line/branch coverage with the new paths covered.

#### Files to create / modify

- `src/server/services/storage.service.spec.ts` (extend) — or a co-located `storage.service.pipeline.spec.ts`

#### Agent prompt

````
You are a senior test engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API,
published to npm. Strict TS, 100% coverage floor, Stryker break 95.

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.11 of 12

PRECONDITIONS
- `StorageService.upload()` has been rewired to run ValidationService + FileScannerService.

REQUIRED READING (only these):
- `docs/development_plan.md` § 4.6 (the integration acceptance matrix).
- `docs/technical_specification.md` § 8.1 (the canonical pipeline order).

TASK
Add the integration cases (with mocked S3) to `storage.service.spec.ts` (or a co-located
`storage.service.pipeline.spec.ts`) and reach the 100% coverage floor on the new paths.

DELIVERABLES (8+ cases):
1. Upload with mimeWhitelist rejects BEFORE client.send (spy).
2. Upload with maxSizeBytes rejects BEFORE S3.
3. Custom validator rejects BEFORE S3.
4. Pre-upload scanner called BEFORE PutObject (spy ordering).
5. Pre-upload 'infected' prevents PutObject (assert client.send not called).
6. Post-upload scanner called AFTER PutObject.
7. Post-upload 'infected' triggers delete (spy on DeleteObjectCommand / delete path).
8. Cleanup-on-post-upload-failure logs the delete error but re-throws the scan exception.

Constraints:
- Mock the S3 client `send`; configure a fake validator/scanner per case. No real network calls.
- Every `it()` carries a short comment. English-only, timeless comments.

Verification:
- `pnpm test src/server/services/storage.service` — expected: green, 100% line/branch on storage.service.ts.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 12) in the header blockquote.
4. Append a Completion-log entry: `- 3.11 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `test(storage): upload validation/scanner integration tests (3.11)` — NO Co-Authored-By trailer.
````

---

### Task 3.12 — Phase validation + signed-URL smoke test

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11

#### Description

Consolidated gate for the phase: the full static + coverage + build pipeline must be green, the bundle stays within the brotli budget, and a manual smoke test against local MinIO proves real signed URLs (GET + PUT) work and the validation pipeline rejects correctly. Close with a code review and apply findings.

#### Acceptance criteria

- [x] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build` all pass; coverage meets the 100% line/branch floor for every file added in this phase.
- [x] `scripts/check-size.mjs` passes (server < 30 KB brotli, shared < 3.5 KB brotli).
- [x] Smoke test against MinIO: an `image/png` upload succeeds; a `text/plain` upload is rejected with `STORAGE_MIME_NOT_ALLOWED`; an oversize upload is rejected with `STORAGE_SIZE_EXCEEDED`.
- [x] Smoke test: `getDownloadUrl(...)` → `fetch(url)` returns HTTP 200; `getUploadUrl(...)` → `fetch(url, { method: 'PUT', headers: requiredHeaders, body })` returns HTTP 200; uploads are cleaned up afterward.
- [x] **GitHub CI is green on the PR** — the `ci` (verify + e2e), `codeql`, and `scorecard` runs on the PR head all concluded `success` (`gh run list`/`gh run view`). The phase is not closed with red or pending CI.
- [x] `/bymax-quality:code-review` run and all findings applied.

#### Files to create / modify

- `/tmp/smoke-storage-phase3.mjs` (scratch smoke script — not committed)

#### Agent prompt

````
You are a senior NestJS release engineer working on the @bymax-one/nest-storage library.

PROJECT: @bymax-one/nest-storage — production-grade NestJS storage over an S3-compatible API
(AWS SDK v3, SigV4-only), published to npm. Strict TS, 100% line/branch coverage floor on every
file, Stryker mutation (break 95), brotli bundle budget (server < 30 KB, shared < 3.5 KB).

CURRENT PHASE: 3 (Signed URLs + Validation + Scanner) — Task 3.12 of 12 (LAST)

PRECONDITIONS
- Tasks 3.1–3.11 are done: SignedUrlService, ValidationService, FileScannerService and the two
  utilities are implemented, tested, wired into the module, and covered to the 100% floor.
- A local MinIO container is available (the upload phase's smoke harness); credentials/endpoint
  are configured via env as in the prior phase.

REQUIRED READING (only these):
- `docs/development_plan.md` § 4.8 (the phase validation + smoke-test recipe).

TASK
Run the consolidated phase gate, prove signed URLs work against MinIO, and apply a code review.

DELIVERABLES
1. Run `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build` — all green; confirm the
   100% line/branch floor for every file added this phase.
2. Run `node scripts/check-size.mjs` — confirm the brotli budget (server < 30 KB, shared < 3.5 KB).
3. Write `/tmp/smoke-storage-phase3.mjs` (scratch, do NOT commit):
   - Configure `forRoot` with `validation: { mimeWhitelist: ['image/png'], maxSizeBytes: 1024 }`.
   - Attempt 1: `storage.upload({ key: 'a.txt', contentType: 'text/plain', body: Buffer.from('x') })`
     → expect `STORAGE_MIME_NOT_ALLOWED`.
   - Attempt 2: `storage.upload({ key: 'big.png', contentType: 'image/png', body: Buffer.alloc(2048), size: 2048 })`
     → expect `STORAGE_SIZE_EXCEEDED`.
   - Attempt 3: `storage.upload({ key: 'ok.png', contentType: 'image/png', body: Buffer.alloc(100, 0x89), size: 100 })`
     → success.
   - `signedUrls.getDownloadUrl({ key: 'ok.png', ttlSeconds: 60 })` → `await fetch(url)` → status 200.
   - `signedUrls.getUploadUrl({ key: 'via-signed.png', contentType: 'image/png', ttlSeconds: 60 })`
     → `await fetch(url, { method: 'PUT', headers: requiredHeaders, body: Buffer.alloc(50) })` → status 200.
   - Cleanup: delete both uploaded objects.
   - Expected: 3 correct rejections/success + 2 real fetches returning 200.
4. Run `/bymax-quality:code-review` and apply every finding; re-run the gate after fixes.

Constraints:
- Do NOT print signed URLs to logs in the smoke script (treat them as secrets — fetch them inline).
- English-only, timeless comments. Do not commit `/tmp/smoke-storage-phase3.mjs`.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build` — expected: all pass.
- `node scripts/check-size.mjs` — expected: within budget.
- `node /tmp/smoke-storage-phase3.mjs` — expected: 3 expected rejections/success + 2 fetches HTTP 200.

Completion Protocol:
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (12 / 12) in the header blockquote and set the phase Status to ✅.
4. Append a Completion-log entry: `- 3.12 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the § 1.5 Phase dashboard of `../development_plan.md` (Status + Progress + Last updated).
6. Recompute Overall progress in `../development_plan.md` § 1.4 (N/5 phases + %, M/64 tasks) and the dashboard Total row.
7. Commit with a Conventional Commit `chore(storage): complete Phase 3 validation (3.12)` — NO Co-Authored-By trailer.
````

---

## Completion log

_Append `- <id> ✅ <YYYY-MM-DD> — <summary>` as each task completes._

- 3.1 ✅ 2026-06-30 — `clampTtl` utility: validates and silently clamps presign TTL; throws STORAGE_SIGNED_URL_TTL_INVALID for ≤0; 100% line/branch coverage.
- 3.2 ✅ 2026-06-30 — `SignedUrlService`: GET/PUT/multipart presigning via `@aws-sdk/s3-request-presigner`; TTL clamped; URLs never logged; mapAwsError on all failures.
- 3.3 ✅ 2026-06-30 — `mimeMatches` utility: exact/subtype-wildcard/full-wildcard MIME matching, RFC 2045 parameter stripping, 100% line/branch coverage.
- 3.4 ✅ 2026-06-30 — `ValidationService`: MIME whitelist → size → custom IUploadValidator pipeline; readBytes tee for magic-byte validators; NoOpUploadValidator provided.
- 3.5 ✅ 2026-06-30 — `FileScannerService`: pre/post modes, rejectOnUnknown, post-upload delete-on-infected; NoOpFileScanner provided.
- 3.6 ✅ 2026-06-30 — `StorageService.upload()` integrates validation pipeline and pre/post scanner; post-upload cleanup on scan failure.
- 3.7 ✅ 2026-06-30 — Module wiring: SignedUrlService/ValidationService/FileScannerService providers added to BymaxStorageModule; barrel exports SignedUrlService + NoOpUploadValidator + NoOpFileScanner.
- 3.8 ✅ 2026-06-30 — ttl-clamp + mime-match specs extended for comprehensive edge-case matrix; all branches covered for mutation gate readiness.
- 3.9 ✅ 2026-06-30 — SignedUrlService spec extended to 20+ cases: error re-throw paths, bucket-undefined, StorageException pass-through.
- 3.10 ✅ 2026-06-30 — ValidationService + FileScannerService specs extended: readBytes callback, metadata forwarding, threat-absent infected log.
- 3.11 ✅ 2026-06-30 — StorageService scan integration tests: pre/post modes, size branch coverage, infected delete + rethrow, delete-failure resilience.
- 3.12 ✅ 2026-06-30 — Phase gate: typecheck clean, lint clean, 237 tests / 100% line+branch+func+stmt, build passes, bundles within budget, no forbidden patterns.
