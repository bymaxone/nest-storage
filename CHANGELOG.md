# Changelog

All notable changes to `@bymax-one/nest-storage` are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [1.0.1] - 2026-08-03

Documentation only. `dist/` is byte-identical to the one published in 1.0.0 —
verified by unpacking `@bymax-one/nest-storage@1.0.0` from the registry and
diffing it against a fresh build, not asserted. The README ships inside the
package, so a README that is wrong on npm stays wrong until a release replaces
it; that is the whole reason this version exists.

### Fixed

- **Four statements in the README that the code does not support.**
  `KeyResolverService` was documented as public API — it is not exported from the
  barrel, so `import { KeyResolverService } from '@bymax-one/nest-storage'` does
  not resolve. The module was described as refusing an unusable configuration at
  bootstrap; `validate-options` deliberately tolerates empty credentials so a
  development workflow boots without storage, and operations then fail with
  `STORAGE_NOT_CONFIGURED`. `STORAGE_INVALID_PART_COUNT` was missing from the
  error table although `getMultipartUploadUrls()` throws it for `parts <= 0`.
- **The error-payload claim, in both places it was made.** The error table and
  the security table said `details` carries the provider code, HTTP status and
  request id _only_. `mapAwsError` also includes `awsMessage` and spreads the
  call site's context — `op`, `bucket`, and the resolved `key` or `prefix` — so an
  object key does reach whatever consumes the exception. Both now list what is
  actually there, and the security model says the consequence plainly.
- **The supply-chain row named tools this repository does not run.** It claimed
  OSV-Scanner _and_ TruffleHog; only OSV-Scanner is wired up here, alongside
  CodeQL and OpenSSF Scorecard. It also called the Actions SHA-pinned without
  qualification, where the org-internal reusables are referenced by tag.

### Changed

- **The README follows the `@bymax-one` family layout.** Header rebuilt to the
  shared shape — wordmark, package name, claim and feature line, one badge row,
  one navigation row — and the section spine completed with API Reference,
  Architecture, Security Model, Security Table, Tech Stack, Testing & Quality and
  Security Policy, which every published library in the family carries and this
  one did not.

## [1.0.0] - 2026-08-03

First published release. Everything below ships in it.

The `Fixed` and `Security` entries record defects found and corrected before
publication, not regressions any consumer saw — there is no earlier release to
have regressed from. They are kept because the reasoning is worth having.

### Added

- **Initial release** of `@bymax-one/nest-storage` — provider-agnostic S3-compatible object storage for NestJS.
- **Single `@aws-sdk/client-s3` engine** — works with AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO, and Wasabi.
- **`StorageService`** — full object lifecycle:
  - `upload()` — single-shot PutObject or automatic multipart via `@aws-sdk/lib-storage` (with `leavePartsOnError: false` for automatic abort on failure), `onProgress` events, `idempotencyKey` cache
  - `download()` — streaming `Readable` with metadata
  - `downloadBuffer()` — buffered download (for files < 10 MiB)
  - `head()` — object metadata without downloading
  - `exists()` — non-throwing existence check
  - `delete()` — idempotent (no error on 404)
  - `deleteMany()` — batched (chunked ≤ 1 000 keys per S3 API call); returns `{ deleted, failed }`
  - `list()` — paginated listing via `ContinuationToken`
  - `copy()` — server-side copy (same or cross-bucket)
  - `getPublicUrl()` — unsigned public URL (does not validate ACL or existence)
- **`SignedUrlService`** — presigned URL generation:
  - `getDownloadUrl()` — presigned GET with optional response headers
  - `getUploadUrl()` — presigned PUT with Content-Length-Range policy
  - `getMultipartUploadUrls()` — presigned multipart (InitiateMultipartUpload + per-part URLs)
  - TTL clamped to `signedUrls.maxTtlSeconds`; `maxTtlSeconds` clamped to 604 800 s (7-day SigV4 ceiling) at init
- **`IUploadValidator` hook** — pluggable pre-upload validator (MIME whitelist with wildcards, size limit, custom `readBytes` magic-byte checks); `NoOpUploadValidator` included
- **`IFileScanner` hook** — pluggable virus-scan integration (`pre-upload` / `post-upload` / `both`; `rejectOnUnknown` policy); `NoOpFileScanner` included
- **Six provider recipes** (`providerRecipes`):
  - `awsS3` — AWS S3 with SSE-AES256; SDK default checksum mode
  - `cloudflareR2` — region `'auto'`; `customDomain` required; checksums `'WHEN_REQUIRED'`
  - `backblazeB2` — virtual-hosted; checksums `'WHEN_REQUIRED'`
  - `digitalOceanSpaces` — with CDN base URL; checksums `'WHEN_REQUIRED'`
  - `minio` — `forcePathStyle: true`; checksums `'WHEN_REQUIRED'`
  - `wasabi` — virtual-hosted; checksums `'WHEN_REQUIRED'`
- **17-code `StorageException` catalog** — typed errors extending `HttpException` with `{ error: { code, message, details? } }` response body; `STORAGE_ERROR_CODES` exported from the `./shared` subpath
- **`keyPrefix` multi-tenant isolation** — prepended to every resolved key; enforced by `KeyResolverService`
- **Mandatory path-traversal guard** — `KeyResolverService` blocks `..`, leading `/`, and empty-after-normalize keys (`STORAGE_KEY_INVALID` / HTTP 400)
- **In-memory LRU idempotency cache** — default 1 000 entries / 24 h; `idempotencyKey` per-upload
- **Server-side encryption** — `serverSideEncryption: 'AES256'` or `'aws:kms'` globally or per-upload; `'NONE'` sentinel omits the header
- **Subpath exports**:
  - `.` — server runtime (NestJS module, services, provider recipes, DI tokens, interfaces)
  - `./shared` — framework-free types and `STORAGE_ERROR_CODES`
- **`forRoot` / `forRootAsync`** dynamic module API (`@Global()`; `Symbol()` DI tokens)
- **`BYMAX_STORAGE_S3_CLIENT` DI token** — raw `S3Client` injection for provider-specific advanced operations (spec §11.2)
- **Non-AWS checksum opt-out** — the five non-AWS recipes set `requestChecksumCalculation` / `responseChecksumValidation` to `'WHEN_REQUIRED'` to prevent the SDK's default CRC32 `x-amz-checksum-*` headers from being sent to providers that reject them

- **`pnpm check:exports`** runs `attw --pack . --profile strict` against the packed
  tarball. Its absence is why both defects above went unnoticed: a source-level
  typecheck compiles `src` and never resolves through the `exports` map.
- **`pnpm check:runtime`** packs the tarball, lays it out the way npm would, and
  loads every subpath from it in ESM _and_ CommonJS, asserting the expected values
  are really exported. `attw` proves the declarations resolve; it never runs the
  JavaScript. Both gates run in CI.

### Fixed

- **CommonJS consumers resolved ESM type declarations.** The `exports` map
  declared a single `types` condition, so `require()` landed on `.d.ts` instead of
  `.d.cts` — `attw --profile strict` reports it as _Masquerading as ESM_ on every
  subpath. Types are now declared per condition.

- **`node10` type resolution failed outright**: the manifest carried no complete
  set of `main`, `module`, `types` and `typesVersions`. All four are now present.

### Security

- **Peer floors raised to exclude known-vulnerable NestJS versions.** The declared
  ranges were `@nestjs/common ^11.0.0` and `@nestjs/core ^11.0.0`, and both
  admitted versions carrying published advisories:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | New floor  |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |

  A peer range is a statement about which versions this library supports. A floor
  below a published advisory tells a consumer that a vulnerable install is a
  supported one, and nothing in their tooling contradicts it — the install resolves
  cleanly and silently. Corrected before the first publish, so no released version
  ever carried the permissive range. No runtime behaviour changed.

---

[1.0.0]: https://github.com/bymaxone/nest-storage/releases/tag/v1.0.0
[1.0.1]: https://github.com/bymaxone/nest-storage/compare/v1.0.0...v1.0.1
[Unreleased]: https://github.com/bymaxone/nest-storage/compare/v1.0.1...HEAD
