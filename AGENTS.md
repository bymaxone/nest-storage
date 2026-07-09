# @bymax-one/nest-storage — Architecture Deep Dive

For a concise agent quick reference, see `CLAUDE.md`. This document explains the internal design decisions in sufficient depth for an AI agent (or human contributor) to make correct changes without misunderstanding the system.

---

## 1. Package Design

### 1.1 Single-engine, provider-agnostic

The entire library wraps a single `@aws-sdk/client-s3` `S3Client`. There is no provider-specific branching in the core services — the differences between AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO, and Wasabi are expressed as `BymaxStorageModuleOptions` (configuration), not as code branches. Provider-specific config is produced by the `providerRecipes` helpers.

### 1.2 Zero runtime dependencies

`package.json` ships `"dependencies": {}`. Every runtime dependency is a `peerDependency` — the consumer application controls the versions. This minimises the library's supply-chain footprint.

### 1.3 Two subpath exports

| Subpath | Purpose |
|---|---|
| `.` (server) | NestJS module, services, provider recipes, DI tokens, interfaces, errors |
| `./shared` | Framework-free types (`UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`) + `STORAGE_ERROR_CODES` |

The shared subpath has zero `@nestjs/*` imports — it can be used safely in edge workers, browser code, or other non-NestJS contexts.

---

## 2. Dynamic Module (`forRoot` / `forRootAsync`)

`BymaxStorageModule` is a `@Global()` dynamic NestJS module. It exposes two static methods:

### 2.1 `forRoot(options: BymaxStorageModuleOptions)`

Synchronous configuration. Calls `validateOptions(options)` (throws `STORAGE_INVALID_CONFIG` on failure) and `applyDefaults(options)` to produce a `ResolvedStorageOptions` object. Returns a `DynamicModule` that registers all internal providers and exports the public ones.

### 2.2 `forRootAsync(options: BymaxStorageModuleAsyncOptions)`

Asynchronous configuration — supports `useFactory`, `useClass`, and `useExisting` patterns. The factory is resolved by the NestJS DI container at module init time. Internally, the async options are normalised into a provider that produces the same `ResolvedStorageOptions` as `forRoot`.

### 2.3 `@Global()` scope

The module is global so that `StorageService` and `SignedUrlService` can be injected into any module without re-importing `BymaxStorageModule`. This matches the `@nestjs/config` and `@nestjs/cache-manager` conventions.

### 2.4 DI tokens (`Symbol`)

All internal providers are registered behind `Symbol()` tokens defined in `bymax-storage.constants.ts`:

| Token | Provides |
|---|---|
| `BYMAX_STORAGE_OPTIONS` | `ResolvedStorageOptions` |
| `BYMAX_STORAGE_S3_CLIENT` | `S3Client` instance (raw — for advanced ops) |
| `BYMAX_STORAGE_UPLOAD_VALIDATORS` | `IUploadValidator[]` |
| `BYMAX_STORAGE_FILE_SCANNER` | `IFileScanner` (or `NoOpFileScanner`) |
| `BYMAX_STORAGE_LOGGER` | `Logger` instance |
| `BYMAX_STORAGE_IDEMPOTENCY_CACHE` | `IdempotencyCache` |

`BYMAX_STORAGE_S3_CLIENT` is **exported** (public surface) so consumers can inject the raw client for provider-specific operations not covered by `StorageService`.

---

## 3. `S3ClientProvider` — Lifecycle

`S3ClientProvider` is an internal `@Injectable()` class that owns the `S3Client` lifecycle.

### 3.1 `onModuleInit`

The `S3Client` is created lazily in `onModuleInit`, not in the constructor. This allows the module to register successfully even when credentials are absent (missing credentials at init time produce a warning log; the first operation will fail with `STORAGE_NOT_CONFIGURED` rather than crashing the application at startup — the "silent failure on init" principle from the original `SpacesService`).

The S3Client config is built from `ResolvedStorageOptions`, including:
- `endpoint`, `region`, `forcePathStyle`, `credentials`, `maxAttempts`
- `requestChecksumCalculation`, `responseChecksumValidation` (the non-AWS checksum opt-out fields; see §7)

### 3.2 `onApplicationShutdown`

`s3Client.destroy()` is called in `onApplicationShutdown` to release the HTTP connection pool. This prevents file-descriptor leaks during graceful shutdown.

### 3.3 `getClient()` — fail-closed

`getClient()` throws `STORAGE_NOT_CONFIGURED` (HTTP 503) if the client was not initialised (credentials absent at startup). It never returns `undefined`.

### 3.4 Retries

Retry behaviour is controlled by `maxAttempts` (default `3`). This is the AWS SDK v3 knob; the v2 `maxRetries` option does not exist in v3 and is never used.

---

## 4. `KeyResolverService` — Path-Traversal Guard

`KeyResolverService` is the security boundary between user-supplied key strings and the AWS SDK. It must be called for every key before that key reaches any SDK command.

### 4.1 Normalisation

1. Trim whitespace.
2. Collapse multiple consecutive `/` separators to a single `/`.
3. Resolve `./` prefixes (these are safe but normalised away for consistency).

### 4.2 Guards (fail-closed)

After normalisation:

- Reject if the key is empty.
- Reject if any path segment is `..` (path traversal).
- Reject if the normalised key starts with `/`.

All rejections throw `STORAGE_KEY_INVALID` (HTTP 400) with a `details.reason` describing the specific guard that fired.

### 4.3 `keyPrefix` application

If `keyPrefix` is set in `ResolvedStorageOptions`, it is prepended to the normalised key. The result is the final resolved key. `keyPrefix` itself is validated at module init time (the same guards apply — it must not traverse up).

---

## 5. Validation Pipeline

The validation pipeline runs inside `StorageService.upload()` before any bytes are sent to the provider. It is composed of three sequential stages:

```
checkMime(contentType, mimeWhitelist)
  → checkSize(size, maxSizeBytes)
  → runCustomValidators(body, validators, readBytes)
  → runPreUploadScanner(body, scanner)
```

### 5.1 `checkMime`

Validates `contentType` against `mimeWhitelist` using `mime-match.ts`. Wildcards are supported (`'image/*'` matches `'image/jpeg'`, `'image/png'`, etc.). Throws `STORAGE_MIME_NOT_ALLOWED` (HTTP 415) on mismatch.

### 5.2 `checkSize`

Validates `size` (if provided) against `maxSizeBytes`. Throws `STORAGE_SIZE_EXCEEDED` (HTTP 413) when `size > maxSizeBytes`. Note: `size` is optional in `UploadOptions` — when absent, this check is skipped (the provider may still reject oversized objects).

### 5.3 Custom `IUploadValidator`

Each registered `IUploadValidator.validate(input)` is called with `{ body, readBytes }`. The `readBytes(n)` helper peeks at the first `n` bytes of the body stream without consuming it (uses a `PassThrough` tee). On failure, the validator returns `{ valid: false, reason: string }`; the pipeline throws `STORAGE_VALIDATION_FAILED` (HTTP 400).

### 5.4 `IFileScanner` (pre-upload)

If `scanner.mode` is `'pre-upload'` or `'both'`, the scanner runs before the upload. `'infected'` → `STORAGE_SCAN_INFECTED` (HTTP 422). `'unknown'` → `STORAGE_SCAN_INCONCLUSIVE` (HTTP 422) when `rejectOnUnknown: true`; otherwise logged and allowed through.

### 5.5 Post-upload scanner

If `scanner.mode` is `'post-upload'` or `'both'`, the scanner runs after a successful upload. On `'infected'`, the uploaded object is deleted and `STORAGE_SCAN_INFECTED` is thrown. On delete failure, the error is logged but the scan rejection is still surfaced.

---

## 6. Signed-URL TTL Clamp (`ttl-clamp.ts`)

The SigV4 specification hard-limits presigned URL validity to 604 800 seconds (7 days). The clamp logic:

1. At module init: `signedUrls.maxTtlSeconds` is clamped to `min(maxTtlSeconds, 604800)`. Values above 7 days are silently reduced.
2. Per-request: if `ttlSeconds` is ≤ 0, throw `STORAGE_SIGNED_URL_TTL_INVALID` (HTTP 400).
3. Per-request: if `ttlSeconds` > `maxTtlSeconds`, silently clamp to `maxTtlSeconds`. The caller receives a URL with a shorter TTL than requested without an error — the ceiling is an operational constraint, not a per-request contract.

This asymmetry is intentional: rejecting TTL ≤ 0 prevents a degenerate (immediately-expired) URL; silently clamping high TTLs avoids breaking callers that request a long TTL on a system configured for a shorter maximum.

---

## 7. LRU Idempotency Cache (`idempotency-cache.ts`)

The idempotency cache stores `UploadResult` objects keyed by `idempotencyKey`. It prevents duplicate uploads when the same logical object is submitted more than once (e.g. retry after a network timeout on the client side).

| Property | Default | Notes |
|---|---|---|
| Max entries | 1 000 | LRU eviction when full |
| TTL per entry | 24 h | Entries expire after 24 hours regardless of LRU position |
| Scope | Per process instance | Not shared across replicas |

**Multi-replica caveat:** two pods can each receive the same `idempotencyKey` simultaneously and both upload the object. A distributed `IIdempotencyStore` (backed by Redis or a DB) is planned for v0.2.

---

## 8. Provider Recipes

`providerRecipes` is a plain object (`as const`) with one factory per provider. Each factory accepts a provider-specific input shape and returns a `BymaxStorageModuleOptions` ready to spread into `forRoot`/`forRootAsync`.

### 8.1 The non-AWS checksum opt-out (the #1 provider-compat trap)

`@aws-sdk/client-s3` ≥ 3.729.0 defaults `requestChecksumCalculation` to `'WHEN_SUPPORTED'`, adding CRC32 `x-amz-checksum-*` integrity headers on every `PutObject` and `UploadPart`. R2, B2, MinIO, DigitalOcean Spaces, and Wasabi **reject** these headers.

The shared constant:

```typescript
const NON_AWS_CHECKSUM = {
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
} as const
```

is spread into every non-AWS recipe. If you add a new provider recipe for an S3-compatible (non-AWS) provider, you must include this opt-out.

### 8.2 Provider-specific notes

| Recipe | Key specifics |
|---|---|
| `awsS3` | Keeps SDK default checksums; sets `serverSideEncryption: 'AES256'` by default; `publicBaseUrl` is the virtual-hosted bucket URL |
| `cloudflareR2` | `region: 'auto'`; `publicBaseUrl` = `customDomain` (REQUIRED — the S3 API endpoint does not serve public reads); NON_AWS_CHECKSUM |
| `backblazeB2` | `forcePathStyle: false` (B2 supports both styles but virtual-hosted is preferred); NON_AWS_CHECKSUM |
| `digitalOceanSpaces` | Sets `cdnBaseUrl` to the `.cdn.digitaloceanspaces.com` host; `defaultPublicRead: true`; NON_AWS_CHECKSUM |
| `minio` | `forcePathStyle: true` (path-style is required for MinIO); `region` defaults to `'us-east-1'`; NON_AWS_CHECKSUM |
| `wasabi` | Virtual-hosted; NON_AWS_CHECKSUM |

---

## 9. Error Catalog

`StorageException extends HttpException`. All thrown errors carry:

```json
{ "error": { "code": "STORAGE_KEY_INVALID", "message": "...", "details": { ... } } }
```

`STORAGE_ERROR_CODES` (the constant object keyed by code name) is exported from `./shared`. `STORAGE_ERROR_MESSAGES` and `STORAGE_ERROR_STATUS` (the code → message and code → HttpStatus maps) are **internal** implementation details never exported.

The full 17-code catalog is in `README.md` → Error Codes and `docs/technical_specification.md` §12.

---

## 10. Source Structure

```
src/
├── server/
│   ├── bymax-storage.module.ts        # Dynamic module (forRoot / forRootAsync)
│   ├── bymax-storage.constants.ts     # Symbol DI tokens
│   ├── config/
│   │   ├── resolved-options.ts        # ResolvedStorageOptions type + applyDefaults
│   │   ├── validate-options.ts        # validateOptions() — throws STORAGE_INVALID_CONFIG
│   │   └── provider-recipes.ts        # providerRecipes (6 factories)
│   ├── constants/
│   │   ├── default-options.constants.ts
│   │   └── default-mime-whitelist.constants.ts
│   ├── errors/
│   │   ├── storage-exception.ts       # StorageException
│   │   ├── storage-error-messages.ts  # internal
│   │   └── storage-error-status.ts    # internal
│   ├── interfaces/                    # TypeScript interfaces (public types)
│   ├── providers/
│   │   ├── s3-client.provider.ts      # S3ClientProvider (lifecycle — internal)
│   │   ├── no-op-validator.ts         # NoOpUploadValidator (exported)
│   │   └── no-op-scanner.ts           # NoOpFileScanner (exported)
│   ├── services/
│   │   ├── key-resolver.service.ts    # path-traversal guard (internal)
│   │   ├── storage.service.ts         # StorageService (exported)
│   │   ├── signed-url.service.ts      # SignedUrlService (exported)
│   │   ├── validation.service.ts      # ValidationService (internal)
│   │   └── file-scanner.service.ts    # FileScannerService (internal)
│   └── utils/
│       ├── idempotency-cache.ts       # LRU cache
│       ├── mime-match.ts              # wildcard MIME matching
│       ├── ttl-clamp.ts               # TTL clamp + SigV4 ceiling
│       ├── stream-utils.ts            # tee / peekFirstBytes
│       ├── header-utils.ts            # Content-Type helpers
│       └── upload-strategy.ts         # single-shot vs multipart decision
└── shared/
    ├── index.ts                        # shared barrel
    └── constants/
        ├── error-codes.constants.ts    # STORAGE_ERROR_CODES
        ├── mime-types.constants.ts
        └── default-ttls.constants.ts
```

---

## 11. Testing Strategy

### 11.1 Unit tests

- Located alongside source files (`*.spec.ts`).
- All use Jest + ts-jest; S3Client is mocked via `jest.fn()` / `jest.spyOn()` — no real network calls.
- Coverage gate: **100% line/branch on every implemented file** (enforced by `jest.config.ts` global threshold).
- Every `it()` / `test()` block carries an English block comment explaining the scenario and the rule it protects.

### 11.2 E2E tests

- Located in `test/e2e/`.
- Spin a real MinIO instance via `@testcontainers/minio`; tests run against the real S3 API.
- One container per run; `jest.e2e.config.ts` sets `testTimeout: 60000`.
- Run with `pnpm test:e2e`; requires Docker.

### 11.3 Mutation testing

- Stryker with thresholds `high: 100 / low: 95 / break: 95`.
- Runs automatically post-merge on `main` via the shared reusable CI (`bymaxone/.github` → node-lib-ci), never per-PR; also runnable on demand with `pnpm mutation` (takes 10–20 min).
- Equivalent mutants are annotated inline with `// Stryker disable next-line <Mutator>: <reason>`.
- Results documented in `docs/mutation_testing_results.md`.
