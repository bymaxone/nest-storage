/**
 * @fileoverview Pluggable file-scanner contract (virus, malware, content
 * moderation) and its result shape.
 * @layer server/interfaces
 */

/**
 * Pluggable file scanner. Receives bytes in pre-upload mode, only metadata in
 * post-upload mode.
 */
export interface IFileScanner {
  scan(input: {
    /** `'pre-upload'` includes `body`; `'post-upload'` has only key/bucket/contentType. */
    mode: 'pre-upload' | 'post-upload'
    body?: Buffer | NodeJS.ReadableStream
    key: string
    bucket: string
    contentType: string
    size?: number
    /**
     * Aborts when `scanner.timeoutMs` passes. A scanner that ignores it keeps running after the
     * upload is refused, so repeated timeouts pile up scanner work.
     */
    signal?: AbortSignal
  }): Promise<FileScanResult>
}

/** Outcome of a file scan. */
export interface FileScanResult {
  status: 'clean' | 'infected' | 'unknown'
  /** Engine name — e.g. `'clamav-0.103'`, `'aws-macie'`. */
  engine: string
  /** Threat name when `status === 'infected'`. */
  threat?: string
  /** Free-form scanner text. It is logged, escaped and cut at 300 characters, and is never put in an error body. */
  details?: Record<string, unknown>
}
