/**
 * @fileoverview The MIME whitelist check shared by the upload pipeline and the presigned-URL methods,
 * so both refuse the same types with the same error.
 * @layer server/utils
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import { isHeaderValue } from './header-value'
import { mimeMatches } from './mime-match'

/**
 * Throws `STORAGE_MIME_NOT_ALLOWED` when a whitelist is configured and `contentType` is outside it; a
 * no-op when the whitelist is absent or empty. The error shows the refused type so the caller can see
 * what was rejected, except when it is not a header value (a control or non-ASCII character): that
 * value is not repeated, and the error carries the whitelist alone.
 *
 * @param whitelist - The configured `validation.mimeWhitelist`, if any.
 * @param contentType - The type the caller asked for.
 * @throws StorageException `STORAGE_MIME_NOT_ALLOWED`.
 */
export function assertMimeAllowed(whitelist: readonly string[] | undefined, contentType: string): void {
  if (!whitelist || whitelist.length === 0 || mimeMatches(contentType, whitelist)) {
    return
  }
  throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED, undefined, {
    ...(isHeaderValue(contentType) ? { contentType } : {}),
    whitelist,
  })
}
