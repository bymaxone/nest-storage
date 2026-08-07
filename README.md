<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--storage-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-storage" />
</p>

<h1 align="center">@bymax-one/nest-storage</h1>

<p align="center">
  <strong>Provider-agnostic S3-compatible object storage for NestJS</strong><br />
  <sub>AWS S3 · Cloudflare R2 · Backblaze B2 · DigitalOcean Spaces · MinIO · Wasabi · Presigned URLs · Multipart · Virus Scanning · Zero Runtime Dependencies</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-storage"><img src="https://img.shields.io/npm/v/@bymax-one/nest-storage?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-storage"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-storage?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-storage/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-storage/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="https://github.com/bymaxone/nest-storage/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage" /></a>
  <a href="https://github.com/bymaxone/nest-storage/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-100%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/bymaxone/nest-storage"><img src="https://api.scorecard.dev/projects/github.com/bymaxone/nest-storage/badge?style=flat-square" alt="OpenSSF Scorecard" /></a>
  <a href="https://github.com/bymaxone/nest-storage/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-storage?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-storage">GitHub</a> ·
  <a href="https://github.com/bymaxone/nest-storage/issues">Issues</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-api-reference">API Reference</a> ·
  <a href="https://github.com/bymaxone/nest-storage-example">Example App</a>
</p>

---

## ✨ Overview

`@bymax-one/nest-storage` is a NestJS dynamic module that wraps the AWS SDK v3
(`@aws-sdk/client-s3`) behind one typed surface for object storage. Instead of building an
`S3Client`, deciding per provider whether path-style addressing is required, and hand-rolling
multipart, presigning, validation and key normalization in every service, you install one
library and get all of it — against AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces,
MinIO or Wasabi, with the same code.

The library has **zero direct dependencies** — the three `@aws-sdk/*` packages and `@nestjs/*`
arrive as peer dependencies, so you control exact versions and the supply-chain surface stays
minimal.

### Why nest-storage?

- **One engine, six providers.** `providerRecipes` differ only in endpoint, region and the flags
  each provider needs (`forcePathStyle` for MinIO, `auto` region for R2). There is no
  per-provider code path, so switching provider is a configuration change and every operation
  behaves the same way afterwards.
- **The key guard is one chokepoint.** Every caller-supplied key passes through
  `KeyResolverService` before it reaches S3 — `..` segments, a leading `/`, null bytes and empty
  keys are refused, and only then is `keyPrefix` prepended. A tenant cannot climb out of its
  prefix by naming a key.
- **Uploads are refused before they are stored.** MIME allowlist and size limit first, then any
  `IUploadValidator` you register, then the `IFileScanner` if configured — pre-upload,
  post-upload, or both.
- **Presigned URLs cannot outlive what SigV4 allows.** TTLs are clamped and the hard ceiling of
  604 800 s is enforced locally, rather than handed to a signature the provider rejects at use
  time.

---

## 🔥 Features

### ⬆️ Uploading

- ✅ **Multipart upload** — `@aws-sdk/lib-storage` with automatic abort on failure
  (`leavePartsOnError: false`), progress events, and a configurable threshold and part size
- ✅ **Content validation** — MIME allowlist with wildcards (`image/*`, `text/*`) and a size
  limit, refused before a byte is stored
- ✅ **Pluggable validators** — register any number of `IUploadValidator`s; each runs after the
  built-in checks and can refuse with its own reason
- ✅ **Virus scanning hook** — `IFileScanner` pre-upload, post-upload or both, for ClamAV, AWS
  Macie or anything that answers `'clean' | 'infected' | 'unknown'`
- ✅ **Idempotent retries** — an in-memory LRU (1 000 entries / 24 h by default) returns the
  cached `UploadResult` for a repeated `idempotencyKey` instead of storing the object twice

### 🔗 Access & URLs

- ✅ **Presigned GET / PUT** — with optional content-type and length conditions on the PUT
- ✅ **Presigned multipart** — one signed URL per part plus the upload id, so a browser can
  upload directly without the bytes passing through your process
- ✅ **TTL clamping** — SigV4's hard ceiling of 604 800 s (7 days) is enforced locally, not
  discovered when the provider rejects the signature
- ✅ **Public URL composition** — `getPublicUrl` builds from `cdnBaseUrl` or `publicBaseUrl` for
  buckets that are public by policy; it composes, it does not sign

### 🗄️ Objects & Lifecycle

- ✅ **Streaming download** — `download` returns a stream; the body is never buffered unless you
  ask for `downloadBuffer`
- ✅ **Metadata without transfer** — `head` and `exists` answer from object metadata alone
- ✅ **Paginated listing** — `list` over continuation tokens, with the prefix stripped back off
  the keys it returns
- ✅ **Server-side copy** — `copy` moves bytes inside the provider; they never reach this process
- ✅ **Bulk delete with partial results** — `deleteMany` reports what failed instead of throwing
  away the successes

### 🧩 Developer Experience

- ✅ **Six provider recipes** — `awsS3`, `cloudflareR2`, `backblazeB2`, `digitalOceanSpaces`,
  `minio`, `wasabi`
- ✅ **Zero runtime dependencies** — `@aws-sdk/*` and `@nestjs/*` all arrive as peer
  dependencies, so you pin the versions
- ✅ **Two subpaths** — the server surface, and `./shared` carrying types and the error catalog
  that pull in nothing at all
- ✅ **Escape hatch** — `BYMAX_STORAGE_S3_CLIENT` injects the raw `S3Client` for the
  provider-specific operations this surface deliberately does not wrap
- ✅ **Multi-tenant key prefix** — `keyPrefix` prepended after normalization, so it cannot be
  escaped by the key
- ✅ **Server-side encryption** — AES256 or `aws:kms`, globally or per upload
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

| Subpath    | Contents                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | Server runtime: `BymaxStorageModule`, `StorageService`, `SignedUrlService`, `providerRecipes`, DI tokens, interfaces, `StorageException`, `NoOpUploadValidator`, `NoOpFileScanner` |
| `./shared` | Framework-free types (`UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`) + `STORAGE_ERROR_CODES` + `StorageErrorCode`                                            |

```
@bymax-one/nest-storage          (server — NestJS + @aws-sdk/client-s3)
        │
        └── re-exports ──▶ @bymax-one/nest-storage/shared   (zero dependencies)
```

Both subpaths ship ESM **and** CommonJS with declarations for each format, so a
`require()` consumer receives CommonJS declarations rather than ESM ones. The
`pnpm check:exports` gate verifies this against the packed tarball.

### Peer dependency matrix

| Subpath      | Required peers                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.` (server) | `@nestjs/common ^11.0.16`, `@nestjs/core ^11.1.18`, `@aws-sdk/client-s3 ^3.700`, `@aws-sdk/lib-storage ^3.700`, `@aws-sdk/s3-request-presigner ^3.700`, `reflect-metadata ^0.2` |
| `./shared`   | None                                                                                                                                                                            |

---

> [!TIP]
> A reference application lives in
> [`bymaxone/nest-storage-example`](https://github.com/bymaxone/nest-storage-example).

---

## 🚀 Quick Start

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

> **Note:** `customDomain` is the `publicBaseUrl` for R2 and is **required** — there is no working default because the S3 API endpoint (`*.r2.cloudflarestorage.com`) does not serve public object reads. The recipe also sets `requestChecksumCalculation`/`responseChecksumValidation` to `'WHEN_REQUIRED'` to prevent the SDK's default CRC32 headers from being sent (R2 rejects them — see [Provider Compatibility](#provider-compatibility--the-1-trap) below).

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

## ⚙️ Configuration

The full configuration reference lives in `docs/technical_specification.md` §4. Key options:

| Option                         | Type                                              | Default           | Notes                                          |
| ------------------------------ | ------------------------------------------------- | ----------------- | ---------------------------------------------- |
| `endpoint`                     | `string`                                          | —                 | Required. S3-compatible endpoint URL           |
| `region`                       | `string`                                          | —                 | Required. Provider region or `'auto'` (R2)     |
| `bucket`                       | `string`                                          | —                 | Default bucket (can be overridden per-call)    |
| `credentials`                  | `{ accessKeyId, secretAccessKey, sessionToken? }` | —                 | Load from env / Secrets Manager                |
| `forcePathStyle`               | `boolean`                                         | `false`           | Set to `true` for MinIO and self-hosted        |
| `publicBaseUrl`                | `string`                                          | —                 | Base URL for public `getPublicUrl()` results   |
| `cdnBaseUrl`                   | `string`                                          | —                 | CDN edge URL (preferred over `publicBaseUrl`)  |
| `keyPrefix`                    | `string`                                          | —                 | Prepended to every resolved key (multi-tenant) |
| `maxAttempts`                  | `number`                                          | `3`               | SDK v3 retry count                             |
| `serverSideEncryption`         | `'AES256' \| 'aws:kms' \| 'NONE'`                 | —                 | Global SSE policy                              |
| `requestChecksumCalculation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `responseChecksumValidation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `signedUrls.defaultTtlSeconds` | `number`                                          | `3600`            | Default signed-URL TTL                         |
| `signedUrls.maxTtlSeconds`     | `number`                                          | `604800`          | Hard ceiling; clamped to 7 days at init        |
| `multipart.thresholdBytes`     | `number`                                          | `10 MiB`          | Switch to multipart above this size            |
| `multipart.partSizeBytes`      | `number`                                          | `8 MiB`           | Part size (S3 minimum: 5 MiB)                  |
| `validation.mimeWhitelist`     | `string[]`                                        | sensible defaults | Wildcards: `'image/*'`                         |
| `validation.maxSizeBytes`      | `number`                                          | —                 | Maximum upload size in bytes                   |

> **Do not use `maxRetries` or `signatureVersion`** — these are AWS SDK v2 options that do not exist in v3. The v3 SDK is SigV4-only. Use `maxAttempts` (default `3`) for retry configuration.

---

## 🧩 Provider Recipes

| Recipe                                    | Provider            | Notes                                                                                 |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `providerRecipes.awsS3(...)`              | AWS S3              | Keeps the SDK default checksum mode (`'WHEN_SUPPORTED'`); sets SSE-AES256             |
| `providerRecipes.cloudflareR2(...)`       | Cloudflare R2       | `customDomain` required; checksums `'WHEN_REQUIRED'`; `region: 'auto'`                |
| `providerRecipes.backblazeB2(...)`        | Backblaze B2        | `forcePathStyle: false` (B2 supports virtual-hosted); checksums `'WHEN_REQUIRED'`     |
| `providerRecipes.digitalOceanSpaces(...)` | DigitalOcean Spaces | Sets `cdnBaseUrl` to `*.cdn.digitaloceanspaces.com`; checksums `'WHEN_REQUIRED'`      |
| `providerRecipes.minio(...)`              | MinIO / self-hosted | `forcePathStyle: true`; checksums `'WHEN_REQUIRED'`; region defaults to `'us-east-1'` |
| `providerRecipes.wasabi(...)`             | Wasabi Hot Cloud    | Virtual-hosted; checksums `'WHEN_REQUIRED'`                                           |

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

## ⬆️ Upload

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
const opts = {
  key,
  body: buf,
  contentType: 'image/png',
  size: buf.length,
  idempotencyKey: 'order-42-avatar',
}

const r1 = await storage.upload(opts)
const r2 = await storage.upload(opts) // returns cached result instantly
console.log(r2.fromIdempotencyCache) // true
```

---

## ⬇️ Download

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

## 🔗 Signed URLs (GET / PUT / Multipart)

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

## ✅ Validation

```typescript
import { Injectable } from '@nestjs/common'
import type { IUploadValidator } from '@bymax-one/nest-storage'

/** Magic-byte PDF check — reads the first 4 bytes of the stream. */
@Injectable()
export class PdfValidator implements IUploadValidator {
  async validate(input: {
    body: Buffer | NodeJS.ReadableStream
    readBytes: (n: number) => Promise<Buffer>
  }) {
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

## 🦠 Virus Scanning (`IFileScanner`)

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

## ♻️ Lifecycle Operations

### List / Paginate

```typescript
const page1 = await storage.list({ prefix: 'avatars/', maxKeys: 100 })
// { objects: [...], nextContinuationToken?: '...' }
if (page1.nextContinuationToken) {
  const page2 = await storage.list({
    prefix: 'avatars/',
    maxKeys: 100,
    continuationToken: page1.nextContinuationToken,
  })
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

## 🚨 Error Codes

All errors are thrown as `StorageException extends HttpException`. The response body is `{ error: { code, message, details? } }`.

| Code                             | HTTP | When                                                                                                                                                                                                               |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STORAGE_NOT_CONFIGURED`         | 503  | Credentials missing and an operation was called                                                                                                                                                                    |
| `STORAGE_KEY_INVALID`            | 400  | Path traversal (`..`), key starts with `/`, or empty after normalization                                                                                                                                           |
| `STORAGE_BODY_MISSING`           | 400  | `upload()` called without a body                                                                                                                                                                                   |
| `STORAGE_CONTENT_TYPE_REQUIRED`  | 400  | `upload()` called without `contentType`                                                                                                                                                                            |
| `STORAGE_MIME_NOT_ALLOWED`       | 415  | `contentType` outside `mimeWhitelist`                                                                                                                                                                              |
| `STORAGE_SIZE_EXCEEDED`          | 413  | `size > maxSizeBytes`                                                                                                                                                                                              |
| `STORAGE_VALIDATION_FAILED`      | 400  | `IUploadValidator` rejected the file (`details.reason`)                                                                                                                                                            |
| `STORAGE_SCAN_INFECTED`          | 422  | Scanner returned `'infected'` (`details.threat`)                                                                                                                                                                   |
| `STORAGE_SCAN_INCONCLUSIVE`      | 422  | Scanner returned `'unknown'` and `rejectOnUnknown: true`                                                                                                                                                           |
| `STORAGE_OBJECT_NOT_FOUND`       | 404  | `head()`, `download()`, or `copy()` on a nonexistent key                                                                                                                                                           |
| `STORAGE_PROVIDER_ERROR`         | 502  | AWS SDK error (network, 5xx, throttling, `AccessControlListNotSupported`); `details` carries `awsCode`, `awsMessage`, `httpStatus`, `requestId` plus the operation context (`op`, `bucket`, and `key` or `prefix`) |
| `STORAGE_SIGNED_URL_TTL_INVALID` | 400  | Per-request `ttlSeconds` ≤ 0                                                                                                                                                                                       |
| `STORAGE_PART_TOO_SMALL`         | 400  | Multipart with part < 5 MiB (S3 limit)                                                                                                                                                                             |
| `STORAGE_INVALID_PART_COUNT`     | 400  | `getMultipartUploadUrls()` with `parts <= 0` (`details.provided`)                                                                                                                                                  |
| `STORAGE_BUCKET_UNDEFINED`       | 400  | Operation without a bucket and no default in config                                                                                                                                                                |
| `STORAGE_MULTIPART_ABORTED`      | 500  | Multipart upload failed and was aborted                                                                                                                                                                            |
| `STORAGE_INVALID_CONFIG`         | 500  | `BymaxStorageModuleOptions` validation failed at initialization                                                                                                                                                    |
| `STORAGE_TIMEOUT`                | 504  | Request exceeded `requestTimeoutMs`                                                                                                                                                                                |

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

## 📖 API Reference

Every operation below is documented with a runnable example in the sections above.
This is the index.

### `StorageService`

| Method           | Signature                                                     | Notes                                                        |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| `upload`         | `(options: UploadOptions) => Promise<UploadResult>`           | Multipart via `@aws-sdk/lib-storage`; aborts on failure      |
| `download`       | `(options: DownloadOptions) => Promise<{ stream, metadata }>` | Streaming; the body is never buffered                        |
| `downloadBuffer` | `(options: DownloadOptions) => Promise<{ buffer, metadata }>` | Buffers — bounded by the caller's own memory                 |
| `head`           | `(key, options?) => Promise<ObjectMetadata>`                  | Metadata without transferring the body                       |
| `exists`         | `(key, options?) => Promise<boolean>`                         | `head` reduced to a boolean                                  |
| `getPublicUrl`   | `(key, options?) => string`                                   | Composed, not signed — for buckets that are public by policy |
| `delete`         | `(key, options?) => Promise<void>`                            | Idempotent, as S3 delete is                                  |
| `deleteMany`     | `(keys: string[], options?) => Promise<DeleteManyResult>`     | Partial failures are reported, not thrown                    |
| `list`           | `(options: ListOptions) => Promise<ListResult>`               | Paginated by continuation token                              |
| `copy`           | `(options: CopyOptions) => Promise<{ key, etag }>`            | Server-side; the bytes never reach this process              |

### `SignedUrlService`

| Method                   | Signature                                                                     | Notes                                                         |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `getDownloadUrl`         | `(options: SignedGetUrlOptions) => Promise<SignedUrlResult>`                  | GET presign                                                   |
| `getUploadUrl`           | `(options: SignedPutUrlOptions) => Promise<SignedUrlResult>`                  | PUT presign, with optional content-type and length conditions |
| `getMultipartUploadUrls` | `(options: MultipartUploadUrlsOptions) => Promise<MultipartUploadUrlsResult>` | One signed URL per part, plus the upload id                   |

### Key normalization

`KeyResolverService` is internal — it is not exported, and it is not something a
consumer calls. It is named here because every method above passes the key you
supply through it first: the guard below, then `keyPrefix`. The key you read back in
`UploadResult` and `ListedObject` is the resolved one.

### DI tokens

`BYMAX_STORAGE_OPTIONS` · `BYMAX_STORAGE_S3_CLIENT` · `BYMAX_STORAGE_FILE_SCANNER` ·
`BYMAX_STORAGE_UPLOAD_VALIDATORS` · `BYMAX_STORAGE_IDEMPOTENCY_CACHE` ·
`BYMAX_STORAGE_LOGGER` — all `Symbol()`, so no string token can collide with them.

---

## 🏗️ Architecture

```
                 BymaxStorageModule.forRoot / forRootAsync
                                    │
                          validateOptions (fail fast)
                     credentials tolerated empty on purpose
                                    │
                    ┌───────────────┴────────────────┐
                    │        S3ClientProvider        │
                    │  one @aws-sdk/client-s3 client │
                    │  built from a provider recipe  │
                    └───────────────┬────────────────┘
                                    │
                        BYMAX_STORAGE_S3_CLIENT
                     (escape hatch — the raw S3Client)
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          │                                                   │
    StorageService                                     SignedUrlService
  upload · download                                  GET · PUT · multipart
  head · exists · list                                   TTL-clamped
  copy · delete · deleteMany                         SigV4 ceiling 7 days
          │                                                   │
          └──────────────┬────────────────────────────────────┘
                         │
                  KeyResolverService
        every caller key passes here before S3:
        refuse `..`, leading `/`, NUL, empty → then keyPrefix
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
IUploadValidator[]   IFileScanner       IdempotencyCache
MIME + size, then    pre- and/or        LRU, in-process,
yours                post-upload        collapses a retry
   (yours)             (yours)          within one instance
```

One engine, six recipes. `providerRecipes` differ only in endpoint, region and the
handful of flags each provider needs (`forcePathStyle` for MinIO, `auto` region for
R2) — there is no per-provider code path, so a provider swap is a configuration
change and every operation behaves the same way afterwards.

The idempotency cache is **in-process**. It collapses a retried `upload` inside one
instance; it does not coordinate between replicas.

### Design Principles

| Principle                        | Description                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔑 **One key chokepoint**        | Every caller-supplied key passes through `KeyResolverService` before it reaches S3. `..`, a leading `/`, null bytes and empty keys are refused, and `keyPrefix` is prepended after normalization — so it cannot be escaped by the key |
| 🧩 **One engine, six recipes**   | `providerRecipes` differ in endpoint, region and per-provider flags only. There is no per-provider code path, so a provider swap is configuration and every operation behaves the same afterwards                                     |
| 🚫 **Refuse before storing**     | MIME allowlist and size limit, then registered `IUploadValidator`s, then the `IFileScanner`. An upload that will be rejected is rejected before a byte is written                                                                     |
| ⏱️ **Bounded signatures**        | Presign TTLs are clamped and SigV4's 604 800 s ceiling is enforced locally, not discovered when the provider rejects the signature                                                                                                    |
| 💥 **Fail at boot, mostly**      | Options are validated before any client is built. Credentials are the deliberate exception: empty values are tolerated so a development workflow boots, and operations then fail with `STORAGE_NOT_CONFIGURED`                        |
| 🧊 **Zero runtime dependencies** | `dependencies` is `{}`. You choose the exact `@aws-sdk/*` versions and the supply-chain surface stays yours                                                                                                                           |

---

## 🔐 Security Model

This library turns caller input into object keys, signs URLs that grant access on their
own, and holds the credentials for a bucket. Its security contract is about what a key can
reach, how long a signature lives, and what leaves in an error.

### The object key is the attack surface

Everything a caller sends becomes part of a key, and a key is a path.
`KeyResolverService.normalize` is the single chokepoint: it refuses an empty key, a key
containing a null byte, a key starting with `/`, and any key with a `..` segment; it
collapses duplicate slashes; and only then does it prepend `keyPrefix`. Nothing in this
library composes a key any other way, so a tenant cannot climb out of its prefix by naming
one.

### Presigned URLs are bearer credentials

Anyone holding one has the access it encodes, for as long as it lives. TTLs are clamped,
and SigV4's hard ceiling of 604 800 s (7 days) is enforced here rather than passed through
to a signature the provider would reject at use time. Treat a signed URL like a password
with an expiry, not like a link.

### Credentials stay where they were put

They arrive through module options and are handed to the SDK. This library never reads
`process.env`, never logs them, and never places them — or a signed URL — in an exception.

They are also not reachable by serializing the objects that hold them. The resolved
options are injected into every service, so `credentials` is attached as a non-enumerable
accessor: `JSON.stringify`, object spread, `util.inspect` and `util.inspect` with
`showHidden` all omit it. Those are the paths taken by code that renders a provider it was
handed incidentally — a structured logger formatting its arguments, an error reporter
capturing the scope of a throw. Reading on purpose is unchanged.

### Error payloads carry the operation, and that includes the key

What `aws-error-mapper` puts in `details` is the provider's error code and message, the
HTTP status, the request id, and the operation context the call site supplies: which
operation, which bucket, and the resolved key or prefix. That is enough to diagnose a
failure, and it means an object key reaches whatever consumes the exception — so if a key
is itself sensitive in your deployment, do not log the envelope verbatim.

### Uploads are refused before they are stored

MIME allowlist (wildcards included) and size limit run first, then any `IUploadValidator`
you register, then the `IFileScanner` if configured. A scanner can run pre-upload,
post-upload, or both — the post-upload position exists because some scanners only accept an
object they can fetch.

### `keyPrefix` is a namespace, not an access boundary

It scopes the keys this library composes; it does not restrict what the credentials can
reach. Anything holding the bucket's credentials can read every prefix in it. Isolation
that must survive a compromised client belongs in IAM policies or separate buckets.

---

## 🛡️ Security Table

| Layer            | Implementation                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Object keys      | Guarded and normalized in one place; `..`, leading `/`, null bytes and empty keys refused                                                              |
| Multi-tenancy    | `keyPrefix` prepended after normalization, so it cannot be escaped by the key                                                                          |
| Credentials      | Injected options only; never read from `process.env`, never logged, never in an exception; held in a non-enumerable accessor, so serializing a service omits them |
| Error payloads   | Provider code and message, HTTP status, request id, and the operation context (`op`, `bucket`, `key`/`prefix`) — never credentials, never a signed URL |
| Presign lifetime | TTL clamped, SigV4's 7-day ceiling enforced locally                                                                                                    |
| Encryption       | Server-side (AES256 / `aws:kms`) configurable globally or per upload                                                                                   |
| Content          | MIME allowlist + size limit, then registered validators, then the scanner                                                                              |
| Supply chain     | `dependencies: {}`; third-party Actions pinned by commit SHA (org-internal reusables by tag); CodeQL, OSV-Scanner and OpenSSF Scorecard                |

> [!IMPORTANT]
> **`keyPrefix` is not an access boundary.** It scopes the keys this library composes;
> it does not restrict what the credentials can reach. Anything holding the bucket's
> credentials can read every prefix in it. Enforce tenant isolation with IAM policies
> or separate buckets when the boundary has to hold against the application itself.

---

## 🧱 Tech Stack

- **Runtime:** Node.js 24+
- **Framework:** NestJS 11 (`ConfigurableModuleBuilder`, `@Global()`, `Symbol()` tokens)
- **Storage engine:** `@aws-sdk/client-s3 ^3.700` (peer), with `@aws-sdk/lib-storage`
  for multipart and `@aws-sdk/s3-request-presigner` for presigns — all peers
- **Providers:** AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO, Wasabi
- **Build:** tsup — ESM + CJS per subpath, with `.d.ts` _and_ `.d.cts` declarations
- **Tests:** Jest + Testcontainers (MinIO, E2E) + Stryker (mutation)
- **TypeScript:** 5.x strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), zero `any`

---

## 🧪 Testing & Quality

Object storage is where a bug is expensive to discover later — a key written to the wrong
place stays there — so the suite is held to a bar beyond "the tests pass".

- ✅ **100% line coverage** — statements, branches, functions and lines, enforced as a gate
- ✅ **100% mutation score** — verified with [Stryker](https://stryker-mutator.io/) at
  `break: 95`; every survivor was killed by a strengthened assertion, and the eight provable
  equivalents are documented inline
- ✅ **Real object storage in e2e** — MinIO through Testcontainers, so multipart, presigning
  and listing are exercised against an actual S3 API rather than a mock
- ✅ **Published-artifact gates** — `check:exports` resolves the types the way each module
  system does, `check:runtime` loads every subpath from the packed tarball in ESM and
  CommonJS, and `check:published` compiles this README's snippets against `dist/`
- ✅ **Every suppression is justified** — no coverage directives anywhere; the six
  `// Stryker disable` comments in the production source each name why the mutant they
  silence is provably equivalent, and `check:mutants` proves each reason is written in the
  grammar Stryker parses, so the mutation report carries it in full rather than the
  `Ignored using a comment` fallback

```bash
pnpm test          # unit tests (Jest)
pnpm test:cov      # unit tests with the 100% coverage gate
pnpm test:e2e      # end-to-end against MinIO (requires Docker)
pnpm mutation      # Stryker mutation testing (break: 95)
pnpm typecheck     # tsc strict check
pnpm lint          # ESLint
```

---

## 🤝 Contributing

Pull requests are welcome. Please open an issue first for significant changes.

- Read [`docs/technical_specification.md`](docs/technical_specification.md) for architecture decisions.
- Run `pnpm test:cov` and `pnpm lint` before opening a PR.
- Please use Conventional Commits for the message; nothing enforces it here, so it is a convention rather than a gate.

---

## 🔒 Security Policy

If you discover a security vulnerability, please **do not** open a public issue. Instead, email us
at **support@bymax.one** with details. We take security seriously and will respond promptly. See
[`SECURITY.md`](SECURITY.md) for the full policy, including the storage-specific security goals.

---

## 📄 License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub>
</p>
