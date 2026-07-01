/**
 * @fileoverview Public barrel for the server entry (`.` subpath). Exposes only
 * the module, the DI tokens, the public types, and `StorageException` — internal
 * services and providers are intentionally not re-exported.
 * @layer server/barrel
 */

// Module
export { BymaxStorageModule } from './bymax-storage.module'

// Services
export { StorageService } from './services/storage.service'
export { SignedUrlService } from './services/signed-url.service'

// No-op helpers (default implementations for validation and scanning)
export { NoOpUploadValidator } from './providers/no-op-validator'
export { NoOpFileScanner } from './providers/no-op-scanner'

// DI Tokens
export {
  BYMAX_STORAGE_OPTIONS,
  BYMAX_STORAGE_S3_CLIENT,
  BYMAX_STORAGE_UPLOAD_VALIDATORS,
  BYMAX_STORAGE_FILE_SCANNER,
  BYMAX_STORAGE_LOGGER,
  BYMAX_STORAGE_IDEMPOTENCY_CACHE,
} from './bymax-storage.constants'

// Interfaces
export type {
  BymaxStorageModuleOptions,
  BymaxStorageModuleAsyncOptions,
  BymaxStorageModuleOptionsFactory,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  ListResult,
  SignedGetUrlOptions,
  SignedPutUrlOptions,
  MultipartUploadUrlsOptions,
  MultipartUploadUrlsResult,
  IUploadValidator,
  IFileScanner,
  FileScanResult,
  ProviderRecipe,
} from './interfaces'

// Errors
export { StorageException } from './errors/storage-exception'

// Re-export from shared for convenience
export type { UploadResult, ObjectMetadata, ListedObject, SignedUrlResult } from '../shared'
export { STORAGE_ERROR_CODES } from '../shared'
export type { StorageErrorCode } from '../shared'
