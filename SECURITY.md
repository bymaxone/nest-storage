# Security Policy — @bymax-one/nest-storage

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |

Only the latest minor release receives security patches. Upgrade to the current version before reporting.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **[support@bymax.one](mailto:support@bymax.one)** with:

- A clear description of the vulnerability and its impact
- Steps to reproduce (minimal reproduction preferred)
- The affected versions and component (`StorageService`, `KeyResolverService`, signed URLs, etc.)
- Any relevant code, logs, or CVE references

You will receive an acknowledgement within 72 hours. Coordinate disclosure timeline with the maintainers before publishing. Credit is given in the release notes upon fix.

---

## Security Goals

The following properties are designed to hold in every supported release.

### Path-traversal mitigation

`KeyResolverService` normalises every caller-supplied key before it reaches the AWS SDK:

- Rejects keys containing `..` segments (`STORAGE_KEY_INVALID` / HTTP 400)
- Rejects keys that start with `/` after normalisation
- Rejects keys that are empty after normalisation
- Prepends `keyPrefix` to enforce multi-tenant isolation — callers cannot escape their own prefix

Validate user-controlled input before passing it to `StorageService`; the library provides the last line of defence, not the only one.

### Signed-URL secrecy

- Per-request `ttlSeconds` values above `signedUrls.maxTtlSeconds` are **silently clamped**, not rejected (avoids leaking the server ceiling to the caller).
- `signedUrls.maxTtlSeconds` is clamped to 604 800 s (the SigV4 7-day absolute ceiling) at module initialisation.
- `ttlSeconds` ≤ 0 is rejected with `STORAGE_SIGNED_URL_TTL_INVALID` (HTTP 400).
- A signed URL is a **temporary credential** — **never log it** (a logged signed URL is accessible to anyone with access to your log system). Never include a signed URL in `details` of a `StorageException`.

### Signed PUT security considerations

A presigned PUT bypasses the library's local MIME/size validation — bytes go directly to the provider. Mitigate by:

1. Setting `maxSizeBytes` in `getUploadUrl()` (maps to a Content-Length-Range presigner policy).
2. Running a `HEAD` check on the uploaded object to verify size and content-type.
3. Using a post-upload `IFileScanner` to scan for malware after the bytes land.

### Credentials handling

- Pass AWS credentials via environment variables or AWS SDK credential providers, never hard-code them.
- Use AWS Secrets Manager, HashiCorp Vault, or Doppler in production.
- Prefer IAM roles with STS temporary credentials (`credentials.sessionToken`) over long-lived access keys.
- The `details` field of `StorageException` never carries a credential or signed URL.
- Never put PII (email addresses, government IDs) in object keys — keys appear in provider logs, CDN access logs, and distributed traces.

### Server-side encryption (SSE)

- Enable `serverSideEncryption: 'AES256'` at a minimum in production environments.
- For sensitive data, use `'aws:kms'` and ensure the IAM policy allows `kms:Encrypt` and `kms:Decrypt` on the target KMS key.
- `serverSideEncryption: 'NONE'` is a library-only sentinel — it omits the SSE header without sending the string `'NONE'` to the provider.

### MIME validation

- The `mimeWhitelist` check is based on the `Content-Type` header supplied by the client; it is **header-only** and cannot detect a file whose true type differs from its declared type.
- Plug an `IUploadValidator` that uses `readBytes(n)` for magic-byte verification when the content source is untrusted.

---

## Operational Hardening Notes

### Non-AWS provider checksum opt-out

`@aws-sdk/client-s3` ≥ 3.729.0 sends `x-amz-checksum-crc32` integrity headers by default (`requestChecksumCalculation: 'WHEN_SUPPORTED'`). Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces, and Wasabi **reject** these headers. Every non-AWS provider recipe included in this library sets:

```typescript
requestChecksumCalculation: 'WHEN_REQUIRED',
responseChecksumValidation: 'WHEN_REQUIRED',
```

If you build a custom configuration instead of using a recipe, you must add this opt-out manually. See `README.md` — Provider Compatibility for the full explanation.

### Public access / ACL caveat

`publicRead: true` (or `defaultPublicRead: true`) sends `ACL: 'public-read'` on PutObject. This fails on modern AWS S3 buckets (Object Ownership = "Bucket owner enforced") with HTTP 400 `AccessControlListNotSupported`, and is a **silent no-op** on Cloudflare R2. Use a **bucket policy**, a **CDN**, or **signed URLs** for public object delivery.

---

## Sensitive Code Paths

The following files have elevated security relevance and warrant close review on any change:

| File                                          | Concern                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `src/server/services/key-resolver.service.ts` | Path-traversal guard; keyPrefix isolation                        |
| `src/server/utils/ttl-clamp.ts`               | Signed-URL TTL clamping and SigV4 ceiling                        |
| `src/server/utils/mime-match.ts`              | MIME wildcard matching (mismatches could allow disallowed types) |
| `src/server/utils/idempotency-cache.ts`       | In-memory LRU; per-instance (not shared across replicas)         |
| `src/server/services/signed-url.service.ts`   | Presigned URL generation; never log the output                   |
| `src/server/config/validate-options.ts`       | Module-options validation; malformed config must fail closed     |
