<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-storage"><img src="https://img.shields.io/npm/v/@bymax-one/nest-storage.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-storage"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-storage.svg" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-storage/actions/workflows/ci.yml"><img src="https://github.com/bymaxone/nest-storage/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/bymaxone/nest-storage"><img src="https://codecov.io/gh/bymaxone/nest-storage/branch/main/graph/badge.svg" alt="coverage" /></a>
  <a href="https://stryker-mutator.io"><img src="https://img.shields.io/badge/mutation%20score-100%25-brightgreen" alt="mutation score" /></a>
  <a href="https://api.securityscorecards.dev/projects/github.com/bymaxone/nest-storage"><img src="https://api.securityscorecards.dev/projects/github.com/bymaxone/nest-storage/badge" alt="OpenSSF Scorecard" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@bymax-one/nest-storage.svg" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node-%3E%3D24-green.svg" alt="Node 24+" />
</p>

<h1 align="center">@bymax-one/nest-storage</h1>

<p align="center">
  Provider-agnostic S3-compatible object storage for NestJS.<br/>
  Single <code>@aws-sdk/client-s3</code> engine — works with AWS S3, Cloudflare R2, Backblaze B2,<br/>
  DigitalOcean Spaces, MinIO, and Wasabi with zero runtime dependencies.
</p>

---

## Overview

`@bymax-one/nest-storage` is a NestJS dynamic module that wraps the AWS SDK v3 (`@aws-sdk/client-s3`) to provide a unified, provider-agnostic API for any S3-compatible object storage service. A single `StorageService` covers the full lifecycle — upload, download, signed URLs, listing, copy, and batch delete — while the pluggable `IUploadValidator` and `IFileScanner` hooks let you enforce your own MIME rules and virus-scan policies without coupling the library to any specific scanner.

## Features

- **Multipart upload** via `@aws-sdk/lib-storage` with automatic abort on failure (`leavePartsOnError: false`), progress events, and a configurable part-size threshold
- **Presigned GET / PUT / multipart URLs** with TTL clamping and a hard 7-day SigV4 ceiling
- **MIME whitelist + size limit** (wildcards supported: `image/*`, `text/*`) with a pluggable `IUploadValidator` hook for magic-byte checks and custom business rules
- **Pluggable `IFileScanner` hook** (pre- and/or post-upload) for ClamAV, AWS Macie, or any scanner that returns `'clean' | 'infected' | 'unknown'`
- **Six ready-to-use provider recipes** — `awsS3`, `cloudflareR2`, `backblazeB2`, `digitalOceanSpaces`, `minio`, `wasabi`
- **Path-traversal guard** in `KeyResolverService` — blocks `..`, leading `/`, and empty-after-normalize keys
- **In-memory LRU idempotency cache** (default 1 000 entries / 24 h) — identical `idempotencyKey` returns the cached `UploadResult`
- **Server-side encryption** (AES256 / aws:kms) configurable globally or per-upload
- **`keyPrefix` multi-tenant isolation** — prepended to every resolved key
- **`forRoot` / `forRootAsync`** dynamic module API; `@Global()` scope; `Symbol()` DI tokens
- **`BYMAX_STORAGE_S3_CLIENT` token** for injecting the raw `S3Client` for provider-specific operations

## Subpath Exports

| Subpath | Contents |
|---|---|
| `.` | Server runtime: `BymaxStorageModule`, `StorageService`, `SignedUrlService`, `providerRecipes`, DI tokens, interfaces, `StorageException`, `NoOpUploadValidator`, `NoOpFileScanner` |
| `./shared` | Framework-free types (`UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`) + `STORAGE_ERROR_CODES` + `StorageErrorCode` |

---

## Quick Start

### 1 — AWS S3

```typescript
import { Module } from '@nestjs/common'
import { BymaxStorageModule, providerRecipes } from '@bymax-one/nest-storage'

@Module({
  imports: [
    BymaxStorageModule.forRoot({
      ...providerRecipes.awsS3({
        region: 'us-east-1',
        bucket: 'my-bucket',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      }),
      // AWS keeps the SDK default checksum behaviour — no opt-out needed.
    }),
  ],
})
export class AppModule {}
```

```typescript
import { Injectable } from '@nestjs/common'
import { StorageService } from '@bymax-one/nest-storage'

@Injectable()
export class AssetService {
  constructor(private readonly storage: StorageService) {}

  async uploadFile(key: string, buffer: Buffer, contentType: string) {
    return this.storage.upload({ key, body: buffer, contentType, size: buffer.length })
  }
}
```

### 2 — Cloudflare R2

```typescript
import { BymaxStorageModule, providerRecipes } from '@bymax-one/nest-storage'

BymaxStorageModule.forRoot({
  ...providerRecipes.cloudflareR2({
    accountId: process.env.R2_ACCOUNT_ID!,
    bucket: 'my-bucket',
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    // Required — the *.r2.cloudflarestorage.com API host does not serve public reads.
    // Configure a Custom Domain in the R2 dashboard and supply it here.
    customDomain: 'https://cdn.example.com',
  }),
})
```

> **Note:** `customDomain` is the `publicBaseUrl` for R2 and is **required** — there is no working default because the S3 API endpoint (`*.r2.cloudflarestorage.com`) does not serve public object reads. The recipe also sets `requestChecksumCalculation`/`responseChecksumValidation` to `'WHEN_REQUIRED'` to prevent the SDK's default CRC32 headers from being sent (R2 rejects them — see [Provider Compatibility](#provider-compatibility-the-1-trap) below).

### 3 — DigitalOcean Spaces with CDN

```typescript
import { BymaxStorageModule, providerRecipes } from '@bymax-one/nest-storage'

BymaxStorageModule.forRoot({
  ...providerRecipes.digitalOceanSpaces({
    region: 'nyc3',
    bucket: 'my-bucket',
    accessKeyId: process.env.DO_ACCESS_KEY_ID!,
    secretAccessKey: process.env.DO_SECRET_ACCESS_KEY!,
  }),
  // The recipe sets cdnBaseUrl to *.cdn.digitaloceanspaces.com automatically.
  // Override if you use a custom CDN domain:
  // cdnBaseUrl: 'https://cdn.example.com',
})
```

### 4 — MinIO (local development)

```typescript
import { BymaxStorageModule, providerRecipes } from '@bymax-one/nest-storage'

BymaxStorageModule.forRoot({
  ...providerRecipes.minio({
    endpoint: 'http://localhost:9000',
    bucket: 'dev-bucket',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  }),
  // forcePathStyle: true is set by the recipe automatically.
})
```

---

## Configuration

The full configuration reference lives in `docs/technical_specification.md` §4. Key options:

| Option | Type | Default | Notes |
|---|---|---|---|
| `endpoint` | `string` | — | Required. S3-compatible endpoint URL |
| `region` | `string` | — | Required. Provider region or `'auto'` (R2) |
| `bucket` | `string` | — | Default bucket (can be overridden per-call) |
| `credentials` | `{ accessKeyId, secretAccessKey, sessionToken? }` | — | Load from env / Secrets Manager |
| `forcePathStyle` | `boolean` | `false` | Set to `true` for MinIO and self-hosted |
| `publicBaseUrl` | `string` | — | Base URL for public `getPublicUrl()` results |
| `cdnBaseUrl` | `string` | — | CDN edge URL (preferred over `publicBaseUrl`) |
| `keyPrefix` | `string` | — | Prepended to every resolved key (multi-tenant) |
| `maxAttempts` | `number` | `3` | SDK v3 retry count |
| `serverSideEncryption` | `'AES256' \| 'aws:kms' \| 'NONE'` | — | Global SSE policy |
| `requestChecksumCalculation` | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'` | SDK default | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `responseChecksumValidation` | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'` | SDK default | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `signedUrls.defaultTtlSeconds` | `number` | `3600` | Default signed-URL TTL |
| `signedUrls.maxTtlSeconds` | `number` | `604800` | Hard ceiling; clamped to 7 days at init |
| `multipart.thresholdBytes` | `number` | `10 MiB` | Switch to multipart above this size |
| `multipart.partSizeBytes` | `number` | `8 MiB` | Part size (S3 minimum: 5 MiB) |
| `validation.mimeWhitelist` | `string[]` | sensible defaults | Wildcards: `'image/*'` |
| `validation.maxSizeBytes` | `number` | — | Maximum upload size in bytes |

> **Do not use `maxRetries` or `signatureVersion`** — these are AWS SDK v2 options that do not exist in v3. The v3 SDK is SigV4-only. Use `maxAttempts` (default `3`) for retry configuration.

---

## Provider Recipes

| Recipe | Provider | Notes |
|---|---|---|
| `providerRecipes.awsS3(...)` | AWS S3 | Keeps the SDK default checksum mode (`'WHEN_SUPPORTED'`); sets SSE-AES256 |
| `providerRecipes.cloudflareR2(...)` | Cloudflare R2 | `customDomain` required; checksums `'WHEN_REQUIRED'`; `region: 'auto'` |
| `providerRecipes.backblazeB2(...)` | Backblaze B2 | `forcePathStyle: false` (B2 supports virtual-hosted); checksums `'WHEN_REQUIRED'` |
| `providerRecipes.digitalOceanSpaces(...)` | DigitalOcean Spaces | Sets `cdnBaseUrl` to `*.cdn.digitaloceanspaces.com`; checksums `'WHEN_REQUIRED'` |
| `providerRecipes.minio(...)` | MinIO / self-hosted | `forcePathStyle: true`; checksums `'WHEN_REQUIRED'`; region defaults to `'us-east-1'` |
| `providerRecipes.wasabi(...)` | Wasabi Hot Cloud | Virtual-hosted; checksums `'WHEN_REQUIRED'` |

### Provider Compatibility — The #1 Trap

`@aws-sdk/client-s3` ≥ 3.729.0 defaults `requestChecksumCalculation` to `'WHEN_SUPPORTED'`, which causes the SDK to send `x-amz-checksum-crc32` integrity headers on every `PutObject` and `UploadPart` call. **Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces, and Wasabi reject these headers** — the default upload path fails out of the box on exactly the providers this library targets.

Every non-AWS provider recipe sets both `requestChecksumCalculation` and `responseChecksumValidation` to `'WHEN_REQUIRED'` to suppress the headers. If you build a custom config instead of using a recipe, you must add this opt-out manually:

```typescript
BymaxStorageModule.forRoot({
  endpoint: 'https://...',
  region: '...',
  bucket: '...',
  credentials: { ... },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
```

### Public Access / ACLs

`publicRead: true` (or `defaultPublicRead: true` in the config) sends `ACL: 'public-read'` on PutObject. However:

- **Modern AWS S3 buckets** (Object Ownership = "Bucket owner enforced", the default since April 2023) return **HTTP 400 `AccessControlListNotSupported`** when an ACL header is present.
- **Cloudflare R2** ignores ACLs entirely — `publicRead: true` is a **silent no-op**; configure a Custom Domain in the R2 dashboard for public delivery.

For public access on either provider, use a **bucket policy**, a **CDN**, or **signed URLs** rather than ACLs.

---

## Upload

### Single-shot / Buffer

```typescript
import { StorageService } from '@bymax-one/nest-storage'
import { randomUUID } from 'node:crypto'

const result = await storage.upload({
  key: `avatars/${randomUUID()}.jpg`,
  body: fileBuffer,
  contentType: 'image/jpeg',
  size: fileBuffer.length,
  metadata: { userId: '42' },
  serverSideEncryption: 'AES256',
})
console.log(result.publicUrl) // https://...
```

### Stream with Progress

```typescript
import { createReadStream, statSync } from 'node:fs'

await storage.upload({
  key: 'videos/event-2026.mp4',
  body: createReadStream('/tmp/video.mp4'),
  contentType: 'video/mp4',
  size: statSync('/tmp/video.mp4').size,
  onProgress: (e) => console.log(`${e.loaded}/${e.total ?? '?'} bytes`),
})
```

Uploads are automatically routed to multipart when `size >= multipart.thresholdBytes` (default 10 MiB). A `Readable` without a `size` always uses multipart. Multipart aborts automatically on failure (`leavePartsOnError: false`).

### Idempotency

```typescript
const key = `uploads/${randomUUID()}.png`
const opts = { key, body: buf, contentType: 'image/png', size: buf.length, idempotencyKey: 'order-42-avatar' }

const r1 = await storage.upload(opts)
const r2 = await storage.upload(opts) // returns cached result instantly
console.log(r2.fromIdempotencyCache) // true
```

---

## Download

### As a Stream

```typescript
import { Controller, Get, Param, Res } from '@nestjs/common'
import type { Response } from 'express'

@Get(':key')
async download(@Param('key') key: string, @Res() res: Response) {
  const { stream, metadata } = await this.storage.download({ key })
  res.setHeader('Content-Type', metadata.contentType)
  res.setHeader('Content-Length', String(metadata.size))
  stream.pipe(res)
}
```

### As a Buffer

```typescript
// Use only for files < 10 MB — loads the entire object into memory.
const { buffer, metadata } = await this.storage.downloadBuffer({ key: 'docs/report.pdf' })
```

---

## Signed URLs (GET / PUT / Multipart)

> **Security:** signed URLs are temporary credentials. **Never log them** — a logged signed URL is accessible to anyone with log access.

### Presigned GET

```typescript
import { SignedUrlService } from '@bymax-one/nest-storage'

const result = await signedUrls.getDownloadUrl({
  key: 'invoices/2026-001.pdf',
  ttlSeconds: 900,
  responseContentDisposition: 'attachment; filename="invoice.pdf"',
})
// result.url — share this with the client; expires at result.expiresAt
```

### Presigned PUT (direct browser upload)

```typescript
// Backend — issue a signed upload URL
@Post('signed-put')
async getSignedPut(@Body() body: { folder: string; contentType: string }) {
  const key = `${body.folder}/${randomUUID()}`
  const result = await this.signedUrls.getUploadUrl({
    key,
    contentType: body.contentType,
    ttlSeconds: 600,
    maxSizeBytes: 10 * 1024 * 1024,
  })
  // NEVER log result.url — it is a temporary credential
  return { uploadUrl: result.url, key, expiresAt: result.expiresAt }
}
```

> **Caveat:** a signed PUT bypasses the library's local MIME/size validation. Pair it with a presigner `maxSizeBytes` (Content-Length-Range policy), a `HEAD` check after upload, and an `IFileScanner` post-upload hook.

```typescript
// Frontend
const { uploadUrl, key } = await fetchJson('/uploads/signed-put', { folder, contentType })
await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })
await fetchJson('/uploads/confirm', { key }) // backend persists metadata
```

### Presigned Multipart

```typescript
const { uploadId, parts, key } = await signedUrls.getMultipartUploadUrls({
  key: 'videos/large.mp4',
  contentType: 'video/mp4',
  partCount: 10,
  ttlSeconds: 3600,
})
// Upload each part with the corresponding signed URL, then call CompleteMultipartUpload.
```

> **TTL clamp:** per-request `ttlSeconds` values above `signedUrls.maxTtlSeconds` are silently clamped; `maxTtlSeconds` is itself clamped to 604 800 s (7-day SigV4 ceiling) at module init. A `ttlSeconds` ≤ 0 throws `STORAGE_SIGNED_URL_TTL_INVALID`.

---

## Validation

```typescript
import { Injectable } from '@nestjs/common'
import type { IUploadValidator } from '@bymax-one/nest-storage'

/** Magic-byte PDF check — reads the first 4 bytes of the stream. */
@Injectable()
export class PdfValidator implements IUploadValidator {
  async validate(input: { body: Buffer | NodeJS.ReadableStream; readBytes: (n: number) => Promise<Buffer> }) {
    const header = await input.readBytes(4)
    if (header.toString('ascii', 0, 4) !== '%PDF') {
      return { valid: false, reason: 'Not a valid PDF (magic bytes mismatch)' }
    }
    return { valid: true }
  }
}
```

Register it in the module:

```typescript
BymaxStorageModule.forRoot({
  ...providerRecipes.awsS3({ ... }),
  validation: {
    mimeWhitelist: ['application/pdf'],
    maxSizeBytes: 25 * 1024 * 1024,
  },
  validators: [{ useClass: PdfValidator }],
})
```

---

## Virus Scanning (`IFileScanner`)

```typescript
import type { IFileScanner, FileScanResult } from '@bymax-one/nest-storage'

/** ClamAV stub — delegate to clamd over a socket in production. */
@Injectable()
export class ClamAvScanner implements IFileScanner {
  async scan(_input: unknown): Promise<FileScanResult> {
    // Replace with real clamd socket call
    return { status: 'clean', engine: 'clamav-0.103' }
  }
}
```

```typescript
BymaxStorageModule.forRoot({
  ...providerRecipes.awsS3({ ... }),
  scanner: {
    impl: new ClamAvScanner(),
    mode: 'pre-upload',       // 'pre-upload' | 'post-upload' | 'both'
    rejectOnUnknown: false,   // treat inconclusive scans as pass (true = reject)
  },
})
```

---

## Lifecycle Operations

### List / Paginate

```typescript
const page1 = await storage.list({ prefix: 'avatars/', maxKeys: 100 })
// { objects: [...], nextContinuationToken?: '...' }
if (page1.nextContinuationToken) {
  const page2 = await storage.list({ prefix: 'avatars/', maxKeys: 100, continuationToken: page1.nextContinuationToken })
}
```

### Copy (server-side)

```typescript
const { etag } = await storage.copy({
  sourceKey: 'drafts/file.pdf',
  destinationKey: 'published/file.pdf',
})
```

### Delete / Batch Delete

```typescript
await storage.delete('temp/file.png') // idempotent — no error on 404

const { deleted, failed } = await storage.deleteMany(['a.png', 'b.png', 'c.png'])
```

### Raw S3Client (Advanced)

For provider-specific operations not covered by the public API, inject the raw client:

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { S3Client } from '@aws-sdk/client-s3'
import { BYMAX_STORAGE_S3_CLIENT } from '@bymax-one/nest-storage'

@Injectable()
export class AdvancedStorageService {
  constructor(@Inject(BYMAX_STORAGE_S3_CLIENT) private readonly s3: S3Client) {}

  async customOperation() {
    // Direct S3Client call — bypass the public API when needed.
  }
}
```

### `forRootAsync`

```typescript
import { ConfigModule, ConfigService } from '@nestjs/config'

BymaxStorageModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    ...providerRecipes.awsS3({
      region: config.getOrThrow('AWS_REGION'),
      bucket: config.getOrThrow('AWS_BUCKET'),
      accessKeyId: config.getOrThrow('AWS_ACCESS_KEY_ID'),
      secretAccessKey: config.getOrThrow('AWS_SECRET_ACCESS_KEY'),
    }),
    keyPrefix: config.get('STORAGE_KEY_PREFIX'),
    serverSideEncryption: 'AES256',
  }),
})
```

---

## Error Codes

All errors are thrown as `StorageException extends HttpException`. The response body is `{ error: { code, message, details? } }`.

| Code | HTTP | When |
|---|---|---|
| `STORAGE_NOT_CONFIGURED` | 503 | Credentials missing and an operation was called |
| `STORAGE_KEY_INVALID` | 400 | Path traversal (`..`), key starts with `/`, or empty after normalization |
| `STORAGE_BODY_MISSING` | 400 | `upload()` called without a body |
| `STORAGE_CONTENT_TYPE_REQUIRED` | 400 | `upload()` called without `contentType` |
| `STORAGE_MIME_NOT_ALLOWED` | 415 | `contentType` outside `mimeWhitelist` |
| `STORAGE_SIZE_EXCEEDED` | 413 | `size > maxSizeBytes` |
| `STORAGE_VALIDATION_FAILED` | 400 | `IUploadValidator` rejected the file (`details.reason`) |
| `STORAGE_SCAN_INFECTED` | 422 | Scanner returned `'infected'` (`details.threat`) |
| `STORAGE_SCAN_INCONCLUSIVE` | 422 | Scanner returned `'unknown'` and `rejectOnUnknown: true` |
| `STORAGE_OBJECT_NOT_FOUND` | 404 | `head()`, `download()`, or `copy()` on a nonexistent key |
| `STORAGE_PROVIDER_ERROR` | 502 | AWS SDK error (network, 5xx, throttling, `AccessControlListNotSupported`); `details.awsCode`, `httpStatus`, `requestId` |
| `STORAGE_SIGNED_URL_TTL_INVALID` | 400 | Per-request `ttlSeconds` ≤ 0 |
| `STORAGE_PART_TOO_SMALL` | 400 | Multipart with part < 5 MiB (S3 limit) |
| `STORAGE_BUCKET_UNDEFINED` | 400 | Operation without a bucket and no default in config |
| `STORAGE_MULTIPART_ABORTED` | 500 | Multipart upload failed and was aborted |
| `STORAGE_INVALID_CONFIG` | 500 | `BymaxStorageModuleOptions` validation failed at initialization |
| `STORAGE_TIMEOUT` | 504 | Request exceeded `requestTimeoutMs` |

```typescript
import { StorageException, STORAGE_ERROR_CODES } from '@bymax-one/nest-storage'

try {
  await storage.upload({ ... })
} catch (err) {
  if (err instanceof StorageException) {
    const body = err.getResponse() as { error: { code: string; message: string } }
    console.error(body.error.code) // e.g. 'STORAGE_MIME_NOT_ALLOWED'
  }
}
```

---

## Testing

```bash
# Unit tests
pnpm test

# Unit tests with coverage (100% threshold enforced)
pnpm test:cov

# E2E tests (requires Docker — spins MinIO via Testcontainers)
pnpm test:e2e

# Mutation testing (Stryker — run manually pre-release, not on every CI commit)
pnpm mutation
```

---

## Contributing

Security issues: report privately to [security@bymax.one](mailto:security@bymax.one) — do not open a public issue. See [SECURITY.md](SECURITY.md) for the full disclosure policy and storage-specific security goals.

For feature requests and bugs, open a GitHub issue. Pull requests are welcome; please run `pnpm test:cov` and `pnpm lint` before submitting.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Bymax One
