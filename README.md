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

- **One engine, six providers.** `providerRecipes` only produce module options (endpoint, region,
  addressing style, public URLs and, for the non-AWS providers, the checksum opt-out). There is no per-provider code
  path, so switching provider is a configuration change.
- **One key chokepoint.** Every caller key passes through `KeyResolverService` before it reaches S3,
  and `keyPrefix` is prepended only after it ([Security Model](#-security-model)).
- **Uploads are refused before they are stored.** MIME allowlist and size limit first, then any
  `IUploadValidator` you register, then the `IFileScanner`, before or after the upload.

---

## 🔥 Features

- ✅ **Multipart upload** — `@aws-sdk/lib-storage` with automatic abort on failure
  (`leavePartsOnError: false`), progress events, and a configurable threshold and part size
- ✅ **Content validation** — MIME allowlist with wildcards (`image/*`) and a size limit, then any
  number of `IUploadValidator`s, all refused before a byte is stored
- ✅ **Virus scanning hook** — `IFileScanner` pre-upload or post-upload, for ClamAV, AWS Macie or
  anything that answers `'clean' | 'infected' | 'unknown'`
- ✅ **Idempotent retries** — a bounded in-memory LRU with a TTL returns the cached
  `UploadResult` for a repeated `idempotencyKey`
- ✅ **Presigned GET / PUT / multipart** — the PUT signs the `Content-Type` (and ACL and metadata, when set) as required headers, so a PUT that sends another type is refused and stores nothing; multipart gets one signed URL per part, so a browser uploads directly
- ✅ **Streaming download, metadata without transfer, paginated listing, server-side copy, bulk delete**
  — `deleteMany` reports what failed instead of throwing away the successes
- ✅ **Public URL composition** — `getPublicUrl` builds from `cdnBaseUrl` or `publicBaseUrl`; it
  composes, it does not sign
- ✅ **Bucket lifecycle rules** — read the rules, add or replace an expiration or a multipart-abort
  rule by id, remove one, and leave every other rule as the provider returned it
- ✅ **Six provider recipes** — `awsS3`, `cloudflareR2`, `backblazeB2`, `digitalOceanSpaces`,
  `minio`, `wasabi`
- ✅ **Zero runtime dependencies** — `@aws-sdk/*` and `@nestjs/*` all arrive as peer dependencies,
  so you pin the versions
- ✅ **Escape hatch** — `BYMAX_STORAGE_S3_CLIENT` injects the raw `S3Client` for the
  provider-specific operations this surface does not wrap
- ✅ **Key prefix and server-side encryption** — `keyPrefix` is prepended after normalization and the
  keys the library returns are relative to it; AES256 or `aws:kms`, globally or per upload
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

| Subpath    | Contents                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | Server runtime: `BymaxStorageModule`, `StorageService`, `SignedUrlService`, `BucketLifecycleService`, `providerRecipes`, DI tokens, interfaces, `StorageException`, `NoOpUploadValidator`, `NoOpFileScanner` |
| `./shared` | Framework-free types (`UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`, `StorageErrorResponse`) + `STORAGE_ERROR_CODES` + `StorageErrorCode` + the default MIME whitelists and the TTL and multipart default constants                                            |

The root re-exports some `./shared` names for convenience; import the rest from the subpath.

Both subpaths ship ESM **and** CommonJS with declarations for each format, so a
`require()` consumer receives CommonJS declarations rather than ESM ones. The
`pnpm check:exports` gate verifies this against the packed tarball.

### Peer dependency matrix

| Subpath      | Required peers                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.` (server) | `@nestjs/common ^11.0.16`, `@nestjs/core ^11.1.18`, `@aws-sdk/client-s3 ^3.700`, `@aws-sdk/lib-storage ^3.700`, `@aws-sdk/s3-request-presigner ^3.700`, `reflect-metadata ^0.2` |
| `./shared`   | None                                                                                                                                                                            |

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

Options accepted by `forRoot` and `forRootAsync`:

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
| `maxAttempts`                  | `number`                                          | `3`               | SDK v3 retry count; an integer of at least `1` |
| `serverSideEncryption`         | `'AES256' \| 'aws:kms'`                           | —                 | Global SSE policy; `aws:kms` needs `kmsKeyId`. `'NONE'` is accepted per upload only |
| `requestChecksumCalculation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `responseChecksumValidation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `defaultPublicRead`            | `boolean`                                         | `false`           | ACL `public-read` on uploads; see Public Access / ACLs |
| `defaultCacheControl`          | `string`                                          | `public, max-age=31536000, immutable` | Default `Cache-Control` on uploads |
| `defaultContentDisposition`    | `'inline' \| 'attachment'`                        | `inline`          | Default `Content-Disposition` on uploads       |
| `requestTimeoutMs`             | `number`                                          | `30000`           | Per attempt, until the response headers arrive; an integer of at least `1`; see below the table |
| `uploadIdleTimeoutMs`          | `number`                                          | `30000`           | Longest silence from a stream body during a multipart upload; follows `requestTimeoutMs` unless set, `0` disables; see below the table |
| `bodyIdleTimeoutMs`            | `number`                                          | `30000`           | Longest silence from a download body while the caller is reading it; follows `requestTimeoutMs` unless set, `0` disables; see below the table |
| `signedUrls.defaultGetTtlSeconds` | `number`                                       | `300`             | Default TTL for `getDownloadUrl`               |
| `signedUrls.defaultPutTtlSeconds` | `number`                                       | `300`             | Default TTL for `getUploadUrl`                 |
| `signedUrls.maxTtlSeconds`     | `number`                                          | `604800`          | Per-request TTLs above this are clamped; a larger value is reduced to 604800 (the 7-day SigV4 limit) at init |
| `multipart.thresholdBytes`     | `number`                                          | `5 MiB`           | Switch to multipart at or above this size      |
| `multipart.partSizeBytes`      | `number`                                          | `5 MiB`           | Part size (S3 minimum: 5 MiB)                  |
| `multipart.queueSize`          | `number`                                          | `4`               | Concurrent parts                               |
| `validation.mimeWhitelist`     | `string[]`                                        | —                 | No MIME check when absent. Wildcards: `'image/*'`. A value that lists several types never matches |
| `validation.maxSizeBytes`      | `number`                                          | —                 | Maximum upload size in bytes; counted as a stream is read, so it holds with or without `size` |

> **Do not use `maxRetries` or `signatureVersion`** — these are AWS SDK v2 options that do not exist in v3. The v3 SDK is SigV4-only. Use `maxAttempts` (default `3`) for retry configuration.

**`requestTimeoutMs`** is passed to the S3 client's request handler as `requestTimeout` with `throwOnRequestTimeout` ([AWS SDK for JavaScript v3: `requestHandler: { requestTimeout: 3_000, ... }`][sdk-request-timeout]). It bounds one attempt, from sending the request until the response headers arrive, and an upload body counts toward it, so a large single-shot upload on a slow link needs a larger value. It does not limit reading a download stream; `bodyIdleTimeoutMs` does. With `maxAttempts` above 1 a stalled request is retried, so the total wait is the timeout times the attempts.

**`uploadIdleTimeoutMs`** covers what `requestTimeoutMs` cannot: a multipart upload waiting for the next bytes of a stream has no request in flight, so a source that stops delivering would hold the upload open on the provider indefinitely. After this much silence the upload is aborted (the provider is sent `AbortMultipartUpload`), your stream is destroyed and `upload()` rejects with `STORAGE_TIMEOUT` and `details.phase` set to `'source-idle'`. The clock restarts on every chunk and runs only while the library is waiting for data, so a slow but live source succeeds and a slow provider does not trip it. It defaults to the value of `requestTimeoutMs`; `0` turns it off. It applies only to a stream on the multipart path: a single-shot upload is bounded by `requestTimeoutMs`, and a `Buffer` cannot stall.

**`bodyIdleTimeoutMs`** covers the other direction: `requestTimeoutMs` ends when the response headers arrive, so a provider that stops sending in the middle of a download would leave the stream, its connection and the caller waiting without limit. After this much silence while a read is pending, the stream fails with `STORAGE_TIMEOUT` and `details.phase` set to `'body-idle'`, and the connection is released. The clock runs only while the caller is waiting for data, so a consumer that is slow to read, for example a response piped to a slow client, never trips it, and every chunk restarts it. It defaults to the value of `requestTimeoutMs`; `0` turns it off. It applies to `download` and `downloadBuffer`.


[aws-presigned-expiry]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
[aws-get-object]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
[aws-head-object]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
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

**Header values.** Every caller string that becomes an HTTP header or a signed query value —
`contentType`, `cacheControl`, `contentDisposition`, `kmsKeyId`, the keys and values of `metadata`,
`range`, `ifMatch`, `ifNoneMatch`, and `responseContentDisposition` / `responseContentType` on a
signed GET — may hold only tab, space and printable ASCII. Anything else, a line break included, fails
with `STORAGE_VALIDATION_FAILED` before any request, whether or not `validation.mimeWhitelist` is set;
`details` names the field and the reason, never the value. With a whitelist set it is consulted first,
so a `contentType` it does not allow, a malformed one included, fails as `STORAGE_MIME_NOT_ALLOWED`. A
`metadata` key must also be a non-empty header name: letters, digits and the characters
``!#$%&'*+-.^_`|~``. To send a non-ASCII filename, percent-encode it as RFC 6266 `filename*`:
`contentDisposition: "attachment; filename*=UTF-8''caf%C3%A9.pdf"`. Percent-encode non-ASCII
`metadata` values yourself (`encodeURIComponent`) and decode them when you read them.

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

**The library owns a `Readable` once you pass it to `upload()`**, as with `stream.pipeline`. When the upload is rejected for any reason, the stream is destroyed without an error, which releases the file handle or socket behind it: a listener on the stream sees `'close'`, and the failure is the rejection of `upload()`. A call answered from the idempotency cache destroys the stream unread. Do not reuse a stream you passed in; open a new one to retry. No listener on the stream is needed to avoid an unhandled `'error'` event.

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

A repeated upload is answered from the cache only while this instance still believes the object
exists: `delete()` and `deleteMany()` drop the entries of the objects they remove, so uploading
again after a delete stores the object again. The cache is **per instance**. A delete made by
another replica, or outside this library, does not reach it, and there a repeated upload can be
answered with a success for an object that no longer exists.

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

> **Caveat:** a signed PUT bypasses the library's local size validation and custom validators. The `contentType` you pass is signed, so it is the type that gets stored and a PUT with another type is refused. When `validation.mimeWhitelist` is set, `getUploadUrl` and `getMultipartUploadUrls` refuse a `contentType` outside it with `STORAGE_MIME_NOT_ALLOWED`, so a type taken from the client cannot get a URL the whitelist forbids. No size limit is bound into the signature — `maxSizeBytes` is advisory — so verify the size with a `HEAD` check after upload and add an `IFileScanner` post-upload hook.

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

**Streams in pre-upload mode.** A stream can be read once, so in `pre-upload` mode it is first read
into memory, bounded by `validation.maxSizeBytes`, and the scanner and the upload share that buffer. A
stream longer than the limit is refused with `STORAGE_VALIDATION_FAILED` as soon as it passes it, and
with no `maxSizeBytes` it is refused with a reason that says to set it or use `post-upload`. Buffer
bodies are not affected, and `post-upload` hands the scanner the key only, no body.

**A rejected object that could not be removed.** In `post-upload` mode the object is already stored
when the scanner rejects it, so the library deletes it and rejects `upload()` with the verdict
(`STORAGE_SCAN_INFECTED` or `STORAGE_SCAN_INCONCLUSIVE`). If that delete fails the verdict is still the
error, and `details` carries `cleanup: 'failed'`, the `key` you passed, the `storedKey` (with any
`keyPrefix`, as a bucket listing shows it) and the delete failure in `cleanupError`; the failure is
also logged at error level as `STORAGE_SCAN_CLEANUP_FAILED`. With no `details.cleanup` the object was
removed; with `cleanup: 'failed'` it is **still stored** and has to be removed by other means.

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

`BucketLifecycleService` reads, adds, replaces and removes one expiration rule or one multipart-abort
rule by id. Every other rule in the bucket, and the `TransitionDefaultMinimumObjectSize` setting when
the provider reports it, is sent back unchanged.

```typescript
import { BucketLifecycleService } from '@bymax-one/nest-storage'

// Expire everything under `expiring/` seven days after creation.
await lifecycle.upsert({ id: 'expire-tmp', prefix: 'expiring/', expirationDays: 7 })

// Abort multipart uploads that were never completed, so their parts stop costing storage.
await lifecycle.upsert({ id: 'abort-stale', prefix: 'uploads/', abortIncompleteMultipartDays: 7 })

const rules = await lifecycle.get() // [] when the bucket has no configuration

const removed = await lifecycle.remove('expire-tmp') // true; false when no rule has that id
```

- **Read-modify-write, not atomic.** `PutBucketLifecycleConfiguration` replaces the whole
  configuration ([AWS: "this will overwrite an existing lifecycle configuration"][aws-put-lifecycle]),
  so `upsert` and `remove` read the rules, change the one with the given id (replaced in place, or
  appended when new) and write them all back. S3 has no conditional write for it, so a change made by
  another writer between the read and the write is overwritten: run lifecycle changes from one place.
- **Removing the last rule deletes the configuration**, because a put with no rules is invalid.
- **`prefix` is relative to `keyPrefix`**, the way `list()` keys are, and `get()` returns filter
  prefixes relative too, so `upsert({ prefix: rule.Filter.Prefix, ... })` on a value read from `get()`
  does not prefix twice. The deprecated rule-level `Prefix` is treated like `Filter.Prefix`.
- **Rules outside `keyPrefix` are read-only.** With a `keyPrefix` set, a rule whose filter prefix does
  not start with it (another application's, tag-only, or whole-bucket) is returned as stored with
  `isOutsideKeyPrefix: true`; `upsert` and `remove` refuse its id with `STORAGE_LIFECYCLE_RULE_INVALID`,
  and every write sends it back field for field.
- **Two rule kinds.** An input has exactly one of `expirationDays` (delete objects under the prefix
  after N days) and `abortIncompleteMultipartDays` (abort uploads not completed within N days of
  starting; [AWS: "Specifies the number of days after which Amazon S3 aborts an incomplete multipart
  upload"][aws-abort-mpu]). A rule with the same id is replaced, whichever kind it was.
- **Validated before any request.** `id` is 1 to 255 characters, the day count an integer of at least
  1, and `prefix` passes the key guard. An expiration rule needs a non-empty prefix; a multipart-abort
  rule may have an empty one, meaning every upload in the module's namespace, because aborting deletes
  no object. A bad input throws `STORAGE_LIFECYCLE_RULE_INVALID`.
- **Typed provider errors.** `STORAGE_LIFECYCLE_UNSUPPORTED` (501) when the provider lacks the API,
  `STORAGE_LIFECYCLE_REJECTED` (422) when it refuses the configuration; `details` carries the
  provider's code, status and request id, never the caught error.

**Provider support**

| Provider                                   | Status                | Basis |
| ------------------------------------------ | --------------------- | ----- |
| MinIO (tested with the `pgsty/silo` image) | **Verified**          | The end-to-end suite applies an expiration rule and keeps unrelated rules through upsert, replace and remove. It does not accept a multipart-abort rule: the server answers HTTP 400 `InvalidArgument`, typed as `STORAGE_LIFECYCLE_REJECTED`, and the existing rules stay as they were. |
| Cloudflare R2                              | **Verified (docs)**   | R2 documents the lifecycle calls and multipart-abort rules ([R2 object lifecycles][r2-lifecycles]); this repository does not run them against R2. |
| AWS S3                                     | Documented, not run   | Follows the S3 API reference ([Put][aws-put-lifecycle], [Get][aws-get-lifecycle], [Delete][aws-delete-lifecycle]); no test here hits AWS. |
| Backblaze B2, DigitalOcean Spaces, Wasabi  | **Unverified**        | Neither documented nor tested here. A provider without the API surfaces as `STORAGE_LIFECYCLE_UNSUPPORTED`. |

Expiry timing is the provider's: R2 states that objects "will typically be removed from a bucket
within 24 hours" of their expiry, and MinIO's scanner runs at low priority, so an object can outlive
its rule period.

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
| `STORAGE_MIME_NOT_ALLOWED`       | 415  | `contentType` outside `mimeWhitelist`, at upload or at presign                                                                                                                                                                            |
| `STORAGE_SIZE_EXCEEDED`          | 413  | `size > maxSizeBytes`                                                                                                                                                                                              |
| `STORAGE_VALIDATION_FAILED`      | 400  | `IUploadValidator` rejected the file, or a header-bound value is not a header value (`details.field`, `details.reason`)                                                                                                                                                            |
| `STORAGE_SCAN_INFECTED`          | 422  | Scanner returned `'infected'` (`details.threat`); `details.cleanup: 'failed'` means the object is still stored                                                                                                    |
| `STORAGE_SCAN_INCONCLUSIVE`      | 422  | Scanner returned `'unknown'` and `rejectOnUnknown: true`                                                                                                                                                           |
| `STORAGE_OBJECT_NOT_FOUND`       | 404  | `head()`, `download()`, or `copy()` on a nonexistent key                                                                                                                                                           |
| `STORAGE_PROVIDER_ERROR`         | 502  | AWS SDK error (network, 5xx, throttling, `AccessControlListNotSupported`); `details` carries `awsCode`, `awsMessage`, `httpStatus`, `requestId` plus the operation context (`op`, `bucket`, and `key` or `prefix`) |
| `STORAGE_SIGNED_URL_TTL_INVALID` | 400  | Per-request `ttlSeconds` ≤ 0                                                                                                                                                                                       |
| `STORAGE_PART_TOO_SMALL`         | 400  | Never thrown: a `multipart.partSizeBytes` below 5 MiB fails at init as `STORAGE_INVALID_CONFIG`                                                                                                                                                                             |
| `STORAGE_INVALID_PART_COUNT`     | 400  | `getMultipartUploadUrls()` with `parts` not an integer from 1 to 10 000 (`details.provided`, `details.reason`)                                                                                                                                                  |
| `STORAGE_BUCKET_UNDEFINED`       | 400  | Operation without a bucket and no default in config                                                                                                                                                                |
| `STORAGE_MULTIPART_ABORTED`      | 500  | A multipart upload failed. `details.abort` is `'completed'` when the library aborted it, `'failed'` (with `abortError`) when the abort itself failed: that upload then stays open on the provider until a lifecycle rule removes it |
| `STORAGE_INVALID_CONFIG`         | 500  | `BymaxStorageModuleOptions` validation failed at initialization                                                                                                                                                    |
| `STORAGE_TIMEOUT`                | 504  | An attempt got no response headers within `requestTimeoutMs`, a multipart source stayed silent for `uploadIdleTimeoutMs` (`details.phase: 'source-idle'`), or a download body stayed silent for `bodyIdleTimeoutMs` (`details.phase: 'body-idle'`)                                                                                                                                                                                |
| `STORAGE_LIFECYCLE_RULE_INVALID` | 400  | `BucketLifecycleService` input rejected: bad `id`, day count or `prefix`, or an id naming a rule outside `keyPrefix` (`details.reason`) |
| `STORAGE_LIFECYCLE_UNSUPPORTED` | 501  | The provider does not implement the lifecycle API |
| `STORAGE_LIFECYCLE_REJECTED` | 422  | The provider refused the lifecycle configuration |
| `STORAGE_BUCKET_NOT_FOUND`       | 404  | The provider answered `NoSuchBucket` (any operation that gets an error body: `download()`, `upload()`, `list()`, `copy()`, `delete()`), or `checkBucket()` got a 404 |
| `STORAGE_BUCKET_ACCESS_DENIED`   | 403  | `checkBucket()` got a 403: the credentials cannot use the bucket, or it does not exist and the credentials cannot list (S3 answers 403 to a caller without `s3:ListBucket`) |
| `STORAGE_BUCKET_REGION_MISMATCH` | 500  | `checkBucket()` got a 301 or `PermanentRedirect`: the bucket lives in another region than the configured one |
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

## 🚫 What This Library Does NOT Do

- **Detect a file's real type.** The MIME check reads the declared `Content-Type` only; plug in an
  `IUploadValidator` with a `readBytes(n)` magic-byte check for untrusted sources ([Validation](#-validation)).
- **Bound a signed PUT.** A signed URL skips local size validation and custom validators, and no size
  limit is signed into it ([Presigned PUT](#presigned-put-direct-browser-upload)).
- **Isolate tenants.** `keyPrefix` is a namespace, not an access boundary ([Security Model](#-security-model)).
- **Share state between replicas.** The idempotency cache is per instance.
- **Complete or abort a presigned multipart upload.** The client sends the part ETags to `completeUrl`
  and aborts with its own signed request ([Presigned Multipart](#presigned-multipart)).
- **Make ACLs work everywhere.** `publicRead` fails on modern AWS S3 and is a no-op on R2
  ([Public Access / ACLs](#public-access--acls)).
- **Lock lifecycle writes.** Changes are read-modify-write and not atomic.
- **Wrap every S3 operation.** Provider-specific calls go through the raw `S3Client`
  ([Raw S3Client](#raw-s3client-advanced)).

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

Options are validated before any client is built. Credentials are the deliberate exception: empty
values are tolerated so a development workflow boots, and operations then fail with
`STORAGE_NOT_CONFIGURED`.

---

## 🔐 Security Model

This library turns caller input into object keys, signs URLs that grant access on their own, and holds
the credentials for a bucket. Its contract covers what a key can reach, how long a signature lives,
and what leaves in an error.

### The object key is the attack surface

Everything a caller sends becomes part of a key, and a key is a path. `KeyResolverService.normalize`
is the single chokepoint: it refuses an empty key, a null byte, a leading `/` and any `..` segment,
collapses duplicate slashes, and only then prepends `keyPrefix`, so a tenant cannot climb out of its prefix by naming one.

### Presigned URLs are bearer credentials

Anyone holding one has the access it encodes until it expires, so treat it like a password with an
expiry, not like a link. Its lifetime is capped by `signedUrls.maxTtlSeconds` (see
[Signed URLs](#-signed-urls-get--put--multipart)), and it must never be logged.

### Credentials stay where they were put

They arrive through module options and are handed to the SDK. This library never reads `process.env`,
never logs them, and never places them — or a signed URL — in an exception.

They are also not reachable by serializing the objects that hold them. The resolved options are
injected into every service, so `credentials` is attached as a non-enumerable accessor:
`JSON.stringify`, object spread and `util.inspect` (with or without `showHidden`) all omit it, which
is what a structured logger or an error reporter capturing a scope would otherwise pick up. Reading it
on purpose is unchanged.

### Error payloads carry the operation, and that includes the key

`details` holds the provider's error code and message, the HTTP status, the request id, and the
operation context the call site supplies: the operation, the bucket, and the resolved key or prefix.
That is enough to diagnose a failure, and it means an object key reaches whatever consumes the
exception, so if a key is itself sensitive in your deployment, do not log the envelope verbatim.

### `keyPrefix` is a namespace, not an access boundary

It scopes the keys this library composes; it does not restrict what the credentials can reach. Anything
holding the bucket's credentials can read every prefix in it. Isolation that must survive a compromised
client belongs in IAM policies or separate buckets.

It is also fixed when the module is registered: `forRoot` resolves one prefix, and the module is
`@Global()` with one `StorageService` behind fixed injection tokens, so it is not designed to be
registered twice in one application with different prefixes. To keep tenants apart in one application,
build the tenant segment into the key on each call from a trusted source (`tenants/${tenantId}/${name}`,
never from request input) or give each tenant its own bucket and credentials.

---

## 🛡️ Security Table

| Layer            | Control                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Object keys      | One guard: `..`, a leading `/`, null bytes and empty keys refused before `keyPrefix` is prepended    |
| Multi-tenancy    | `keyPrefix` is a namespace, not an access boundary; isolate with IAM policies or separate buckets     |
| Credentials      | Injected options only; never read from `process.env`, never logged, never in an exception             |
| Error payloads   | Provider code and message, status, request id and operation context; never credentials or a signed URL |
| Presign lifetime | TTL capped by `signedUrls.maxTtlSeconds`                                                              |
| Header values    | Tab, space and printable ASCII only; refused with `STORAGE_VALIDATION_FAILED` before any request      |
| Encryption       | Server-side (AES256 / `aws:kms`), globally or per upload                                              |
| Content          | MIME allowlist and size limit, then registered validators, then the scanner                           |
| Supply chain     | `dependencies: {}`; see the repository's CI workflows for the scanners that run on it                 |

---

## 🧱 Tech Stack

![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![AWS SDK v3](https://img.shields.io/badge/AWS%20SDK-v3%20(peer)-FF9900?style=flat-square&logo=amazons3&logoColor=white)
![TypeScript 5 strict](https://img.shields.io/badge/TypeScript-5%20strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![tsup](https://img.shields.io/badge/build-tsup-000000?style=flat-square)
![Jest 30](https://img.shields.io/badge/tests-Jest%2030-C21325?style=flat-square&logo=jest&logoColor=white)
![Testcontainers](https://img.shields.io/badge/e2e-Testcontainers%20%2B%20MinIO-9B1D20?style=flat-square)
![Stryker](https://img.shields.io/badge/mutation-Stryker-E74C3C?style=flat-square)

---

## 🧪 Testing & Quality

- ✅ **100% coverage** — statements, branches, functions and lines, enforced as a gate
- ✅ **100% mutation score** — [Stryker](https://stryker-mutator.io/) at `break: 100`
- ✅ **Real object storage in e2e** — MinIO through Testcontainers, so multipart, presigning and
  listing are exercised against an actual S3 API rather than a mock
- ✅ **Published-artifact gates** — `check:exports` resolves the types the way each module system
  does, `check:runtime` loads every subpath from the packed tarball in ESM and CommonJS, and
  `check:published` compiles this README's snippets against `dist/`
- ✅ **Every suppression is justified** — no coverage directives anywhere; each `// Stryker disable`
  comment in the production source names why its mutant is provably equivalent, and `check:mutants`
  proves the reason is written in the grammar Stryker parses, so the mutation report carries it in full

---

## 📖 API Reference

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
| `delete`         | `(key, options?) => Promise<void>`                            | Idempotent for a missing object, as S3 delete is; a missing bucket rejects `STORAGE_BUCKET_NOT_FOUND` |
| `deleteMany`     | `(keys: string[], options?) => Promise<DeleteManyResult>`     | Partial failures are reported, not thrown                    |
| `list`           | `(options: ListOptions) => Promise<ListResult>`               | Paginated by continuation token                              |
| `copy`           | `(options: CopyOptions) => Promise<{ etag }>`            | Server-side; the bytes never reach this process              |
| `checkBucket`    | `(options?) => Promise<void>`                                 | One `HeadBucket` for a readiness check; resolves when the bucket is reachable, otherwise rejects `STORAGE_BUCKET_NOT_FOUND`, `STORAGE_BUCKET_ACCESS_DENIED`, `STORAGE_BUCKET_REGION_MISMATCH` or `STORAGE_TIMEOUT`; needs `s3:ListBucket`; never called at boot |

> **`exists()` returns `false` for any failure that is not a 404** (a 403, a 5xx, a timeout), after
> logging a warning, so a transient provider error reads as "absent". Do not use it to decide whether
> to overwrite or to create (`if (!(await exists(k))) await upload(k)` can overwrite an object
> that is there); use `head()` and branch on the error code.

**A missing bucket and `head()` / `exists()`.** A `HEAD` response has no body, so the provider cannot say which of the bucket and the key is missing: AWS documents that "if the `HEAD` request generates an error, it returns a generic code, such as `400 Bad Request`, `403 Forbidden`, `404 Not Found` ... It's not possible to retrieve the exact exception of these error codes" ([HeadObject][aws-head-object]). `head()` therefore rejects `STORAGE_OBJECT_NOT_FOUND` and `exists()` returns `false` for a missing bucket too. Call `checkBucket()` to tell the two apart, for example from a readiness endpoint.

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
| `upsert` | `(rule: LifecycleRuleInput, options?) => Promise<void>`                | Read-modify-write; replaces the rule with the same id, keeps the rest   |
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
  `get()` returns), `LifecycleRuleInput` (`ExpirationRuleInput` or `AbortMultipartRuleInput`) and
  `LifecycleBucketOptions` (`{ bucket? }`).
- **Extension points:** `IUploadValidator`, `IFileScanner`, `FileScanResult`, and the helpers
  `NoOpUploadValidator` and `NoOpFileScanner`.
- **From `./shared`:** `UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`,
  `StorageErrorResponse`, `StorageErrorCode`, `STORAGE_ERROR_CODES`, the MIME presets
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
them, and they are in the module's `exports`, so injection resolves rather than raising
`UnknownDependenciesException`. Some are nullable by design: `BYMAX_STORAGE_S3_CLIENT`
is `null` until credentials are configured, and `BYMAX_STORAGE_FILE_SCANNER` is `null` when no
scanner is set, which is the default. Type them as `S3Client | null` and `IFileScanner | null`.

---

## 🤝 Contributing

Pull requests are welcome. Please open an issue first for significant changes.

- Run `pnpm test:cov` and `pnpm lint` before opening a PR.
- Use Conventional Commits for commit messages.

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
