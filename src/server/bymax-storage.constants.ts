/**
 * @fileoverview Dependency-injection tokens. `Symbol()` tokens are used instead
 * of strings to avoid collision with tokens from other libraries.
 * @layer server/di-tokens
 */
export const BYMAX_STORAGE_OPTIONS = Symbol('BYMAX_STORAGE_OPTIONS')
export const BYMAX_STORAGE_S3_CLIENT = Symbol('BYMAX_STORAGE_S3_CLIENT')
export const BYMAX_STORAGE_UPLOAD_VALIDATORS = Symbol('BYMAX_STORAGE_UPLOAD_VALIDATORS')
export const BYMAX_STORAGE_FILE_SCANNER = Symbol('BYMAX_STORAGE_FILE_SCANNER')
export const BYMAX_STORAGE_LOGGER = Symbol('BYMAX_STORAGE_LOGGER')
export const BYMAX_STORAGE_IDEMPOTENCY_CACHE = Symbol('BYMAX_STORAGE_IDEMPOTENCY_CACHE')
