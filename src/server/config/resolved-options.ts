/**
 * @fileoverview The fully-resolved options shape consumed internally by services
 * so they never deal with `undefined` for fields that carry a default.
 * @layer server/config
 */
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

/** Every optional field with a default is present and typed as required. */
export interface ResolvedBymaxStorageOptions {
  endpoint: string
  region: string
  bucket: string
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  forcePathStyle: boolean
  publicBaseUrl: string
  cdnBaseUrl?: string
  defaultPublicRead: boolean
  keyPrefix: string
  defaultCacheControl: string
  defaultContentDisposition: 'inline' | 'attachment'
  signedUrls: {
    defaultGetTtlSeconds: number
    defaultPutTtlSeconds: number
    maxTtlSeconds: number
  }
  multipart: {
    thresholdBytes: number
    partSizeBytes: number
    queueSize: number
  }
  validation?: BymaxStorageModuleOptions['validation']
  scanner?: BymaxStorageModuleOptions['scanner']
  serverSideEncryption?: 'AES256' | 'aws:kms'
  kmsKeyId?: string
  requestChecksumCalculation: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  responseChecksumValidation: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  maxAttempts: number
  requestTimeoutMs: number
  /** True when both `accessKeyId` and `secretAccessKey` are non-empty. */
  hasCredentials: boolean
}
