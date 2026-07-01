# Phase 5 — Release v0.1.0

> **Status**: 🔄 In Progress · **Progress**: 3 / 9 tasks · **Last updated**: 2026-07-01
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) §6
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §13, §14, §16

---

## Context

Phase 5 turns a feature-complete, fully-tested library into a **published `0.1.0` artifact on npm**. The engine, services, provider recipes, e2e suite, and mutation baseline already exist from Phases 1–4; the four CI workflows (`ci` / `codeql` / `scorecard` / `release`) were created in **Phase 1** and have gated every PR since the first one. This phase is therefore predominantly mechanical: write the public documentation (README, CHANGELOG, SECURITY, CLAUDE, AGENTS, mutation-testing docs, LICENSE), **confirm** the existing CI suite is green for the release candidate, **finalize** the `release.yml` `v*.*.*` publish trigger, calibrate the brotli bundle budgets, run the final Stryker mutation pass (break 95), and tag + publish with `--provenance`.

The single largest correctness risk in the documentation is teaching consumers the two provider traps that the AWS SDK v3 surfaces by default: the **integrity-checksum headers** that non-AWS S3-compatible providers reject (the #1 provider-compat trap), and the **`ACL: public-read`** path that returns HTTP 400 on modern AWS S3 and is a silent no-op on Cloudflare R2. The README, SECURITY, and CHANGELOG must state these accurately so a first-time consumer does not hit a broken upload path.

---

## Rules-of-phase

1. **TDD (test-first).** Any executable code touched in this phase (e.g. `scripts/check-size.mjs` budget logic) is changed test-first; prose/config files are reviewed, not unit-tested.
2. **100% line/branch coverage** on every *implemented* source file (the Bymax lib floor — **not** 80%); the published artifact is additionally gated at 100% global by `jest.coverage.config.ts` via `prepublishOnly`. Most Phase 5 work is documentation/config and adds no source files, but any source file it does touch keeps the floor.
3. **English-only and timeless comments.** No `Phase N` / `Task X` / roadmap-stage references inside any committed file (code, JSDoc, config, or docs-as-config such as `CLAUDE.md`/`AGENTS.md`). A reference to a spec/plan *section* (`§16.1`) is fine; a reference to a plan *stage* is not.
4. **`@fileoverview` + `@layer` header** on every source file (applies only if a new `.ts` file is created or an existing one is edited).
5. **Functions ≤ 50 lines, files ≤ 800 lines** — split by responsibility if exceeded.
6. **Official-docs-first.** Before documenting or invoking any AWS SDK v3 API (client config, `Upload`, presigner, checksum knobs), re-verify against the current official docs via context7; never write SDK option names from memory.
7. **Conventional Commits**, one commit per task, **with NO `Co-Authored-By` (or any AI-attribution) trailer**.
8. **Never create `.gitkeep` / `.keep`** or empty-directory placeholders; directories emerge from real files.
9. **Checksum opt-out is mandatory for non-AWS providers.** The options/resolved-options and the S3Client config carry `requestChecksumCalculation` + `responseChecksumValidation` (`'WHEN_SUPPORTED' | 'WHEN_REQUIRED'`, default `'WHEN_SUPPORTED'`). The non-AWS provider recipes (R2, Backblaze B2, MinIO, DigitalOcean Spaces, Wasabi) set **both to `'WHEN_REQUIRED'`**. README/SECURITY must teach this as the **#1 provider-compat trap** (§16.1).
10. **`maxAttempts`, not `maxRetries`** (AWS SDK v3); `DEFAULT_MAX_ATTEMPTS = 3`. **There is NO `signatureVersion` option anywhere** — the SDK is SigV4-only. Never document either removed/renamed name.
11. **ACL caveat.** `defaultPublicRead` / `publicRead` via `ACL: 'public-read'` returns HTTP 400 `AccessControlListNotSupported` on modern AWS S3 (Object Ownership "Bucket owner enforced") and is a **silent no-op on R2**. Document where relevant (README provider notes, SECURITY, error-code table for `STORAGE_PROVIDER_ERROR`).
12. **Bundle budget is brotli** — `dist/server` < 30 KB brotli, `dist/shared` < 3.5 KB brotli. Never report or write "gzipped".
13. **Mutation: Stryker `high 100 / low 95 / break 95`** — the final run must not drop below the break threshold.
14. **Publish with `--provenance`.**
15. **Do NOT recreate the CI workflows.** `ci.yml`, `codeql.yml`, `scorecard.yml`, `release.yml` already exist from Phase 1. This phase only **verifies** they are green and **finalizes** the `release.yml` `v*.*.*` publish trigger.

---

## Reference docs

- [`../technical_specification.md`](../technical_specification.md) — **§12** Error Code Catalog (the 17-code table for the README/CHANGELOG), **§13** What is NOT in the package, **§14** Dependencies (peer deps + checksum rationale), **§16** Known Limitations (**§16.1** the checksum trap + the ACL caveat; **§16.2** security notes for `SECURITY.md`), **§17** Example Integration (copy-pasteable README snippets).
- [`../development_plan.md`](../development_plan.md) — **§6** Release v0.1.0 (§6.1 README, §6.2 CHANGELOG, §6.3 SECURITY/CLAUDE/AGENTS, §6.4 CI confirmation, §6.5 brotli budgets, §6.6 final mutation run, §6.7 tag + publish), **Appendix C** Reference Configs (the nest-auth files to mirror).
- Template files (read once each, mirror structure only): `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/README.md`, `.../nest-auth/CHANGELOG.md`, `.../nest-auth/SECURITY.md`, `.../nest-auth/CLAUDE.md`, `.../nest-auth/AGENTS.md`, `.../nest-auth/LICENSE`, `.../nest-auth/docs/mutation_testing_plan.md`, `.../nest-auth/.github/workflows/release.yml`.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 5.1 | README (badges + quick start + 4 provider scenarios + error table) | ✅ Done | P1 | L | 4.12 |
| 5.2 | CHANGELOG.md + SECURITY.md | ✅ Done | P1 | M | 1.1 |
| 5.3 | CLAUDE.md + AGENTS.md | ✅ Done | P2 | L | 1.1 |
| 5.4 | Confirm `ci.yml` is green for the release candidate | 📋 ToDo | P0 | S | 4.12 |
| 5.5 | Confirm `codeql.yml` + `scorecard.yml` green; finalize `release.yml` publish trigger | 📋 ToDo | P0 | S | 5.4 |
| 5.6 | mutation_testing_plan.md + mutation_testing_results.md + LICENSE | 📋 ToDo | P2 | M | 4.10 |
| 5.7 | Finalize brotli bundle budgets + `pnpm pack --dry-run` | 📋 ToDo | P1 | S | 4.12 |
| 5.8 | Final pre-publish gate | 📋 ToDo | P0 | S | 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7 |
| 5.9 | Tag v0.1.0 + `npm publish --provenance` + post-publish smoke | 📋 ToDo | P0 | S | 5.8 |

---

## Tasks

### Task 5.1 — README (badges + quick start + 4 provider scenarios + error table)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: L
- **Depends on**: 4.12

#### Description

Author the public `README.md`, mirroring the structure of `nest-auth/README.md` but with storage content. It must include badges, an overview, the two subpath exports (`.` server, `./shared`), four copy-pasteable provider quick-start scenarios, upload/download/signed-URL/validation/scanner/lifecycle examples, the full 17-code error table, and — critically — the two provider traps (checksum opt-out and the ACL-on-modern-S3 caveat).

#### Acceptance criteria

- [x] README contains all sections: Overview, Features, Subpath Exports, Quick Start, Configuration, Provider Recipes, Upload, Download, Signed URLs, Validation, Virus Scanning, Lifecycle Operations, Error Codes, Testing, Contributing, License.
- [x] Badges configured for `bymaxone/nest-storage`: npm version, downloads, CI status, coverage, mutation score, OpenSSF Scorecard, license, TypeScript, Node 24+.
- [x] Subpath Exports table lists exactly two entries: `.` (server) and `./shared`.
- [x] Four complete, copy-pasteable quick-start scenarios: (1) AWS S3 via `providerRecipes.awsS3`; (2) Cloudflare R2 with `customDomain` (which is the `publicBaseUrl` — **required**, no working default); (3) DigitalOcean Spaces with CDN; (4) MinIO local (dev) with `forcePathStyle: true`.
- [x] A dedicated note teaches the **#1 provider-compat trap**: non-AWS providers reject the SDK's default integrity-checksum headers, and the non-AWS recipes set `requestChecksumCalculation`/`responseChecksumValidation` to `'WHEN_REQUIRED'` to fix it.
- [x] A note documents that `publicRead` via ACL returns HTTP 400 `AccessControlListNotSupported` on modern AWS S3 and is a silent no-op on R2 — use a bucket policy / CDN / signed URL instead.
- [x] Configuration prose uses `maxAttempts` (default 3) and contains **no** `maxRetries` and **no** `signatureVersion` anywhere.
- [x] Complete table of all 17 error codes with their HTTP status (mirrors spec §12.2).
- [x] An `IUploadValidator` example (magic-byte PDF check) and an `IFileScanner` stub (ClamAV) example.
- [x] Markdown is valid with no broken intra-repo links.

#### Files to create / modify

- `README.md` (create)

#### Agent prompt

````
You are a senior NestJS release engineer + technical writer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — a provider-agnostic, S3-compatible storage library for NestJS
built on a single `@aws-sdk/client-s3` engine. Two subpath exports: `.` (server) and `./shared`.
Targets AWS S3, Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces, Wasabi.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.1 of 9

PRECONDITIONS
- The library is feature-complete (Phases 1–4): StorageService, SignedUrlService,
  ValidationService, FileScannerService, six Provider Recipes, forRoot/forRootAsync, e2e suite.
- CI has gated every PR since Phase 1; no README exists yet.

REQUIRED READING (only these — do not load the whole spec):
- `docs/technical_specification.md` §12 (error catalog, the 17-code table), §16.1 (the checksum
  trap and the ACL caveat — read carefully; these drive two required README notes), §17 (Example
  Integration — source the upload/signed-URL/stream/download/validator/scanner snippets here).
- `docs/development_plan.md` §6.1 (README structure + acceptance criteria).
- `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/README.md` (structure/layout to mirror — do NOT
  copy auth content).
- Provider option names/shapes: re-verify `@aws-sdk/client-s3` S3Client config field names via
  context7 before writing the config table (especially the checksum knobs and `maxAttempts`).

TASK
Create `README.md` at the repository root, mirroring the nest-auth README layout with storage
content, four copy-pasteable provider scenarios, the full error table, and the two provider-trap
notes.

DELIVERABLES
1. Header: centered badges (npm version, downloads, CI status, coverage, mutation score, OpenSSF
   Scorecard, license, TypeScript, Node 24+) pointing at `bymaxone/nest-storage`; title
   `@bymax-one/nest-storage`.
2. `## Overview` — provider-agnostic S3-compatible storage for NestJS (single engine).
3. `## Features` — multipart, signed URLs, MIME/size validation, virus-scan hook, six providers,
   path-traversal guard, in-memory LRU idempotency, server-side encryption (AES256 / aws:kms),
   `keyPrefix` multi-tenant isolation.
4. `## Subpath Exports` — a two-row table: `.` (server runtime: module, services, recipes) and
   `./shared` (framework-free types + constants + `STORAGE_ERROR_CODES`).
5. `## Quick Start` — four complete, copy-pasteable scenarios:
   - AWS S3: `providerRecipes.awsS3({ region, bucket, credentials })`. Note AWS supports the
     default checksum mode, so no opt-out is needed here.
   - Cloudflare R2: `providerRecipes.r2({ accountId, bucket, credentials, customDomain })` — state
     that `publicBaseUrl` IS the `customDomain` and is REQUIRED (no working default); the recipe
     sets `forcePathStyle: false` and the checksum knobs to `'WHEN_REQUIRED'`.
   - DigitalOcean Spaces: recipe with the regional endpoint + a CDN/edge base URL; checksum
     `'WHEN_REQUIRED'`.
   - MinIO (local dev): recipe with a local `endpoint`, `forcePathStyle: true`, checksum
     `'WHEN_REQUIRED'`.
6. `## Configuration` — link to spec §4; show the config surface using `maxAttempts` (default 3).
   Do NOT mention `maxRetries` or `signatureVersion` (they do not exist — SDK v3 is SigV4-only).
7. `## Provider Recipes` — short table of the six providers; for Backblaze B2 note
   `forcePathStyle: false` (B2 supports both styles); all non-AWS recipes opt out of checksums.
8. `## Upload`, `## Download`, `## Signed URLs (GET/PUT/multipart)`, `## Validation`,
   `## Virus Scanning`, `## Lifecycle Operations` — adapt the snippets from spec §17 (Buffer +
   Readable + onProgress + idempotencyKey; streaming controller; three signed-URL examples; a
   magic-byte PDF `IUploadValidator`; a ClamAV `IFileScanner` stub; list/copy/deleteMany).
9. TWO required callout notes:
   - **Provider compatibility (the #1 trap):** non-AWS S3-compatible providers reject the SDK's
     default `x-amz-checksum-*` integrity headers; the non-AWS recipes set
     `requestChecksumCalculation` + `responseChecksumValidation` to `'WHEN_REQUIRED'` to make the
     default upload path work. Explain that a fresh install resolves `^3.700.0` to a version with
     the new default, so this is opt-out-by-recipe, not relied upon by e2e.
   - **Public access / ACLs:** `publicRead` via `ACL: 'public-read'` returns HTTP 400
     `AccessControlListNotSupported` on modern AWS S3 (Object Ownership "Bucket owner enforced")
     and is a silent no-op on R2 (configure a Custom Domain instead). Use a bucket policy, a CDN,
     or signed URLs for public access.
10. `## Error Codes` — the full 17-row table (code + HTTP status + when), mirroring spec §12.2.
11. `## Testing` — `pnpm test`, `pnpm test:cov`, `pnpm test:e2e`, `pnpm mutation`.
12. `## Contributing` (link `SECURITY.md`) and `## License` (MIT).

Constraints:
- English-only, timeless — reference spec/plan SECTIONS (e.g. §16.1) but never roadmap stages.
- No `maxRetries`, no `signatureVersion` anywhere. Use `maxAttempts` (default 3).
- All four scenarios must be genuinely copy-pasteable (imports + module wiring + a usage call).
- Do not invent option names — verify the S3Client config fields via context7 first.

Verification:
- `npx markdownlint-cli README.md --no-config || true` — expected: runs, no fatal lint errors.
- `grep -c 'STORAGE_' README.md` — expected: at least 17 (the error table).
- `grep -E 'maxRetries|signatureVersion' README.md` — expected: NO matches.
- `grep -E "WHEN_REQUIRED|AccessControlListNotSupported|customDomain" README.md` — expected: each
  present (the two trap notes + the R2 required base URL).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.1 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (Status +
   Progress + Last updated).
6. Recompute **Overall progress** in `../development_plan.md` §1.4 (N/5 phases + %, M/64 tasks)
   and the dashboard Total row.
7. Commit with a Conventional Commit `docs(storage): add README with badges and quick start (5.1)`
   — NO Co-Authored-By trailer.
````

---

### Task 5.2 — CHANGELOG.md + SECURITY.md

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.1

#### Description

Create the `CHANGELOG.md` (Keep a Changelog 1.1.0 + SemVer) with the `0.1.0` entry, and the `SECURITY.md` (disclosure policy + storage-specific security goals), adapting the nest-auth versions.

#### Acceptance criteria

- [x] `CHANGELOG.md` follows Keep a Changelog 1.1.0 + Semantic Versioning, with an `## [Unreleased]` section and an `## [0.1.0]` `### Added` entry enumerating the v0.1.0 feature set.
- [x] The `0.1.0` entry lists: provider-agnostic single-engine storage; six provider recipes; `StorageService`; `SignedUrlService`; `IUploadValidator`; `IFileScanner`; 17-code `StorageException` catalog; `keyPrefix`; mandatory path-traversal guard; in-memory LRU idempotency; SSE (AES256 / aws:kms); subpaths `.` and `./shared`.
- [x] `SECURITY.md` states the private disclosure channel (`security@bymax.one`, no public issues for vulnerabilities) and supported versions.
- [x] `SECURITY.md` enumerates the storage-specific security goals: path-traversal mitigation in `KeyResolverService`, signed-URL TTL clamping, never logging signed URLs, SSE recommended in production, plaintext-credentials guidance, and the non-AWS checksum opt-out / ACL caveat as operational hardening notes.
- [x] Both files are valid Markdown.

#### Files to create / modify

- `CHANGELOG.md` (create)
- `SECURITY.md` (create)

#### Agent prompt

````
You are a senior NestJS release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS. Subpaths
`.` (server) and `./shared`. Six providers; single `@aws-sdk/client-s3` engine.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.2 of 9

PRECONDITIONS
- The feature set is frozen for 0.1.0. No CHANGELOG or SECURITY file exists yet.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.2 (the canonical `## [0.1.0]` `### Added` list) and §6.3 (the
  SECURITY.md highlights).
- `docs/technical_specification.md` §16.2 (Security limitations — the source for SECURITY goals),
  §16.1 (checksum trap + ACL caveat — referenced as operational hardening), §12 (error catalog).
- `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/CHANGELOG.md` and `.../nest-auth/SECURITY.md`
  (structure to mirror — adapt scope from auth to storage).

TASK
Create `CHANGELOG.md` and `SECURITY.md` at the repository root.

DELIVERABLES
1. `CHANGELOG.md`:
   - Keep a Changelog 1.1.0 header + the SemVer adherence line.
   - `## [Unreleased]` (empty placeholder).
   - `## [0.1.0] - 2026-XX-XX` with a `### Added` list covering: initial release; provider-agnostic
     S3-compatible storage (single `@aws-sdk/client-s3` engine); works with AWS S3, DigitalOcean
     Spaces, Cloudflare R2, Backblaze B2, MinIO, Wasabi; `StorageService` (upload single/multipart/
     stream, download stream/buffer, head, exists, delete, deleteMany, list, copy, getPublicUrl);
     `SignedUrlService` (presigned GET/PUT/multipart with TTL clamp); `IUploadValidator` (MIME
     whitelist with wildcards, size limit, custom); `IFileScanner` (pre/post-upload virus-scan
     hook); 17-code `StorageException` catalog; `keyPrefix` multi-tenant isolation; mandatory
     path-traversal guard; in-memory LRU idempotency cache; server-side encryption (AES256,
     aws:kms); subpaths `.` (server) and `./shared`.
   - Leave the exact date as `2026-XX-XX` for Task 5.8 to fill at the gate.
2. `SECURITY.md`:
   - Supported versions table + private disclosure process (report to `security@bymax.one`; do not
     open public issues for vulnerabilities).
   - Storage-specific SECURITY GOALS: path-traversal mitigation in `KeyResolverService`; signed-URL
     TTL clamping (and the absolute 7-day ceiling); NEVER log signed URLs; SSE recommended in
     production; plaintext-credentials guidance (Secrets Manager / Vault / Doppler).
   - A short "operational hardening" subsection: non-AWS providers must opt out of integrity
     checksums (`'WHEN_REQUIRED'`, done by the recipes), and `publicRead` via ACL fails on modern
     AWS S3 / is a no-op on R2 — prefer bucket policy / CDN / signed URLs.
   - List the sensitive code paths that warrant extra review: `KeyResolverService`, the TTL clamp,
     the MIME matcher, and the idempotency cache.

Constraints:
- English-only, timeless — no roadmap/phase references; section references (§16.2) are fine.
- Do not transcribe nest-auth's auth-specific content; rewrite for storage scope.

Verification:
- `grep -q '0.1.0' CHANGELOG.md` and `grep -qi 'unreleased' CHANGELOG.md` — expected: both match.
- `grep -qi 'security@bymax.one' SECURITY.md` — expected: match.
- `grep -qi 'TTL' SECURITY.md && grep -qi 'traversal' SECURITY.md` — expected: both match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.2 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md`.
6. Recompute **Overall progress** in `../development_plan.md` §1.4 and the dashboard Total row.
7. Commit `docs(storage): add CHANGELOG and SECURITY policy (5.2)` — NO Co-Authored-By trailer.
````

---

### Task 5.3 — CLAUDE.md + AGENTS.md

- **Status**: ✅ Done
- **Priority**: P2
- **Size**: L
- **Depends on**: 1.1

#### Description

Create `CLAUDE.md` (quick reference for AI agents) and `AGENTS.md` (architecture deep-dive), adapting the nest-auth versions to the storage domain — S3 client lifecycle, signed-URL secrecy, MIME validation, path traversal, idempotency, and the provider-compat traps — and the two-subpath model.

#### Acceptance criteria

- [x] Both files exist, with every `nest-auth` reference replaced by `nest-storage`.
- [x] Critical Rules reflect storage concerns (S3 client lifecycle, signed-URL secrecy, MIME validation, path-traversal guard, idempotency, checksum opt-out for non-AWS providers, ACL caveat) — **not** JWT/MFA/OAuth.
- [x] Subpaths documented as exactly two (`.`, `./shared`), not five.
- [x] The Guidelines table drops irrelevant rows (CRYPTO, JWT, OAUTH, NEXTJS, REACT), keeps NESTJS/TYPESCRIPT/TESTING, and adds AWS_SDK / MINIO / TESTCONTAINERS.
- [x] `AGENTS.md` deep-dives the architecture: dynamic module (`forRoot`/`forRootAsync`), `S3ClientProvider` lifecycle (`onModuleInit` / `onApplicationShutdown` + `destroy()`), `KeyResolverService`, the validation pipeline, signed-URL TTL clamp, the LRU idempotency cache, and the Provider Recipes (with the `'WHEN_REQUIRED'` checksum opt-out for non-AWS providers).
- [x] No `signatureVersion`/`maxRetries` mentions; `maxAttempts` (default 3) used where retries are discussed.

#### Files to create / modify

- `CLAUDE.md` (create)
- `AGENTS.md` (create)

#### Agent prompt

````
You are a senior NestJS architect documenting @bymax-one/nest-storage for AI agents.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS. Single
`@aws-sdk/client-s3` engine. Subpaths `.` (server) and `./shared`. Six provider recipes.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.3 of 9

PRECONDITIONS
- The library is feature-complete. No CLAUDE.md / AGENTS.md exists yet.

REQUIRED READING (only these):
- `docs/technical_specification.md` §2 (Architecture), §5 (StorageService), §16.1 (checksum trap +
  ACL caveat), §12 (error catalog). Re-verify any S3Client config field name via context7 before
  asserting it.
- `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/CLAUDE.md` and `.../nest-auth/AGENTS.md`
  (structure to mirror — adapt the domain from auth to storage).

TASK
Create `CLAUDE.md` (concise agent quick reference) and `AGENTS.md` (architecture deep-dive),
both scoped to storage.

DELIVERABLES
1. `CLAUDE.md`:
   - Replace all `nest-auth` references with `nest-storage`.
   - Critical Rules for storage: S3 client lifecycle (lazy init, destroy on shutdown); signed URLs
     are secrets (never log them); MIME validation is header-only (plug an `IUploadValidator` for
     magic bytes); path-traversal guard is mandatory; idempotency cache is in-memory/per-instance;
     non-AWS providers MUST opt out of integrity checksums (`'WHEN_REQUIRED'`); `publicRead` via
     ACL fails on modern AWS S3 and is a no-op on R2.
   - Subpaths: exactly two (`.`, `./shared`).
   - Guidelines table: remove CRYPTO/JWT/OAUTH/NEXTJS/REACT; keep NESTJS/TYPESCRIPT/TESTING; add
     AWS_SDK, MINIO, TESTCONTAINERS.
2. `AGENTS.md` — architecture deep-dive:
   - Dynamic module: `forRoot()` (sync) and `forRootAsync()` (factory/useClass/useExisting).
   - `S3ClientProvider`: lifecycle hooks (`onModuleInit` / `onApplicationShutdown`) and
     `s3Client.destroy()`; retries via `maxAttempts` (default 3); SigV4-only (no `signatureVersion`).
   - `KeyResolverService`: normalization, `..`/leading-`/` rejection, `keyPrefix` application.
   - Validation pipeline: `checkMime` (wildcard MIME) → `checkSize` → custom `IUploadValidator`
     (`readBytes` helper) → optional `IFileScanner` (pre/post-upload).
   - Signed-URL TTL clamp (cap at `signedUrls.maxTtlSeconds`, reject TTL ≤ 0).
   - LRU idempotency cache (default 1000 entries / 24h, in-memory, per-replica caveat).
   - Provider Recipes: the six providers and the `'WHEN_REQUIRED'` checksum opt-out for the five
     non-AWS ones (R2 also needs `customDomain` as `publicBaseUrl`; B2 uses `forcePathStyle: false`).

Constraints:
- English-only, timeless — no roadmap/phase references in these committed docs-as-config files.
- No `signatureVersion`/`maxRetries`; use `maxAttempts` (default 3).

Verification:
- `grep -c nest-auth CLAUDE.md AGENTS.md` — expected: 0 in each (no leftover auth references).
- `grep -qi 'WHEN_REQUIRED' AGENTS.md` and `grep -qi 'maxAttempts' AGENTS.md` — expected: match.
- `grep -E 'signatureVersion|maxRetries' CLAUDE.md AGENTS.md` — expected: NO matches.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.3 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md`.
6. Recompute **Overall progress** in `../development_plan.md` §1.4 and the dashboard Total row.
7. Commit `docs(storage): add CLAUDE.md and AGENTS.md (5.3)` — NO Co-Authored-By trailer.
````

---

### Task 5.4 — Confirm `ci.yml` is green for the release candidate

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 4.12

#### Description

The `ci.yml` workflow was created in Phase 1 and has gated every PR. This task **verifies** (does not recreate) that the full CI pipeline — typecheck, lint, test+coverage, build, size, and the Dockerized E2E layer (MinIO) — is green on the release candidate, and confirms its conventions (least-privilege permissions, concurrency, Docker availability, MinIO image cache) are intact.

#### Acceptance criteria

- [ ] `.github/workflows/ci.yml` exists and is **not** recreated; only verified (optionally patched if a step is stale).
- [ ] CI runs on `pull_request` + `push` to `main`, with `permissions: contents: read`, `concurrency` + `cancel-in-progress: true`, and Node 24.x.
- [ ] CI steps cover `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test:cov`, `pnpm build`, `pnpm size`, and a `pnpm test:e2e` job with Docker (MinIO) and the `minio/minio:latest` image cached.
- [ ] The latest CI run on the release-candidate ref is green (confirmed via `gh run list` / `gh run view`).
- [ ] The coverage step enforces the 100% line/branch lib floor (not 80%).

#### Files to create / modify

- `.github/workflows/ci.yml` (verify; patch only if a step is stale)

#### Agent prompt

````
You are a senior NestJS CI/CD engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS. The four CI
workflows (ci/codeql/scorecard/release) were created in Phase 1 and gate every PR.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.4 of 9

PRECONDITIONS
- `.github/workflows/ci.yml` ALREADY EXISTS (built in Phase 1). Do NOT recreate it. Phases 1–4 are
  complete; the release candidate is on `main` or a release branch.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.4 (CI confirmation note — workflows are created in Phase 1; this
  step only confirms the suite is green).
- The existing `.github/workflows/ci.yml` (read it; do not rewrite it).

TASK
Confirm the existing `ci.yml` is green for the release candidate and that its conventions are
intact. Use the `gh` CLI for all GitHub operations.

DELIVERABLES
1. Read `.github/workflows/ci.yml` and confirm: triggers (`pull_request` + `push` to `main`);
   `permissions: { contents: read }`; `concurrency` with `cancel-in-progress: true`; Node 24.x
   matrix; the step set (`pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test:cov`,
   `build`, `size`); the `test:e2e` job runs on a Docker-capable runner with the `minio/minio:latest`
   image pulled + cached; the coverage step enforces the 100% line/branch lib floor.
2. Confirm the latest run is green:
   - `gh run list --workflow ci.yml --limit 5`
   - `gh run view <latest-run-id>` (or `--log-failed` if not green).
3. If — and only if — a step is genuinely stale (e.g. a renamed script, a dropped cache key), apply
   the MINIMAL patch to bring it green; otherwise change nothing. Do not recreate the workflow.

Constraints:
- Verification task: prefer reading + `gh` over editing. Any edit is the smallest viable patch.
- English-only, timeless — no phase/task references inside the YAML.
- Least privilege preserved: never widen workflow-level permissions beyond `contents: read`.

Verification:
- `gh run list --workflow ci.yml --limit 1` — expected: latest conclusion `success`.
- `grep -q 'contents: read' .github/workflows/ci.yml` — expected: match.
- `grep -qi 'minio' .github/workflows/ci.yml` — expected: match (the E2E Docker layer).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.4 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md`.
6. Recompute **Overall progress** in `../development_plan.md` §1.4 and the dashboard Total row.
7. Commit `ci(storage): confirm ci.yml is green for the release candidate (5.4)` — NO
   Co-Authored-By trailer. (If no file changed, record the confirmation in the completion log and
   commit only the docs/dashboard updates.)
````

---

### Task 5.5 — Confirm `codeql.yml` + `scorecard.yml` green; finalize `release.yml` publish trigger

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.4

#### Description

Verify the `codeql.yml` and `scorecard.yml` workflows (created in Phase 1) are green, and **finalize** the `release.yml` publish trigger so it fires on a `v*.*.*` tag and runs `pnpm prepublishOnly` + `pnpm publish --provenance` (inert until the tag is pushed). Do not recreate the workflows.

#### Acceptance criteria

- [ ] `codeql.yml` and `scorecard.yml` exist (not recreated); their latest runs are green.
- [ ] `release.yml` triggers on a `v*.*.*` tag push, runs `pnpm prepublishOnly`, then `pnpm publish --provenance`, and creates a GitHub Release; it stays inert until a tag is pushed.
- [ ] `release.yml` uses **OIDC Trusted Publishing — NO `NPM_TOKEN` secret** — with the publish job widening to `contents: write` (release) + `id-token: write` (OIDC), nothing broader, behind the `npm-publish` environment.
- [ ] An **`npm-publish` GitHub Environment** with a required reviewer is documented as a prerequisite, and a **Trusted Publisher** is registered on npmjs.com for `@bymax-one/nest-storage` bound to this repo's `release.yml` (documented in the PR description and `SECURITY.md`/release notes).
- [ ] No `nest-auth` references remain in any of the three workflows.

#### Files to create / modify

- `.github/workflows/release.yml` (finalize trigger/publish step)
- `.github/workflows/codeql.yml`, `.github/workflows/scorecard.yml` (verify only)

#### Agent prompt

````
You are a senior NestJS CI/CD + release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS. The four CI
workflows were created in Phase 1.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.5 of 9

PRECONDITIONS
- `.github/workflows/codeql.yml`, `scorecard.yml`, and `release.yml` ALREADY EXIST (Phase 1). Do
  NOT recreate them. Task 5.4 confirmed `ci.yml` is green.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.4 (workflows created in Phase 1; finalize the release publish
  trigger) and §6.7 (tag + publish with `--provenance`).
- The existing `.github/workflows/{codeql,scorecard,release}.yml` (read; do not rewrite).
- `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/.github/workflows/release.yml` (reference for the
  provenance publish job shape).

TASK
Confirm codeql/scorecard are green and finalize the `release.yml` publish trigger. Use `gh` for all
GitHub operations.

DELIVERABLES
1. Confirm green:
   - `gh run list --workflow codeql.yml --limit 3` and `gh run view <id>`.
   - `gh run list --workflow scorecard.yml --limit 3` and `gh run view <id>`.
2. Finalize `release.yml` (minimal patch only):
   - Trigger: `on: { push: { tags: ['v*.*.*'] } }` — inert until a matching tag is pushed.
   - Job: `pnpm install --frozen-lockfile` → `pnpm prepublishOnly` → `pnpm publish --provenance` →
     create a GitHub Release.
   - Permissions: exactly `contents: write` (for the Release) + `id-token: write` (OIDC provenance);
     nothing broader.
   - Ensure no `nest-auth` references remain in the file.
3. Document the publish prerequisites (NO NPM_TOKEN — OIDC only): (a) a **Trusted Publisher**
   registered on npmjs.com for `@bymax-one/nest-storage` bound to this repo's `release.yml`; (b) an
   **`npm-publish` GitHub Environment** with a required reviewer — note both in the PR description and
   the release section of `SECURITY.md`/`CONTRIBUTING.md`.

Constraints:
- Verification + minimal finalize only; do not recreate any workflow.
- English-only, timeless — no phase/task references in the YAML.
- `--provenance` is mandatory; do not publish without it.

Verification:
- `grep -E "v\*\.\*\.\*" .github/workflows/release.yml` — expected: the tag trigger present.
- `grep -q 'provenance' .github/workflows/release.yml` — expected: match.
- `grep -q 'id-token: write' .github/workflows/release.yml` — expected: match (OIDC provenance).
- `gh run list --workflow scorecard.yml --limit 1` — expected: latest conclusion `success`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.5 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md`.
6. Recompute **Overall progress** in `../development_plan.md` §1.4 and the dashboard Total row.
7. Commit `ci(storage): finalize release.yml publish trigger (5.5)` — NO Co-Authored-By trailer.
````

---

### Task 5.6 — mutation_testing_plan.md + mutation_testing_results.md + LICENSE

- **Status**: 📋 ToDo
- **Priority**: P2
- **Size**: M
- **Depends on**: 4.10

#### Description

Author the mutation-testing documentation (`docs/mutation_testing_plan.md` describing the Stryker strategy with `high 100 / low 95 / break 95`, and a `docs/mutation_testing_results.md` placeholder per release) and the MIT `LICENSE`.

#### Acceptance criteria

- [ ] `docs/mutation_testing_plan.md` documents the strategy: thresholds **high 100 / low 95 / break 95**, `pnpm mutation` run manually pre-release (not per-commit in CI due to cost), equivalent mutants annotated inline with `// Stryker disable next-line <mutator> : <reason>`, reports at `reports/mutation/mutation.html`, and the list of critical paths held at the 95%+ gate.
- [ ] `docs/mutation_testing_results.md` is a placeholder with a per-release section listing the critical paths (`key-resolver.service.ts`, `resolved-options.ts` / validation, `ttl-clamp.ts`, `mime-match.ts`, `idempotency-cache.ts`) with `TBD` scores to be filled by the final run.
- [ ] `LICENSE` is the MIT license, "Copyright (c) 2026 Bymax One".
- [ ] All three files are valid and English-only.

#### Files to create / modify

- `docs/mutation_testing_plan.md` (create)
- `docs/mutation_testing_results.md` (create)
- `LICENSE` (create)

#### Agent prompt

````
You are a senior NestJS test/release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS. Mutation
testing uses Stryker with thresholds high 100 / low 95 / break 95.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.6 of 9

PRECONDITIONS
- The mutation baseline exists (Phase 4). The final scored run happens in Task 5.8; this task
  writes the docs + LICENSE.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.6 (final mutation run + results doc) and Appendix C (the
  `stryker.config.json` thresholds row: high 100 / low 95 / break 95).
- `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/docs/mutation_testing_plan.md` and
  `.../nest-auth/LICENSE` (structure to mirror).

TASK
Create the two mutation-testing docs and the MIT LICENSE.

DELIVERABLES
1. `docs/mutation_testing_plan.md`:
   - Strategy: Stryker thresholds **high 100, low 95, break 95** (the run fails below 95%).
   - Run command: `pnpm mutation` — run MANUALLY pre-release, NOT on every CI commit (cost).
   - Equivalent mutants are documented inline at the suppression site with
     `// Stryker disable next-line <mutator> : <reason>` — never a blanket disable.
   - Reports: `reports/mutation/mutation.html`.
   - Critical paths held at the 95%+ gate: `key-resolver.service.ts`, the options
     validation (`resolved-options.ts`), `ttl-clamp.ts`, `mime-match.ts`, `idempotency-cache.ts`.
2. `docs/mutation_testing_results.md` — placeholder:
   - `# Mutation Testing Results`
   - `## v0.1.0 (2026-XX-XX)` with `- Global score: TBD` and a critical-paths list each set to
     `TBD` (the five files above), to be filled by Task 5.8's run.
3. `LICENSE` — the full MIT license text, "Copyright (c) 2026 Bymax One".

Constraints:
- English-only, timeless — reference doc SECTIONS only, never roadmap stages.
- The suppression comment example must NOT reference a phase/task.

Verification:
- `grep -q 'break 95' docs/mutation_testing_plan.md` — expected: match.
- `grep -qi 'TBD' docs/mutation_testing_results.md` — expected: match.
- `grep -qi 'MIT' LICENSE && grep -q 'Bymax One' LICENSE` — expected: both match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.6 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md`.
6. Recompute **Overall progress** in `../development_plan.md` §1.4 and the dashboard Total row.
7. Commit `docs(storage): add mutation plan, results placeholder and LICENSE (5.6)` — NO
   Co-Authored-By trailer.
````

---

### Task 5.7 — Finalize brotli bundle budgets + `pnpm pack --dry-run`

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 4.12

#### Description

Measure the real built bundle, calibrate the **brotli** budgets in `scripts/check-size.mjs` (server < 30 KB brotli, shared < 3.5 KB brotli — never gzipped), and verify the npm tarball contents via `pnpm pack --dry-run` (only `dist/` + package metadata).

#### Acceptance criteria

- [ ] `pnpm build && pnpm size` runs; `dist/server/index.mjs` < 30 KB brotli and `dist/shared/index.mjs` < 3.5 KB brotli.
- [ ] If the real values are consistently lower, the budgets are tightened by ~10–15% (no excessive headroom); the budgets in `scripts/check-size.mjs` measure **brotli**, never gzip.
- [ ] If `server` exceeds budget, the AWS SDK externalization in `tsup.config.ts` is verified (the `@aws-sdk/*` peers must be `external`, not bundled).
- [ ] `pnpm pack --dry-run` lists only `dist/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` — and NOT `src/`, `test/`, `docs/`, `*.config.ts`, `tsconfig.*.json`, or `.stryker-tmp/`.
- [ ] Final measured values are recorded in the commit message.

#### Files to create / modify

- `scripts/check-size.mjs` (calibrate `BUDGETS`)
- `tsup.config.ts` / `package.json` `files` (verify only; patch if a leak is found)

#### Agent prompt

````
You are a senior NestJS build/release engineer working on @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS, bundled with
tsup. The AWS SDK packages are PEER dependencies and must be externalized (not bundled).

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.7 of 9

PRECONDITIONS
- The build pipeline exists; `scripts/check-size.mjs` and `tsup.config.ts` were created in Phase 1.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.5 (the brotli budgets: server < 30 KB, shared < 3.5 KB; AWS SDK is
  external) and Appendix C (the `scripts/check-size.mjs` row).
- The existing `scripts/check-size.mjs` and `tsup.config.ts`.

TASK
Measure the real bundle, calibrate the brotli budgets, and verify the publish tarball.

DELIVERABLES
1. Run `pnpm build && pnpm size`. Measure the REAL **brotli** sizes of `dist/server/index.mjs` and
   `dist/shared/index.mjs`.
   - If `server` > 30 KB brotli → investigate: the `@aws-sdk/*` peers are likely being bundled;
     confirm they are in tsup's `external` list. Fix the externalization, do not raise the budget.
   - If `shared` > 3.5 KB brotli → investigate (it should be ~2–3 KB of types + constants).
   - If the values are comfortably under budget, TIGHTEN the budgets by ~10–15% so there is no
     excessive headroom. The `BUDGETS` entries must measure brotli (`brotli: <bytes>`), never gzip.
2. Verify the tarball: `pnpm pack --dry-run`. The file list must contain ONLY `dist/`,
   `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`. It must NOT contain `src/`, `test/`,
   `docs/`, `*.config.ts`, `tsconfig.*.json`, or `.stryker-tmp/`. If extra files leak, fix the
   `files` field in `package.json` (or add an `.npmignore`).
3. Record the final measured brotli values in the commit message.

Constraints:
- Brotli only — never report or encode "gzipped".
- Do not raise a budget to mask a bundling regression; fix the externalization instead.
- English-only, timeless comments in any edited script.

Verification:
- `pnpm size` — expected: server < 30 KB brotli, shared < 3.5 KB brotli, exit 0.
- `pnpm pack --dry-run` — expected: only dist + metadata files listed.
- `grep -qi 'brotli' scripts/check-size.mjs && ! grep -qi 'gzip' scripts/check-size.mjs` —
  expected: brotli present, gzip absent.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.7 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md`.
6. Recompute **Overall progress** in `../development_plan.md` §1.4 and the dashboard Total row.
7. Commit `chore(storage): finalize brotli bundle size budgets (5.7)` — NO Co-Authored-By trailer.
````

---

### Task 5.8 — Final pre-publish gate

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7

#### Description

Run the full local pipeline that simulates CI + release, fill the release date/version, run the final Stryker mutation pass (break 95), and complete the pre-publish checklist before tagging.

#### Acceptance criteria

- [ ] `pnpm prepublishOnly` (clean + typecheck + lint + 100% coverage suite + build) passes.
- [ ] `pnpm size` passes within the brotli budgets; `dist/` contains `server/index.{mjs,cjs,d.ts}` and `shared/index.{mjs,cjs,d.ts}`.
- [ ] `pnpm mutation` completes at or above the Stryker break threshold (95); `docs/mutation_testing_results.md` is updated with the timestamp and the real scores.
- [ ] `package.json` version is set to `0.1.0` (from the pre-release placeholder).
- [ ] The `CHANGELOG.md` `0.1.0` entry has the real release date filled in.
- [ ] `/bymax-quality:code-review` is run one last time and all findings are applied.
- [ ] `git status` is clean (all commits made) and the E2E suite passes against MinIO (Docker running).

#### Files to create / modify

- `package.json` (version → `0.1.0`)
- `CHANGELOG.md` (fill the `0.1.0` date)
- `docs/mutation_testing_results.md` (fill real scores)

#### Agent prompt

````
You are a senior NestJS release engineer running the final pre-publish gate for @bymax-one/nest-storage.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS. Coverage
floor is 100% line/branch; mutation gate is Stryker break 95.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.8 of 9

PRECONDITIONS
- Tasks 5.1–5.7 are done: docs, LICENSE, CI confirmation, release.yml finalized, budgets calibrated.
- Docker is running locally for the E2E suite (MinIO via Testcontainers).

REQUIRED READING (only these):
- `docs/development_plan.md` §6.6 (final mutation run) and §6.7 (tag + publish prerequisites).

TASK
Run the complete local pipeline (CI + release simulation) and complete the pre-publish checklist.
Run the suites SEQUENTIALLY in this single agent — never fan out parallel test runners.

DELIVERABLES — run and confirm each:
1. `pnpm prepublishOnly` = clean + typecheck + lint + 100% coverage suite + build. Must pass.
2. `pnpm size` — within the brotli budgets. Confirm `dist/` has `server/index.{mjs,cjs,d.ts}` and
   `shared/index.{mjs,cjs,d.ts}`.
3. `pnpm test:e2e` — E2E green against MinIO (Docker up).
4. `pnpm mutation` — must finish at/above the break threshold (95). Update
   `docs/mutation_testing_results.md` with the real timestamp + global score + per-critical-path
   scores (replace every `TBD`).
5. Set `package.json` `"version": "0.1.0"` (from the pre-release placeholder).
6. Fill the real release date in the `CHANGELOG.md` `## [0.1.0]` heading.
7. Run `/bymax-quality:code-review` one last time and apply ALL findings.
8. Confirm `git status` is clean.

Constraints:
- Sequential test execution only (memory safety): one suite at a time, no parallel agents/runners.
- Do not bypass any gate; no `--no-verify`, no `@ts-ignore`, no coverage/mutation threshold lowering.
- Mutation break threshold is 95 — if the run drops below, fix tests, do not lower the threshold.
- English-only, timeless edits.

Verification:
- `pnpm prepublishOnly && pnpm size` — expected: exit 0.
- `node -p "require('./package.json').version"` — expected: `0.1.0`.
- `grep -E '\[0.1.0\] - 2026-[0-9]{2}-[0-9]{2}' CHANGELOG.md` — expected: a real date (no `XX`).
- `grep -qi 'TBD' docs/mutation_testing_results.md` — expected: NO match (all filled).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`X / 9`) in the header blockquote.
4. Append a Completion-log entry: `- 5.8 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md`.
6. Recompute **Overall progress** in `../development_plan.md` §1.4 and the dashboard Total row.
7. Commit `chore(storage): final pre-publish gate (5.8)` — NO Co-Authored-By trailer.
````

---

### Task 5.9 — Tag v0.1.0 + `npm publish --provenance` + post-publish smoke

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.8

#### Description

Create the annotated `v0.1.0` tag, push it to trigger `release.yml`, confirm the workflow publishes to npm with provenance and creates the GitHub Release, then run a post-publish smoke test in a clean directory consuming the package from npm.

#### Acceptance criteria

- [ ] Annotated tag `v0.1.0` created and pushed (`--follow-tags`).
- [ ] `release.yml` runs green: `pnpm prepublishOnly` + `pnpm publish --provenance` + GitHub Release.
- [ ] `https://www.npmjs.com/package/@bymax-one/nest-storage` shows `0.1.0` with the Provenance badge.
- [ ] A GitHub Release exists for `v0.1.0`.
- [ ] Post-publish smoke test in a clean directory installs the package + its peers and imports `providerRecipes` successfully.

#### Files to create / modify

- (none — git tag + release workflow; smoke test runs in a throwaway directory)

#### Agent prompt

````
You are a senior NestJS release engineer publishing @bymax-one/nest-storage v0.1.0.

PROJECT: @bymax-one/nest-storage — provider-agnostic S3-compatible storage for NestJS, published to
npm with provenance via the tag-driven `release.yml`.

CURRENT PHASE: 5 (Release v0.1.0) — Task 5.9 of 9 (FINAL)

PRECONDITIONS
- Task 5.8 passed the pre-publish gate: version is `0.1.0`, CHANGELOG dated, `git status` clean,
  all CI green, `release.yml` ready (triggers on `v*.*.*`, publishes with `--provenance`).
- OIDC Trusted Publishing is set up (NO `NPM_TOKEN`): a Trusted Publisher for `@bymax-one/nest-storage`
  is registered on npmjs.com and the `npm-publish` GitHub Environment has a required reviewer.

REQUIRED READING (only this):
- `docs/development_plan.md` §6.7 (tag + publish + post-publish smoke test).

TASK
Tag, push, confirm the release workflow, and smoke-test the published package. Use `gh` for all
GitHub operations.

DELIVERABLES
1. From the repo root, ensure clean + up to date:
   - `git status` (clean), `git pull --ff-only origin main`.
2. Create + push the annotated tag:
   - `git tag -a v0.1.0 -m "Release v0.1.0 — initial release"`
   - `git push origin main --follow-tags`
3. Confirm `release.yml` fires and is green (`gh run list --workflow release.yml`,
   `gh run view <id>` / `--log-failed`). Confirm: `pnpm prepublishOnly` ran, `pnpm publish
   --provenance` succeeded, and a GitHub Release was created.
4. Confirm publication:
   - `npm view @bymax-one/nest-storage version` → `0.1.0`.
   - The npm page shows the Provenance badge.
   - `gh release view v0.1.0` shows the Release.
5. Post-publish smoke test in a CLEAN throwaway directory:
   - `mkdir /tmp/nest-storage-smoke && cd /tmp/nest-storage-smoke && pnpm init`
   - `pnpm add @bymax-one/nest-storage @nestjs/common @nestjs/core @aws-sdk/client-s3
     @aws-sdk/lib-storage @aws-sdk/s3-request-presigner reflect-metadata`
   - Run a tiny script: `import { providerRecipes } from '@bymax-one/nest-storage'` and log
     `providerRecipes.minio({ endpoint, bucket, credentials })` — confirm it resolves with the
     checksum knobs set to `'WHEN_REQUIRED'`.
6. If the workflow fails: read the logs, fix the root cause, and only after confirming the diagnosis
   recreate the `v0.1.0` tag (delete local + remote first).

Constraints:
- Publish MUST use `--provenance` (done by the workflow); never publish manually without it.
- English-only, timeless.
- Do not delete/recreate the tag except after a confirmed root-cause diagnosis.

Verification:
- `npm view @bymax-one/nest-storage version` — expected: `0.1.0`.
- `gh release view v0.1.0` — expected: the Release exists.
- `gh run list --workflow release.yml --limit 1` — expected: latest conclusion `success`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the now-satisfied acceptance-criteria checkboxes.
3. Bump the phase **Progress** counter (`9 / 9`) in the header blockquote and set the phase Status
   to ✅ Done.
4. Append a Completion-log entry: `- 5.9 ✅ <YYYY-MM-DD> — <one-line summary>`.
5. Update this phase's row in the §1.5 Phase dashboard of `../development_plan.md` (mark ✅ Done).
6. Recompute **Overall progress** in `../development_plan.md` §1.4 (5/5 phases + 100%, 64/64 tasks)
   and the dashboard Total row.
7. Commit `chore(storage): release v0.1.0 (5.9)` — NO Co-Authored-By trailer.
````

---

## Completion log

_Append `- <id> ✅ <YYYY-MM-DD> — <summary>` as each task completes._

- 5.1 ✅ 2026-07-01 — README created with badges, four provider quick-starts, error table, and the two provider-trap callouts
- 5.2 ✅ 2026-07-01 — CHANGELOG.md (Keep a Changelog 1.1.0, full 0.1.0 Added list) and SECURITY.md (disclosure policy, storage-specific security goals, operational hardening) created
- 5.3 ✅ 2026-07-01 — CLAUDE.md (agent quick reference, 9 critical rules, context7 guidelines) and AGENTS.md (full architecture deep-dive: module, S3ClientProvider lifecycle, KeyResolverService, validation pipeline, TTL clamp, idempotency cache, provider recipes) created
