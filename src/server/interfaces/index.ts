/**
 * @fileoverview Barrel for the public server interface contracts.
 * @layer server/interfaces
 */
export type {
  BymaxStorageModuleOptions,
  BymaxStorageModuleAsyncOptions,
  BymaxStorageModuleOptionsFactory,
} from './storage-module-options.interface'
export type { UploadOptions } from './upload-options.interface'
export type { DownloadOptions } from './download-options.interface'
export type { ListOptions, ListResult } from './list-options.interface'
export type { CopyOptions } from './copy-options.interface'
export type {
  DeleteManyOptions,
  DeleteManyResult,
  FailedDeletion,
} from './delete-many-options.interface'
export type {
  SignedGetUrlOptions,
  SignedPutUrlOptions,
  MultipartUploadUrlsOptions,
  MultipartUploadUrlsResult,
} from './signed-url-options.interface'
export type { IUploadValidator } from './upload-validator.interface'
export type { IFileScanner, FileScanResult } from './file-scanner.interface'
export type { ProviderRecipe } from './provider-recipe.interface'
