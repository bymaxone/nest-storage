/**
 * @fileoverview Default and hard-limit numeric constants for signed-URL TTLs and
 * multipart uploads. Short TTLs by default — prefer issuing a new URL over
 * caching long-lived ones.
 * @layer shared/constants
 */

/** Default TTL (seconds) for signed URLs. */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300 as const

/** Hard cap (seconds) on a signed-URL TTL — 7 days, the SigV4 limit. */
export const MAX_SIGNED_URL_TTL_SECONDS = 604_800 as const // 7 * 24 * 60 * 60

/** Multipart upload threshold — files at or above this use `@aws-sdk/lib-storage`. */
export const DEFAULT_MULTIPART_THRESHOLD_BYTES = 5_242_880 as const // 5 * 1024 * 1024

/** Default size of each part in a multipart upload. The S3 minimum is 5 MB. */
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 5_242_880 as const // 5 * 1024 * 1024

/** Number of parts uploaded concurrently. */
export const DEFAULT_MULTIPART_QUEUE_SIZE = 4 as const
