/**
 * @fileoverview What a failed call to the provider writes to the log: named fields of the error, with
 * secrets masked and the message bounded, and never the error object.
 * @layer server/utils
 */
import { ConsoleLogger, Logger } from '@nestjs/common'
import { describeProviderFailure, logProviderFailure } from './provider-failure-log'

describe('describeProviderFailure', () => {
  it('names the error, the provider code, the status, the request id and the message', () => {
    const line = describeProviderFailure({
      name: 'AccessDenied',
      Code: 'AccessDenied',
      message: 'denied',
      $metadata: { httpStatusCode: 403, requestId: 'req-1' },
    })

    expect(line).toBe(
      'name="AccessDenied" code="AccessDenied" status="403" requestId="req-1" message="denied"',
    )
  })

  it('marks a field the error does not have, and takes a null, a string or an empty object as it is', () => {
    expect(describeProviderFailure(null)).toBe('name=- code=- status=- requestId=- message="null"')
    expect(describeProviderFailure('boom')).toBe(
      'name=- code=- status=- requestId=- message="boom"',
    )
    expect(describeProviderFailure({ name: 7, Code: {}, $metadata: { httpStatusCode: 'x' } })).toBe(
      'name="7" code=- status="x" requestId=- message="[object Object]"',
    )
  })

  it('never prints the response, the headers or any other field of the error', () => {
    const line = describeProviderFailure({
      name: 'E',
      message: 'm',
      $response: { statusCode: 500, headers: { 'x-amz-id-2': 'SECRET-HEADER' }, body: 'BODY' },
      $metadata: { httpStatusCode: 500, requestId: 'r', extendedRequestId: 'SECRET-EXT' },
      $fault: 'server',
      vendor: 'SECRET-VENDOR',
    })

    expect(line).not.toMatch(/SECRET|BODY|\$response|headers|vendor|\$fault/)
  })

  it.each([
    ['X-Amz-Signature=abc123&x=1', 'X-Amz-Signature=[redacted]&x=1'],
    ['x-amz-credential=AKIA/2026/s3&y', 'x-amz-credential=[redacted]&y'],
    ['X-Amz-Security-Token=tok123', 'X-Amz-Security-Token=[redacted]'],
    ['AWSAccessKeyId=AKIAEXAMPLE ok', 'AWSAccessKeyId=[redacted] ok'],
    ['Signature=zzz"', 'Signature=[redacted]"'],
  ])('masks a secret in the message (%s)', (message, masked) => {
    expect(describeProviderFailure({ message })).toContain(`message=${JSON.stringify(masked)}`)
  })

  it('leaves no part of a secret when the cut falls inside it', () => {
    // The label ends before the 300th character and the value runs past it. The code masks first and
    // cuts after; every pattern puts its label before the value, so a cut can only drop the end of a
    // value, never leave one without its label, and the order cannot expose a part of a secret.
    const message = `${'a'.repeat(280)}X-Amz-Signature=SECRETVALUE1234567890&tail`

    const line = describeProviderFailure({ message })

    expect(line).not.toContain('SECR')
    // Masked first, then cut: the mask is what the cut lands in.
    expect(line).toContain(`${'a'.repeat(280)}X-Amz-Signature=[red"`)
  })

  it('masks the credential scope of an Authorization header, whole', () => {
    const message =
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261117/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=abc123def'

    const line = describeProviderFailure({ message })

    expect(line).not.toMatch(/AKIA|abc123def|20261117|aws4_request/)
    expect(line).toContain('AWS4-HMAC-SHA256 Credential=[redacted]')
    expect(line).toContain('SignedHeaders=host;x-amz-date')
  })

  it.each([
    ['an AKIA key', 'The key AKIAIOSFODNN7EXAMPLE does not exist'],
    ['a temporary ASIA key', 'The key ASIAIOSFODNN7EXAMPLE has expired'],
  ])('masks a bare access key id (%s)', (_label, message) => {
    const line = describeProviderFailure({ message })

    expect(line).not.toMatch(/[AI]{2,}OSFODNN7EXAMPLE|AKIA|ASIA/)
    expect(line).toContain('[redacted-key-id]')
  })

  it('leaves a word that only looks like a key id', () => {
    const line = describeProviderFailure({ message: 'AKIA is a prefix, and AKIAshort stays' })

    expect(line).toContain('AKIA is a prefix, and AKIAshort stays')
  })

  it.each([
    [
      'a credential scope',
      'Credential=AKIAIOSFODNN7EXAMPLE/20261117/us-east-1/s3/aws4_request',
      280,
    ],
    ['a bare key id', ' AKIAIOSFODNN7EXAMPLE', 289],
  ])('leaves no part of %s when the cut falls inside it', (_label, secret, padding) => {
    const line = describeProviderFailure({ message: `${'a'.repeat(padding)}${secret}&tail` })

    expect(line).not.toMatch(/AKIA|IOSFOD|20261117/)
  })

  it('bounds the message, so a provider that answers with a page cannot flood the log', () => {
    const line = describeProviderFailure({ message: 'a'.repeat(5000) })

    expect(line).toContain(`message="${'a'.repeat(300)}"`)
    expect(line).not.toContain('a'.repeat(301))
  })

  it('escapes control characters, so a message cannot end the line or start another', () => {
    expect(describeProviderFailure({ message: 'x\nFORGED' })).not.toContain('\n')
  })
})

describe('logProviderFailure', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('warns once, with the operation and the key beside the projection', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ name: 'E', message: 'm' }, { op: 'head', key: 'a/b.bin' })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'Provider call failed: op="head" key="a/b.bin" name="E" code=- status=- requestId=- message="m"',
    )
  })

  it('says nothing for a request the caller cancelled', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure(
      { name: 'AbortError', message: 'The operation was aborted' },
      { op: 'download' },
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('opens the line with the label the caller gives', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ message: 'm' }, { op: 'upload-multipart' }, 'Multipart upload failed')

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Multipart upload failed: op="upload-multipart" /),
    )
  })

  it('marks the operation and the key when the context has none', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ message: 'm' })
    logProviderFailure({ message: 'm' }, { op: 1, key: 2 })

    expect(warn).toHaveBeenNthCalledWith(1, expect.stringContaining('op=- key=- '))
    expect(warn).toHaveBeenNthCalledWith(2, expect.stringContaining('op=- key=- '))
  })

  it('writes under the name of the storage provider, so a host can filter on it', () => {
    const warn = jest.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ message: 'm' })

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Provider call failed'),
      'StorageProvider',
    )
  })
})
