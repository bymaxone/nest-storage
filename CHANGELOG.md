# Changelog

All notable changes to `@bymax-one/nest-storage` are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

Versioning is **not** strict [SemVer](https://semver.org/spec/v2.0.0.html) while this API is
pre-stable: breaking changes ship in minor and patch releases by explicit `@bymax-one` policy,
so a version number carries no compatibility information. The **Apply to a derived backend**
note on each entry is the compatibility contract — read it, not the number.

---

## [Unreleased]

### Fixed

- **A failed scan cleanup now names the provider's cause and the key as stored, and a failed abort no
  longer says the upload was aborted.** The 1.1.5 failure reports were too thin to act on:
  - `details.cleanupError` of a rejected post-upload scan whose delete failed was the generic
    "Storage Exception", which lost the provider's message. It is now the error code and the
    provider's message, for example `STORAGE_PROVIDER_ERROR: Access Denied`.
  - `details.key` and the `STORAGE_SCAN_CLEANUP_FAILED` log line named the key you passed, not the
    key under the `keyPrefix`. The details now also carry `storedKey`, the key as the provider
    holds it, and the log line names it; an operator audits by listing the bucket.
  - `STORAGE_MULTIPART_ABORTED` carried the message "Multipart upload was aborted" even when
    `details.abort` was `'failed'`. In that case the message is now "Multipart upload failed and
    could not be aborted".

  **Apply to a derived backend:** code that matches `details.cleanupError` against the old generic
  text, or the multipart message against "Multipart upload was aborted" when the abort failed, no
  longer matches; read `details.cleanup`, `details.abort` and the error code instead. Log queries for
  `STORAGE_SCAN_CLEANUP_FAILED` now see the key with its `keyPrefix`. `details.storedKey` is new.
  `StorageException` gains an optional fourth constructor parameter, `message`, which replaces the
  default message of the code; existing calls are unchanged.

## [1.1.5] - 2026-11-01

### Fixed

- **With a `keyPrefix`, a post-upload scan never removed the object it rejected.** The cleanup passed
  the already-prefixed key to `delete()`, which prefixes it again, so it deleted `prefix/prefix/key`
  (nothing), succeeded, and the rejected object stayed stored: no error beyond the scan verdict and no
  log line. The cleanup now targets the object's real key.
- **A failed cleanup or abort is no longer reported as a clean outcome.** These paths told the caller
  one thing while the provider held another:
  - A `post-upload` scan that rejected an object deleted it and rejected with the verdict; when that
    delete failed, the caller saw only the verdict (`STORAGE_SCAN_INFECTED`) while the object stayed
    stored, and the failure was a log line. The verdict is still the error, and its `details` now
    carry `cleanup: 'failed'`, the `key` and the delete failure (`cleanupError`); the log line is at
    error level with the code `STORAGE_SCAN_CLEANUP_FAILED`.
  - A multipart upload whose `CompleteMultipartUpload` failed was reported as aborted but was never
    aborted: the upload and its parts stayed open on the provider. The library now sends
    `AbortMultipartUpload` itself.
  - When the abort also failed, the SDK threw the abort failure in place of the failure that caused
    it. The original failure is now the error, and `details.abort` is `'completed'` or `'failed'`
    (with `abortError`). The same holds for the silent-source abort (`STORAGE_TIMEOUT`,
    `details.phase: 'source-idle'`).
  - After `delete()` or `deleteMany()` removed an object, a repeated `upload()` with the same
    `idempotencyKey` was answered from the cache with a success (`fromIdempotencyCache: true`) for an
    object that no longer existed. Both now drop the cache entries of the objects they delete. The
    cache is per instance, so a delete made by another replica or outside the library still does not
    reach it.

  **Apply to a derived backend:** if you use a `keyPrefix` together with a `post-upload` scanner,
  **audit your bucket** for objects that failed a scan in an earlier version: they were never removed
  and nothing was logged, so your logs will not list them. Re-scan the prefix, or delete what your
  scanner flagged. Error shapes also change, not codes. Code that reads `error.details` of
  `STORAGE_SCAN_INFECTED`, `STORAGE_SCAN_INCONCLUSIVE`, `STORAGE_MULTIPART_ABORTED` or the
  source-idle `STORAGE_TIMEOUT` gains the fields above: treat `details.cleanup === 'failed'` as
  "rejected but still stored" and alert on it. A failed multipart upload now costs one more request,
  the `AbortMultipartUpload` the SDK used to send (the credentials already needed
  `s3:AbortMultipartUpload`). A repeated `upload()` after a `delete()` now stores the object again
  instead of returning the earlier result. `exists()` is unchanged and still returns `false` for any
  failure that is not a 404; the README now says so next to the method.

### Changed

- **The Stryker gate is 100.** `stryker.config.json` now fails a mutation run below 100 (`thresholds.break`
  and `low` were 95), and the README states the gate. Equivalent mutants stay documented inline; the gate is
  not lowered. Nothing in the published code changes.

## [1.1.4] - 2026-11-01

### Changed

- **A missing bucket is no longer reported as an absent object, and `delete()` no longer hides it.** When
  the provider answers `NoSuchBucket`, `download()`, `upload()`, `list()`, `copy()` and `delete()` now
  reject with the new `STORAGE_BUCKET_NOT_FOUND` (404) instead of `STORAGE_OBJECT_NOT_FOUND`, and
  `delete()`, which used to resolve successfully against a bucket that does not exist, rejects it.

  **Apply to a derived backend:** a behaviour change for a deployment whose bucket is missing or
  misnamed. Code that treated `STORAGE_OBJECT_NOT_FOUND` after a failed `download()`, `upload()`, `list()`
  or `copy()` as "the bucket or key is not there" must also handle `STORAGE_BUCKET_NOT_FOUND`, and a
  `delete()` that used to succeed silently now fails until the bucket exists. `head()` and `exists()` are
  unchanged: a `HEAD` response has no body, so the provider cannot say which of the bucket and the key is
  missing, and a missing bucket still reads as an absent object there (use `checkBucket()` to tell).

### Added

- **`StorageService.checkBucket()`.** One `HeadBucket` that resolves when the bucket is reachable with these
  credentials and otherwise rejects with a typed code: `STORAGE_BUCKET_NOT_FOUND` (404),
  `STORAGE_BUCKET_ACCESS_DENIED` (403, which a provider also answers for a bucket the caller cannot list),
  `STORAGE_BUCKET_REGION_MISMATCH` (301 or `PermanentRedirect`), `STORAGE_TIMEOUT`, or
  `STORAGE_PROVIDER_ERROR`. Nothing calls it at boot; wire it into a readiness endpoint so a misconfigured
  bucket keeps the instance out of rotation. It needs `s3:ListBucket`.

## [1.1.3] - 2026-11-01

### Fixed

- **A stream that stops delivering no longer holds a multipart upload open forever.** A multipart upload
  waiting for the next bytes of a stream has no request in flight, so `requestTimeoutMs` never fired:
  a client that sent a few MiB and went silent left `upload()` pending and the upload (and its parts)
  open on the provider until a lifecycle rule reaped it. A new `uploadIdleTimeoutMs` bounds the silence.
  Past it the library sends `AbortMultipartUpload`, destroys your stream and rejects `upload()` with
  `STORAGE_TIMEOUT` and `details.phase: 'source-idle'`. The clock restarts on every chunk and runs only
  while the library is waiting for data.

  **Apply to a derived backend:** a behaviour change, on by default. A stream source that delivers no
  bytes for `uploadIdleTimeoutMs` now aborts the multipart upload and rejects `STORAGE_TIMEOUT`; the
  limit defaults to `requestTimeoutMs` (30 s). Set `uploadIdleTimeoutMs: 0` to restore the old
  behaviour, or raise it for a source that legitimately pauses longer. It applies only to a stream that
  takes the multipart path (no `size`, or at or above `multipart.thresholdBytes`); single-shot uploads
  and `Buffer` bodies are unchanged. An invalid value (negative, fractional, not a number) is rejected
  at startup as `STORAGE_INVALID_CONFIG`.
- **Reporting a failure can no longer replace it.** `deleteMany()`, the post-upload cleanup, `exists()` and
  the multipart error mapping built a message with `String(err)` or `err.message`; for a rejection value
  with no usable `toString` (an object with no prototype, one whose `toString` throws) that raised from
  inside the catch and the new error escaped in place of the one being reported. A value is now described
  by its string `message`, else its string form, else `non-printable rejection value`, and never throws.

## [1.1.2] - 2026-10-31

### Changed

- **Keys the library returns are relative to `keyPrefix`, so every one can be passed back.**
  `UploadResult.key` and `ObjectMetadata.key` (from `head`, `download`, `downloadBuffer`) carried
  the `keyPrefix`, while every method prepends it again, so with a prefix set `head(r.key)`,
  `exists`, `download`, `delete` and a signed-URL call addressed `prefix/prefix/key`. `delete`
  was the quiet one: it removed nothing and reported success. `list()` and `deleteMany()` already
  returned relative keys. `UploadResult.publicUrl` is unchanged and still carries the prefix.

  **Apply to a derived backend:** only a deployment with a non-empty `keyPrefix` is affected. In
  1.0.0 to 1.1.1 the returned key is `prefix/name` and cannot be passed back; from this release it is
  `name`. A `.key` value you stored from an earlier version carries the prefix: strip it once (for
  example `stored.slice(prefix.length + 1)`, where `prefix` is the normalized `keyPrefix` without
  surrounding slashes) before passing it to the library, and when you read keys from your database
  stop adding or removing the prefix yourself.
- **`upload()` destroys a `Readable` body it rejects.** A rejected upload (invalid key or content
  type, a validation or scan failure, a provider error) used to leave the caller's stream open, so the
  file handle or the connection behind it stayed held. The library now takes ownership of the stream, as
  `stream.pipeline` does, and destroys it; a cache hit destroys it unread. The stream is destroyed
  without an error, because the AWS SDK (under its default checksum setting) wraps a stream body in its
  own Readable and forwards the source's error to it, and nothing listens to that wrapper once the
  request has failed; the failure is the rejection of `upload()`, and a listener on the stream sees
  `'close'`. Destroying can still emit `'error'` when the stream's own cleanup fails, so the library
  attaches a no-op listener first.

  **Apply to a derived backend:** do not reuse a stream you passed to `upload()`. A caller that
  fixed a validation error and retried with the same, still unread, stream must open a new one.

### Added

- **`STORAGE_NOT_MODIFIED` (304) and `STORAGE_PRECONDITION_FAILED` (412).** `download()` with
  `ifNoneMatch` equal to the current ETag, or `ifMatch` that differs, used to surface as a generic
  `STORAGE_PROVIDER_ERROR` (502); they now have their own codes, so a caller can branch on them.
  A 304 is thrown, not returned.
- **`BucketLifecycleService.upsert` writes multipart-abort rules.** An input with
  `abortIncompleteMultipartDays` instead of `expirationDays` adds or replaces an
  `AbortIncompleteMultipartUpload` rule, so abandoned multipart uploads stop holding storage. The
  read-modify-write, the preservation of other rules and the `keyPrefix` rules are the same; an empty
  prefix is allowed for this rule only (it means the module's whole namespace, and aborting deletes no
  object). Types `AbortMultipartRuleInput` and `LifecycleRuleInput`. MinIO does not accept this rule
  through the S3 API (the end-to-end suite shows the typed `STORAGE_LIFECYCLE_REJECTED`); AWS and R2
  document it.
- **`BucketLifecycleService`: bucket lifecycle rules.** `get()` returns the rules (an empty array when
  the bucket has no configuration), `upsert({ id, prefix, expirationDays })` adds or replaces one
  expiration rule by id, and `remove(id)` deletes one. Both writes read the configuration, change
  only the rule with that id and write the full set back, so every other rule (transitions, tag
  filters, multipart aborts) is sent back as the provider returned it. Removing the last rule calls
  `DeleteBucketLifecycle`, because S3 rejects a put with no rules. The read-modify-write is not
  atomic: S3 has no conditional lifecycle write, so a concurrent writer can be overwritten.
  The service is exported from the package and from the module.
- **Error codes:** `STORAGE_LIFECYCLE_RULE_INVALID` (400), `STORAGE_LIFECYCLE_UNSUPPORTED`
  (501) and `STORAGE_LIFECYCLE_REJECTED` (422).
- Types `BucketLifecycleRule`, `BucketLifecycleRuleView`, `LifecycleBucketOptions` and
  `ExpirationRuleInput`.

  **Apply to a derived backend:** additive; nothing existing changes. A consumer that applies
  lifecycle rules through the raw `S3Client` can switch to this service. Rule prefixes are relative
  to `keyPrefix`; with a `keyPrefix` set, rules outside it are returned flagged and are not changed.
  Providers other than MinIO (tested) and Cloudflare R2 (documented) are unverified; see the README.

### Fixed

- **`requestTimeoutMs` now takes effect.** It was resolved and defaulted to 30 000 ms but never
  passed to the S3 client, so a request to an endpoint that stopped answering waited forever. It is
  now the client's `requestTimeout` with `throwOnRequestTimeout`, and an attempt that gets no
  response headers in time fails as `STORAGE_TIMEOUT` (504). A failure inside a multipart upload
  still surfaces as `STORAGE_MULTIPART_ABORTED`.

  **Apply to a derived backend:** a behaviour change. The 30 s default now applies to every
  attempt, and an upload body counts toward it: a single-shot upload that needs longer than 30 s
  (a slow link, a body near `multipart.thresholdBytes`) now fails. Raise `requestTimeoutMs` for
  such workloads before upgrading. It does not limit reading a download stream.
- **A stream body under a pre-upload scanner no longer hangs the upload.** The scanner and the upload
  were handed the same stream object; a scanner that read it left the upload with nothing to send, and
  `upload()` never returned (nothing was stored). In `pre-upload` mode a stream is now read into one
  buffer, bounded by `validation.maxSizeBytes`, and the scanner and the upload share that buffer. A
  stream longer than the limit, or any stream when `maxSizeBytes` is unset, is refused with
  `STORAGE_VALIDATION_FAILED`.

  **Apply to a derived backend:** if you scan streams before upload, set `validation.maxSizeBytes`
  (or switch the scanner to `post-upload`), and expect the stream to be held in memory up to that size.
  With `requestTimeoutMs` an upload whose stream was consumed fails as `STORAGE_TIMEOUT` instead of
  hanging.
- **`getMultipartUploadUrls` validates `parts`.** Only `parts <= 0` was refused, so a fraction, `NaN`
  or a count above S3's 10 000 part numbers was accepted. `parts` must now be an integer from 1 to
  10 000, or the call throws `STORAGE_INVALID_PART_COUNT`. The README documents the 5 MiB minimum for
  every part but the last, the absence of an abort URL, and the `AbortIncompleteMultipartUpload`
  lifecycle rule recommended against orphaned uploads.
- **`signedUrls.maxTtlSeconds` above 604 800 is reduced at init.** The SigV4 signer rejects any
  expiry over 7 days, so a larger configured ceiling made every request above 7 days fail with a
  provider error while shorter requests worked. The ceiling is now capped at 604 800 s when the
  module starts, with one warning naming both values. A boot that worked before still boots.
- **`STORAGE_PART_TOO_SMALL` is documented as reserved.** Nothing throws it: a part size under the
  S3 minimum is rejected at init as `STORAGE_INVALID_CONFIG`. The code stays in the contract.
- **The published-surface gate now fails on a wrong option, method or field in a README snippet.**
  `check:published` ran `tsc` on the snippets, which stops after syntax errors and so never reported
  the semantic ones once any snippet had a parse error; it compiled only snippets that import the
  package; and it ignored every undeclared name, so a call through one resolved to `any`. Every
  snippet is now compiled with the syntactic and semantic diagnostics together, public names are
  imported for it, and the names a snippet takes from the surrounding prose are typed in
  `scripts/readme-prelude.ts`. A diagnostic about a missing property is excused as an abbreviated
  example only when the type is a plain identifier the snippet declares itself, searched outside its
  imports, so a wrong method on an imported or union type fails.
  The prelude is compiled as a `.ts` file, so a type in it that stops resolving is an error rather than
  an `any`, and any syntax error in a snippet fails the gate.
- **README option defaults and examples now match the code.** The configuration table listed
  `signedUrls.defaultTtlSeconds` (no such option; the options are `defaultGetTtlSeconds` and
  `defaultPutTtlSeconds`, both 300 s, not 3600), a 10 MiB multipart threshold and an 8 MiB part size
  (both are 5 MiB), a `'NONE'` module-level encryption value (accepted per upload only) and a "sensible
  default" MIME whitelist (there is none). The validator, scanner-mode and multipart-URL examples used
  names that do not exist (`validators`, `'both'`, `partCount`, `valid`). The error-code table now
  matches the key guard (it rejects an empty key and a null byte, not "empty after normalization"),
  and the `STORAGE_PART_TOO_SMALL` note says what the code does.
  A new spec parses the README option-default table and the error-code table and fails when either
  drifts from the code.

  **Apply to a derived backend:** documentation only; no behaviour changed.

## [1.1.1] - 2026-10-30

Apart from the removal below, nothing here changes the published bundle: the remaining entries are
development, test and CI tooling.

### Removed

- **`BYMAX_STORAGE_LOGGER` and `BYMAX_STORAGE_IDEMPOTENCY_CACHE` are no longer exported.**
  Both were re-exported from the package barrel while being absent from the module's
  `exports`: no provider ever registered `BYMAX_STORAGE_LOGGER`, and the idempotency cache is
  registered but deliberately not exported. Injecting either raised
  `UnknownDependenciesException` and the application failed to boot, so neither has ever been
  usable as an injectable token from this library.

  **Apply to a derived backend:** delete every *import* of these two names, not only the
  injections. The reliable signal is the TypeScript error `TS2305: Module … has no exported
  member '…'`, which fires in both module systems. At runtime the two differ, and only one is
  loud: an ESM consumer fails at module-link time with `SyntaxError: The requested module does
  not provide an export named '…'` before Nest bootstraps, while a CommonJS consumer — the
  common case for a compiled NestJS application — silently receives `undefined` and fails later
  with a confusing resolution error. Do not wait for a crash to find these; grep for the names.

  One shape did work and is the one to migrate deliberately: registering the exported symbol as
  **your own** provider (`{ provide: BYMAX_STORAGE_LOGGER, useValue: myLogger }`) and injecting
  it in your own service. That never involved this library's DI container. Replace the symbol
  with a token you own — `Symbol('MY_STORAGE_LOGGER')` — and nothing else changes.

  For logging specifically: services here use `new Logger(ClassName)` from `@nestjs/common`, so
  `app.useLogger(...)` redirects them all, which is what this token pretended to offer.

### Security

- Raised the floors of vulnerable transitive dev dependencies through `pnpm.overrides` in
  `pnpm-workspace.yaml`: `browserslist`, `fast-uri`, `qs`, `undici`, `multer`, `brace-expansion`,
  `handlebars`, `js-yaml`, `@grpc/grpc-js`, `body-parser`, `proxy-addr` and `zod`. Every one is
  reached only through test, lint or mutation tooling; `dependencies` is empty, so none ships.
- `osv-scanner.toml` ignores `GHSA-gcqx-w48m-w2h4` (`deepmerge`, reached only through
  `jest-config`) until 2027-01-27, because no patched release exists.

### Changed

- Moved the development toolchain to ESLint 10 and bumped the `dev-dependencies` groups.
- The E2E suite starts its S3 server from one image, pinned by digest, held in
  `test/e2e/fixtures/minio-container.ts`; the CI workflow pre-pulls the reference it reads from
  that file.
- Bumped the pinned CI actions (`actions/setup-node`, `actions/upload-artifact`,
  `step-security/harden-runner`, `pnpm/action-setup`, `github/codeql-action/upload-sarif`) and moved
  the OSV scan and the shared review-rules sync to their shared workflows.

### Tests

- `mapAwsError` is now asserted never to attach the caught error, on every branch.

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
[1.1.1]: https://github.com/bymaxone/nest-storage/compare/v1.1.0...v1.1.1
[1.1.2]: https://github.com/bymaxone/nest-storage/compare/v1.1.1...v1.1.2
[1.1.3]: https://github.com/bymaxone/nest-storage/compare/v1.1.2...v1.1.3
[1.1.4]: https://github.com/bymaxone/nest-storage/compare/v1.1.3...v1.1.4
[1.1.5]: https://github.com/bymaxone/nest-storage/compare/v1.1.4...v1.1.5
[Unreleased]: https://github.com/bymaxone/nest-storage/compare/v1.1.5...HEAD
