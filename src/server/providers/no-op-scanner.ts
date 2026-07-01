/**
 * @fileoverview No-operation file scanner — always reports clean. Use as the
 * default when no scanner implementation is plugged in.
 * @layer server/providers
 */
import type { IFileScanner, FileScanResult } from '../interfaces/file-scanner.interface'

/**
 * No-operation file scanner that unconditionally returns a clean result.
 * Useful as a default injectable when the host application does not need
 * virus or content-moderation scanning.
 *
 * @example
 *   BymaxStorageModule.forRoot({
 *     ...options,
 *     scanner: { impl: new NoOpFileScanner() },
 *   })
 */
export class NoOpFileScanner implements IFileScanner {
  /**
   * Always returns `{ status: 'clean', engine: 'noop' }`.
   *
   * @param _input - The scan input (ignored).
   * @returns A clean scan result with the `'noop'` engine identifier.
   */
  scan(_input: Parameters<IFileScanner['scan']>[0]): Promise<FileScanResult> {
    return Promise.resolve({ status: 'clean', engine: 'noop' })
  }
}
