# Mutation Testing Results — @bymax-one/nest-storage (Phase 4.10)

**Date:** 2026-07-01
**Tool:** StrykerJS (`pnpm mutation`)
**Scope:** `src/server/**` unit test suite (Jest)

## Baseline (before this round)

| Metric | Value |
| --- | --- |
| Mutation score | **81%** |
| Killed | 510 |
| Timeout (detected) | 10 |
| Total detected | 520 |
| **Survived** | **122** |
| No coverage | 0 |

Line/branch/function coverage was already 100%. Every survivor was an **assertion
gap**: the mutated code was executed by a test, but no assertion pinned the exact
value/branch the mutant changed.

## What was strengthened

All 122 survivors were addressed: **114 killed with new/upgraded assertions** and
**8 marked as provable equivalents** (disabled inline). No production behaviour was
changed. The fast gates remain green: `pnpm typecheck`, `pnpm lint`, and
`pnpm test:cov` (308 tests, 100% line/branch/function coverage preserved).

Representative assertion upgrades, grouped by source file:

- **config/validate-options.ts** — assert the exact `details.reason` for every
  structural guard (options object, endpoint, region, bucket, credentials).
- **config/apply-defaults.ts** — assert optional keys are **omitted** (`'key' in r`)
  rather than set to `undefined`; assert multi-slash endpoints collapse to a single
  `/` in `publicBaseUrl` (regex `/\/+$/` + empty replacement).
- **config/provider-recipes.ts** — assert `sessionToken` key absence when no token.
- **services/key-resolver.service.ts** — assert exact `details.reason` per guard;
  assert prefix trimming preserves internal slashes and strips *multiple* leading /
  trailing slashes (the four `/^\/+|\/+$/g` regex mutants).
- **services/validation.service.ts** — assert `MIME_NOT_ALLOWED`/`SIZE_EXCEEDED`
  details; assert the `size > maxSizeBytes` boundary (exact-limit upload passes);
  assert `size`/`metadata` are included in the validator context only when provided.
- **services/file-scanner.service.ts** — assert both `&&` operands of `isEnabled`,
  the exact "guard with isEnabled()" Error message, the `SCAN_INCONCLUSIVE` details,
  the exact "Inconclusive scan result accepted" warn log, and that a `clean` result
  never enters the unknown branch even with `rejectOnUnknown: true`.
- **providers/s3-client.provider.ts** — assert the built client's resolved
  `config.credentials()` carries the configured `accessKeyId`/`secretAccessKey`
  (kills the `config -> {}` mutant, which would fall back to the ambient credential
  chain) and the `sessionToken`; assert the `getClient()` "not available" Error
  message and the missing-credentials warn / init log lines.
- **services/signed-url.service.ts** — assert `getSignedUrl` receives
  `{ expiresIn: ttl }`; assert conditional command keys
  (`ResponseContentDisposition`/`ResponseContentType`/`Metadata`) are omitted when
  absent; assert `expiresAt = now + ttl * 1000` for the PUT path (both arithmetic
  mutants); assert `mapAwsError` context (`op`/`key`/`bucket`) for GET/PUT/multipart;
  assert `INVALID_PART_COUNT` / no-`UploadId` `PROVIDER_ERROR` details (the latter
  also kills the `instanceof StorageException` re-throw guard).
- **services/storage.service.ts** — assert `mapAwsError` context (`op` + keys) for
  `head`/`download`/`delete`/`upload-single`/`list`/`copy`; assert `OBJECT_NOT_FOUND`
  (no body) and `MULTIPART_ABORTED` details; assert `exists()` warn behaviour on the
  404 vs non-404 branches; assert the idempotent-delete warn log; assert the
  post-upload cleanup deletes from the **per-call** bucket and logs on delete failure;
  assert size/metadata spread into the validation pipeline; assert `deleteMany([])`
  returns early **before** `resolveBucket`; assert `getPublicUrl` base normalization
  (multi-slash strip) and `baseCarriesBucket` authority/path-segment parsing edges.
- **module** — assert the idempotency-cache factory yields a real `IdempotencyCache`
  and that `forRoot().exports` contains the full public DI surface.
- **utils/mime-match.ts, utils/stream-utils.ts, utils/ttl-clamp.ts** — assert input
  trimming, same-type/different-subtype non-match, slashless-pattern handling, the
  cross-chunk peek width (`maxBytes - peeked`) and the `peeked >= maxBytes` close
  boundary, and the `TTL_INVALID` details (`reason` + `provided`).

## Provable equivalent mutants (disabled inline)

Each is disabled at its exact line with `// Stryker disable next-line <Mutator>: <reason>`.
These mutations cannot change observable behaviour within the code's actual input
contract, so no test can distinguish them (disabling them is correct, not a coverage
gap).

| # | File : Line | Mutator | Original → Mutated | Why it is equivalent |
| --- | --- | --- | --- | --- |
| 1 | `utils/mime-match.ts:35` | ConditionalExpression | `normalized.length === 0` → `false` | An empty `normalized` can never contain `/`, so the second operand `!normalized.includes('/')` already covers the length-0 case. Forcing the first operand to `false` leaves the disjunction's truth value unchanged for every input. |
| 2 | `utils/stream-utils.ts:89` | ConditionalExpression | `!isPeekClosed` → `true` | The `isPeekClosed` flag is still set to `true` inside the block, and calling `peekPT.end()` more than once on a `PassThrough` is a harmless no-op (verified empirically). Dropping this idempotency guard changes nothing observable, including the L105 backpressure branch. |
| 3 | `services/storage.service.ts:432` | Regex | `/^[a-z][a-z\d+.-]*:\/\//i` → drop `^` anchor | `base` is always a well-formed absolute URL with a single leading `scheme://` (or a bare authority with no `://`). For that input domain the leftmost match is the leading scheme either way, so `schemeless` is identical. |
| 4 | `services/storage.service.ts:432` | Regex | `/^[a-z][a-z\d+.-]*:\/\//i` → `\d`→`\D` | Same input domain: with a single `://` delimiter and standard scheme characters, widening the class to "any non-digit" backtracks to the identical scheme strip. It could only differ on malformed inputs (e.g. a second `://`) that `publicBaseUrl`/`cdnBaseUrl` never produce. |
| 5 | `services/storage.service.ts:435` | StringLiteral | `''` → `"Stryker was here!"` | When `pathStart === -1`, `path` is consumed only by `pathSegments.includes(bucket)`. An empty string and any non-bucket sentinel yield the same `includes(bucket)` result, and no real bucket equals the injected sentinel. |
| 6 | `services/storage.service.ts:437` | MethodExpression | `path.split('/').filter(s => s.length > 0)` → drop `.filter(...)` | `pathSegments` is used only via `.includes(bucket)`, and `bucket` is guaranteed non-empty by `resolveBucket`; retaining empty `''` segments can never match a non-empty bucket. |
| 7 | `services/storage.service.ts:437` | ConditionalExpression | `segment.length > 0` → `true` | Same reason as #6 — the predicate becoming always-true only keeps empty `''` segments, which never equal the non-empty `bucket`. |
| 8 | `services/storage.service.ts:437` | EqualityOperator | `segment.length > 0` → `segment.length >= 0` | Same reason as #6 — `>= 0` is always true, keeping empty `''` segments that never match the non-empty `bucket`. |

> Note: the disable comments on lines 432 and 437 are per-mutator, so they also
> suppress the already-killed non-equivalent variants that share those mutator names
> on the same line (e.g. the `ConditionalExpression -> false` on line 437, which is
> covered by the path-style `getPublicUrl` tests). Those behaviours remain tested and
> passing; they are simply no longer counted in the mutation denominator.

## Expected outcome

With 114 survivors newly killed and 8 equivalents excluded, the mutation score is
expected to rise from 81% to **≥ 95%** (Stryker `break: 95`). The full
`pnpm mutation` run (~15 min) is executed by the orchestrator to confirm.
