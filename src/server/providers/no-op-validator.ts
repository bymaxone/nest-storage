/**
 * @fileoverview No-operation upload validator — always passes. Use as the
 * default when no custom validation logic is needed.
 * @layer server/providers
 */
import type { IUploadValidator } from '../interfaces/upload-validator.interface'

/**
 * No-operation upload validator that unconditionally allows every upload.
 * Useful as a default injectable when the host application does not need
 * custom validation logic.
 *
 * @example
 *   BymaxStorageModule.forRoot({
 *     ...options,
 *     validation: { customValidators: [new NoOpUploadValidator()] },
 *   })
 */
export class NoOpUploadValidator implements IUploadValidator {
  /** Identifies this validator in validation-failed error details. */
  readonly name = 'no-op'

  /**
   * Always returns `{ ok: true }` — no validation is performed.
   *
   * @param _ctx - The upload context (ignored).
   * @returns A passing validation result.
   */
  validate(_ctx: Parameters<IUploadValidator['validate']>[0]): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true })
  }
}
