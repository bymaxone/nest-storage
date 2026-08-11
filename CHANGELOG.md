# Changelog

All notable changes to `@bymax-one/nest-storage` are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [1.1.0] - 2026-08-11

Coordinated ecosystem release aligning every `@bymax-one/*` package after the ioredis 6 /
bullmq 6 migration. **No source, runtime, or public-API change in this package** — the
published `dist/` is byte-identical to `1.0.6`; the changes below are development
and CI tooling only.

### Changed

- Bumped the `dev-dependencies` group with 6 updates. None of these reaches the published bundle.
- Bumped the pinned `google/osv-scanner-action` CI action from 2.3.8 to 2.5.0.
- Bumped the pinned `step-security/harden-runner` CI action from 2.20.0 to 2.20.1.
- Bumped the pinned `pnpm/action-setup` CI action from 6.0.9 to 6.0.10.
- Bumped the pinned `github/codeql-action/upload-sarif` CI action from 4.37.4 to 4.37.6 in the
  codeql group.
- Reworked the mutation workflow to run incrementally on each push and to measure cold once a week.

## [1.0.6] - 2026-08-06

**Documentation and tooling, not behaviour.** `dist/` differs from `1.0.5` only in the text
of five comments; no runtime code changed.

### Fixed

- **Five of the six suppression reasons never reached the mutation report.** Stryker captures
  a directive's reason only after the colon and only to the end of that comment line. Five
  directives wrapped their reason onto following `//` lines, so the report kept a truncated
  half-sentence — and for the one on `storage.service.ts` it kept nothing, falling back to
  `Ignored using a comment`. `docs/mutation_testing_results.md` had specified the right shape
  (`<Mutator>: <reason>`) all along; the source did not follow it. Each reason is now on its
  directive line.
- The README counted **five** `// Stryker disable` comments where the source carries six.

### Security

- **`js-yaml` is patched to the fixed release** (GHSA-5p4m-2wfm-xmqj, CVSS 7.5). It reaches
  this repo only through `jest` -> `babel-plugin-istanbul` -> `@istanbuljs/load-nyc-config`,
  and `dependencies` is empty, so nothing here ships it and no consumer was exposed. Fixed
  with a `pnpm-workspace.yaml` override to `3.15.1` / `4.3.1` — a patch bump within each
  major — rather than by telling the scanner to ignore dev dependencies, which would leave it
  blind after this advisory is gone. `dist/` is unaffected.

### Added

- `check:mutants` gate (`scripts/check-mutation-directives.mjs`) — validates every
  `// Stryker` comment against the parser's own regular expression, rejecting a reason
  wrapped onto a second line, a reason written after `--` instead of a colon, and a mutator
  name Stryker does not know, which would silence nothing. Wired into CI and
  `prepublishOnly`.

## [1.0.5] - 2026-08-06

**Published-artifact change, not a behavioural one.** `dist/` differs from `1.0.4` — this
bundler preserves comments and the source gained mutation-suppression notes — but no runtime
path changed. Measured by building both revisions and diffing the output.

### Tests

- `configurable: false` on the withheld credentials accessor had nothing asserting it. That flag
  is the guarantee behind every serialization assertion already in the suite: a configurable
  accessor can be redefined back into a plain enumerable value by anything holding the object.
  It is load-bearing in this package specifically — the sibling cache and queue packages freeze
  their resolved options, which makes every property non-configurable anyway; this one does not.

## [1.0.4] - 2026-08-04

### Security

- The AWS credentials are no longer disclosed when a service that holds the resolved
  options is serialized. `credentials` moves from a plain field on the resolved options
  object to a non-enumerable accessor, so `JSON.stringify`, object spread, `util.inspect`
  and `util.inspect` with `showHidden` all omit it. The resolved options are injected into
  `StorageService`, `SignedUrlService`, `ValidationService` and `FileScannerService`, so
  the long-lived `accessKeyId`, `secretAccessKey` and `sessionToken` were previously
  emitted in plaintext by anything that rendered one of them incidentally — a structured
  logger formatting its arguments, an error reporter capturing the scope of a throw.
  Plain `JSON.stringify` happened not to disclose them only because it throws on the S3
  client's circular graph, which is an accident rather than a defence: the circular-safe
  stringifier that pino and winston use disclosed them, as did `util.inspect`.

Reading on purpose is unchanged. `options.credentials.accessKeyId` and its siblings
resolve exactly as before, and no public type changed.

## [1.0.3] - 2026-08-04

Documentation only. `dist/` is byte-identical to the one 1.0.2 published — verified by
unpacking `@bymax-one/nest-storage@1.0.2` from the registry and diffing it against a
fresh build (`diff -r`, no output), not asserted. 1.0.0 and 1.0.1 shipped the same
`dist/`, so the artifact has not changed since the first release.

### Changed

- **The architecture diagram is drawn rather than listed.** Every published
  `@bymax-one` library draws this section with box-drawing characters, laid out so the
  picture shows what flows into what. This one had an indented tree of bullets with a
  description beside each entry, which says what exists but not how a request moves
  through it, which step feeds which, or where the decision is made. The redrawn
  diagram carries what the prose underneath was saying alone: the single chokepoint
  every caller-supplied key passes before it reaches S3, and the escape hatch beside
  the two services rather than buried under them.

## [1.0.2] - 2026-08-04

Documentation only, again — and for the same reason 1.0.1 existed: the README ships
inside the package, so a correction that stays on `main` leaves the npm page wrong.
`dist/` is byte-identical to 1.0.0 and 1.0.1, verified by unpacking the published
tarball and diffing it against a fresh build rather than asserting it.

### Fixed

- **The vulnerability contact pointed at a mailbox that does not exist.** The README's
  Security Policy and `SECURITY.md` both named `security@bymax.one`. A researcher
  following those instructions sent a private disclosure into nothing — and from their
  side, an unread inbox and a maintainer ignoring them look identical, so a report that
  gets no acknowledgement is usually published anyway. Everything now names
  `support@bymax.one`, the single inbox that routes.

### Changed

- **The README follows the layout of the published `@bymax-one` libraries, not just
  their section names.** The previous release standardized which sections exist and
  left the inside of each as it was. Features is now grouped under subheadings with
  one entry per capability, Overview carries a `Why nest-storage?` block, Architecture
  carries the design-principles table that follows its diagram everywhere else,
  Security Model is one subheading per property, and Testing & Quality states what the
  suite is held to before listing the commands. The tail gained the family's license
  line and footer, and Subpath Exports gained the dependency diagram and peer matrix.
- **Four statements corrected against the source.** `KeyResolverService` was listed as
  public API and is not exported; the module was described as refusing an unusable
  configuration at bootstrap, where `validate-options` deliberately tolerates empty
  credentials so a development workflow boots; `STORAGE_INVALID_PART_COUNT` was missing
  from the error table; and the suppression claim said the production source carries no
  mutation directives, where it carries five, each naming why its mutant is provably
  equivalent.

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
[1.0.2]: https://github.com/bymaxone/nest-storage/compare/v1.0.1...v1.0.2
[1.0.3]: https://github.com/bymaxone/nest-storage/compare/v1.0.2...v1.0.3
[1.0.4]: https://github.com/bymaxone/nest-storage/compare/v1.0.3...v1.0.4
[1.0.5]: https://github.com/bymaxone/nest-storage/compare/v1.0.4...v1.0.5
[1.0.6]: https://github.com/bymaxone/nest-storage/compare/v1.0.5...v1.0.6
[1.1.0]: https://github.com/bymaxone/nest-storage/compare/v1.0.6...v1.1.0
[Unreleased]: https://github.com/bymaxone/nest-storage/compare/v1.1.0...HEAD
