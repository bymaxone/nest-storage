/**
 * @fileoverview Every log line that repeats text a caller or a provider controls writes it as one
 * escaped token: a key or a message holding a newline or an escape sequence cannot forge a line.
 * Each case drives one log site of the library with such a value and reads what the logger got.
 * @layer server
 */
import { Logger } from '@nestjs/common'
import { S3Client } from '@aws-sdk/client-s3'
import { applyDefaults } from './config/apply-defaults'
import { S3ClientProvider } from './providers/s3-client.provider'
import { FileScannerService } from './services/file-scanner.service'
import { KeyResolverService } from './services/key-resolver.service'
import { StorageService } from './services/storage.service'
import { ValidationService } from './services/validation.service'
import { IdempotencyCache } from './utils/idempotency-cache'
import type { IFileScanner } from './interfaces/file-scanner.interface'

/** A key a caller can legitimately send to S3 that holds a newline, a carriage return and an escape. */
const FORGED_KEY = 'a.txt\n2026-01-01 ERROR forged line\r\u001b[31m'
const ESCAPED_KEY = '"a.txt\\n2026-01-01 ERROR forged line\\r\\u001b[31m"'

/** Whether a log line holds a character that could end it or start an escape sequence. */
function holdsControl(line: string): boolean {
  return line.includes('\n') || line.includes('\r') || line.includes(String.fromCharCode(27))
}

/** The one line the logger received, its arguments joined; fails when the logger was called any other number of times. */
function onlyLine(spy: jest.SpyInstance): string {
  const calls: string[] = spy.mock.calls.map((call: unknown[]) => call.map(String).join(' '))
  expect(calls).toHaveLength(1)
  return calls.join('')
}

describe('log lines carry caller text as one escaped token', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function scannerService(result: Awaited<ReturnType<IFileScanner['scan']>>): FileScannerService {
    const scanner: IFileScanner = { scan: () => Promise.resolve(result) }
    const resolved = applyDefaults({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'b',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      scanner: { impl: scanner, mode: 'post-upload', rejectOnUnknown: false },
    })
    return new FileScannerService(resolved, scanner)
  }

  it('the infected-file warning shows the key and the threat as escaped tokens', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const service = scannerService({ status: 'infected', engine: 'e\nx', threat: 'T\u001b[0m' })

    await service.scan({ mode: 'post-upload', key: FORGED_KEY, bucket: 'b', contentType: 'text/plain' }).catch(() => undefined)

    const line = onlyLine(warn)
    expect(line).toContain(`key=${ESCAPED_KEY}`)
    expect(line).toContain('threat="T\\u001b[0m"')
    expect(line).toContain('engine="e\\nx"')
    expect(holdsControl(line)).toBe(false)
  })

  it('the inconclusive-result warning shows the key as an escaped token', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const service = scannerService({ status: 'unknown', engine: 'clamav' })

    await service.scan({ mode: 'post-upload', key: FORGED_KEY, bucket: 'b', contentType: 'text/plain' })

    const line = onlyLine(warn)
    expect(line).toContain(`key=${ESCAPED_KEY}`)
    expect(holdsControl(line)).toBe(false)
  })

  function storage(): { service: StorageService; send: jest.SpyInstance } {
    const resolved = applyDefaults({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'b',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    })
    const client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    })
    const send = jest.spyOn(client, 'send')
    const provider = new S3ClientProvider(resolved)
    jest.spyOn(provider, 'getClient').mockReturnValue(client)
    jest.spyOn(provider, 'isConfigured').mockReturnValue(true)
    const service = new StorageService(
      resolved,
      provider,
      new KeyResolverService(resolved),
      new IdempotencyCache(10, 1000, () => 0),
      new ValidationService(resolved, []),
      new FileScannerService(resolved, null),
    )
    return { service, send }
  }

  it('the idempotent-delete warning shows the key as an escaped token', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service, send } = storage()
    send.mockRejectedValue(Object.assign(new Error('gone'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }))

    await service.delete(FORGED_KEY)

    const line = onlyLine(warn)
    expect(line).toContain(ESCAPED_KEY)
    expect(holdsControl(line)).toBe(false)
  })

  it('the exists warning shows the message of an unexpected failure as an escaped token', async () => {
    // A StorageException carries a fixed message; any other failure keeps its own text, which may hold control characters.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service } = storage()
    jest.spyOn(service, 'head').mockRejectedValue(new Error('boom\n2026 ERROR forged\u001b[31m'))

    await service.exists('a.txt')

    const line = onlyLine(warn)
    expect(line).toContain('"boom\\n2026 ERROR forged\\u001b[31m"')
    expect(holdsControl(line)).toBe(false)
  })

  it('the scan-cleanup error shows the stored key and the provider message as escaped tokens', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const resolved = applyDefaults({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'b',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      scanner: { impl: { scan: () => Promise.resolve({ status: 'infected', engine: 'e' }) }, mode: 'post-upload' },
    })
    const client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    })
    // The upload's PutObject succeeds, then the cleanup DeleteObject is refused.
    const send: jest.SpyInstance = jest.spyOn(client, 'send')
    send.mockResolvedValueOnce({ ETag: '"e"' })
    send.mockRejectedValueOnce(
      Object.assign(new Error('denied\n2026 ERROR forged'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    )
    const provider = new S3ClientProvider(resolved)
    jest.spyOn(provider, 'getClient').mockReturnValue(client)
    jest.spyOn(provider, 'isConfigured').mockReturnValue(true)
    const service = new StorageService(
      resolved,
      provider,
      new KeyResolverService(resolved),
      new IdempotencyCache(10, 1000, () => 0),
      new ValidationService(resolved, []),
      new FileScannerService(resolved, resolved.scanner?.impl ?? null),
    )

    await service
      .upload({ key: FORGED_KEY, body: Buffer.from('x'), contentType: 'text/plain' })
      .catch(() => undefined)

    const line = onlyLine(error)
    expect(line).toContain('STORAGE_SCAN_CLEANUP_FAILED')
    expect(line).toContain(ESCAPED_KEY)
    expect(holdsControl(line)).toBe(false)
  })
})
