# @bymax-one/nest-storage — Complete Technical Specification

> **Version:** 1.0.0
> **Last updated:** 2026-06-24
> **Status:** Draft for implementation
> **Type:** Public npm package (`@bymax-one/nest-storage`)

---

## Table of Contents

1. [Vision and Value Proposition](#1-vision-and-value-proposition)
2. [Architecture](#2-architecture)
3. [Package Structure](#3-package-structure)
4. [Configuration API](#4-configuration-api)
5. [Main Service (`StorageService`)](#5-main-service-storageservice)
6. [Upload (single, multipart, stream, idempotency)](#6-upload-single-multipart-stream-idempotency)
7. [Signed URLs (GET, PUT, multipart)](#7-signed-urls-get-put-multipart)
8. [Validation (MIME, size, `IUploadValidator`)](#8-validation-mime-size-iuploadvalidator)
9. [Virus Scan Hook (`IFileScanner`)](#9-virus-scan-hook-ifilescanner)
10. [Listing and Pagination](#10-listing-and-pagination)
11. [Lifecycle Management](#11-lifecycle-management)
12. [Error Code Catalog](#12-error-code-catalog)
13. [What is NOT in the package](#13-what-is-not-in-the-package)
14. [Dependencies (peer deps)](#14-dependencies-peer-deps)
15. [Implementation Phases](#15-implementation-phases)
16. [Known Limitations](#16-known-limitations)
17. [Example Integration](#17-example-integration)

---

## 1. Vision and Value Proposition

### 1.1 What it is

`@bymax-one/nest-storage` is a public npm package for NestJS that provides a unified, **provider-agnostic** abstraction layer over any object storage compatible with the S3 API, using `@aws-sdk/client-s3` as the single engine.

The same application code runs unchanged on **AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Linode Object Storage** (and any other S3-compatible provider: Scaleway, Storj, IDrive e2).

The starting point was an internal `SpacesService` (~222 LoC, extracted from a production NestJS application originally coupled to DigitalOcean Spaces). This extraction generalizes the configuration and broadens the scope (multipart, streams, signed URLs, validation, scanner) while keeping the API ergonomic.

### 1.2 Why it exists

Each provider has nuances in `forcePathStyle`, endpoint addressing, ACLs, integrity checksums, and CDN. Without a common lib, these specifics pollute application code. The lib:

- Eliminates duplication across services
- Standardizes content-type, content-disposition, cache headers, retries
- Mitigates vendor lock-in — switching providers only requires reconfiguration
- Standardizes security (signed URLs with TTL, MIME/size validation, scan hooks)
- Simplifies testing — local MinIO in CI/dev

### 1.3 Who uses it

NestJS applications in the Bymax ecosystem that store files; multi-tenant applications that need per-tenant isolation via key prefix; any NestJS project that wants to avoid lock-in between AWS S3, R2, B2, Spaces, MinIO.

### 1.4 Distribution

| Aspect        | Detail                                   |
| ------------- | ---------------------------------------- |
| Registry      | Public npm (`@bymax-one/nest-storage`)   |
| License       | MIT                                      |
| Runtime       | Node.js 24+                              |
| Framework     | NestJS 11+                               |
| Subpaths      | `.` (server), `./shared`                 |

### 1.5 Design Principles

1. **Provider-agnostic by design** — specific endpoints and quirks do not leak into the public API.
2. **Configuration over convention** — everything configurable via `forRoot()`/`forRootAsync()`.
3. **Dependency inversion** — defines interfaces (`IUploadValidator`, `IFileScanner`); the app plugs in implementations.
4. **Stream-first** — APIs accept `Buffer | Readable` for large files without blowing up memory.
5. **Security by default** — signed URLs with short TTL, opt-in validation, scan hook available.
6. **Zero opinion** on CDN, image transform, video transcoding (out-of-scope).
7. **Idiomatic NestJS** — dynamic module, `Symbol()` injection tokens, singletons.

### 1.6 Features

**Core (always active):** `StorageService` (upload, download, delete, list, head, copy, exists), `S3ClientProvider` (`S3Client` lifecycle), `SignedUrlService` (presigned GET/PUT/multipart), `KeyResolverService` (normalization and path traversal guard).

**Opt-in (enabled via config):** `ValidationService` (`validation: {}`) for MIME/size/custom validators; `FileScannerService` (`scanner: {}`) for virus scan via an injected `IFileScanner`.

> When an opt-in extension is not configured, its providers are not registered in the NestJS container — zero runtime overhead.

---

## 2. Architecture

### 2.1 NestJS dynamic module

`@bymax-one/nest-storage` is a dynamic module: it runs inside each application that imports it. The consuming app controls credentials, the default bucket, custom validators, and the scanner.

```
┌─────────────────────────────────────────────────┐
│         Host Application (NestJS)               │
│                                                 │
│   StorageService ──► S3ClientProvider           │
│       │                  │                      │
│       ▼                  ▼                      │
│   SignedUrlService   KeyResolverService         │
│       │                                         │
│       ▼                                         │
│   ValidationService ── IUploadValidator[]       │
│       │                                         │
│       ▼                                         │
│   FileScannerService ── IFileScanner            │
│                                                 │
│       ┌──────────────────────────────┐          │
│       │  S3 / R2 / B2 / DO / MinIO   │          │
│       │  Wasabi / Linode / Storj     │          │
│       └──────────────────────────────┘          │
└─────────────────────────────────────────────────┘
```

### 2.2 `S3Client` lifecycle

The `S3Client` is a heavy object — it keeps an HTTP agent with keep-alive. Reusing the same client is critical for performance.

- **`onModuleInit()`** — resolves options, validates config, instantiates a single `S3Client` (singleton)
- **Every call** — reuses the same client
- **`onApplicationShutdown()`** — `s3Client.destroy()` releases TCP connections
- **Missing credentials** — logs a warning, the module still registers; operations fail with `STORAGE_NOT_CONFIGURED` (HTTP 503)

> When credentials are not present, the module **does not throw on initialization** (decision inherited from the original `SpacesService`). This allows dev environments to run without storage configured.

### 2.3 Upload flow

```
Controller (host app) → storageService.upload({ key, body, contentType })
   │
   ├─► KeyResolverService.normalize(key)         (path traversal guard, keyPrefix)
   ├─► ValidationService.validate(...)           (MIME, size, custom validators)
   ├─► FileScannerService.scan(body)             (if mode='pre-upload')
   ├─► S3Client.send(PutObject) or Upload (multipart)
   ├─► FileScannerService.scan(...)              (if mode='post-upload')
   └─► StorageService.getPublicUrl(key)          (populates UploadResult.publicUrl via CDN or endpoint)
```

### 2.4 Why `@aws-sdk/client-s3` as the single engine

Three options were evaluated: (A) a separate SDK per provider — multiplies peer deps and fragments the API; (B) **AWS SDK v3 as a single engine (chosen)** — all providers are S3-compatible, 1 peer dep, exclusive features (R2 cache rules) stay out but accessible via the raw token; (C) implement HTTP S3 from scratch — reinventing pagination, multipart, retry, presigning is high risk.

`@aws-sdk/client-s3 ^3.700.0` is the de facto standard, maintained by AWS, with modular tree-shaking. Provider-specific features (R2 bindings, S3 Object Lambda) stay out — the app can access them via the `BYMAX_STORAGE_S3_CLIENT` token (section 11.2).

---

## 3. Package Structure

### 3.1 Directory tree

```
@bymax-one/nest-storage/
├── package.json, tsconfig.*.json, tsup.config.ts
├── src/
│   ├── server/                              # NestJS backend
│   │   ├── index.ts
│   │   ├── bymax-storage.module.ts          # Root dynamic module
│   │   ├── bymax-storage.constants.ts       # Injection tokens (Symbol)
│   │   ├── interfaces/                      # storage-module-options, upload-options,
│   │   │                                    # download-options, list-options,
│   │   │                                    # signed-url-options, upload-validator,
│   │   │                                    # file-scanner, upload-result,
│   │   │                                    # object-metadata, provider-recipe
│   │   ├── config/                          # default-options, resolved-options,
│   │   │                                    # provider-recipes (AWS, DO, R2, B2, MinIO…)
│   │   ├── services/                        # storage, signed-url, key-resolver,
│   │   │                                    # validation, file-scanner
│   │   ├── providers/                       # s3-client, no-op-validator, no-op-scanner
│   │   ├── constants/                       # default-mime-whitelist, error-codes
│   │   ├── errors/                          # storage-error-codes, storage-exception
│   │   └── utils/                           # content-disposition, stream-utils
│   └── shared/                              # zero deps
│       ├── index.ts
│       ├── types/                           # storage-types, signed-url-types, error-types
│       └── constants/                       # error-codes, mime-types, default-ttls
├── test/                                    # e2e (Testcontainers + MinIO)
├── scripts/check-size.mjs
└── docs/
```

### 3.2 Subpath exports

```json
{
  "exports": {
    ".": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.mjs",
      "require": "./dist/server/index.cjs"
    },
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "import": "./dist/shared/index.mjs",
      "require": "./dist/shared/index.cjs"
    }
  }
}
```

| Subpath        | Description                                          | Dependencies        |
| -------------- | ---------------------------------------------------- | ------------------- |
| `.` (server)   | Dynamic module, services, interfaces                 | NestJS, @aws-sdk/*  |
| `./shared`     | Types, constants, error codes                        | Zero                |

### 3.3 Public exports

**Server (`@bymax-one/nest-storage`):**

- Module: `BymaxStorageModule`
- Tokens: `BYMAX_STORAGE_OPTIONS`, `BYMAX_STORAGE_S3_CLIENT`, `BYMAX_STORAGE_UPLOAD_VALIDATORS`, `BYMAX_STORAGE_FILE_SCANNER`, `BYMAX_STORAGE_LOGGER`
- Types: `BymaxStorageModuleOptions`, `UploadOptions`, `UploadResult`, `DownloadOptions`, `ListOptions`, `ListResult`, `SignedGetUrlOptions`, `SignedPutUrlOptions`, `SignedUrlResult`, `ObjectMetadata`, `StorageErrorResponse`, `IUploadValidator`, `IFileScanner`, `FileScanResult`, `ProviderRecipe`
- Public services: `StorageService`, `SignedUrlService`
- Errors: `StorageException`, `STORAGE_ERROR_CODES`
- Helpers: `providerRecipes`, `NoOpUploadValidator`, `NoOpFileScanner`

**Shared (`@bymax-one/nest-storage/shared`):**

- Types: `UploadResult`, `ObjectMetadata`, `StorageErrorResponse`, `SignedUrlResult`
- Constants: `STORAGE_ERROR_CODES`, `DEFAULT_IMAGE_MIME_WHITELIST`, `DEFAULT_VIDEO_MIME_WHITELIST`, `DEFAULT_DOC_MIME_WHITELIST`, `DEFAULT_SIGNED_URL_TTL_SECONDS`, `DEFAULT_MULTIPART_THRESHOLD_BYTES`

> **Public vs internal:** only `StorageService` and `SignedUrlService` are exported for direct use. `KeyResolverService`, `ValidationService`, and `FileScannerService` are implementation details.

> **Shared re-exports:** the server entry (`.`) re-exports every `./shared` type (`UploadResult`, `ObjectMetadata`, `SignedUrlResult`, `StorageErrorResponse`), so server consumers import them from `@bymax-one/nest-storage` directly; `./shared` exists for frontends/workers that need only the zero-dependency types and constants.

---

## 4. Configuration API

### 4.1 `BymaxStorageModuleOptions` interface

```typescript
export interface BymaxStorageModuleOptions {
  /** S3-compatible endpoint. See "Provider Recipes" below. REQUIRED. */
  endpoint: string
  /** Region. For R2 use 'auto'. For MinIO any string. REQUIRED. */
  region: string
  /** Default bucket. Can be overridden per call. REQUIRED. */
  bucket: string
  /** Credentials. Inject via ConfigService — never hardcode. REQUIRED. */
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    /** STS / OIDC temporary. */
    sessionToken?: string
  }
  /** false = virtual-hosted (AWS, DO, R2, Wasabi). true = path-style (MinIO). Default: false. */
  forcePathStyle?: boolean
  /** Public base URL for direct links. Fallback: endpoint + bucket. */
  publicBaseUrl?: string
  /** When defined, getPublicUrl() returns via CDN. */
  cdnBaseUrl?: string
  /**
   * Apply ACL `public-read` on uploads. Default: false. NOTE: modern AWS S3 buckets
   * disable ACLs (Object Ownership = "Bucket owner enforced", the default for new
   * buckets since April 2023), so sending an ACL on PutObject returns HTTP 400
   * `AccessControlListNotSupported`; Cloudflare R2 ignores ACLs entirely. For public
   * access prefer a bucket policy, a CDN, or signed URLs — see §16.1 / §16.2.
   */
  defaultPublicRead?: boolean
  /** Global prefix applied to all keys. Useful for multi-tenant. */
  keyPrefix?: string
  /** Default: 'public, max-age=31536000, immutable'. */
  defaultCacheControl?: string
  /** Default: 'inline'. */
  defaultContentDisposition?: 'inline' | 'attachment'

  signedUrls?: {
    /** Seconds. Default: 300. */
    defaultGetTtlSeconds?: number
    /** Seconds. Default: 300. */
    defaultPutTtlSeconds?: number
    /** Per-request `ttlSeconds` above this is silently clamped (never an error). This value is itself clamped to the SigV4 hard cap of 604800s (7 days) at init. Default: 604800. */
    maxTtlSeconds?: number
  }

  multipart?: {
    /** Threshold in bytes for multipart. Default: 5_242_880 (5 MB). */
    thresholdBytes?: number
    /** Size of each part. S3 minimum: 5 MB. Default: 5 MB. */
    partSizeBytes?: number
    /** Concurrent parts. Default: 4. */
    queueSize?: number
  }

  /** Enables ValidationService when present. */
  validation?: {
    /** MIME whitelist (supports wildcards: 'image/*'). */
    mimeWhitelist?: string[]
    /** Maximum size in bytes. */
    maxSizeBytes?: number
    /** Run in order; the first to reject interrupts. */
    customValidators?: IUploadValidator[]
  }

  /** Enables FileScannerService when present. */
  scanner?: {
    /** ClamAV, AWS Macie, Cloudmersive, VirusTotal, etc. */
    impl: IFileScanner
    /** 'pre-upload' (default) scans before; 'post-upload' after (removes if infected). */
    mode?: 'pre-upload' | 'post-upload'
    /** Reject when scanner returns 'unknown'. Default: false. */
    rejectOnUnknown?: boolean
  }

  /** 'AES256' (SSE-S3) or 'aws:kms' (requires kmsKeyId). */
  serverSideEncryption?: 'AES256' | 'aws:kms'
  kmsKeyId?: string
  /**
   * S3 data-integrity checksum behavior — maps to the AWS SDK v3 `S3Client`
   * `requestChecksumCalculation` option. AWS S3 accepts the SDK default
   * `'WHEN_SUPPORTED'` (CRC32 `x-amz-checksum-*` headers on every PutObject /
   * UploadPart, added by default in `@aws-sdk/client-s3` v3.729.0). Most
   * S3-compatible providers — Cloudflare R2, Backblaze B2, MinIO, DigitalOcean
   * Spaces — REJECT those headers, so they require `'WHEN_REQUIRED'`. The non-AWS
   * provider recipes (§4.3) set this to `'WHEN_REQUIRED'` automatically. See §16.1.
   * Default: `'WHEN_SUPPORTED'`.
   */
  requestChecksumCalculation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  /** Maps to `S3Client` `responseChecksumValidation` (checksum-mode on GET). Same provider caveat as `requestChecksumCalculation`. Default: `'WHEN_SUPPORTED'`. */
  responseChecksumValidation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  /** Total request attempts including the first try — maps to the AWS SDK v3 `maxAttempts` (NOT v2's `maxRetries`; attempts = retries + 1). Default: 3. */
  maxAttempts?: number
  /** Default: 30_000 ms. */
  requestTimeoutMs?: number
}
```

### 4.2 Summary of required options and defaults

**Required:** `endpoint`, `region`, `bucket`, `credentials.accessKeyId`, `credentials.secretAccessKey`.

**Main defaults** (all others are optional with sensible defaults — the JSDoc on the interface above covers each one):

| Category         | Defaults                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------- |
| URL/ACL          | `forcePathStyle: false`, `defaultPublicRead: false`                                         |
| Headers          | `defaultCacheControl: 'public, max-age=31536000, immutable'`, `defaultContentDisposition: 'inline'` |
| Signed URLs      | `defaultGetTtlSeconds: 300`, `defaultPutTtlSeconds: 300`, `maxTtlSeconds: 604800` (7 days)  |
| Multipart        | `thresholdBytes: 5_242_880` (5 MB), `partSizeBytes: 5_242_880`, `queueSize: 4`              |
| Scanner          | `mode: 'pre-upload'`, `rejectOnUnknown: false`                                              |
| Integrity        | `requestChecksumCalculation: 'WHEN_SUPPORTED'`, `responseChecksumValidation: 'WHEN_SUPPORTED'` (non-AWS recipes override to `'WHEN_REQUIRED'`) |
| Network          | `maxAttempts: 3` (AWS SDK v3), `requestTimeoutMs: 30_000`                                    |
| Optional         | `keyPrefix`, `publicBaseUrl`, `cdnBaseUrl`, `validation.*`, `scanner.*`, `serverSideEncryption`, `kmsKeyId` |

### 4.3 Provider Recipes

Each recipe is a function that takes provider-specific arguments and returns a `ProviderRecipe` — a ready-to-spread, fully-resolved options object for `forRoot()`:

```typescript
/** Output of a provider recipe: a complete options object ready to pass to forRoot(). */
export type ProviderRecipe = BymaxStorageModuleOptions
```

The lib exposes `providerRecipes` with named snippets:

```typescript
import { providerRecipes } from '@bymax-one/nest-storage'

const options = providerRecipes.cloudflareR2({
  accountId: process.env.CF_ACCOUNT_ID!,
  bucket: process.env.CF_BUCKET!,
  accessKeyId: process.env.CF_ACCESS_KEY_ID!,
  secretAccessKey: process.env.CF_SECRET_ACCESS_KEY!,
})
```

**AWS S3:**

```typescript
{
  endpoint: `https://s3.${region}.amazonaws.com`,                       // e.g. us-east-1
  region, bucket, credentials,
  forcePathStyle: false,
  publicBaseUrl: `https://${bucket}.s3.${region}.amazonaws.com`,
  serverSideEncryption: 'AES256',
}
```

**DigitalOcean Spaces:**

```typescript
{
  endpoint: `https://${region}.digitaloceanspaces.com`,                 // e.g. nyc3
  region, bucket, credentials,
  forcePathStyle: false,
  publicBaseUrl: `https://${bucket}.${region}.digitaloceanspaces.com`,
  cdnBaseUrl: `https://${bucket}.${region}.cdn.digitaloceanspaces.com`,
  defaultPublicRead: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',                          // Spaces rejects the SDK's default CRC32 integrity headers
  responseChecksumValidation: 'WHEN_REQUIRED',
}
```

**Cloudflare R2:** (R2 ignores ACLs — configure Custom Domain in the R2 dashboard)

```typescript
{
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  region: 'auto', bucket, credentials,
  forcePathStyle: false,
  // The *.r2.cloudflarestorage.com host is the S3 API endpoint and does NOT serve public
  // object reads — pass an r2.dev managed domain or a custom domain for getPublicUrl().
  publicBaseUrl: customDomain,                                          // REQUIRED for public reads (no working default)
  requestChecksumCalculation: 'WHEN_REQUIRED',                         // R2 rejects the SDK's default CRC32 integrity headers
  responseChecksumValidation: 'WHEN_REQUIRED',
}
```

**Backblaze B2:**

```typescript
{
  endpoint: `https://s3.${region}.backblazeb2.com`,                     // e.g. s3.us-west-002.backblazeb2.com
  region, bucket,
  credentials: { accessKeyId: applicationKeyId, secretAccessKey: applicationKey },
  forcePathStyle: false,                                                 // B2 supports both styles; virtual-hosted matches publicBaseUrl
  publicBaseUrl: `https://${bucket}.s3.${region}.backblazeb2.com`,
  requestChecksumCalculation: 'WHEN_REQUIRED',                          // B2 rejects the SDK's default CRC32 integrity headers
  responseChecksumValidation: 'WHEN_REQUIRED',
}
```

**MinIO (dev / CI / self-hosted):**

```typescript
{
  endpoint: 'http://localhost:9000',
  region: 'us-east-1', bucket, credentials,
  forcePathStyle: true,                                                  // MinIO recommends path-style
  publicBaseUrl: `http://localhost:9000/${bucket}`,
  requestChecksumCalculation: 'WHEN_REQUIRED',                          // older MinIO builds reject the SDK's default CRC32 integrity headers
  responseChecksumValidation: 'WHEN_REQUIRED',
}
```

**Wasabi:**

```typescript
{
  endpoint: `https://s3.${region}.wasabisys.com`,
  region, bucket, credentials,
  forcePathStyle: false,
  publicBaseUrl: `https://${bucket}.s3.${region}.wasabisys.com`,
  requestChecksumCalculation: 'WHEN_REQUIRED',                          // Wasabi rejects the SDK's default CRC32 integrity headers
  responseChecksumValidation: 'WHEN_REQUIRED',
}
```

### 4.4 `forRootAsync` example

```typescript
BymaxStorageModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    endpoint: config.getOrThrow('STORAGE_ENDPOINT'),
    region: config.getOrThrow('STORAGE_REGION'),
    bucket: config.getOrThrow('STORAGE_BUCKET'),
    credentials: {
      accessKeyId: config.getOrThrow('STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: config.getOrThrow('STORAGE_SECRET_ACCESS_KEY'),
    },
    forcePathStyle: config.get('STORAGE_FORCE_PATH_STYLE') === 'true',
    cdnBaseUrl: config.get('STORAGE_CDN_BASE_URL'),
    defaultPublicRead: true,
    validation: {
      mimeWhitelist: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      maxSizeBytes: 10 * 1024 * 1024,
    },
    signedUrls: { defaultGetTtlSeconds: 300, maxTtlSeconds: 3600 },
    serverSideEncryption: 'AES256',
  }),
})
```

### 4.5 Injection tokens

All defined via `Symbol()` in `bymax-storage.constants.ts`:

`BYMAX_STORAGE_OPTIONS` (resolved options), `BYMAX_STORAGE_S3_CLIENT` (singleton instance), `BYMAX_STORAGE_UPLOAD_VALIDATORS` (array of `IUploadValidator`), `BYMAX_STORAGE_FILE_SCANNER` (`IFileScanner` or no-op), `BYMAX_STORAGE_LOGGER` (NestJS logger).

---

## 5. Main Service (`StorageService`)

`StorageService` is the public facade. Every interaction with storage goes through it.

### 5.1 Signatures

```typescript
@Injectable()
export class StorageService {
  /** Upload. Decides between single-shot PutObject and multipart based on `multipart.thresholdBytes`. */
  upload(options: UploadOptions): Promise<UploadResult>

  /** Download stream. Caller MUST consume the stream. @throws STORAGE_OBJECT_NOT_FOUND. */
  download(options: DownloadOptions): Promise<{
    /** The v3 GetObject `Body` — a Node `Readable` carrying the sdk-stream-mixin (`transformToByteArray` / `transformToString` / `transformToWebStream`). */
    stream: Readable
    metadata: ObjectMetadata
  }>

  /** Buffer (files < 10 MB only). For large files use download() stream. */
  downloadBuffer(options: DownloadOptions): Promise<{ buffer: Buffer; metadata: ObjectMetadata }>

  /** Idempotent delete: does not throw if the object does not exist, just logs a warning. */
  delete(key: string, options?: { bucket?: string }): Promise<void>

  /** Batch delete (up to 1000 keys — S3 API limit). Returns failures individually. */
  deleteMany(keys: string[], options?: { bucket?: string }): Promise<{
    deleted: string[]
    failed: Array<{ key: string; error: string }>
  }>

  /** Paginated list via continuationToken. See §10. */
  list(options: ListOptions): Promise<ListResult>

  /** HEAD — metadata without downloading. @throws STORAGE_OBJECT_NOT_FOUND. */
  head(key: string, options?: { bucket?: string }): Promise<ObjectMetadata>

  /** False on 404; warning on non-404 errors. */
  exists(key: string, options?: { bucket?: string }): Promise<boolean>

  /** Server-side copy (same bucket or cross-bucket); does not transfer bytes through the client. @throws STORAGE_OBJECT_NOT_FOUND when the source key does not exist. */
  copy(options: {
    sourceKey: string
    destinationKey: string
    sourceBucket?: string
    destinationBucket?: string
    publicRead?: boolean
    cacheControl?: string
  }): Promise<{ etag: string }>

  /** Public URL (unsigned). Does NOT validate existence or ACL. */
  getPublicUrl(key: string, options?: { bucket?: string }): string
}
```

### 5.2 `UploadOptions`

```typescript
export interface UploadOptions {
  key: string
  /** Buffer (small/medium), Readable (large), or Uint8Array. */
  body: Buffer | NodeJS.ReadableStream | Uint8Array
  contentType: string
  bucket?: string
  /** Needed for validation and optimized multipart. */
  size?: number
  cacheControl?: string
  contentDisposition?: 'inline' | 'attachment' | string
  /** Default: defaultPublicRead from config. */
  publicRead?: boolean
  /** Per-upload SSE. `'NONE'` is a lib-only sentinel that OMITS the header (overriding any global default); it is never passed to the SDK literally. */
  serverSideEncryption?: 'AES256' | 'aws:kms' | 'NONE'
  kmsKeyId?: string
  /** x-amz-meta-* */
  metadata?: Record<string, string>
  /** If the key has been seen in the last 24h, returns cached result. Section 6.4. */
  idempotencyKey?: string
  /** Progress during multipart. */
  onProgress?: (event: { loaded: number; total?: number; part?: number }) => void
}

/** Parameters for `download()` / `downloadBuffer()`. */
export interface DownloadOptions {
  key: string
  bucket?: string
  /** Specific object version (versioned buckets). */
  versionId?: string
  /** Byte range, e.g. `'bytes=0-1023'` — maps to the GetObject `Range` header. */
  range?: string
}
```

> `Readable` is imported from `node:stream`; `DownloadOptions` is exported from the server entry (§3.3).

### 5.3 `UploadResult` and `ObjectMetadata`

```typescript
export interface UploadResult {
  /** Final key after normalization and global keyPrefix. */
  key: string
  bucket: string
  etag: string
  /** Only in buckets with versioning. */
  versionId?: string
  size?: number
  contentType: string
  publicUrl: string
  multipart: boolean
  /** True when deduplicated by idempotencyKey. */
  fromIdempotencyCache: boolean
}

export interface ObjectMetadata {
  key: string
  bucket: string
  size: number
  contentType: string
  etag: string
  lastModified: Date
  cacheControl?: string
  contentDisposition?: string
  /** x-amz-meta-* */
  metadata: Record<string, string>
  /** STANDARD, GLACIER, etc. */
  storageClass?: string
  versionId?: string
}
```

---

## 6. Upload (single, multipart, stream, idempotency)

### 6.1 Single-shot vs multipart decision

`StorageService.upload()` decides automatically:

- **Single-shot `PutObject`** when `size < multipart.thresholdBytes`, or `body` is a small Buffer.
- **Multipart via `@aws-sdk/lib-storage`** (`Upload` class) when `size >= thresholdBytes`, or `body` is a Readable without a known `size`, or the body exceeds `partSizeBytes` in chunks.

> **Why `@aws-sdk/lib-storage`:** it encapsulates `CreateMultipartUpload` + parallelized `UploadPart` + `CompleteMultipartUpload`, and with `leavePartsOnError: false` (the default) it AUTO-aborts the multipart upload on failure — no need to orchestrate `AbortMultipartUpload` manually. A manual abort applies only to the raw presigned-multipart path (§7.1), where the consumer orchestrates the part commands itself.

### 6.2 Stream uploads

```typescript
import { createReadStream } from 'node:fs'

await storageService.upload({
  key: 'large/video.mp4',
  body: createReadStream('/tmp/video.mp4'),
  contentType: 'video/mp4',
  size: 250 * 1024 * 1024,                  // optional, enables optimized multipart
  onProgress: (e) => console.log(`Loaded: ${e.loaded}`),
})
```

When `size` is unknown (transformation stream), the package uses multipart with part size = `multipart.partSizeBytes`.

### 6.3 Progress events

`onProgress` is called after each `UploadPart` in multipart and once at the end for single-shot uploads, with `{ loaded, total?, part? }` — `total` is `size` when known.

### 6.4 Idempotency

When the caller provides `idempotencyKey`, the lib computes `sha256(idempotencyKey + ':' + finalKey)`, then looks up an in-memory LRU cache (default 1000 entries, TTL 24h). Cache hit: returns the previous `UploadResult` with `fromIdempotencyCache: true`. Cache miss: runs the upload and stores the result.

> **Trade-off:** in-memory cache per instance. In multi-replica, two pods can accept the same key simultaneously. Cross-instance: future `IIdempotencyStore` (v0.2).

### 6.5 Automatic headers

- `ContentType` — `options.contentType`
- `CacheControl` — `options.cacheControl` or `defaultCacheControl`
- `ContentDisposition` — `options.contentDisposition` or `defaultContentDisposition`
- `ACL` — `'public-read'` if `publicRead` (or default), otherwise omitted
- `ServerSideEncryption` — `options.serverSideEncryption` or global config
- `SSEKMSKeyId` — `options.kmsKeyId` or global config (only with `aws:kms`)
- `Metadata` — `options.metadata` (x-amz-meta-*)

---

## 7. Signed URLs (GET, PUT, multipart)

### 7.1 `SignedUrlService`

```typescript
@Injectable()
export class SignedUrlService {
  /** GET URL: client downloads without credentials until the TTL expires. */
  getDownloadUrl(options: SignedGetUrlOptions): Promise<SignedUrlResult>

  /**
   * PUT URL: client uploads directly without going through the backend.
   * Local MIME/size validation does NOT apply — use `maxSizeBytes` (presigner policy)
   * and validate after upload via head() + scanner.
   */
  getUploadUrl(options: SignedPutUrlOptions): Promise<SignedUrlResult>

  /** Multipart via signed URLs. Returns uploadId + per-part URLs + complete URL. */
  getMultipartUploadUrls(options: {
    key: string
    bucket?: string
    contentType: string
    parts: number
    ttlSeconds?: number
  }): Promise<{
    uploadId: string
    partUrls: Array<{ partNumber: number; url: string }>
    completeUrl: string
  }>
}
```

### 7.2 Types

```typescript
export interface SignedGetUrlOptions {
  key: string
  bucket?: string
  /** Clamped at maxTtlSeconds. */
  ttlSeconds?: number
  /** e.g. 'attachment; filename="invoice.pdf"'. */
  responseContentDisposition?: string
  responseContentType?: string
}

export interface SignedPutUrlOptions {
  key: string
  bucket?: string
  /** Content-Type the client MUST send (part of the signature). */
  contentType: string
  ttlSeconds?: number
  /** Includes Content-Length-Range policy — S3 rejects larger PUTs. */
  maxSizeBytes?: number
  publicRead?: boolean
  metadata?: Record<string, string>
}

export interface SignedUrlResult {
  url: string
  expiresAt: Date
  method: 'GET' | 'PUT'
  /** Headers required to match the signature. */
  requiredHeaders: Record<string, string>
}
```

### 7.3 Security

- Use the smallest viable TTL (5 min default covers most cases).
- A per-request `ttlSeconds` above `maxTtlSeconds` is **silently clamped** (never an error) — callers cannot exceed it. Only `ttlSeconds ≤ 0` throws `STORAGE_SIGNED_URL_TTL_INVALID`. The configured `maxTtlSeconds` is itself clamped to the SigV4 hard cap of 604800s (7 days) at init, so an over-cap config can never widen the window.
- Force `responseContentType: 'text/plain'` for suspicious files to avoid accidental execution.
- **Never log a signed URL** — it is a temporary credential.
- **Never cache signed URLs across users** — each user must receive their own.

---

## 8. Validation (MIME, size, `IUploadValidator`)

### 8.1 Pipeline

```
1. KeyResolverService    — normalizes, validates path traversal, applies keyPrefix
2. checkMime             — compares against mimeWhitelist
3. checkSize             — compares against maxSizeBytes
4. runCustomValidators   — runs IUploadValidator[] in order
5. FileScannerService    — if mode='pre-upload'
6. S3Client.send(...)    — PutObject or Upload (multipart)
7. FileScannerService    — if mode='post-upload'
```

### 8.2 MIME whitelist (supports wildcards)

```typescript
validation: {
  mimeWhitelist: ['image/jpeg', 'image/png', 'image/*', 'application/pdf'],
}
```

Case-insensitive comparison, supports `*` in the subtype.

### 8.3 Size limit

```typescript
validation: { maxSizeBytes: 10 * 1024 * 1024 }
```

When `body` is a stream without a `size`, validates what it knows. For large streams, the multipart `Upload` aborts on the first out-of-limit part (cost: parts already sent must be paid for).

### 8.4 `IUploadValidator`

```typescript
export interface IUploadValidator {
  readonly name: string
  validate(context: {
    key: string
    contentType: string
    size?: number
    metadata?: Record<string, string>
    /** Reads up to maxBytes from the body — useful for magic-byte sniffing without loading everything. */
    readBytes?: (maxBytes: number) => Promise<Buffer>
  }): Promise<{ ok: true } | { ok: false; reason: string }>
}
```

**Example — magic-byte check for PDF:**

```typescript
class PdfMagicByteValidator implements IUploadValidator {
  readonly name = 'pdf-magic-byte'
  async validate(ctx) {
    if (ctx.contentType !== 'application/pdf' || !ctx.readBytes) return { ok: true }
    const head = await ctx.readBytes(4)
    return head.toString('ascii') === '%PDF'
      ? { ok: true }
      : { ok: false, reason: 'Declared as PDF but missing magic bytes' }
  }
}
```

> **`NoOpUploadValidator`** (exported helper) — an `IUploadValidator` whose `validate()` always returns `{ ok: true }`. It is the default registered for `BYMAX_STORAGE_UPLOAD_VALIDATORS` when no `validation.customValidators` are configured.

---

## 9. Virus Scan Hook (`IFileScanner`)

### 9.1 Interface

```typescript
export interface IFileScanner {
  scan(input: {
    /** 'pre-upload' receives bytes; 'post-upload' receives only key/bucket. */
    mode: 'pre-upload' | 'post-upload'
    body?: Buffer | NodeJS.ReadableStream
    key: string
    bucket: string
    contentType: string
    size?: number
  }): Promise<FileScanResult>
}

export interface FileScanResult {
  status: 'clean' | 'infected' | 'unknown'
  /** e.g. 'clamav', 'aws-macie' */
  engine: string
  /** Threat name when infected. */
  threat?: string
  details?: Record<string, unknown>
}
```

### 9.2 Modes

- **`'pre-upload'`** — fast local scanner (ClamAV via socket). Infected files never reach the bucket. Adds upload latency.
- **`'post-upload'`** — remote scanner (AWS Macie, S3 EventBridge). Fast upload; async removal if infected. Short exposure window.

### 9.3 Behavior

- **`'clean'`** — proceeds
- **`'infected'`** — rejects (pre) or removes (post). Throws `STORAGE_SCAN_INFECTED` with `threat` in `details`
- **`'unknown'`** — `rejectOnUnknown: false` (default) passes with a warning; `true` rejects with `STORAGE_SCAN_INCONCLUSIVE`

> Out-of-scope: the package does not provide a concrete implementation. The app injects one. Common adapters: `clamav.js`, AWS Macie SDK, Cloudmersive, VirusTotal, MetaDefender.

> **`NoOpFileScanner`** (exported helper) — an `IFileScanner` whose `scan()` always returns `{ status: 'clean', engine: 'noop' }`. It is the default bound to `BYMAX_STORAGE_FILE_SCANNER` when no `scanner` is configured, so the scan step is a zero-cost pass-through.

---

## 10. Listing and Pagination

### 10.1 `ListOptions` and `ListResult`

```typescript
export interface ListOptions {
  /** Filter prefix (after global keyPrefix). */
  prefix?: string
  bucket?: string
  /** Maximum per page. Default: 1000 (S3 API limit). */
  maxKeys?: number
  /** Token returned by the previous page. */
  continuationToken?: string
  /**
   * Delimiter for pseudo-hierarchical listing. When '/', objects under subprefixes
   * appear aggregated in `commonPrefixes`.
   */
  delimiter?: string
}

export interface ListResult {
  objects: Array<{
    key: string
    size: number
    etag: string
    lastModified: Date
    storageClass?: string
  }>
  commonPrefixes: string[]
  isTruncated: boolean
  nextContinuationToken?: string
}
```

### 10.2 Iterator helper (future)

In v0.2, `listAll(prefix, options)` is planned to return `AsyncIterable<ObjectInfo>` — a common convention in modern SDKs for `for await`.

---

## 11. Lifecycle Management

### 11.1 Scope decision

Lifecycle policies (`PutBucketLifecycleConfiguration`) control transitions between storage classes (STANDARD → GLACIER) and automatic expiration.

**Decision: out of scope for the v0.1 public API.** Reasons: (1) configuration is at the **bucket** level, not the object — it does not match the `StorageService` granularity; (2) each provider has its own dialect despite the common API; (3) it is a typical **IaC** operation (Terraform, CDK, CloudFormation) — already well covered; (4) risk of side effects (an accidental call could delete petabytes).

### 11.2 Access to the raw `S3Client`

For advanced cases (lifecycle, replication, inventory, bucket notification), the lib exposes the `S3Client` via a token:

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { S3Client, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3'
import { BYMAX_STORAGE_S3_CLIENT } from '@bymax-one/nest-storage'

@Injectable()
export class AdvancedStorageOps {
  constructor(@Inject(BYMAX_STORAGE_S3_CLIENT) private readonly s3: S3Client) {}

  async setLifecyclePolicy(bucket: string) {
    await this.s3.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { /* ... */ },
    }))
  }
}
```

> **Trade-off:** the app loses provider-agnostic abstraction when calling AWS SDK commands directly. R2 and B2 may not support every command.

---

## 12. Error Code Catalog

### 12.1 `StorageException` class

```typescript
import { HttpException, HttpStatus } from '@nestjs/common'

/** JSON body carried by every `StorageException` — also the `./shared` `StorageErrorResponse` type. */
export interface StorageErrorResponse {
  error: {
    code: keyof typeof STORAGE_ERROR_CODES
    message: string
    details?: Record<string, unknown>
  }
}

export class StorageException extends HttpException {
  constructor(
    code: keyof typeof STORAGE_ERROR_CODES,
    /** Defaults to `STORAGE_ERROR_STATUS[code]` (the §12.2 HTTP column). Pass only to override. */
    statusCode: HttpStatus = STORAGE_ERROR_STATUS[code],
    details?: Record<string, unknown>,
  ) {
    const body: StorageErrorResponse = { error: { code, message: STORAGE_ERROR_MESSAGES[code], details } }
    super(body, statusCode)
  }
}
```

> `STORAGE_ERROR_MESSAGES` (code→message) and `STORAGE_ERROR_STATUS` (code→`HttpStatus`) are **internal** maps generated from the §12.2 table, each typed `Record<keyof typeof STORAGE_ERROR_CODES, …>` so the compiler enforces exhaustiveness. Only `STORAGE_ERROR_CODES` and `StorageException` are part of the public surface (§3.3); the message/status maps are implementation details.

### 12.2 Code table

| Code                              | HTTP | When it occurs                                                                             |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `STORAGE_NOT_CONFIGURED`          | 503  | Credentials missing and an operation was called                                            |
| `STORAGE_KEY_INVALID`             | 400  | Path traversal (`..`), key starts with `/`, or empty after normalization                   |
| `STORAGE_BODY_MISSING`            | 400  | `upload()` without body                                                                    |
| `STORAGE_CONTENT_TYPE_REQUIRED`   | 400  | `upload()` without `contentType`                                                           |
| `STORAGE_MIME_NOT_ALLOWED`        | 415  | `contentType` outside `mimeWhitelist`                                                      |
| `STORAGE_SIZE_EXCEEDED`           | 413  | `size > maxSizeBytes`                                                                      |
| `STORAGE_VALIDATION_FAILED`       | 400  | `IUploadValidator` rejected (`details.reason`)                                             |
| `STORAGE_SCAN_INFECTED`           | 422  | Scanner returned `'infected'` (`details.threat`)                                           |
| `STORAGE_SCAN_INCONCLUSIVE`       | 422  | Scanner returned `'unknown'` and `rejectOnUnknown: true`                                   |
| `STORAGE_OBJECT_NOT_FOUND`        | 404  | `head()`, `download()`, or `copy()` on a nonexistent key                                   |
| `STORAGE_PROVIDER_ERROR`          | 502  | AWS SDK error (network, 5xx, throttling); `details.awsCode`, `httpStatus`, `requestId`     |
| `STORAGE_SIGNED_URL_TTL_INVALID`  | 400  | Per-request `ttlSeconds` ≤ 0. (A `ttlSeconds` above `maxTtlSeconds` is silently clamped, not rejected; the configured `maxTtlSeconds` is itself clamped to the 604800s SigV4 cap at init.) |
| `STORAGE_PART_TOO_SMALL`          | 400  | Multipart with part < 5 MB (S3 limit)                                                      |
| `STORAGE_BUCKET_UNDEFINED`        | 400  | Operation without a bucket and no default bucket in the config                                 |
| `STORAGE_MULTIPART_ABORTED`       | 500  | Multipart upload failed and was aborted. With `@aws-sdk/lib-storage` (`leavePartsOnError: false`) the abort is automatic; on the raw presigned-multipart path the lib issues `AbortMultipartUpload` to avoid orphan parts being billed |
| `STORAGE_INVALID_CONFIG`          | 500  | `BymaxStorageModuleOptions` validation failed at initialization                            |
| `STORAGE_TIMEOUT`                 | 504  | Request exceeded `requestTimeoutMs`                                                        |

### 12.3 AWS SDK → `StorageException` mapping

- `NotFound` / 404 → `STORAGE_OBJECT_NOT_FOUND`
- `NoSuchBucket`, `AccessDenied` (403) → `STORAGE_PROVIDER_ERROR`
- `AccessControlListNotSupported` (400) → `STORAGE_PROVIDER_ERROR` (bucket has ACLs disabled — see §16.1; surface a clear hint that `publicRead` requires a bucket policy / CDN / signed URL)
- `SlowDown` (503) → `STORAGE_PROVIDER_ERROR` + retry
- `TimeoutError` → `STORAGE_TIMEOUT`
- Other 5xx → `STORAGE_PROVIDER_ERROR`

---

## 13. What is NOT in the package

Deliberate scope decisions. Each item belongs to another lib, IaC, or the consumer app:

- **CDN configuration** (CloudFront, Cloudflare, Bunny.net) — proprietary APIs. Use Terraform or the CDN SDK.
- **Image transformation** (Sharp, resize, watermark) — dedicated lib.
- **Video transcoding** (FFmpeg, MediaConvert, Mux) — separate queue jobs.
- **PDF processing** (OCR, signing, extraction) — dedicated lib.
- **Backup / snapshot orchestration** — IaC domain.
- **Cross-bucket replication** — cross-region replication is bucket configuration; use IaC.
- **Direct browser upload UI** — frontend, not NestJS.
- **Metadata database** — the lib does not persist to a DB. Persistence lives in app tables (e.g. `Asset` with `storageKey` as FK).
- **Audit log in DB** — the lib logs via the NestJS Logger but does not persist. Consume the logs via `@bymax-one/nest-logger`.
- **Per-user/tenant quotas** — domain logic, app layer.
- **Automatic compression** — the app should compress before uploading if needed.
- **Local ↔ remote sync** — use `aws s3 sync` or `rclone`.
- **WebDAV / SMB / NFS bridges** — other protocols, out of scope.

---

## 14. Dependencies (peer deps)

### 14.1 Strategy

Following `@bymax-one/nest-auth`: the target is `"dependencies": {}` in `package.json`. Everything is `peerDependencies` — the consumer app controls the version.

### 14.2 Peer dependencies

```json
{
  "peerDependencies": {
    "@nestjs/common": "^11.0.16",
    "@nestjs/core": "^11.1.18",
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/lib-storage": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "reflect-metadata": "^0.2.0"
  },
  "peerDependenciesMeta": {
    "@nestjs/common": { "optional": false },
    "@nestjs/core": { "optional": false },
    "@aws-sdk/client-s3": { "optional": false },
    "@aws-sdk/lib-storage": { "optional": false },
    "@aws-sdk/s3-request-presigner": { "optional": false },
    "reflect-metadata": { "optional": false }
  }
}
```

### 14.3 Rationale

- `@nestjs/common` + `@nestjs/core` — framework, the app always defines the version.
- `@aws-sdk/client-s3` — single S3-compatible engine. From v3.729.0 it enables default integrity checksums that several S3-compatible providers reject; the lib exposes `requestChecksumCalculation`/`responseChecksumValidation` to opt out (see §16.1).
- `@aws-sdk/lib-storage` — multipart upload (`Upload` class), separated for tree-shaking.
- `@aws-sdk/s3-request-presigner` — signed URL generation, isolated package.
- `reflect-metadata` — NestJS decorators.

### 14.4 Dev dependencies

`jest`, `tsup`, `typescript`, `@nestjs/testing`, `@testcontainers/minio` (e2e), `@stryker-mutator/core` (mutation testing), `eslint`, `prettier`.

---

## 15. Implementation Phases

> **Testing strategy:** TDD per phase. Each phase delivers services + unit tests with **100% line/branch coverage on every file implemented in the phase** (Bymax lib floor); the published artifact is additionally gated at 100% global by `jest.coverage.config.ts` (run via `prepublishOnly`). Phase 5 adds e2e against real MinIO (Testcontainers) and mutation testing (Stryker, break 95).

### 15.1 Overview

> The **authoritative** phase sequencing, sub-step granularity, and per-phase task files live in [`docs/development_plan.md`](development_plan.md) (the status dashboard) and [`docs/tasks/`](tasks/) (one file per phase). This section mirrors that same 5-phase breakdown.

| Phase | Effort | Focus | Main deliverables |
| ----- | ------ | ----- | ----------------- |
| 1 | MEDIUM | Foundation + S3 Client + Config | Scaffold **+ the four CI workflows**, shared types/constants, interfaces, `Symbol` DI tokens, options merge/validation, `S3ClientProvider` lifecycle, `KeyResolverService` (path-traversal guard), error catalog + `StorageException`, synchronous `forRoot()` |
| 2 | HIGH | Upload (single + multipart + stream + idempotency) + Download | `IdempotencyCache` (LRU), stream/header/upload-strategy utils, `StorageService` single-shot `upload` + multipart via `@aws-sdk/lib-storage`, `download` (stream + buffer), `head`, `exists`, idempotent `delete`, progress events |
| 3 | MEDIUM | Signed URLs + Validation + Scanner | `SignedUrlService` (GET/PUT/multipart, TTL clamp, max-size policy), `ValidationService` (MIME wildcard + size + `IUploadValidator`), `FileScannerService` (`IFileScanner`, pre/post-upload), pipeline integration |
| 4 | HIGH | Listing + forRootAsync + E2E + Mutation | `list()` + pagination, `copy()`, `deleteMany()` (chunked ≤ 1000), Provider Recipes, `forRootAsync()`, e2e (Testcontainers + MinIO), mutation baseline |
| 5 | LOW | Release v0.1.0 | README/CHANGELOG/SECURITY/CLAUDE/AGENTS, bundle-size budgets, final mutation run, tag + `npm publish --provenance` |

> **CI is front-loaded:** the `ci`/`codeql`/`scorecard`/`release` workflows are created in Phase 1 (incremental-safe, green from the first PR), not at release; Phase 5 only fires the tag/publish trigger.

> **Executed by AI agents** — no estimates in human days/weeks. Relative complexity per phase is in the table above and the Complexity Matrix (plan Appendix B).

### 15.2 Phase 1 — Foundation + S3 Client + Config

**Goal:** a building, CI-gated scaffold with the public contracts and a live `S3Client`.

Deliverables: scaffold (`package.json`, `tsconfig.*`, `tsup.config.ts`, eslint/jest/stryker configs, structure from §3.1, barrel exports) **and the four CI workflows** (`ci`/`codeql`/`scorecard`/`release`, incremental-safe); shared types + constants (`src/shared`); server interfaces (`storage-module-options`, `upload-options`, `download-options`, `list-options`, `signed-url-options`, `upload-validator`, `file-scanner`, `upload-result`, `object-metadata`, `provider-recipe`); configuration (`bymax-storage.constants.ts` with `Symbol` tokens, `default-options.ts`, `resolved-options.ts` merge + validation); `S3ClientProvider` (`onModuleInit` / `onApplicationShutdown` lifecycle, `s3Client.destroy()`); `KeyResolverService` (normalization, path-traversal blocking, `keyPrefix`); error catalog (`storage-error-codes`, `storage-error-messages`, `storage-error-status`, `StorageException`, AWS SDK → `StorageException` mapping); synchronous `BymaxStorageModule.forRoot()`.

### 15.3 Phase 2 — Upload (single, multipart, stream) + Download

**Goal:** the full object read/write path.

Deliverables: `IdempotencyCache` (in-memory LRU + TTL; default 1000 entries / 24h); `stream-utils`, `header-utils`, `upload-strategy` (single-shot vs multipart decision); `StorageService` single-shot `upload` (PutObject) and multipart `upload` via `@aws-sdk/lib-storage` `Upload` (`partSize`, `queueSize`, `leavePartsOnError: false` → automatic abort on failure), stream uploads (`Buffer | Readable | Uint8Array`; forces multipart when `size` is unknown), `onProgress` events, `download` (stream + buffer), `head`, `exists`, idempotent `delete`, `getPublicUrl`; module registration.

### 15.4 Phase 3 — Signed URLs + Validation + Scanner

**Goal:** presigned URLs and the pluggable pre-upload pipeline.

Deliverables: `ttl-clamp` (clamp at `signedUrls.maxTtlSeconds`, reject TTL ≤ 0 → `STORAGE_SIGNED_URL_TTL_INVALID`); `SignedUrlService` `getDownloadUrl()`/`getUploadUrl()` (Content-Length-Range policy)/`getMultipartUploadUrls()` via `@aws-sdk/s3-request-presigner`, `SignedUrlResult` with `expiresAt` + `requiredHeaders`; `mime-match` (wildcards); `ValidationService` (`checkMime`/`checkSize`/`runCustomValidators`, `readBytes` helper), `NoOpUploadValidator`, default whitelists; `FileScannerService` (`IFileScanner`, `pre-upload`/`post-upload`, `rejectOnUnknown`, post-upload removal), `NoOpFileScanner`; integration into `StorageService.upload()` (pipeline §8.1).

### 15.5 Phase 4 — Listing + forRootAsync + E2E + Mutation

**Goal:** listing, async config, and real-provider verification.

Deliverables: `list()` (pagination via `ContinuationToken`/`commonPrefixes`, `maxKeys` cap 1000), `copy()` (server-side), `deleteMany()` (chunked ≤ 1000, per-key failures); Provider Recipes (AWS/DO/R2/B2/MinIO/Wasabi, with non-AWS checksum opt-out); `forRootAsync()`; e2e in `test/e2e/` (Testcontainers + MinIO: upload single + multipart → list → head → download → delete; signed PUT via real fetch; validation MIME/size; scanner mock `'infected'`); mutation-testing baseline.

### 15.6 Phase 5 — Release v0.1.0

**Goal:** docs, budgets, and publish.

Deliverables: complete JSDoc; README with quick start + provider scenarios; SECURITY.md / CHANGELOG.md / CLAUDE.md / AGENTS.md; `scripts/check-size.mjs` budgets (< 30 KB brotli `dist/server`, < 3.5 KB brotli `dist/shared`); final mutation run (Stryker, break 95); tag v0.1.0 + `npm publish --provenance`. (The CI workflows themselves are created in Phase 1, not here.)

---

## 16. Known Limitations

### 16.1 Framework and provider

- **NestJS only.** Does not work in plain Express, Fastify standalone. In the plan for Deno/Bun.
- **S3-compatible only.** Does not cover Azure Blob Storage or native GCS (GCS Interop has limitations: no multipart, no modern signed PUT). A future separate lib, not planned.
- **Provider-exclusive features.** R2 cache rules, S3 Object Lambda, S3 Select, Wasabi compliance — nothing leaks through the public API. Use the `BYMAX_STORAGE_S3_CLIENT` token for direct calls.
- **Integrity checksums break non-AWS providers (the #1 S3-v3 trap).** `@aws-sdk/client-s3` ≥ 3.729.0 defaults `requestChecksumCalculation` to `'WHEN_SUPPORTED'`, adding CRC32 `x-amz-checksum-*` headers on every PutObject/UploadPart (and checksum-mode on GET). Cloudflare R2, Backblaze B2, MinIO, and DigitalOcean Spaces **reject** these headers (`Unsupported header x-amz-checksum-crc32` / `XAmzContentChecksumMismatch`), so the default upload path **fails out of the box** on exactly the providers this lib targets. Mitigation: set `requestChecksumCalculation`/`responseChecksumValidation` to `'WHEN_REQUIRED'` — the non-AWS provider recipes (§4.3) do this automatically. Because the peer floor is `^3.700.0`, every fresh install resolves to a version with the new default; a Testcontainers/MinIO e2e is **not** a reliable guard (MinIO checksum support is version-dependent), so this is documented rather than relied upon.
- **ACL `public-read` fails on modern AWS S3.** New AWS S3 buckets default to Object Ownership = "Bucket owner enforced" (ACLs disabled, since April 2023), so a PutObject carrying `ACL: 'public-read'` returns HTTP 400 `AccessControlListNotSupported`. `defaultPublicRead`/`publicRead` therefore **does not work by default on AWS**; Cloudflare R2 ignores ACLs entirely (`publicRead: true` is silently a no-op — configure a Custom Domain in the R2 dashboard). For public access on either, use a bucket policy, a CDN, or signed URLs rather than ACLs.
- **Versioning across providers.** Behavior varies; R2 still does not officially support object versioning. `UploadResult.versionId` may be `undefined`.

### 16.2 Security

- **MIME validation by header only.** The client can lie about `Content-Type`. No built-in magic-byte sniffing — plug in an `IUploadValidator`.
- **Signed PUT bypasses local validation.** Bytes go straight to the provider; local MIME/size validation does not run. Use `maxSizeBytes` in the presigner + HEAD + post-upload scanner.
- **In-memory idempotency cache.** Multi-replica: two pods accept the same key simultaneously. Future `IIdempotencyStore` in v0.2.
- **Plaintext credentials in config.** Use AWS Secrets Manager, Vault, or Doppler in the app.
- **SSE-KMS depends on IAM.** The user policy needs to allow `kms:Encrypt` and `kms:Decrypt` on the key.

### 16.3 Performance

- **`downloadBuffer()` loads everything in memory.** Use `download()` (stream) for files > 10 MB.
- **Listing is per page of 1000.** A bucket with millions of objects requires explicit iteration; `listAll()` async-iterable helper planned for v0.2.
- **Multipart with part < 5 MB is rejected by S3.** Keep `partSizeBytes >= 5_242_880`.

### 16.4 Features outside v0.1

External `IIdempotencyStore` (Redis) → v0.2. Async iterable `listAll()` → v0.2. Built-in magic-byte sniffing → v0.2 (dedicated validators). Bucket lifecycle in the public API → probably never (use IaC). `./client` subpath for direct browser upload → evaluate based on demand. Custom retry with backoff → AWS SDK has a default; `maxAttempts` covers the basics.

---

## 17. Example Integration

### 17.1 Upload via NestJS controller

```typescript
import { Controller, Post, UploadedFile, UseInterceptors, Body, BadRequestException } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { StorageService } from '@bymax-one/nest-storage'
import { randomUUID } from 'node:crypto'

@Controller('assets')
export class AssetController {
  constructor(private readonly storage: StorageService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File, @Body('folder') folder: string) {
    if (!file) throw new BadRequestException('File is required')
    const extension = file.originalname.split('.').pop()
    const key = `${folder}/${randomUUID()}.${extension}`
    const result = await this.storage.upload({
      key,
      body: file.buffer,
      contentType: file.mimetype,
      size: file.size,
      metadata: { originalName: file.originalname },
    })
    return { url: result.publicUrl, key: result.key, size: result.size }
  }
}
```

### 17.2 Direct browser upload via signed URL

```typescript
// Backend — endpoint that issues a signed PUT URL
@Post('signed-put')
async getSignedPut(@Body() body: { folder: string; contentType: string }) {
  const key = `${body.folder}/${randomUUID()}`
  const result = await this.signedUrls.getUploadUrl({
    key,
    contentType: body.contentType,
    ttlSeconds: 600,
    maxSizeBytes: 10 * 1024 * 1024,
  })
  return { uploadUrl: result.url, key, expiresAt: result.expiresAt }
}

// Frontend
async function uploadFile(file: File) {
  // 1. Get signed URL from backend
  const { uploadUrl, key } = await fetch('/uploads/signed-put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: 'avatars', contentType: file.type }),
  }).then((r) => r.json())

  // 2. PUT directly to the provider — bypasses the backend
  await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })

  // 3. Notify backend to persist metadata in DB
  await fetch('/uploads/confirm', { method: 'POST', body: JSON.stringify({ key }) })
}
```

### 17.3 Stream upload with progress

```typescript
import { createReadStream, statSync } from 'node:fs'

await storage.upload({
  key: 'videos/event-2026.mp4',
  body: createReadStream('/tmp/video.mp4'),
  contentType: 'video/mp4',
  size: statSync('/tmp/video.mp4').size,
  onProgress: (e) => console.log(`Uploaded ${e.loaded}/${e.total ?? '?'} bytes`),
})
```

### 17.4 Download as stream

```typescript
@Get(':key')
async download(@Param('key') key: string, @Res() res: Response) {
  const { stream, metadata } = await this.storage.download({ key })
  res.setHeader('Content-Type', metadata.contentType)
  res.setHeader('Content-Length', metadata.size.toString())
  res.setHeader('Cache-Control', metadata.cacheControl ?? 'public, max-age=300')
  stream.pipe(res)
}
```

### 17.5 Configuration with validation and scanner

```typescript
class ClamAvScanner implements IFileScanner {
  async scan(input): Promise<FileScanResult> {
    // Delegate to a ClamAV daemon (clamd) via socket — implementation omitted
    return { status: 'clean', engine: 'clamav-0.103' }
  }
}

BymaxStorageModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    endpoint: config.getOrThrow('STORAGE_ENDPOINT'),
    region: config.getOrThrow('STORAGE_REGION'),
    bucket: config.getOrThrow('STORAGE_BUCKET'),
    credentials: {
      accessKeyId: config.getOrThrow('STORAGE_KEY_ID'),
      secretAccessKey: config.getOrThrow('STORAGE_SECRET'),
    },
    validation: {
      mimeWhitelist: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      maxSizeBytes: 25 * 1024 * 1024,
    },
    scanner: { impl: new ClamAvScanner(), mode: 'pre-upload', rejectOnUnknown: false },
    serverSideEncryption: 'AES256',
    multipart: { thresholdBytes: 10 * 1024 * 1024, partSizeBytes: 8 * 1024 * 1024, queueSize: 6 },
  }),
})
```

### 17.6 Production security considerations

- **SSE:** enable `serverSideEncryption: 'AES256'` at minimum. For sensitive data use `'aws:kms'`.
- **Bucket policies:** deny by default; allow only via IAM/signed URLs. Do not rely on ACLs alone.
- **Versioning:** enable in the provider for recovery from accidental deletes (`UploadResult.versionId`).
- **Public access:** prefer CDN + signed URLs. Use `publicRead: true` only for immutable assets.
- **MFA delete:** configure in the provider (S3) — out-of-scope for the lib.
- **Auditing:** enable S3 server access logs / CloudTrail. The lib logs via the NestJS Logger without persisting to a DB.
- **Keys with PII:** never include email, government ID, etc. — keys appear in provider logs, CDN, traces.
- **Path traversal:** the lib blocks `..`, but validate user input beforehand.
- **Rate limiting:** use `@nestjs/throttler` in the upload controller — out of scope for the lib.
- **Credential rotation:** prefer IAM roles with STS (`credentials.sessionToken`); rotate access keys.

---

_End of the `@bymax-one/nest-storage` technical specification._
