/**
 * @fileoverview The MIME whitelist check shared by the upload pipeline and the presigned-URL methods,
 * so both refuse the same types with the same error.
 * @layer server/utils
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import { isSingleMediaType, mimeMatches } from './mime-match'

/**
 * Throws `STORAGE_MIME_NOT_ALLOWED` when a whitelist is configured and `contentType` is outside it; a
 * no-op when the whitelist is absent or empty. The error shows the refused media type, without its parameters, so the
 * caller can see what was rejected, except when the value is not a single well-formed type (a list, a control
 * or a non-ASCII character): nothing of it is repeated then. The configured whitelist is never repeated: it is the host's configuration.
 *
 * @param whitelist - The configured `validation.mimeWhitelist`, if any.
 * @param contentType - The type the caller asked for.
 * @throws StorageException `STORAGE_MIME_NOT_ALLOWED`.
 */
export function assertMimeAllowed(
  whitelist: readonly string[] | undefined,
  contentType: string,
): void {
  if (!whitelist || whitelist.length === 0 || mimeMatches(contentType, whitelist)) {
    return
  }
  // Nothing of a value that is not one well-formed type is repeated; for that, the media type alone is shown: the
  // parameters after `;` are the caller's and may carry more than a type.
  if (!isSingleMediaType(contentType)) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED, undefined, {})
  }
  const end = contentType.indexOf(';')
  const mediaType = (end === -1 ? contentType : contentType.slice(0, end)).trim()
  throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED, undefined, {
    contentType: mediaType,
  })
}
