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
  `IUploadValidator` you register, then the `IFileScanner` if configured — before the upload
  or after it.
- **Presigned URLs stay inside a configured ceiling.** A requested TTL above
  `signedUrls.maxTtlSeconds` (604 800 s, the SigV4 limit, by default) is clamped locally, rather
  than handed to a signature the provider rejects at use time.

---

## 🔥 Features

### ⬆️ Uploading

- ✅ **Multipart upload** — `@aws-sdk/lib-storage` with automatic abort on failure
  (`leavePartsOnError: false`), progress events, and a configurable threshold and part size
- ✅ **Content validation** — MIME allowlist with wildcards (`image/*`, `text/*`) and a size
  limit, refused before a byte is stored
- ✅ **Pluggable validators** — register any number of `IUploadValidator`s; each runs after the
  built-in checks and can refuse with its own reason
- ✅ **Virus scanning hook** — `IFileScanner` pre-upload or post-upload, for ClamAV, AWS
  Macie or anything that answers `'clean' | 'infected' | 'unknown'`
- ✅ **Idempotent retries** — an in-memory LRU (1 000 entries / 24 h by default) returns the
  cached `UploadResult` for a repeated `idempotencyKey` instead of storing the object twice

### 🔗 Access & URLs

- ✅ **Presigned GET / PUT** — the PUT signs the `Content-Type` (and ACL and metadata, when set) as required headers
- ✅ **Presigned multipart** — one signed URL per part plus the upload id, so a browser can
  upload directly without the bytes passing through your process
- ✅ **TTL clamping** — a requested TTL above `signedUrls.maxTtlSeconds` (default 604 800 s, the
  7-day SigV4 limit) is clamped locally, not discovered when the provider rejects the signature
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
- ✅ **Bucket lifecycle rules** — read the rules, add or replace an expiration rule by id, remove
  one, and leave every other rule exactly as the provider returned it

### 🧩 Developer Experience

- ✅ **Six provider recipes** — `awsS3`, `cloudflareR2`, `backblazeB2`, `digitalOceanSpaces`,
  `minio`, `wasabi`
- ✅ **Zero runtime dependencies** — `@aws-sdk/*` and `@nestjs/*` all arrive as peer
  dependencies, so you pin the versions
- ✅ **Two subpaths** — the server surface, and `./shared` carrying types and the error catalog
  that pull in nothing at all
- ✅ **Escape hatch** — `BYMAX_STORAGE_S3_CLIENT` injects the raw `S3Client` for the
  provider-specific operations this surface deliberately does not wrap
- ✅ **Key prefix** — `keyPrefix` is prepended after normalization, so a key cannot escape it; the
  keys the library returns are relative to it, so they can be passed straight back
- ✅ **Server-side encryption** — AES256 or `aws:kms`, globally or per upload
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

| Subpath    | Contents                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | Server runtime: `BymaxStorageModule`, `StorageService`, `SignedUrlService`, `BucketLifecycleService`, `providerRecipes`, DI tokens, interfaces, `StorageException`, `NoOpUploadValidator`, `NoOpFileScanner` |
| `./shared` | Framework-free types (`UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`, `StorageErrorResponse`) + `STORAGE_ERROR_CODES` + `StorageErrorCode` + the default MIME whitelists and the TTL and multipart default constants                                            |

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
| `keyPrefix`                    | `string`                                          | —                 | Prepended to every key before it reaches the provider; fixed per module instance |
| `maxAttempts`                  | `number`                                          | `3`               | SDK v3 retry count                             |
| `serverSideEncryption`         | `'AES256' \| 'aws:kms'`                           | —                 | Global SSE policy; `aws:kms` needs `kmsKeyId`. `'NONE'` is accepted per upload only |
| `requestChecksumCalculation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `responseChecksumValidation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `defaultPublicRead`            | `boolean`                                         | `false`           | ACL `public-read` on uploads; see Public Access / ACLs |
| `defaultCacheControl`          | `string`                                          | `public, max-age=31536000, immutable` | Default `Cache-Control` on uploads |
| `defaultContentDisposition`    | `'inline' \| 'attachment'`                        | `inline`          | Default `Content-Disposition` on uploads       |
| `requestTimeoutMs`             | `number`                                          | `30000`           | Per attempt, until the response headers arrive; see below the table |
| `uploadIdleTimeoutMs`          | `number`                                          | `30000`           | Longest silence from a stream body during a multipart upload; follows `requestTimeoutMs` unless set, `0` disables; see below the table |
| `signedUrls.defaultGetTtlSeconds` | `number`                                       | `300`             | Default TTL for `getDownloadUrl`               |
| `signedUrls.defaultPutTtlSeconds` | `number`                                       | `300`             | Default TTL for `getUploadUrl`                 |
| `signedUrls.maxTtlSeconds`     | `number`                                          | `604800`          | Per-request TTLs above this are clamped; a value above 604800 (the 7-day SigV4 limit) is reduced to it at init |
| `multipart.thresholdBytes`     | `number`                                          | `5 MiB`           | Switch to multipart at or above this size      |
| `multipart.partSizeBytes`      | `number`                                          | `5 MiB`           | Part size (S3 minimum: 5 MiB)                  |
| `multipart.queueSize`          | `number`                                          | `4`               | Concurrent parts                               |
| `validation.mimeWhitelist`     | `string[]`                                        | —                 | No MIME check when absent. Wildcards: `'image/*'` |
| `validation.maxSizeBytes`      | `number`                                          | —                 | Maximum upload size in bytes                   |

> **Do not use `maxRetries` or `signatureVersion`** — these are AWS SDK v2 options that do not exist in v3. The v3 SDK is SigV4-only. Use `maxAttempts` (default `3`) for retry configuration.

**`requestTimeoutMs`** is passed to the S3 client's request handler as `requestTimeout` with `throwOnRequestTimeout` ([AWS SDK for JavaScript v3: `requestHandler: { requestTimeout: 3_000, ... }`][sdk-request-timeout]). It bounds one attempt, from sending the request until the response headers arrive, and an upload body counts toward it, so a large single-shot upload on a slow link needs a larger value. It does not limit reading a download stream. With `maxAttempts` above 1 a stalled request is retried, so the total wait is the timeout times the attempts.

**`uploadIdleTimeoutMs`** covers the gap `requestTimeoutMs` cannot: a multipart upload that is waiting for the next bytes of a stream has no request in flight, so a source that stops delivering (a client that stalls, a pipe that never closes) would hold the upload open on the provider indefinitely. When the source delivers nothing for this long, the upload is aborted (the provider is sent `AbortMultipartUpload`), your stream is destroyed and `upload()` rejects with `STORAGE_TIMEOUT` and `details.phase` set to `'source-idle'`. The clock restarts on every chunk and runs only while the library is waiting for data, so a slow but live source succeeds and a slow provider does not trip it. It defaults to the value of `requestTimeoutMs`; `0` turns it off. It applies only to a stream that takes the multipart path; a single-shot upload is bounded by `requestTimeoutMs`, and a `Buffer` cannot stall.

[aws-presigned-expiry]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
[aws-get-object]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
[aws-mpu-limits]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
[aws-mpu-abort-rule]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html
[sdk-request-timeout]: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-configuring-maxsockets.html

---

## 🧩 Provider Recipes

| Recipe                                    | Provider            | Notes                                                                                 |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `providerRecipes.awsS3(...)`              | AWS S3              | Keeps the SDK default checksum mode (`'WHEN_SUPPORTED'`); sets SSE-AES256             |
| `providerRecipes.cloudflareR2(...)`       | Cloudflare R2       | `customDomain` required; checksums `'WHEN_REQUIRED'`; `region: 'auto'`                |
| `providerRecipes.backblazeB2(...)`        | Backblaze B2        | `forcePathStyle: false` (B2 supports virtual-hosted); checksums `'WHEN_REQUIRED'`     |
| `providerRecipes.digitalOceanSpaces(...)` | DigitalOcean Spaces | Sets `cdnBaseUrl` to `*.cdn.digitaloceanspaces.com` and `defaultPublicRead: true`; checksums `'WHEN_REQUIRED'`      |
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

Uploads are automatically routed to multipart when `size >= multipart.thresholdBytes` (default 5 MiB). A `Readable` without a `size` always uses multipart. Multipart aborts automatically on failure (`leavePartsOnError: false`).

**The library owns a `Readable` once you pass it to `upload()`**, the convention of `stream.pipeline`. When the upload is rejected for any reason (invalid key or content type, a validation or scan failure, a provider error), the stream is destroyed, which releases the file handle or the socket behind it. It is destroyed without an error, so a listener on the stream sees `'close'` and not the failure; the failure is the rejection of `upload()`. A call answered from the idempotency cache destroys the stream unread. A stream consumed by a successful upload ends on its own. Do not reuse a stream after passing it in: if you retry an upload, open a new stream. A listener on the stream itself is not needed to avoid an unhandled `'error'` event.

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

### Conditional and ranged reads

`download` and `downloadBuffer` accept `range`, `ifNoneMatch` and `ifMatch`. S3 answers a matching
`If-None-Match` with 304 ([AWS GetObject: "otherwise, return a `304 Not Modified` error"][aws-get-object])
and a failing `If-Match` with 412, and the library turns them into typed errors:

| Outcome | Error code | HTTP |
|---|---|---|
| `ifNoneMatch` equals the current ETag | `STORAGE_NOT_MODIFIED` | 304 |
| `ifMatch` differs from the current ETag | `STORAGE_PRECONDITION_FAILED` | 412 |

A 304 is therefore thrown, not returned: catch `StorageException` and branch on `code`. A `range`
(`'bytes=0-99'`) returns the requested bytes, and the metadata describes the whole object.

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

> **Caveat:** a signed PUT bypasses the library's local MIME/size validation. No size limit is bound into the signature — `maxSizeBytes` is advisory — so verify the size with a `HEAD` check after upload and add an `IFileScanner` post-upload hook.

```typescript
// Frontend
const { uploadUrl, key } = await fetchJson('/uploads/signed-put', { folder, contentType })
await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })
await fetchJson('/uploads/confirm', { key }) // backend persists metadata
```

### Presigned Multipart

```typescript
const { uploadId, partUrls, completeUrl } = await signedUrls.getMultipartUploadUrls({
  key: 'videos/large.mp4',
  contentType: 'video/mp4',
  parts: 10,
  ttlSeconds: 3600,
})
// Upload each part with the corresponding signed URL, then call CompleteMultipartUpload.
```

- `parts` is an integer from 1 to 10 000, S3's limit of part numbers per upload ([AWS multipart
  limits][aws-mpu-limits]); anything else throws `STORAGE_INVALID_PART_COUNT` before a request is made.
- Every part except the last must be at least 5 MiB. The library signs the URLs and does not see the
  bytes, so it cannot check part sizes; a client that sends a smaller non-final part gets the
  provider's `EntityTooSmall` when it completes the upload.
- The client completes the upload itself, by sending the part ETags as the XML body to `completeUrl`.
- The library issues no abort URL. A client that gives up should abort with its own signed
  `AbortMultipartUpload` request, and an upload nobody completes keeps its parts, and their storage
  cost, until it is aborted. Recommended: a bucket lifecycle rule with `AbortIncompleteMultipartUpload`
  ([AWS: "we recommend that you configure a lifecycle rule by using the `AbortIncompleteMultipartUpload`
  action"][aws-mpu-abort-rule]). `BucketLifecycleService` can write it
  (`upsert({ id, prefix, abortIncompleteMultipartDays })`) and keeps it through every change.

> **TTL clamp:** per-request `ttlSeconds` values above `signedUrls.maxTtlSeconds` are silently clamped. `maxTtlSeconds` defaults to 604 800 s (the 7-day SigV4 limit). A larger configured value is reduced to 604 800 s at module init, with one warning, because the signer rejects a longer expiry and no URL longer than 7 days can exist ([AWS: "the expiration time can be set as high as 7 days"][aws-presigned-expiry]). A `ttlSeconds` ≤ 0 throws `STORAGE_SIGNED_URL_TTL_INVALID`.

---

## ✅ Validation

```typescript
import { Injectable } from '@nestjs/common'
import type { IUploadValidator } from '@bymax-one/nest-storage'

/** Magic-byte PDF check — reads the first 4 bytes of the stream. */
@Injectable()
export class PdfValidator implements IUploadValidator {
  readonly name = 'pdf-magic-bytes'

  async validate(ctx: Parameters<IUploadValidator['validate']>[0]) {
    if (!ctx.readBytes) return { ok: true as const }
    const header = await ctx.readBytes(4)
    if (header.toString('ascii', 0, 4) !== '%PDF') {
      return { ok: false as const, reason: 'Not a valid PDF (magic bytes mismatch)' }
    }
    return { ok: true as const }
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
    customValidators: [new PdfValidator()],
  },
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
    mode: 'pre-upload',       // 'pre-upload' | 'post-upload'
    rejectOnUnknown: false,   // treat inconclusive scans as pass (true = reject)
  },
})
```

**Streams in pre-upload mode.** A stream can be read once, so the scanner and the upload could not
both consume it. In `pre-upload` mode a stream body is first read into memory, counted as it
arrives, and the scanner and the upload then share that buffer. The read is bounded by
`validation.maxSizeBytes`: a stream longer than the limit is refused with
`STORAGE_VALIDATION_FAILED` as soon as it passes it, and with no `maxSizeBytes` a stream is
refused with a reason that says to set it or use `post-upload`. Buffer bodies and `post-upload`
mode are not affected; `post-upload` hands the scanner no body, only the key.

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

### Bucket Lifecycle Rules

`BucketLifecycleService` manages the bucket's lifecycle configuration: read the rules, add or
replace one expiration rule or one multipart-abort rule by id, remove one. Every other rule in the bucket — transitions,
tag filters, multipart aborts — is sent back exactly as the provider returned it.

```typescript
import { BucketLifecycleService } from '@bymax-one/nest-storage'

// Expire everything under `expiring/` seven days after creation.
await lifecycle.upsert({ id: 'expire-tmp', prefix: 'expiring/', expirationDays: 7 })

// Abort multipart uploads that were never completed, so their parts stop costing storage.
await lifecycle.upsert({ id: 'abort-stale', prefix: 'uploads/', abortIncompleteMultipartDays: 7 })

const rules = await lifecycle.get() // [] when the bucket has no configuration

const removed = await lifecycle.remove('expire-tmp') // true; false when no rule has that id
```

- **Read-modify-write.** `PutBucketLifecycleConfiguration` replaces the whole configuration
  ([AWS: "this will overwrite an existing lifecycle configuration"][aws-put-lifecycle]), so
  `upsert` and `remove` read the rules, change the one with the given id, and write all of them
  back. A rule with the same id is replaced in place; a new id is appended.
- **Removing the last rule deletes the configuration.** A put with no rules is invalid (the `Rule`
  element is required), so the service calls `DeleteBucketLifecycle` instead.
- **Not atomic.** S3 has no conditional write for lifecycle configuration. If another writer
  changes the bucket between the read and the write, that change is overwritten. The service does
  not lock; run lifecycle changes from one place (an operator command or a single deployment step).
- **`prefix` is relative to `keyPrefix`.** The rule's effective prefix is `keyPrefix` plus the one
  you pass, because that is where the objects live. `get()` returns filter prefixes the same
  relative way `list()` returns keys, so `upsert({ prefix: rule.Filter.Prefix, ... })` on a value
  read from `get()` does not prefix twice. The deprecated rule-level `Prefix` is treated the same
  way as `Filter.Prefix`.
- **Rules outside `keyPrefix` are read-only.** With a `keyPrefix` set, a rule whose filter prefix
  does not start with it — written by another application or by hand, tag-only, or covering the
  whole bucket — is returned exactly as stored with `isOutsideKeyPrefix: true`. `upsert` and
  `remove` refuse an id that names such a rule (`STORAGE_LIFECYCLE_RULE_INVALID`), and every write
  sends it back field for field. Without a `keyPrefix`, no rule is flagged.
- **Two rule kinds.** An input has exactly one of `expirationDays` (delete objects under the prefix after
  N days) and `abortIncompleteMultipartDays` (abort uploads not completed within N days of starting;
  [AWS: "Specifies the number of days after which Amazon S3 aborts an incomplete multipart
  upload"][aws-abort-mpu]). A rule with the same id is replaced, whichever kind it was.
- **Inputs are validated before any request.** `id` is 1 to 255 characters (the AWS limit), the day
  count is an integer of at least 1, and `prefix` passes the same key guard as every other key. An
  expiration rule needs a non-empty prefix: an expiry over the whole bucket is not supported by this
  API. A multipart-abort rule may have an empty prefix, which means every upload in the module's
  namespace (the whole bucket without a `keyPrefix`), because aborting a stale upload deletes no object.
  A bad input throws `STORAGE_LIFECYCLE_RULE_INVALID`.
- **Typed provider errors.** A provider that does not implement the API throws
  `STORAGE_LIFECYCLE_UNSUPPORTED` (501); a configuration the provider refuses throws
  `STORAGE_LIFECYCLE_REJECTED` (422). `details` carries the provider's error code, status and
  request id, never the caught error.
- **`TransitionDefaultMinimumObjectSize`.** When the provider reports this setting, a write sends it
  back unchanged so existing transition behaviour does not reset.

**Provider support**

| Provider                                   | Status                | Basis                                                                                                                                               |
| ------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| MinIO (tested with the `pgsty/silo` image) | **Verified**          | The end-to-end suite applies an expiration rule once, keeps unrelated rules through upsert, replace and remove, and deletes the configuration on the last rule. It does not accept a multipart-abort rule: the server answers HTTP 400 `InvalidArgument`, which the library types as `STORAGE_LIFECYCLE_REJECTED`, and the existing rules stay as they were (also checked end to end). |
| Cloudflare R2                              | **Verified (docs)**   | R2 documents the S3 lifecycle calls ([R2 object lifecycles][r2-lifecycles]) and multipart-abort rules, and a default rule that expires multipart uploads after seven days; this repository does not run them against R2. |
| AWS S3                                     | Documented, not run   | The behaviour follows the S3 API reference ([Put][aws-put-lifecycle], [Get][aws-get-lifecycle], [Delete][aws-delete-lifecycle]), including multipart-abort rules; no test here hits AWS. |
| Backblaze B2, DigitalOcean Spaces, Wasabi  | **Unverified**        | Neither documented nor tested here. A provider without the API surfaces as `STORAGE_LIFECYCLE_UNSUPPORTED`.                                        |

Expiry timing is the provider's, not this library's. R2 states that objects "will typically be
removed from a bucket within 24 hours" of their expiry; MinIO's scanner runs at low priority, so an
object can outlive its rule period.

[aws-put-lifecycle]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutBucketLifecycleConfiguration.html
[aws-abort-mpu]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortIncompleteMultipartUpload.html
[aws-get-lifecycle]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetBucketLifecycleConfiguration.html
[aws-delete-lifecycle]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteBucketLifecycle.html
[r2-lifecycles]: https://developers.cloudflare.com/r2/buckets/object-lifecycles/

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
| `STORAGE_KEY_INVALID`            | 400  | Empty key, null byte, path traversal (`..`), or key starts with `/`                                                                                                                                           |
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
| `STORAGE_PART_TOO_SMALL`         | 400  | Reserved: a `multipart.partSizeBytes` below 5 MiB is rejected at init as `STORAGE_INVALID_CONFIG`                                                                                                                                                                             |
| `STORAGE_INVALID_PART_COUNT`     | 400  | `getMultipartUploadUrls()` with `parts` not an integer from 1 to 10 000 (`details.provided`, `details.reason`)                                                                                                                                                  |
| `STORAGE_BUCKET_UNDEFINED`       | 400  | Operation without a bucket and no default in config                                                                                                                                                                |
| `STORAGE_MULTIPART_ABORTED`      | 500  | Multipart upload failed and was aborted                                                                                                                                                                            |
| `STORAGE_INVALID_CONFIG`         | 500  | `BymaxStorageModuleOptions` validation failed at initialization                                                                                                                                                    |
| `STORAGE_TIMEOUT`                | 504  | An attempt got no response headers within `requestTimeoutMs` (the SDK's `TimeoutError`); a multipart source that stays silent for `uploadIdleTimeoutMs` also surfaces as `STORAGE_TIMEOUT` (`details.phase: 'source-idle'`); any other failure inside a multipart upload surfaces as `STORAGE_MULTIPART_ABORTED`                                                                                                                                                                                |
| `STORAGE_LIFECYCLE_RULE_INVALID` | 400  | `BucketLifecycleService` input rejected: empty or over-long `id`, non-positive or non-integer `expirationDays`, bad `prefix`, or an id naming a rule outside `keyPrefix` (`details.reason`) |
| `STORAGE_LIFECYCLE_UNSUPPORTED` | 501  | The provider does not implement the lifecycle API |
| `STORAGE_LIFECYCLE_REJECTED` | 422  | The provider refused the lifecycle configuration |
| `STORAGE_NOT_MODIFIED`           | 304  | `download()` with `ifNoneMatch` equal to the current ETag |
| `STORAGE_PRECONDITION_FAILED`    | 412  | `download()` with `ifMatch` different from the current ETag |

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
| `exists`         | `(key, options?) => Promise<boolean>`                         | `head` reduced to a boolean; any non-404 failure is logged and returns `false`                                  |
| `getPublicUrl`   | `(key, options?) => string`                                   | Composed, not signed — for buckets that are public by policy |
| `delete`         | `(key, options?) => Promise<void>`                            | Idempotent, as S3 delete is                                  |
| `deleteMany`     | `(keys: string[], options?) => Promise<DeleteManyResult>`     | Partial failures are reported, not thrown                    |
| `list`           | `(options: ListOptions) => Promise<ListResult>`               | Paginated by continuation token                              |
| `copy`           | `(options: CopyOptions) => Promise<{ etag }>`            | Server-side; the bytes never reach this process              |

### `SignedUrlService`

| Method                   | Signature                                                                     | Notes                                                         |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `getDownloadUrl`         | `(options: SignedGetUrlOptions) => Promise<SignedUrlResult>`                  | GET presign                                                   |
| `getUploadUrl`           | `(options: SignedPutUrlOptions) => Promise<SignedUrlResult>`                  | PUT presign; signs `Content-Type` and returns the `requiredHeaders` |
| `getMultipartUploadUrls` | `(options: MultipartUploadUrlsOptions) => Promise<MultipartUploadUrlsResult>` | One signed URL per part, plus the upload id and the completion URL                   |

### `BucketLifecycleService`

| Method   | Signature                                                              | Notes                                                                   |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `get`    | `(options?) => Promise<BucketLifecycleRuleView[]>`                     | `[]` when the bucket has no configuration; filter prefixes are relative to `keyPrefix`; rules outside it carry `isOutsideKeyPrefix` |
| `upsert` | `(rule: ExpirationRuleInput, options?) => Promise<void>`               | Read-modify-write; replaces the rule with the same id, keeps the rest   |
| `remove` | `(id: string, options?) => Promise<boolean>`                           | `false` and no write for an unknown id; deletes the configuration when it removes the last rule |

### Key normalization

`KeyResolverService` is internal — it is not exported, and it is not something a
consumer calls. It is named here because every method above passes the key you
supply through it first: the guard below, then `keyPrefix`.

**Keys the library returns are relative to `keyPrefix`.** `UploadResult.key`, `ObjectMetadata.key`
(from `head`, `download` and `downloadBuffer`), `ListedObject.key`, `commonPrefixes` and the
`deleteMany` result all omit the prefix, so any of them can be passed straight back to `head`,
`download`, `delete`, `copy` or a signed-URL call, which prepend it once. `UploadResult.publicUrl`
is the one full value: it is a URL, and the prefix is part of the object's real path. Error
`details` carry the real, prefixed key, because they describe what was sent to the provider.

### Exported types and constants

Every name the package exports is listed here, so none is a surprise.

- **Module configuration:** `BymaxStorageModuleOptions`, `BymaxStorageModuleAsyncOptions` (the
  `forRootAsync` shape: `imports`, `inject`, and one of `useFactory`, `useClass`, `useExisting`) and
  `BymaxStorageModuleOptionsFactory` (the `createStorageOptions()` contract for `useClass` /
  `useExisting`).
- **Provider recipes:** `providerRecipes`, and the `ProviderRecipe<TInput>` type for writing a recipe
  for another S3-compatible provider (it must keep the `'WHEN_REQUIRED'` checksum opt-out).
- **Operation inputs and results:** `UploadOptions`, `DownloadOptions`, `ListOptions`, `ListResult`,
  `CopyOptions`, `DeleteManyOptions`, `DeleteManyResult`, `FailedDeletion`, `SignedGetUrlOptions`,
  `SignedPutUrlOptions`, `MultipartUploadUrlsOptions`, `MultipartUploadUrlsResult`.
- **Lifecycle:** `BucketLifecycleRule` (the provider's rule as stored), `BucketLifecycleRuleView` (what
  `get()` returns), `ExpirationRuleInput` and `LifecycleBucketOptions` (`{ bucket? }`).
- **Extension points:** `IUploadValidator`, `IFileScanner`, `FileScanResult`, and the helpers
  `NoOpUploadValidator` and `NoOpFileScanner`.
- **From `./shared`:** `UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`,
  `StorageErrorResponse`, `StorageErrorCode`, `STORAGE_ERROR_CODES`, the three MIME presets
  `DEFAULT_IMAGE_MIME_WHITELIST`, `DEFAULT_VIDEO_MIME_WHITELIST`, `DEFAULT_DOC_MIME_WHITELIST`, and the
  defaults `DEFAULT_SIGNED_URL_TTL_SECONDS`, `MAX_SIGNED_URL_TTL_SECONDS`,
  `DEFAULT_MULTIPART_THRESHOLD_BYTES`, `DEFAULT_MULTIPART_PART_SIZE_BYTES`,
  `DEFAULT_MULTIPART_QUEUE_SIZE`.

`BYMAX_STORAGE_OPTIONS` is exported so a provider of yours can read the resolved configuration, and it
is also reachable by every other provider in the application. The credentials are not enumerable on
that object, but they are readable on it: treat the token as sensitive.

### DI tokens

`BYMAX_STORAGE_OPTIONS` · `BYMAX_STORAGE_S3_CLIENT` · `BYMAX_STORAGE_FILE_SCANNER` ·
`BYMAX_STORAGE_UPLOAD_VALIDATORS` — all `Symbol()`, so no string token can collide with
them, and all four are in the module's `exports`, so injection resolves rather than raising
`UnknownDependenciesException`. Two of them are nullable by design: `BYMAX_STORAGE_S3_CLIENT`
is `null` until credentials are configured, and `BYMAX_STORAGE_FILE_SCANNER` is `null` when no
scanner is set, which is the default. Type them as `S3Client | null` and `IFileScanner | null`.

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
ValidationService    IFileScanner       IdempotencyCache
MIME + size, then    pre- and/or        LRU, in-process,
IUploadValidator[]   post-upload        collapses a retry
   (yours)             (yours)          within one instance
```

`SignedUrlService` stops at `KeyResolverService`: it signs a URL and never sees the body, so
validation, scanning and the idempotency cache apply to `StorageService` only. See the signed-PUT
caveat above.

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
| ⏱️ **Bounded signatures**        | Presign TTLs above `signedUrls.maxTtlSeconds` (default 604 800 s, the SigV4 limit) are clamped locally, not discovered when the provider rejects the signature                                                                                                    |
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

Anyone holding one has the access it encodes, for as long as it lives. A requested TTL
above `signedUrls.maxTtlSeconds` (604 800 s, SigV4's limit, by default) is clamped here rather
than passed through to a signature the provider would reject at use time. Treat a signed URL like a password
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
you register, then the `IFileScanner` if configured. A scanner runs either pre-upload or
post-upload — the post-upload position exists because some scanners only accept an
object they can fetch.

### `keyPrefix` is a namespace, not an access boundary

It scopes the keys this library composes; it does not restrict what the credentials can
reach. Anything holding the bucket's credentials can read every prefix in it. Isolation
that must survive a compromised client belongs in IAM policies or separate buckets.

It is also fixed when the module is registered: `forRoot` resolves one prefix, and the
module is `@Global()` with one `StorageService` behind fixed injection tokens, so it is not
designed to be registered twice in one application with different prefixes. To keep tenants
apart in one application, build the tenant segment into the key on each call from a trusted
source (`tenants/${tenantId}/${name}`, never from request input) or give each tenant its own
bucket and credentials.

---

## 🛡️ Security Table

| Layer            | Implementation                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Object keys      | Guarded and normalized in one place; `..`, leading `/`, null bytes and empty keys refused                                                              |
| Multi-tenancy    | `keyPrefix` prepended after normalization, so it cannot be escaped by the key                                                                          |
| Credentials      | Injected options only; never read from `process.env`, never logged, never in an exception; held in a non-enumerable accessor, so serializing a service omits them |
| Error payloads   | Provider code and message, HTTP status, request id, and the operation context (`op`, `bucket`, `key`/`prefix`) — never credentials, never a signed URL |
| Presign lifetime | TTL clamped to `signedUrls.maxTtlSeconds` (default: SigV4's 7-day limit)                                                                                                    |
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
- **Framework:** NestJS 11 (a hand-written `forRoot` / `forRootAsync` dynamic module, `@Global()`, `Symbol()` tokens)
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
