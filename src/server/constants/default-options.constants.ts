/**
 * @fileoverview Internal default values applied by `applyDefaults()` when the
 * consumer provides options only partially. `as const` preserves literal types.
 * @layer server/constants
 */
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  MAX_SIGNED_URL_TTL_SECONDS,
  DEFAULT_MULTIPART_THRESHOLD_BYTES,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_MULTIPART_QUEUE_SIZE,
} from '../../shared/constants/default-ttls.constants'

export const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable' as const
export const DEFAULT_CONTENT_DISPOSITION = 'inline' as const
export const DEFAULT_MAX_ATTEMPTS = 3 as const
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000 as const
export const DEFAULT_FORCE_PATH_STYLE = false as const
export const DEFAULT_PUBLIC_READ = false as const

// AWS SDK v3 default; non-AWS provider recipes override to 'WHEN_REQUIRED'.
export const DEFAULT_CHECKSUM_CALCULATION = 'WHEN_SUPPORTED' as const
export const DEFAULT_CHECKSUM_VALIDATION = 'WHEN_SUPPORTED' as const

export const DEFAULT_SIGNED_URLS = {
  defaultGetTtlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  defaultPutTtlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  maxTtlSeconds: MAX_SIGNED_URL_TTL_SECONDS,
} as const

export const DEFAULT_MULTIPART = {
  thresholdBytes: DEFAULT_MULTIPART_THRESHOLD_BYTES,
  partSizeBytes: DEFAULT_MULTIPART_PART_SIZE_BYTES,
  queueSize: DEFAULT_MULTIPART_QUEUE_SIZE,
} as const

export const DEFAULT_SCANNER_MODE = 'pre-upload' as const
export const DEFAULT_SCANNER_REJECT_ON_UNKNOWN = false as const

/**
 * In-memory idempotency-cache defaults. The cache is per-instance; multi-replica
 * deployments may double-upload if requests hit different pods within the TTL
 * window. Cross-instance deduplication is tracked for a later release.
 */
export const DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES = 1000 as const
export const DEFAULT_IDEMPOTENCY_CACHE_TTL_MS = 86_400_000 as const // 24 * 60 * 60 * 1000
