/**
 * @fileoverview Curated MIME whitelists for common upload domains. Consumers may
 * merge them with their own or pass them directly to `validation.mimeWhitelist`.
 * Wildcards are not used here — a consumer can add `'image/*'` if it trusts any
 * image subtype.
 * @layer shared/constants
 */
export const DEFAULT_IMAGE_MIME_WHITELIST: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
] as const

export const DEFAULT_VIDEO_MIME_WHITELIST: readonly string[] = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const

export const DEFAULT_DOC_MIME_WHITELIST: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const
