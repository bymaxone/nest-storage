/**
 * @fileoverview What a failed call to the provider writes to the log: an object event with named fields, and
 * the error as a fresh object built from them (never the SDK's), with secrets masked and the text bounded.
 * @layer server/utils
 */
import { ConsoleLogger, Logger } from '@nestjs/common'
import { inspect } from 'node:util'
import { logProviderFailure, projectProviderFailure, failureError } from './provider-failure-log'

describe('projectProviderFailure', () => {
  it('names the error, the provider code, the status, the request id and the message', () => {
    expect(
      projectProviderFailure({
        name: 'AccessDenied',
        Code: 'AccessDenied',
        message: 'denied',
        $metadata: { httpStatusCode: 403, requestId: 'req-1' },
      }),
    ).toEqual({
      name: 'AccessDenied',
      awsCode: 'AccessDenied',
      httpStatus: 403,
      requestId: 'req-1',
      message: 'denied',
    })
  })

  it('reads no field off a function, which has a name of its own', () => {
    // A function is not an object by `typeof`; read as one, its own `name` would be logged as the error's name.
    function boom(): void {}

    expect(projectProviderFailure(boom)).not.toHaveProperty('name')
  })

  it('leaves out a field the error does not have or holds as another kind, and takes a null or a string as the message', () => {
    expect(projectProviderFailure(null)).toEqual({ message: 'null' })
    expect(projectProviderFailure('boom')).toEqual({ message: 'boom' })
    expect(
      projectProviderFailure({ name: 7, Code: {}, $metadata: { httpStatusCode: 'x' } }),
    ).toEqual({
      message: '[object Object]',
    })
  })

  it('never carries the response, the headers or any other field of the error', () => {
    const view = projectProviderFailure({
      name: 'E',
      message: 'm',
      $response: { statusCode: 500, headers: { 'x-amz-id-2': 'SECRET-HEADER' }, body: 'BODY' },
      $metadata: { httpStatusCode: 500, requestId: 'r', extendedRequestId: 'SECRET-EXT' },
      $fault: 'server',
      vendor: 'SECRET-VENDOR',
    })

    expect(JSON.stringify(view)).not.toMatch(/SECRET|BODY|\$response|headers|vendor|\$fault/)
  })

  it.each([
    ['X-Amz-Signature=abc123&x=1', 'X-Amz-Signature=[redacted]&x=1'],
    ['x-amz-credential=AKIA/2026/s3&y', 'x-amz-credential=[redacted]&y'],
    ['X-Amz-Security-Token=tok123', 'X-Amz-Security-Token=[redacted]'],
    ['AWSAccessKeyId=AKIAEXAMPLE ok', 'AWSAccessKeyId=[redacted] ok'],
    ['Signature=zzz"', 'Signature=[redacted]"'],
  ])('masks a secret in the message (%s)', (message, masked) => {
    expect(projectProviderFailure({ message }).message).toBe(masked)
  })

  it('leaves no part of a secret when the cut falls inside it', () => {
    const message = `${'a'.repeat(280)}X-Amz-Signature=SECRETVALUE1234567890&tail`

    const text = projectProviderFailure({ message }).message

    expect(text).not.toContain('SECR')
    expect(text).toBe(`${'a'.repeat(280)}X-Amz-Signature=[red`)
  })

  it('masks the credential scope of an Authorization header, whole', () => {
    const text = projectProviderFailure({
      message:
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261117/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=abc123def',
    }).message

    expect(text).not.toMatch(/AKIA|abc123def|20261117|aws4_request/)
    expect(text).toContain('AWS4-HMAC-SHA256 Credential=[redacted]')
    expect(text).toContain('SignedHeaders=host;x-amz-date')
  })

  it.each([
    ['an AKIA key', 'The key AKIAIOSFODNN7EXAMPLE does not exist'],
    ['a temporary ASIA key', 'The key ASIAIOSFODNN7EXAMPLE has expired'],
  ])('masks a bare access key id (%s)', (_label, message) => {
    const text = projectProviderFailure({ message }).message

    expect(text).not.toMatch(/AKIA|ASIA/)
    expect(text).toContain('[redacted-key-id]')
  })

  it('leaves a word that only looks like a key id', () => {
    expect(
      projectProviderFailure({ message: 'AKIA is a prefix, and AKIAshort stays' }).message,
    ).toBe('AKIA is a prefix, and AKIAshort stays')
  })

  it.each([
    [
      'a credential scope',
      'Credential=AKIAIOSFODNN7EXAMPLE/20261117/us-east-1/s3/aws4_request',
      280,
    ],
    ['a bare key id', ' AKIAIOSFODNN7EXAMPLE', 289],
  ])('leaves no part of %s when the cut falls inside it', (_label, secret, padding) => {
    expect(
      projectProviderFailure({ message: `${'a'.repeat(padding)}${secret}&tail` }).message,
    ).not.toMatch(/AKIA|IOSFOD|20261117/)
  })

  it('bounds the message, so a provider that answers with a page cannot flood the log', () => {
    const text = projectProviderFailure({ message: 'a'.repeat(5000) }).message

    expect(text).toBe('a'.repeat(300))
  })

  it('escapes control characters, so a message cannot end the line or start another', () => {
    const text = projectProviderFailure({ message: 'x\nFORGED\u001b[31m\u009b' }).message

    expect(text).toBe('x\\nFORGED\\u001b[31m\\u009b')
  })
})

/** An error whose `field` getter throws, as a host-injected scanner or a faulty driver can reject with. */
function throwingGetter(field: string): object {
  return Object.defineProperty({ message: 'm' }, field, {
    get: () => {
      throw new Error('getter')
    },
    enumerable: true,
  })
}

describe('a failure whose fields cannot be read', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each(['name', 'Code', '$metadata'])('is projected without the %s it cannot read', (field) => {
    expect(projectProviderFailure(throwingGetter(field)).message).toBe('m')
    expect(failureError(throwingGetter(field)).message).toBe('m')
  })

  it('is logged, and the call being logged is not replaced by the getter', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    for (const field of ['name', '$metadata', 'code']) {
      logProviderFailure(throwingGetter(field))
    }

    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ reason: 'rejected' })
    expect(warn.mock.calls[2]?.[0]).toMatchObject({ reason: 'rejected' })
  })
})

describe('failureError', () => {
  it('is a fresh error with the name, the provider code and the masked message, and no cause', () => {
    const sdk = Object.assign(new Error('denied X-Amz-Signature=abc'), {
      name: 'AccessDenied',
      Code: 'AccessDenied',
      $response: { headers: { 'x-amz-id-2': 'SECRET-HEADER' } },
      $metadata: { httpStatusCode: 403, requestId: 'r', extendedRequestId: 'SECRET-EXT' },
      cause: new Error('SECRET-CAUSE'),
    })

    const error = failureError(sdk)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBe(sdk)
    expect(error.name).toBe('AccessDenied')
    expect(error.message).toBe('denied X-Amz-Signature=[redacted]')
    expect(Object.getOwnPropertyNames(error).sort()).toEqual(
      ['awsCode', 'message', 'name', 'stack'].sort(),
    )
    expect(error).not.toHaveProperty('cause')
    expect(inspect(error, { depth: 6 })).not.toMatch(/SECRET|\$response|\$metadata/)
  })

  it('carries the provider code as an enumerable own field, and none when the failure has no code', () => {
    const withCode = failureError({ Code: 'SlowDown', message: 'm' })
    const without = failureError({ message: 'm' })

    expect(Object.keys(withCode)).toContain('awsCode')
    expect(withCode).toHaveProperty('awsCode', 'SlowDown')
    expect(Object.getOwnPropertyNames(without)).not.toContain('awsCode')
  })

  it('falls back to a plain Error name when the failure has none', () => {
    expect(failureError({ message: 'm' }).name).toBe('Error')
    expect(failureError('boom').message).toBe('boom')
  })
})

describe('logProviderFailure', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('warns once with the event, the operation and the fields, and the error under err', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure(
      {
        name: 'E',
        Code: 'SlowDown',
        message: 'm',
        $metadata: { httpStatusCode: 503, requestId: 'req-1' },
      },
      { op: 'head', key: 'a/b.bin', bucket: 'SECRET-BUCKET' },
    )

    expect(warn).toHaveBeenCalledTimes(1)
    const entry = warn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(entry).toMatchObject({
      event: 'STORAGE_PROVIDER_CALL_FAILED',
      message: 'Provider call failed',
      operation: 'head',
      awsCode: 'SlowDown',
      httpStatus: 503,
      requestId: 'req-1',
      reason: 'provider-error',
    })
    expect((entry.err as Error).message).toBe('m')
    expect(Object.keys(entry).sort()).toEqual(
      [
        'awsCode',
        'err',
        'event',
        'httpStatus',
        'message',
        'operation',
        'reason',
        'requestId',
      ].sort(),
    )
  })

  it('leaves out the code, the status and the request id when the failure has none', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ message: 'm' }, { op: 'head' })

    const entry = warn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(entry).not.toHaveProperty('awsCode')
    expect(entry).not.toHaveProperty('httpStatus')
    expect(entry).not.toHaveProperty('requestId')
  })

  it('carries no key and no bucket, and nothing the provider wrote in the message', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure(
      { message: 'SENTINEL-PROVIDER-TEXT us-east-1 s3.example.com' },
      { op: 'head', key: 'k', bucket: 'b' },
    )

    const entry = warn.mock.calls[0]?.[0] as { message: string; err: Error }
    expect(entry).not.toHaveProperty('key')
    expect(entry).not.toHaveProperty('bucket')
    expect(entry.message).toBe('Provider call failed')
    expect(entry.err.message).toContain('SENTINEL-PROVIDER-TEXT')
  })

  it('says nothing for a request the caller cancelled', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure(
      { name: 'AbortError', message: 'The operation was aborted' },
      { op: 'download' },
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('opens with the label the caller gives', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ message: 'm' }, { op: 'upload-multipart' }, 'Multipart upload failed')

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Multipart upload failed' }),
    )
  })

  it('leaves out the operation when the context has none or holds another kind', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ message: 'm' })
    logProviderFailure({ message: 'm' }, { op: 1 })

    expect(warn.mock.calls[0]?.[0]).not.toHaveProperty('operation')
    expect(warn.mock.calls[1]?.[0]).not.toHaveProperty('operation')
  })

  it('writes under the name of the storage provider, so a host can filter on it', () => {
    const warn = jest.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined)

    logProviderFailure({ message: 'm' })

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'STORAGE_PROVIDER_CALL_FAILED' }),
      'StorageProvider',
    )
  })

  it('is not broken by a host logger that throws or rejects', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      throw new Error('host logger')
    })
    expect(() => {
      logProviderFailure({ message: 'm' })
    }).not.toThrow()
    jest.restoreAllMocks()
    const rejected = Promise.reject(new Error('host logger'))
    const handled = jest.fn()
    rejected.catch(handled)
    jest.spyOn(Logger.prototype, 'warn').mockReturnValue(rejected as never)

    logProviderFailure({ message: 'm' })

    await new Promise((resolve) => setImmediate(resolve))
    expect(handled).toHaveBeenCalledTimes(1)
  })
})
