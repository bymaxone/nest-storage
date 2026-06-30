/**
 * @fileoverview Pluggable upload-validator contract. Implementations run in order
 * before the S3 PutObject — the first that returns `{ ok: false }` aborts the
 * upload.
 * @layer server/interfaces
 */

/**
 * Pluggable upload validator.
 *
 * @example
 *   class PdfMagicByteValidator implements IUploadValidator {
 *     readonly name = 'pdf-magic-byte'
 *     async validate(ctx) {
 *       if (ctx.contentType !== 'application/pdf' || !ctx.readBytes) return { ok: true }
 *       const head = await ctx.readBytes(4)
 *       return head.toString('ascii') === '%PDF'
 *         ? { ok: true }
 *         : { ok: false, reason: 'Declared as PDF but missing magic bytes' }
 *     }
 *   }
 */
export interface IUploadValidator {
  /** Unique name — used in error logs. */
  readonly name: string
  validate(context: {
    key: string
    contentType: string
    size?: number
    metadata?: Record<string, string>
    /**
     * Reads up to `maxBytes` from the body without consuming it for the actual
     * upload. Useful for magic-byte sniffing on streams.
     */
    readBytes?: (maxBytes: number) => Promise<Buffer>
  }): Promise<{ ok: true } | { ok: false; reason: string }>
}
