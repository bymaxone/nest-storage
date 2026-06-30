/**
 * @fileoverview Centralizes object-key manipulation: applies the global key
 * prefix, collapses duplicate separators, and blocks path traversal. This is the
 * security-critical guard between caller input and the S3 object key.
 * @layer server/services
 */
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

function keyInvalid(reason: string): StorageException {
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_KEY_INVALID, HttpStatus.BAD_REQUEST, { reason })
}

@Injectable()
export class KeyResolverService {
  private readonly keyPrefix: string

  constructor(@Inject(BYMAX_STORAGE_OPTIONS) options: ResolvedBymaxStorageOptions) {
    // Normalize the prefix: trim surrounding slashes, then add a single trailing
    // slash when it is non-empty. An all-slash prefix (e.g. "/" or "///") trims to
    // empty and must yield no prefix — never a bare "/" that would leak into the key.
    const trimmedPrefix = options.keyPrefix ? options.keyPrefix.replace(/^\/+|\/+$/g, '') : ''
    this.keyPrefix = trimmedPrefix ? `${trimmedPrefix}/` : ''
  }

  /**
   * Normalizes a raw key into the final S3 object key. Rejects empty keys, null
   * bytes, a leading `/`, and any `..` path segment; collapses duplicate slashes;
   * prepends the configured prefix.
   *
   * @param rawKey - The caller-provided key, already URL-decoded by the caller.
   * @returns The prefixed, normalized object key.
   * @throws StorageException with code `STORAGE_KEY_INVALID`.
   */
  normalize(rawKey: string): string {
    if (rawKey.length === 0) {
      throw keyInvalid('Key must be a non-empty string')
    }
    if (rawKey.includes('\0')) {
      throw keyInvalid('Key must not contain null bytes')
    }
    if (rawKey.startsWith('/')) {
      throw keyInvalid('Key must not start with "/"')
    }
    if (rawKey.split('/').some((segment) => segment === '..')) {
      throw keyInvalid('Key must not contain ".." path segments')
    }
    const collapsed = rawKey.replace(/\/{2,}/g, '/')
    return `${this.keyPrefix}${collapsed}`
  }

  /**
   * Strips the global key prefix from a key — useful when returning keys to the
   * consumer so they need not know the prefix exists.
   *
   * @param fullKey - A normalized key that may carry the global prefix.
   * @returns The key without the configured prefix.
   */
  stripPrefix(fullKey: string): string {
    if (this.keyPrefix && fullKey.startsWith(this.keyPrefix)) {
      return fullKey.slice(this.keyPrefix.length)
    }
    return fullKey
  }

  /**
   * Read-only accessor for the resolved prefix.
   *
   * @returns The normalized prefix (empty string when none is configured).
   */
  getPrefix(): string {
    return this.keyPrefix
  }
}
