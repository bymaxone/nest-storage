/**
 * @fileoverview Provider Recipes — pure, deterministic factories that produce a
 * ready-to-spread `BymaxStorageModuleOptions` pre-tuned for one S3-compatible
 * provider. The decisive detail is the non-AWS checksum opt-out: every provider
 * except AWS S3 sets `requestChecksumCalculation`/`responseChecksumValidation` to
 * `'WHEN_REQUIRED'`, because the SDK's default CRC32 integrity headers are
 * rejected by R2, B2, MinIO, DigitalOcean Spaces, and Wasabi.
 * @layer server/config
 */
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

/** Shared input for the region-addressed providers (AWS, DO Spaces, Wasabi). */
interface BaseInput {
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** STS / OIDC temporary session token, forwarded only when present. */
  sessionToken?: string
}

/** Cloudflare R2 input — account-addressed, region is always `'auto'`. */
interface R2Input extends Omit<BaseInput, 'region' | 'sessionToken'> {
  /** Cloudflare account id — forms the S3 API endpoint host. */
  accountId: string
  /**
   * Public delivery domain (r2.dev or a custom domain). REQUIRED for public
   * reads: the `*.r2.cloudflarestorage.com` host is the S3 API endpoint and does
   * not serve public object reads, so there is no working default.
   */
  customDomain: string
}

/** Backblaze B2 input — the endpoint host varies by region cluster. */
interface B2Input extends Omit<BaseInput, 'sessionToken'> {
  /** B2 S3 endpoint host, e.g. `'s3.us-west-002.backblazeb2.com'`. */
  endpointHost: string
}

/** MinIO / dev / self-hosted input — an explicit endpoint, arbitrary region. */
interface MinIOInput {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** MinIO regions are arbitrary; defaults to `'us-east-1'`. */
  region?: string
}

/** The non-AWS checksum opt-out shared by every S3-compatible provider. */
const NON_AWS_CHECKSUM = {
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
} as const

/** Builds a credentials object, forwarding `sessionToken` only when present. */
function toCredentials(input: {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}): BymaxStorageModuleOptions['credentials'] {
  return {
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    ...(input.sessionToken !== undefined ? { sessionToken: input.sessionToken } : {}),
  }
}

/**
 * Pre-tuned configuration factories for each supported S3-compatible provider.
 * Spread the result into `forRoot`/`forRootAsync` and override any field.
 *
 * @example
 *   BymaxStorageModule.forRoot({
 *     ...providerRecipes.cloudflareR2({
 *       accountId,
 *       bucket,
 *       accessKeyId,
 *       secretAccessKey,
 *       customDomain: 'https://cdn.example.com',
 *     }),
 *     keyPrefix: 'tenant-x/',
 *     validation: { mimeWhitelist: ['image/*'] },
 *   })
 */
export const providerRecipes = {
  /** AWS S3 — keeps the SDK's default checksum behaviour (`'WHEN_SUPPORTED'`). */
  awsS3(input: BaseInput): BymaxStorageModuleOptions {
    return {
      endpoint: `https://s3.${input.region}.amazonaws.com`,
      region: input.region,
      bucket: input.bucket,
      credentials: toCredentials(input),
      forcePathStyle: false,
      publicBaseUrl: `https://${input.bucket}.s3.${input.region}.amazonaws.com`,
      serverSideEncryption: 'AES256',
    }
  },

  /** DigitalOcean Spaces — virtual-hosted, public by default, with a CDN host. */
  digitalOceanSpaces(input: BaseInput): BymaxStorageModuleOptions {
    return {
      endpoint: `https://${input.region}.digitaloceanspaces.com`,
      region: input.region,
      bucket: input.bucket,
      credentials: toCredentials(input),
      forcePathStyle: false,
      publicBaseUrl: `https://${input.bucket}.${input.region}.digitaloceanspaces.com`,
      cdnBaseUrl: `https://${input.bucket}.${input.region}.cdn.digitaloceanspaces.com`,
      defaultPublicRead: true,
      ...NON_AWS_CHECKSUM,
    }
  },

  /** Cloudflare R2 — region `'auto'`; public reads require a custom domain. */
  cloudflareR2(input: R2Input): BymaxStorageModuleOptions {
    return {
      endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      bucket: input.bucket,
      credentials: toCredentials(input),
      forcePathStyle: false,
      publicBaseUrl: input.customDomain,
      ...NON_AWS_CHECKSUM,
    }
  },

  /** Backblaze B2 — S3-compatible API; virtual-hosted matches `publicBaseUrl`. */
  backblazeB2(input: B2Input): BymaxStorageModuleOptions {
    return {
      endpoint: `https://${input.endpointHost}`,
      region: input.region,
      bucket: input.bucket,
      credentials: toCredentials(input),
      forcePathStyle: false,
      publicBaseUrl: `https://${input.bucket}.${input.endpointHost}`,
      ...NON_AWS_CHECKSUM,
    }
  },

  /** MinIO — dev / CI / self-hosted; path-style addressing. */
  minio(input: MinIOInput): BymaxStorageModuleOptions {
    return {
      endpoint: input.endpoint,
      region: input.region ?? 'us-east-1',
      bucket: input.bucket,
      credentials: toCredentials(input),
      forcePathStyle: true,
      publicBaseUrl: `${input.endpoint.replace(/\/+$/, '')}/${input.bucket}`,
      ...NON_AWS_CHECKSUM,
    }
  },

  /** Wasabi — Hot Cloud Storage; virtual-hosted. */
  wasabi(input: BaseInput): BymaxStorageModuleOptions {
    return {
      endpoint: `https://s3.${input.region}.wasabisys.com`,
      region: input.region,
      bucket: input.bucket,
      credentials: toCredentials(input),
      forcePathStyle: false,
      publicBaseUrl: `https://${input.bucket}.s3.${input.region}.wasabisys.com`,
      ...NON_AWS_CHECKSUM,
    }
  },
} as const
