/**
 * @fileoverview Upload validation pipeline: MIME whitelist → size → custom
 * `IUploadValidator` chain. Returns the (possibly tee'd) body that MUST be used
 * for the actual upload when a validator peeked bytes via `readBytes`.
 * @layer server/services
 */
import { Inject, Injectable } from '@nestjs/common'
import { BYMAX_STORAGE_OPTIONS, BYMAX_STORAGE_UPLOAD_VALIDATORS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { IUploadValidator } from '../interfaces/upload-validator.interface'
import type { UploadBody } from '../utils/stream-utils'
import { peekFirstBytes } from '../utils/stream-utils'
import { mimeMatches } from '../utils/mime-match'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/** Minimal subset of upload options consumed by the validation pipeline. */
interface ValidationInput {
  key: string
  body: UploadBody
  contentType: string
  size?: number
  metadata?: Record<string, string>
}

@Injectable()
export class ValidationService {
  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
    @Inject(BYMAX_STORAGE_UPLOAD_VALIDATORS) private readonly validators: readonly IUploadValidator[],
  ) {}

  /**
   * Runs the upload validation pipeline in the canonical order:
   * 1. MIME whitelist (when configured)
   * 2. Size check (best-effort — skipped when `size` is absent)
   * 3. Custom `IUploadValidator` chain (first rejection short-circuits)
   *
   * @param input - The upload options subset used for validation.
   * @returns The validated body (possibly replaced via a tee'd stream).
   * @throws StorageException `STORAGE_MIME_NOT_ALLOWED` on a MIME violation.
   * @throws StorageException `STORAGE_SIZE_EXCEEDED` when `size > maxSizeBytes`.
   * @throws StorageException `STORAGE_VALIDATION_FAILED` on a custom validator rejection.
   */
  async validate(input: ValidationInput): Promise<{ body: UploadBody }> {
    this.checkMime(input.contentType)
    this.checkSize(input.size)
    const body = await this.runCustomValidators(input)
    return { body }
  }

  /** Checks the MIME against the configured whitelist (no-op when absent or empty). */
  private checkMime(contentType: string): void {
    const whitelist = this.options.validation?.mimeWhitelist
    if (!whitelist || whitelist.length === 0) {
      return
    }
    if (!mimeMatches(contentType, whitelist)) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_MIME_NOT_ALLOWED, undefined, {
        contentType,
        whitelist,
      })
    }
  }

  /** Best-effort size check — skipped when size is undefined. */
  private checkSize(size: number | undefined): void {
    const maxSizeBytes = this.options.validation?.maxSizeBytes
    if (maxSizeBytes === undefined || size === undefined) {
      return
    }
    if (size > maxSizeBytes) {
      throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED, undefined, {
        size,
        maxSize: maxSizeBytes,
      })
    }
  }

  /**
   * Runs the custom validator chain. When a validator calls `readBytes`, the
   * body is tee'd and the replacement stream is propagated to subsequent
   * validators and the final upload.
   */
  private async runCustomValidators(input: ValidationInput): Promise<UploadBody> {
    let body: UploadBody = input.body
    for (const validator of this.validators) {
      const readBytes = async (maxBytes: number): Promise<Buffer> => {
        const { head, replacementBody } = await peekFirstBytes(body, maxBytes)
        body = replacementBody
        return head
      }
      const result = await validator.validate({
        key: input.key,
        contentType: input.contentType,
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        readBytes,
      })
      if (!result.ok) {
        throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
          validator: validator.name,
          reason: result.reason,
        })
      }
    }
    return body
  }
}
