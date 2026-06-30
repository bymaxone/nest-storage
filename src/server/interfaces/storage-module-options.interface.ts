/**
 * @fileoverview Public configuration contracts for the dynamic module —
 * synchronous options, async options, and the options factory.
 * @layer server/interfaces
 */
import type { ModuleMetadata, Type } from '@nestjs/common'
import type { IUploadValidator } from './upload-validator.interface'
import type { IFileScanner } from './file-scanner.interface'

/**
 * Synchronous configuration for `BymaxStorageModule.forRoot()`.
 *
 * `defaultPublicRead` applies an ACL on uploads. NOTE: ACLs fail with HTTP 400
 * `AccessControlListNotSupported` on modern AWS S3 buckets (Object Ownership =
 * "Bucket owner enforced") and are a no-op on Cloudflare R2 — prefer a bucket
 * policy, a CDN, or signed URLs.
 */
export interface BymaxStorageModuleOptions {
  /** S3-compatible endpoint. REQUIRED. */
  endpoint: string
  /** Region — `'auto'` for R2, any non-empty string for MinIO. REQUIRED. */
  region: string
  /** Default bucket — overridable per call. REQUIRED. */
  bucket: string
  /** Credentials — inject via ConfigService, never hardcode. REQUIRED. */
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    /** STS / OIDC temporary session token. */
    sessionToken?: string
  }
  /** `false` = virtual-hosted, `true` = path-style (MinIO). Default: `false`. */
  forcePathStyle?: boolean
  /** Public base URL for direct links. Fallback: endpoint + bucket. */
  publicBaseUrl?: string
  /** When set, `getPublicUrl()` returns the CDN URL instead. */
  cdnBaseUrl?: string
  /**
   * Apply ACL `public-read` on uploads. Default: `false`. Fails with HTTP 400
   * on modern AWS S3 (ACLs disabled) and is a no-op on R2 — prefer bucket
   * policy / CDN / signed URLs.
   */
  defaultPublicRead?: boolean
  /** Global key prefix applied to every operation — useful for multi-tenant isolation. */
  keyPrefix?: string
  /** Default `Cache-Control` header on uploads. */
  defaultCacheControl?: string
  /** Default `Content-Disposition`. */
  defaultContentDisposition?: 'inline' | 'attachment'

  signedUrls?: {
    /** Default GET TTL (seconds). Default: `300`. */
    defaultGetTtlSeconds?: number
    /** Default PUT TTL (seconds). Default: `300`. */
    defaultPutTtlSeconds?: number
    /** Hard cap — higher TTLs are silently clamped. Default: `604800` (7 days). */
    maxTtlSeconds?: number
  }

  multipart?: {
    /** Bytes threshold to switch to multipart. Default: `5242880` (5 MB). */
    thresholdBytes?: number
    /** Size per part (S3 minimum: 5 MB). Default: 5 MB. */
    partSizeBytes?: number
    /** Concurrent parts. Default: `4`. */
    queueSize?: number
  }

  /** Enables the validation pipeline when present. */
  validation?: {
    /** MIME whitelist — supports wildcards like `'image/*'`. */
    mimeWhitelist?: readonly string[]
    /** Max upload size in bytes. */
    maxSizeBytes?: number
    /** Custom validators run in order; the first rejection short-circuits. */
    customValidators?: readonly IUploadValidator[]
  }

  /** Enables the file scanner when present. */
  scanner?: {
    impl: IFileScanner
    /** `'pre-upload'` (default) scans before; `'post-upload'` scans after. */
    mode?: 'pre-upload' | 'post-upload'
    /** Reject when the scanner returns `'unknown'`. Default: `false`. */
    rejectOnUnknown?: boolean
  }

  /** Server-side encryption. */
  serverSideEncryption?: 'AES256' | 'aws:kms'
  /** Required when `serverSideEncryption === 'aws:kms'`. */
  kmsKeyId?: string
  /**
   * S3Client `requestChecksumCalculation`. AWS SDK v3 defaults to
   * `'WHEN_SUPPORTED'` (CRC32 integrity headers); non-AWS providers (R2, B2,
   * MinIO, Spaces) require `'WHEN_REQUIRED'`. Provider recipes set it.
   */
  requestChecksumCalculation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  /** S3Client `responseChecksumValidation` (checksum mode on GET). Same provider caveat. */
  responseChecksumValidation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  /** Total attempts including the first try (maps to `maxAttempts`). Default: `3`. */
  maxAttempts?: number
  /** Per-request timeout. Default: `30000` ms. */
  requestTimeoutMs?: number
}

/**
 * Asynchronous configuration for `BymaxStorageModule.forRootAsync()` — the
 * standard NestJS async dynamic-module options shape.
 */
export interface BymaxStorageModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: unknown[]) => BymaxStorageModuleOptions | Promise<BymaxStorageModuleOptions>
  inject?: readonly (string | symbol | Type<unknown>)[]
  useExisting?: Type<BymaxStorageModuleOptionsFactory>
  useClass?: Type<BymaxStorageModuleOptionsFactory>
}

/** Factory contract for `useExisting` / `useClass` async configuration. */
export interface BymaxStorageModuleOptionsFactory {
  createStorageOptions(): BymaxStorageModuleOptions | Promise<BymaxStorageModuleOptions>
}
