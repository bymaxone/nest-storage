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

- ✅ **Multipart upload** — `@aws-sdk/lib-storage` with an abort on failure that the library runs
  itself, progress events, and a configurable threshold and part size
- ✅ **Content validation** — MIME allowlist with wildcards (`image/*`) and a size limit, then any
  number of `IUploadValidator`s, all refused before a byte is stored
- ✅ **Virus scanning hook** — `IFileScanner` pre-upload or post-upload, for ClamAV, AWS Macie or
  anything that answers `'clean' | 'infected' | 'unknown'`
- ✅ **Idempotent retries** — a bounded in-memory LRU with a TTL returns the cached
  `UploadResult` for a repeated `idempotencyKey`
- ✅ **Presigned GET / PUT / multipart** — the PUT signs the `Content-Type` (and the ACL and metadata, when set; the metadata pairs travel in the signed query string, so the client does not send them as headers), so a PUT that sends another type is refused and stores nothing; multipart gets one signed URL per part, so a browser uploads directly
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
- ✅ **Metrics, readiness and spans** — an optional `./observability` subpath publishes Prometheus
  metrics and a bucket readiness check; spans start when `@opentelemetry/api` is installed. Labels are
  closed sets: no key, bucket or prefix is ever a label
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

| Subpath    | Contents                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | Server runtime: `BymaxStorageModule`, `StorageService`, `SignedUrlService`, `BucketLifecycleService`, `providerRecipes`, DI tokens, interfaces, `StorageException`, `NoOpUploadValidator`, `NoOpFileScanner` |
| `./observability` | Optional: `StorageMetrics` (Prometheus metrics), `StorageHealthIndicator` (readiness of the bucket) |
| `./shared` | Framework-free types (`UploadResult`, `ObjectMetadata`, `ListedObject`, `SignedUrlResult`, `StorageErrorResponse`) + `STORAGE_ERROR_CODES` + `StorageErrorCode` + the default MIME whitelists and the TTL and multipart default constants                                            |

The root re-exports some `./shared` names for convenience; import the rest from the subpath.

All subpaths ship ESM **and** CommonJS with declarations for each format, so a
`require()` consumer receives CommonJS declarations rather than ESM ones. The
`pnpm check:exports` gate verifies this against the packed tarball.

### Peer dependency matrix

| Subpath      | Required peers                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.` (server) | `@nestjs/common ^11.0.16`, `@nestjs/core ^11.1.18`, `@aws-sdk/client-s3 ^3.700`, `@aws-sdk/lib-storage ^3.700`, `@aws-sdk/s3-request-presigner ^3.700`, `reflect-metadata ^0.2`; optional: `@opentelemetry/api ^1.9` (the spans start only when it is installed) |
| `./observability` | The peers of `.`, and `prom-client ^15` for the metrics; `@bymax-one/nest-core >=1.6.15` is how a host discovers the two classes. `prom-client` and `@bymax-one/nest-core` are optional for the package, needed only to use this subpath |
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
| `endpoint`                     | `string`                                          | —                 | Required. S3-compatible endpoint URL; it must not carry credentials (`https://user:pass@host` is refused), pass them in `credentials` |
| `region`                       | `string`                                          | —                 | Required. Provider region or `'auto'` (R2): 1 to 63 letters, digits, `.`, `_` or `-`, starting with a letter or digit |
| `bucket`                       | `string`                                          | —                 | Default bucket (can be overridden per-call by a string; any other per-call kind fails with `STORAGE_VALIDATION_FAILED`) |
| `credentials`                  | `{ accessKeyId, secretAccessKey, sessionToken? }` | —                 | Load from env / Secrets Manager                |
| `forcePathStyle`               | `boolean`                                         | `false`           | Set to `true` for MinIO and self-hosted        |
| `publicBaseUrl`                | `string`                                          | —                 | Base URL for public `getPublicUrl()` results; it must not carry credentials (a user or password is refused) |
| `cdnBaseUrl`                   | `string`                                          | —                 | CDN edge URL (preferred over `publicBaseUrl`); it must not carry credentials either |
| `keyPrefix`                    | `string`                                          | —                 | Prepended to every key before it reaches the provider; fixed per module instance. A value that is not a string fails `forRoot`; `null` is read as unset |
| `maxAttempts`                  | `number`                                          | `3`               | SDK v3 retry count; an integer of at least `1` |
| `serverSideEncryption`         | `'AES256' \| 'aws:kms'`                           | —                 | Global SSE policy; `aws:kms` needs `kmsKeyId`. `'NONE'` is accepted per upload only |
| `requestChecksumCalculation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `responseChecksumValidation`   | `'WHEN_SUPPORTED' \| 'WHEN_REQUIRED'`             | SDK default       | Set to `'WHEN_REQUIRED'` for non-AWS providers |
| `defaultPublicRead`            | `boolean`                                         | `false`           | ACL `public-read` on uploads; see Public Access / ACLs |
| `defaultCacheControl`          | `string`                                          | `public, max-age=31536000, immutable` | Default `Cache-Control` on uploads |
| `defaultContentDisposition`    | `'inline' \| 'attachment'`                        | `inline`          | Default `Content-Disposition` on uploads       |
| `requestTimeoutMs`             | `number`                                          | `30000`           | Per attempt, until the response headers arrive; an integer from `1` to `2147483647`; see below the table |
| `uploadIdleTimeoutMs`          | `number`                                          | `30000`           | Longest silence from a stream body during a multipart upload; follows `requestTimeoutMs` unless set, `0` disables, at most `2147483647`; see below the table |
| `bodyIdleTimeoutMs`            | `number`                                          | `30000`           | Longest silence from a download body while the caller is reading it; follows `requestTimeoutMs` unless set, `0` disables, at most `2147483647`; see below the table |
| `signedUrls.defaultGetTtlSeconds` | `number`                                       | `300`             | Default TTL for `getDownloadUrl`               |
| `signedUrls.defaultPutTtlSeconds` | `number`                                       | `300`             | Default TTL for `getUploadUrl`                 |
| `signedUrls.maxTtlSeconds`     | `number`                                          | `604800`          | Per-request TTLs above this are clamped; a larger value is reduced to 604800 (the 7-day SigV4 limit) at init |
| `multipart.thresholdBytes`     | `number`                                          | `5 MiB`           | Switch to multipart at or above this size      |
| `multipart.partSizeBytes`      | `number`                                          | `5 MiB`           | Part size (S3 minimum: 5 MiB)                  |
| `multipart.queueSize`          | `number`                                          | `4`               | Concurrent parts                               |
| `scanner.impl`                 | `IFileScanner`                                    | —                 | The scanner. Without it no scan runs; an object with a `scan` function, see Virus Scanning |
| `scanner.mode`                 | `'pre-upload' \| 'post-upload'`                   | `'pre-upload'`    | When the scan runs: before the bytes are stored, or after, on the stored key |
| `scanner.rejectOnUnknown`      | `boolean`                                         | `false`           | `true` rejects an inconclusive (`'unknown'`) scan; `false` lets it through with a warning |
| `scanner.timeoutMs`            | `number`                                          | `60000`           | Deadline of one scan; a whole number from `1` to `2147483647`; past it the upload is refused with `STORAGE_TIMEOUT` |
| `validation.mimeWhitelist`     | `string[]`                                        | —                 | No MIME check when absent. Wildcards: `'image/*'`. A value that lists several types never matches. An array of strings: any other kind fails `forRoot`, and `null` is refused (omit it to allow every type) |
| `validation.maxSizeBytes`      | `number`                                          | —                 | Maximum upload size in bytes; counted as a stream is read, so it holds with or without `size`. `null` is refused: omit it for no limit |
| `validation.customValidators`  | `IUploadValidator[]`                              | —                 | Run in order before the upload. An array of objects that each have a `validate` function: any other kind, or an entry that is not such an object, fails `forRoot`; `null` is refused (omit it to run none) |

**Option groups are objects.** `signedUrls`, `multipart` and `validation` are each an object, or left out (`null` is read as left out). `false`, `0`, a string, `true` or an array fails `forRoot` with `STORAGE_INVALID_CONFIG` naming the group and repeating nothing of the value: ignoring it would boot without the protection that a toggle such as `validation: enabled && { ... }` was meant to switch on.

**Numeric options are whole numbers, checked at boot.** `validation.maxSizeBytes`, the `signedUrls` TTLs and `multipart.thresholdBytes` take a whole number of at least `1`; `multipart.partSizeBytes` takes one from 5 MiB (the S3 minimum) to 5 GiB (the S3 maximum) and `multipart.queueSize` one from `1` to `1000`. `NaN`, `Infinity`, a fraction, a string or a value out of range fails `forRoot` with `STORAGE_INVALID_CONFIG` naming the option: a comparison alone lets `NaN` through, and `NaN` on a size limit would turn the limit off. The same holds per call: a `ttlSeconds` that is not a whole number above `0` fails with `STORAGE_SIGNED_URL_TTL_INVALID`, and a declared upload `size` or a list `maxKeys` that is not a whole number (at least `0`, and at least `1`) fails with `STORAGE_VALIDATION_FAILED` naming the field, before any request is made. A key set to `undefined` or `null` inside `signedUrls`, `multipart`, `validation` or `scanner` means the default, except `scanner.impl` and the `validation` options named below, which refuse `null`. The per-call values are refused on `null`, and the error for a TTL echoes no value but a finite number. Where leaving an option out means a limit or a protection is off, `null` is refused for it as well, so a config lookup that returns `null` for a missing key cannot switch it off: `validation.maxSizeBytes`, `validation.mimeWhitelist` and `validation.customValidators` (the last must be an array).

**Flags are booleans.** `defaultPublicRead` and `forcePathStyle` take `true` or `false`; `null`, a number, an object or a string fails `forRoot` with `STORAGE_INVALID_CONFIG` naming the option. A string from an environment variable is the case this stops: `'false'` is truthy, and read as a flag it would make every upload `public-read`. Compare the variable to `'true'` and pass the boolean. A per-call `publicRead` that is set and is not a boolean fails that call with `STORAGE_VALIDATION_FAILED` (`details.field: 'publicRead'`) before any request.

**Lists are bounded.** `validation.mimeWhitelist` and `validation.customValidators` hold at most `1000` entries. A longer array, or one whose `length` is not a whole number from `0` to `1000`, fails `forRoot` with `STORAGE_INVALID_CONFIG` before any entry is read; a whitelist that long can use a wildcard such as `'image/*'`.

**An option that cannot be read fails `forRoot` and `forRootAsync` too.** A getter or a Proxy of yours that throws when the library reads it fails with `STORAGE_INVALID_CONFIG` and `reason: 'the options could not be read'`. What you threw is the `cause` of the exception and none of its text is in the response body, so a message that names a secret does not reach a client.

> **Do not use `maxRetries` or `signatureVersion`** — these are AWS SDK v2 options that do not exist in v3. The v3 SDK is SigV4-only. Use `maxAttempts` (default `3`) for retry configuration.

**`requestTimeoutMs`** is passed to the S3 client's request handler as `requestTimeout` with `throwOnRequestTimeout` ([AWS SDK for JavaScript v3: `requestHandler: { requestTimeout: 3_000, ... }`][sdk-request-timeout]). It bounds one attempt, from sending the request until the response headers arrive, and an upload body counts toward it, so a large single-shot upload on a slow link needs a larger value. It does not limit reading a download stream; `bodyIdleTimeoutMs` does. With `maxAttempts` above 1 a stalled request is retried, so the total wait is the timeout times the attempts.

**`uploadIdleTimeoutMs`** covers what `requestTimeoutMs` cannot: a multipart upload waiting for the next bytes of a stream has no request in flight, so a source that stops delivering would hold the upload open on the provider indefinitely. After this much silence the upload is aborted (the provider is sent `AbortMultipartUpload`), your stream is destroyed and `upload()` rejects with `STORAGE_TIMEOUT` and `details.phase` set to `'source-idle'`. The clock restarts on every chunk and runs only while the library is waiting for data, so a slow but live source succeeds and a slow provider does not trip it. It defaults to the value of `requestTimeoutMs`; `0` turns it off. It applies only to a stream on the multipart path: a single-shot upload is bounded by `requestTimeoutMs`, and a `Buffer` cannot stall.

**`bodyIdleTimeoutMs`** covers the other direction: `requestTimeoutMs` ends when the response headers arrive, so a provider that stops sending in the middle of a download would leave the stream, its connection and the caller waiting without limit. After this much silence while a read is pending, the stream fails with `STORAGE_TIMEOUT` and `details.phase` set to `'body-idle'`, and the connection is released. The clock runs only while the caller is waiting for data, so a consumer that is slow to read, for example a response piped to a slow client, never trips it, and every chunk restarts it. It defaults to the value of `requestTimeoutMs`; `0` turns it off. It applies to `download` and `downloadBuffer`. A body that fails after its headers arrived (a reset connection) ends as a `StorageException` like any other failure of the provider (`STORAGE_PROVIDER_ERROR`, **503** when the connection was cut); with the guard off only `download()` is the exception, its stream being the SDK's own and so erroring with the SDK's own error, while `downloadBuffer()` is mapped in both modes.


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
`metadata` values yourself (`encodeURIComponent`) and decode them when you read them. `metadata` is an object of pairs: a `Map`, an array, a string or `null` fails with `STORAGE_VALIDATION_FAILED` before any request.

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

`onProgress` receives `{ loaded, total?, part? }`: the bytes sent so far, the total when it is known, and the
part number on a multipart upload. A single-shot upload reports once, when it ends; a multipart upload reports
as each part is sent.
A hook that throws, or an async one that rejects, is ignored: the upload still resolves with its result and the process is not ended.

Uploads are automatically routed to multipart when `size >= multipart.thresholdBytes` (default 5 MiB). A `Readable` without a `size` always uses multipart. A failed multipart upload is aborted by the library, which tells the SDK to leave the parts (`leavePartsOnError: true`) and runs `AbortMultipartUpload` itself, so an abort that fails cannot replace the error that caused it; the outcome (`completed` or `failed`) is in the error's `details.abort`.

**What `body` may be.** A `Buffer`, a `Uint8Array`, an `ArrayBuffer`, a string or a Node `Readable`. Anything else (a `Blob`, an array of chunks, a plain object) fails with `STORAGE_VALIDATION_FAILED` (`details.field: 'body'`) before any request; it used to reach the upload as if it were a stream and fail as `STORAGE_MULTIPART_ABORTED` (500).

**A stream's declared size must be true.** A stream below the multipart threshold is sent as one request that carries `Content-Length` set to `size`, and a provider stores an object as soon as it has received that many bytes. So a body longer than `size` is refused with `STORAGE_SIZE_EXCEEDED` (`details.declaredSize`) before its last byte is sent, and a body shorter than `size` with `STORAGE_VALIDATION_FAILED` (`details.field: 'size'`, `details.declaredSize` and `details.receivedSize`); either way the request is abandoned and nothing is stored. A stream on the multipart path is still refused when it is longer than `size`; a shorter one is uploaded as it is. With a pre-upload scanner the stream is read into memory first, and the same rules apply to the length that was read. A `size` that is not a whole number of at least `0` fails with `STORAGE_VALIDATION_FAILED` before any request.

**The library owns a `Readable` once you pass it to `upload()`**, as with `stream.pipeline`. When the upload is rejected for any reason, the stream is destroyed without an error, which releases the file handle or socket behind it: a listener on the stream sees `'close'`, and the failure is the rejection of `upload()`. A call answered from the idempotency cache destroys the stream unread. Do not reuse a stream you passed in; open a new one to retry. No listener on the stream is needed to avoid an unhandled `'error'` event. The one exception is a call the runtime guard refuses, because code in the same process added a property to `Object.prototype` after the library loaded: it is refused before the library owns the body, so the stream is untouched and you still own it.

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
// Always pass `maxBytes`: without it the whole object is held in memory, however large it is.
const { buffer, metadata } = await this.storage.downloadBuffer({
  key: 'docs/report.pdf',
  maxBytes: 10 * 1024 * 1024,
})
```

`maxBytes` is an integer of at least `1`. An object whose `Content-Length` is larger is refused before its
body is read, and a body that turns out longer (a missing or wrong `Content-Length`) is cut off as it is
counted; both reject `STORAGE_SIZE_EXCEEDED` with `details.maxSize` and release the connection. The limit
is per call and has no default, so a backend that buffers should set it from what it can hold.

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

### Cancelling a call (`abortSignal`)

`upload`, `download`, `downloadBuffer`, `list`, `head`, `exists`, `delete` and `checkBucket` accept an
`abortSignal`. When it aborts, the call rejects `STORAGE_REQUEST_ABORTED` (HTTP 499) with
`details.reason` set to the **name** of the signal's reason (`AbortError`, `TimeoutError`), never its
message, so a host can tell its own timeout from a client disconnect. `exists` rejects too, rather
than answering `false`. A value that is not an `AbortSignal` fails with `STORAGE_VALIDATION_FAILED` naming
`abortSignal` and nothing of the value (`exists` answers `false` and logs a warning for it, as it does for
any failure that is not a missing object).

```typescript
const controller = new AbortController()
req.on('close', () => controller.abort())
await this.storage.upload({
  key: `${folder}/report.pdf`,
  body: buf,
  contentType,
  abortSignal: controller.signal,
})
```

- A signal that is **already aborted** makes no request at all, not even `CreateMultipartUpload`.
- An **upload** that is aborted mid-flight drops its request. For a multipart upload the library
  aborts it on the provider (`AbortMultipartUpload`), and `details.abort` says whether that
  worked. That cleanup runs with a deadline of its own, never the
  caller's signal, which would cancel it. A signal that fires while `CreateMultipartUpload` is in flight does not cancel that request, so the upload id it returns can still be aborted: the library waits for it within the same deadline, and aborts an id that arrives later without keeping the caller waiting.
  As with any rejected upload, **a stream you passed as `body` is destroyed**.
- **Preparing an upload body is watched too**: while a validator reads the head of a stream, or the
  pre-upload scan buffers it, an abort ends the call at once with the same error and destroys the
  stream, even if the stream never delivers another byte.
- A **post-upload scan** that is still running when the signal aborts ends the call too, with the
  same error and `details.stored: true`: the object is already stored. The scan carries on, and an
  object it finds infected is still deleted.
- A **download** body that is being read when the signal aborts errors as `STORAGE_REQUEST_ABORTED`
  while the idle guard is on (the default `bodyIdleTimeoutMs`), and `downloadBuffer()` rejects with it in
  both modes. With `bodyIdleTimeoutMs: 0` the stream `download()` returns is the SDK's own and errors with
  the SDK's own error, whichever it is where the abort lands.
- The library keeps no listener on your signal after a call, so one signal can be reused across many
  calls.
- `copy`, `deleteMany` and the signed-URL methods take no `abortSignal`.

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
    timeoutMs: 60_000,        // refuse the upload when a scan takes longer (default 60000)
  },
})
```

**What your scanner is given.** `scan(input)` receives `mode` (`'pre-upload'` or `'post-upload'`, the configured
`scanner.mode`), the `key` and `bucket` as the provider holds them, the `contentType`, the `size` when known, a
`signal` that aborts at `scanner.timeoutMs`, and a `body` (a `Buffer` or a stream) only when `mode` is
`'pre-upload'`. In `'post-upload'` mode the scanner reads the object itself.

**Streams in pre-upload mode.** A stream can be read once, so in `pre-upload` mode it is first read
into memory, bounded by `validation.maxSizeBytes`, and the scanner and the upload share that buffer. A `Buffer` or `Uint8Array` body is copied once in this mode, so a change the caller makes to its own array while the scan runs reaches neither (the second copy of the body is held until the upload ends, so the body takes twice its size in memory). The library validates and scans the bytes at call time; do not change a buffer you passed until the call settles. A
stream longer than the limit is refused with `STORAGE_VALIDATION_FAILED` as soon as it passes it, and
with no `maxSizeBytes` it is refused with a reason that says to set it or use `post-upload`.
`post-upload` hands the scanner the key only, no body.

**The scanner configuration is checked at boot.** `scanner.impl` must be an object with a `scan` function, `scanner.mode` must be `'pre-upload'` or `'post-upload'` (unset or `null` is `'pre-upload'`) and `scanner.rejectOnUnknown` must be a boolean (unset or `null` is the default); anything else fails `forRoot` with `STORAGE_INVALID_CONFIG`, because a missing implementation or a mode that is neither value would scan nothing. Omit `scanner` for no scanner: a `scanner` of `null` is refused, so a config lookup that returns `null` for a missing key cannot switch scanning off.

**A scan has a deadline.** `scanner.timeoutMs` (a whole number of milliseconds from `1` to `2147483647`, default `60000`; there is no setting that waits without limit) bounds a scan: past it the upload is refused with `STORAGE_TIMEOUT` (503, `details.phase: 'scan'`), and in `post-upload` mode the stored object is removed as for any other rejection. The scanner is handed an `AbortSignal` (`signal` on its input) that aborts at the deadline. **A scanner that ignores the signal keeps running after the timeout**, so repeated timeouts pile up scanner work: honour the signal, or give the scanner a limit of its own. A listener the scanner adds to the signal and that throws is reported by Node as an uncaught exception, as for any event target: it cannot be caught around the abort.

**What counts as a verdict.** Only the exact strings `'clean'`, `'infected'` and `'unknown'` are results. Anything else (no result, `null`, `'CLEAN'`, `' clean'`, an object, a made-up status) is rejected as `STORAGE_SCAN_INCONCLUSIVE` with `details.reason: 'unrecognised scanner status'`, whatever `rejectOnUnknown` says: an object the scanner did not call clean is not stored.

**What a client is told.** `STORAGE_SCAN_INFECTED` carries `details.engine` and `details.threat`, and
`STORAGE_SCAN_INCONCLUSIVE` carries `details.engine`; each name is cut, in the body and in the log, and left out when the scanner gave something that is not a string. A scanner that throws is answered with a 500, and the library logs a `STORAGE_SCAN_FAILED` event with the error under `err` (its message cut) so there is a trace of why; a scan that outlasts `scanner.timeoutMs` is logged as `STORAGE_SCAN_TIMEOUT` with the limit (see [Log events](#-log-events)). The free-form `details` your scanner returns is the
scanner's own text, so it is written to the warning log (escaped and truncated) and never to the
body of the error.

In `post-upload` mode your scanner is given the key and reads the object itself, so another writer that overwrites the same key between your upload and the scan makes the verdict about their object, and an infected verdict deletes the key whichever object it now holds.

**A rejected object that could not be removed.** In `post-upload` mode the object is already stored
when the scanner rejects it, so the library deletes it and rejects `upload()` with the verdict
(`STORAGE_SCAN_INFECTED` or `STORAGE_SCAN_INCONCLUSIVE`). If that delete fails the verdict is still the
error, and `details` carries `cleanup: 'failed'`, the `key` without any `keyPrefix` and the code of the delete
failure in `cleanupError`. The log gets an error entry with `event: 'STORAGE_SCAN_CLEANUP_FAILED'` and the fields `message`, `storedKey`
(the key as the provider holds it, with any `keyPrefix`, as a bucket listing shows it, so an operator can find and remove the
object) and `cleanupFailure` (why the delete failed); the `storedKey` is never in the response. With no `details.cleanup` the object was
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

| Option | Meaning |
| --- | --- |
| `prefix` | Only keys that start with it, after `keyPrefix` |
| `maxKeys` | Page size, a whole number of at least `1`; above `1000` it is lowered to `1000` (the S3 maximum). Default `1000` |
| `continuationToken` | The `nextContinuationToken` of the previous page |
| `delimiter` | Groups keys under sub-prefixes: with `'/'`, objects below `avatars/2026/` are not listed, and `avatars/2026/` is returned in `commonPrefixes` instead |
| `bucket` | Lists another bucket for this call |
| `abortSignal` | Ends the call when it aborts, see Cancelling a call |

The result is `{ objects, commonPrefixes, isTruncated, nextContinuationToken? }`. Keys and prefixes come back
relative to `keyPrefix`, so they can be passed to any other method as they are.

### Copy (server-side)

```typescript
const { etag } = await storage.copy({
  sourceKey: 'drafts/file.pdf',
  destinationKey: 'published/file.pdf',
})
```

`sourceBucket` and `destinationBucket` default to the module's bucket and may each name another, so a copy can
cross buckets; both keys are relative to `keyPrefix`. `publicRead` and `cacheControl` set the ACL and the
`Cache-Control` of the copy.

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

**What `details` repeats.** Only what the caller supplied in the request that failed: the `key` (without the module's `keyPrefix`), the per-call `bucket`, the `prefix` of a `list()`, the `sourceKey` and `destKey` of a `copy()`, and the media type of a refused upload (`type/subtype` without its parameters, left out when the `contentType` is not a single well-formed type). The others are strings of at most 1024 characters (S3's limit for a key) and are left out when longer or not a string. What the host set as configuration is never repeated: the module's `bucket` when the call did not name one, the `keyPrefix`, the `validation.mimeWhitelist` (a `STORAGE_MIME_NOT_ALLOWED` carries the refused media type and not the list) and the `region`.

| Code                             | HTTP | When                                                                                                                                                                                                               |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STORAGE_NOT_CONFIGURED`         | 503  | Credentials missing and an operation was called                                                                                                                                                                    |
| `STORAGE_KEY_INVALID`            | 400  | Empty key, null byte, path traversal (`..`), or key starts with `/`                                                                                                                                           |
| `STORAGE_BODY_MISSING`           | 400  | `upload()` called without a body                                                                                                                                                                                   |
| `STORAGE_CONTENT_TYPE_REQUIRED`  | 400  | `upload()` called without `contentType`                                                                                                                                                                            |
| `STORAGE_MIME_NOT_ALLOWED`       | 415  | `contentType` outside `mimeWhitelist`, at upload or at presign                                                                                                                                                                            |
| `STORAGE_SIZE_EXCEEDED`          | 413  | `size > maxSizeBytes`                                                                                                                                                                                              |
| `STORAGE_VALIDATION_FAILED`      | 400  | `IUploadValidator` rejected the file, or a header-bound value is not a header value, or a per-call `bucket` or `abortSignal` is of the wrong kind (`details.field`, `details.reason`; the value is never repeated)                                                                                                                                                     |
| `STORAGE_SCAN_INFECTED`          | 422  | Scanner returned `'infected'` (`details.threat`); `details.cleanup: 'failed'` means the object is still stored                                                                                                    |
| `STORAGE_SCAN_INCONCLUSIVE`      | 422  | Scanner returned `'unknown'` and `rejectOnUnknown: true`, or a result that is not a recognised status                                                                                                                                                                 |
| `STORAGE_OBJECT_NOT_FOUND`       | 404  | `head()`, `download()`, or `copy()` on a nonexistent key                                                                                                                                                           |
| `STORAGE_PROVIDER_ERROR`         | 502  | The provider rejected the request (`AccessControlListNotSupported`, an `AccessDenied` on an object, any other rejection). **503** when it could not be reached (connection refused or reset, DNS failure) or answered with a server error (`SlowDown`, 500, 502, 504; not 501), which is worth retrying; **500** when it refused the credentials (`InvalidAccessKeyId`, `SignatureDoesNotMatch`), a deployment fault that a retry does not fix (a `HEAD` answer carries no body and so no code: a refused `head()` stays **502** with reason `rejected`, and the credentials case is not told apart there). `details` carries `awsCode`, `httpStatus`, `requestId` and a fixed `reason` (never the text of the driver or of the provider) plus the operation context (`op`, and the `bucket`, `key` or `prefix` the caller gave; see _What `details` repeats_) |
| `STORAGE_SIGNED_URL_TTL_INVALID` | 400  | Per-request `ttlSeconds` ≤ 0                                                                                                                                                                                       |
| `STORAGE_PART_TOO_SMALL`         | 400  | Never thrown: a `multipart.partSizeBytes` below 5 MiB fails at init as `STORAGE_INVALID_CONFIG`                                                                                                                                                                             |
| `STORAGE_INVALID_PART_COUNT`     | 400  | `getMultipartUploadUrls()` with `parts` not an integer from 1 to 10 000 (`details.reason`; `details.provided` only when `parts` is a finite number)                                                                                                                                                  |
| `STORAGE_BUCKET_UNDEFINED`       | 400  | Operation without a bucket and no default in config                                                                                                                                                                |
| `STORAGE_MULTIPART_ABORTED`      | 500  | A multipart upload failed (**503** when the cause is an outage, as for `STORAGE_PROVIDER_ERROR`). `details.abort` is `'completed'` when the library aborted it, `'failed'` when the abort itself failed (logged as a warning, with what it threw): that upload then stays open on the provider until a lifecycle rule removes it |
| `STORAGE_INVALID_CONFIG`         | 500  | `BymaxStorageModuleOptions` validation failed at initialization                                                                                                                                                    |
| `STORAGE_TIMEOUT`                | 503  | An attempt got no response headers within `requestTimeoutMs`, a multipart source stayed silent for `uploadIdleTimeoutMs` (`details.phase: 'source-idle'`), or a download body stayed silent for `bodyIdleTimeoutMs` (`details.phase: 'body-idle'`)                                                                                                                                                                                |
| `STORAGE_LIFECYCLE_RULE_INVALID` | 400  | `BucketLifecycleService` input rejected: bad `id`, day count or `prefix`, or an id naming a rule outside `keyPrefix` (`details.reason`) |
| `STORAGE_LIFECYCLE_UNSUPPORTED` | 501  | The provider does not implement the lifecycle API |
| `STORAGE_LIFECYCLE_REJECTED` | 422  | The provider refused the lifecycle configuration |
| `STORAGE_BUCKET_NOT_FOUND`       | 404  | The provider answered `NoSuchBucket` (any operation that gets an error body: `download()`, `upload()`, `list()`, `copy()`, `delete()`), or `checkBucket()` got a 404 |
| `STORAGE_BUCKET_ACCESS_DENIED`   | 403  | `checkBucket()` got a 403: the credentials cannot use the bucket, or it does not exist and the credentials cannot list (S3 answers 403 to a caller without `s3:ListBucket`) |
| `STORAGE_BUCKET_REGION_MISMATCH` | 500  | `checkBucket()` got a 301 or `PermanentRedirect`: the bucket lives in another region than the configured one |
| `STORAGE_NOT_MODIFIED`           | 304  | `download()` with `ifNoneMatch` equal to the current ETag |
| `STORAGE_PRECONDITION_FAILED`    | 412  | `download()` with `ifMatch` different from the current ETag |
| `STORAGE_REQUEST_ABORTED`        | 499  | The call's `abortSignal` aborted, before or during the call (`details.reason` is the name of the signal's reason: `AbortError`, `TimeoutError`, ...; for a multipart upload `details.abort` says whether the upload was aborted on the provider) |

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

## 📊 Observability

The main entry counts and times every operation and starts spans. The packages below are
optional peers: install what you use.

```bash
pnpm add prom-client @bymax-one/nest-core @opentelemetry/api
```

### Metrics

```ts
import { Module } from '@nestjs/common'
import { BymaxCoreModule } from '@bymax-one/nest-core'
import { BymaxStorageModule } from '@bymax-one/nest-storage'
import { StorageHealthIndicator, StorageMetrics } from '@bymax-one/nest-storage/observability'

@Module({
  imports: [
    BymaxCoreModule.forRoot({ metrics: { enabled: true }, health: { autoDiscover: true } }),
    BymaxStorageModule.forRoot({
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: 'us-east-1',
      bucket: 'uploads',
      credentials: { accessKeyId: process.env.S3_KEY ?? '', secretAccessKey: process.env.S3_SECRET ?? '' },
    }),
  ],
  providers: [StorageMetrics, StorageHealthIndicator],
})
export class AppModule {}
```

`@bymax-one/nest-core` finds both classes by their markers and calls `registerMetrics` on `StorageMetrics` once at bootstrap.

| Metric | Type | Labels | What it counts |
| --- | --- | --- | --- |
| `bymax_storage_operations_total` | counter | `operation`, `outcome` | Operations that ended |
| `bymax_storage_operation_duration_seconds` | histogram | `operation` | How long they took |
| `bymax_storage_bytes_uploaded_total` | counter | none | Bytes sent by uploads that succeeded |
| `bymax_storage_scans_total` | counter | `verdict` | File scans |

The labels come from closed sets, so the number of series never grows with traffic and no key, bucket, prefix or
message is ever a label:

- `operation`: `upload`, `download`, `head`, `delete`, `delete_many`, `list`, `copy`, `get_download_url`,
  `get_upload_url`, `get_multipart_upload_urls`, `check_bucket`, `lifecycle_get`, `lifecycle_upsert`,
  `lifecycle_remove`.
- `outcome`: `success`, `not_found` (the object was absent), `aborted` (your `abortSignal`, or an aborted multipart
  upload), `error`.
- `verdict`: `clean`, `infected`, `unknown`, `timeout`, `error`.

`exists()` is counted as `head`, `downloadBuffer()` as `download`, and the delete that removes an object a post-upload scan rejected as `delete`. A download is timed to the response, not to the
last byte. A result returned from the idempotency cache counts as an upload but adds no bytes. The bytes are the ones the transfer sent: a stream without a declared `size` is counted too, and a `size` the stream did not reach is not; a failed upload adds none. The counters start
with the module; the histogram starts when `StorageMetrics` registers.

`delete_many` reports how it ended as a call, not per key: `deleteMany()` returns the keys that failed instead of
throwing, so a call in which every key failed is counted as `success`; read `failed` in its result for that. A `head`
of a bucket that does not exist is answered 404 by the provider as it is for a missing object, and is counted as
`not_found`.

`StorageMetricsTally` is what the metrics read, and the library writes to it as it works: `operation(operation,
outcome, seconds)` and `scan(verdict)` count, `bytesUploaded(bytes)` adds to the byte counter, `onDuration(listener)`
hands the listener the duration of every operation that ends from then on, and `snapshot()` returns the counts so
far as copies. A host that publishes its own metrics reads `snapshot()`.

### Readiness

`StorageHealthIndicator` reports under the name `storage`. It asks `StorageService.checkBucket()` for one
`HeadBucket` and answers `up` or `down` with no detail, so nothing about the bucket, the region or the endpoint
leaves with it. The probe has its own deadline, the answer is kept, and checks that arrive
while one is running share it. The probe is counted as `check_bucket`. The answer lags the bucket's real state by up to the 5 seconds it is kept plus the 2 seconds the probe may take,
so a bucket that stops answering can still read `up` for up to 7 seconds.

### Spans

Spans start through `@opentelemetry/api` when it is installed and a tracer is registered; without it the operation
runs as it is.

| Span | Around |
| --- | --- |
| `storage.upload` | `upload()` |
| `storage.download_url` | `getDownloadUrl()` |
| `storage.scan` | a file scan |

Attributes are `bymax.storage.outcome` (the outcome above), `bymax.storage.multipart` (`upload` only: `true` or
`false`) and `bymax.storage.scan_mode` (`scan` only: `pre-upload` or `post-upload`). A failed operation sets the
span status to error with the library error code, never its message.

---

## 📋 Log events

Every operational line the library writes is an **object** through the Nest `Logger`: an `event` code, a `message` with the library's own text, and the fields below. What the provider, the scanner or the host raised goes under `err`, as a fresh error built from its name, its provider code and its message (secrets masked, cut, control characters escaped); never into `message`, and never the SDK's own error, so no response, header or `cause` reaches a log. No field of an event carries the key you passed, the bucket, the endpoint or the region, except `storedKey` of `STORAGE_SCAN_CLEANUP_FAILED`, which an operator needs to remove the object. What the provider or the scanner wrote under `err` is their own text and can name the host, the key or the bucket. A host logger that throws does not change the call being logged. A host `LoggerService` method that is async and rejects is an unhandled rejection, and Node ends the process on it unless the application handles `unhandledRejection`: Nest's `Logger` drops the value a host method returns before the library can see it, so handle rejections inside your logger.

| Code | Level | When | Fields |
| --- | --- | --- | --- |
| `STORAGE_TTL_CLAMPED` | warn | `signedUrls.maxTtlSeconds` is above the SigV4 limit and the limit is used | `configuredSeconds`, `appliedSeconds` |
| `STORAGE_CREDENTIALS_MISSING` | warn | the module starts without credentials; operations then throw `STORAGE_NOT_CONFIGURED` | none |
| `STORAGE_CLIENT_READY` | log | the S3 client is created | none |
| `STORAGE_PROVIDER_CALL_FAILED` | warn | a call to the provider failed (a request you cancelled is not logged) | `operation`, `awsCode`, `httpStatus`, `requestId`, `reason`, `err` |
| `STORAGE_MULTIPART_ABORT_FAILED` | warn | aborting a failed multipart upload failed, so the upload stays open on the provider | `err` |
| `STORAGE_SCAN_INFECTED` | warn | the scanner said `infected` | `engine`, `threat`, `details` (the scanner's own, cut) |
| `STORAGE_SCAN_INCONCLUSIVE_ACCEPTED` | warn | the scanner said `unknown` and `rejectOnUnknown` is off | `engine` |
| `STORAGE_SCAN_INCONCLUSIVE_REJECTED` | warn | `unknown` with `rejectOnUnknown`, or a result outside the contract | `engine`, `status` (when unrecognised), `details` |
| `STORAGE_SCAN_FAILED` | warn | the scanner threw | `err` |
| `STORAGE_SCAN_TIMEOUT` | warn | the scan outlasted `scanner.timeoutMs` | `timeoutMs` |
| `STORAGE_ROOT_GUARD_REFUSED` | warn | a scan was refused because the runtime differs from the one at load | none |
| `STORAGE_SCAN_CLEANUP_FAILED` | error | the object a scan rejected could not be deleted and is still stored | `storedKey`, `cleanupFailure` |
| `STORAGE_EXISTS_FAILED` | warn | `exists()` met a failure that is not a 404 and answered `false` | `err` |
| `STORAGE_DELETE_NOT_FOUND` | warn | `delete()` found no such key (an idempotent no-op) | none |

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

### Error payloads carry the operation, and the key you passed

`details` holds the provider's error code, the HTTP status, the request id, a fixed `reason`, and the
operation context the call site supplies: the operation and the `key`, `bucket` or `prefix` the caller
passed (see _What `details` repeats_). Neither the text of the provider nor anything the host configured is
in it. An object key you passed still reaches whatever consumes the exception, so if a key is itself
sensitive in your deployment, do not log the envelope verbatim.

### The runtime must stay as the library found it

The library compares the built-ins its decisions read with how they were when it loaded, and refuses
every public call and every attempt of every command with `STORAGE_VALIDATION_FAILED` (counts only, no
name) while one differs: a key on `Object.prototype`, a replaced standard method, or a replaced
`Promise` member the verdicts depend on (the `constructor` of the promise prototype). A scan verdict,
a validation result and an upload id are read with `await` on a promise built from the constructor
captured at load, so replacing `Promise.race`, `Promise.resolve`, `Promise.all` or `Promise.prototype.then`
after load does not turn an infected or rejected result into an accepted one. These checks are best-effort hardening, not a security boundary: code in the same process is trusted (see [SECURITY.md](./SECURITY.md), "Threat model: same-process code"). A tracing agent that wraps
`then` and delegates is not refused; a host that replaces `Promise.prototype.constructor` after load
makes the library refuse every call. A replacement made before the library is imported is not seen, except that a `constructor` slot of the promise prototype that is not the engine's own function as a plain value makes the module refuse to load. A scanner or validator dependency that reads `Promise` statics itself is not covered, and neither is a `then` planted and erased again between the entry of a call and the moment the work answers.

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
| `downloadBuffer` | `(options: DownloadBufferOptions) => Promise<{ buffer, metadata }>` | Buffers — set `maxBytes` to bound it; without it the whole object is held |
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
`details` carry the `key` you passed, without the prefix (see "What `details` repeats").

**The fields of the results.** `UploadResult` holds `key`, `bucket`, `etag`, `contentType`, `publicUrl`, `multipart`
and `fromIdempotencyCache`, and `size` and `versionId` when known (`versionId` only on a versioned bucket).
`ObjectMetadata` (from `head` and `download`) holds `key`, `bucket`, `size`, `contentType`, `etag`, `lastModified`
and `metadata` (the `x-amz-meta-*` pairs), and `cacheControl`, `contentDisposition`, `storageClass` and `versionId`
when the provider reports them. A `ListedObject` holds `key`, `size`, `etag` and `lastModified`, and `storageClass`
when reported.

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
- **Observability (main entry):** `StorageMetricsTally`, the counts the `./observability` subpath publishes, and the
  closed sets they are keyed by: `STORAGE_OPERATIONS` and `StorageOperation`, `STORAGE_OUTCOMES` and
  `StorageOutcome`, `SCAN_VERDICTS` and `ScanVerdict`.
- **From `./observability`:** `StorageMetrics`, `StorageHealthIndicator`, the name it reports under
  (`STORAGE_HEALTH_INDICATOR_NAME`), its deadline and cache (`STORAGE_HEALTH_TIMEOUT_MS`,
  `STORAGE_HEALTH_CACHE_MS`), and the metadata keys `@bymax-one/nest-core` discovers them by
  (`METRICS_CONTRIBUTOR_METADATA`, `HEALTH_INDICATOR_METADATA`).
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
