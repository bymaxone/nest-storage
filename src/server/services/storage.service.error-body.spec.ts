/**
 * @fileoverview What a client can read in the body of a failed call: never the text of the driver or
 * of the provider. A failure of the connection, of a deadline or of the provider's answer reaches a
 * host's default exception handler as `getResponse()`, so that body must hold a fixed `reason` and the
 * protocol-level `awsCode`, `httpStatus` and `requestId`, and nothing a client could use to map the
 * host (an address, a port, a driver sentence, a bucket detail the provider wrote). What the driver and
 * the provider said is in the library's warn entry, under `err`, a fresh error built from a fixed
 * projection and never the SDK's own, and `JSON.stringify` of the exception holds none of it. Driven through the real SDK.
 * @layer server/services
 */
import { createServer, type Server, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { inspect } from 'node:util'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { StorageException } from '../errors/storage-exception'
import { StorageService } from './storage.service'

const PROVIDER_SENTENCE = 'Please reduce your request rate for bucket-internal-7'
const DENIED_SENTENCE = 'Access Denied for arn:aws:iam::123456789012:user/internal-svc'

/** The details of a `StorageException`. */
function detailsOf(error: StorageException): Record<string, unknown> {
  const body = error.getResponse() as { error?: { details?: Record<string, unknown> } }
  return body.error?.details ?? {}
}

/** What a client would receive. */
function clientText(error: StorageException): string {
  return JSON.stringify(error.getResponse())
}

/** What the exception serializes to when a host passes the object itself to `JSON.stringify`. */
function wholeText(error: StorageException): string {
  return JSON.stringify(error)
}

describe('the body of a failed call', () => {
  let answering: Server
  let answeringPort: number
  let silent: Server
  let silentPort: number
  let closedPort: number
  let moduleRef: TestingModule | undefined
  let warn: jest.SpyInstance<void, [message: unknown, ...optionalParams: unknown[]]>
  let nextAnswer: { status: number; code: string; message: string } = {
    status: 500,
    code: '',
    message: '',
  }

  beforeAll(async () => {
    answering = createServer((req, res: ServerResponse) => {
      req.resume()
      req.on('end', () => {
        res.statusCode = nextAnswer.status
        res.setHeader('content-type', 'application/xml')
        res.setHeader('x-amz-request-id', 'REQ-123')
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${nextAnswer.code}</Code><Message>${nextAnswer.message}</Message></Error>`,
        )
      })
    })
    await new Promise<void>((resolve) => answering.listen(0, '127.0.0.1', resolve))
    answeringPort = (answering.address() as AddressInfo).port
    // Accepts the request and never answers.
    silent = createServer(() => undefined)
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    silentPort = (silent.address() as AddressInfo).port
    // A port nothing listens on: bound once to get a free number, then released.
    const probe = createNetServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    closedPort = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) =>
      probe.close(() => {
        resolve()
      }),
    )
  })

  afterAll(async () => {
    silent.closeAllConnections()
    await Promise.all(
      [answering, silent].map(
        (server) =>
          new Promise<void>((resolve) =>
            server.close(() => {
              resolve()
            }),
          ),
      ),
    )
  })

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await moduleRef?.close()
    moduleRef = undefined
  })

  /** The entries the library logged at warn level during the call. */
  function entries(): Record<string, unknown>[] {
    return warn.mock.calls.map((call) => call[0] as Record<string, unknown>)
  }

  /** What the library logged as `err`: the message of each fresh error. */
  function loggedErrors(): string {
    return entries()
      .map((entry) => (entry.err as Error).message)
      .join('\n')
  }

  /** The library's own fields of every entry, without `err`. */
  function outsideErr(): string {
    return JSON.stringify(
      entries().map((entry) =>
        Object.fromEntries(Object.entries(entry).filter(([k]) => k !== 'err')),
      ),
    )
  }

  async function failureOf(port: number, abortSignal?: AbortSignal): Promise<StorageException> {
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: `http://127.0.0.1:${String(port)}`,
          region: 'us-east-1',
          bucket: 'b',
          forcePathStyle: true,
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          maxAttempts: 1,
          requestTimeoutMs: 300,
        }),
      ],
    }).compile()
    await moduleRef.init()
    const error: unknown = await moduleRef
      .get(StorageService)
      .download({ key: 'k', ...(abortSignal ? { abortSignal } : {}) })
      .catch((err: unknown) => err)
    if (!(error instanceof StorageException)) {
      throw new Error(`expected a StorageException, got ${String(error)}`)
    }
    return error
  }

  it('does not tell a client where a refused connection was going, and keeps it for the logs', async () => {
    const error = await failureOf(closedPort)

    expect(detailsOf(error).reason).toBe('unreachable')
    expect(clientText(error)).not.toContain('127.0.0.1')
    expect(clientText(error)).not.toContain(String(closedPort))
    expect(clientText(error)).not.toMatch(/ECONN|connect|getaddrinfo|socket/i)
    // The host's logs still have it.
    expect(loggedErrors()).toContain(String(closedPort))
    expect(outsideErr()).not.toContain(String(closedPort))
  })

  it('does not tell a client what the SDK said about a deadline', async () => {
    const error = await failureOf(silentPort)

    expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
    expect(detailsOf(error).reason).toBe('timeout')
    expect(clientText(error)).not.toMatch(/requestTimeout|smithy|node-http-handler|300 ms/i)
    expect(loggedErrors()).toMatch(/requestTimeout|300/)
    expect(outsideErr()).not.toMatch(/requestTimeout|300 ms/)
  })

  it('does not repeat the sentence of a provider that is in trouble, and keeps the protocol facts', async () => {
    nextAnswer = { status: 500, code: 'SlowDown', message: PROVIDER_SENTENCE }
    const error = await failureOf(answeringPort)

    expect(detailsOf(error)).toMatchObject({
      reason: 'provider-error',
      awsCode: 'SlowDown',
      httpStatus: 500,
    })
    expect(clientText(error)).not.toContain('bucket-internal-7')
    expect(clientText(error)).not.toContain('reduce')
    expect(loggedErrors()).toContain('bucket-internal-7')
    expect(outsideErr()).not.toContain('bucket-internal-7')
  })

  it('does not repeat the sentence of a provider that refused the request', async () => {
    nextAnswer = { status: 403, code: 'AccessDenied', message: DENIED_SENTENCE }
    const error = await failureOf(answeringPort)

    expect(detailsOf(error)).toMatchObject({
      reason: 'rejected',
      awsCode: 'AccessDenied',
      httpStatus: 403,
    })
    expect(clientText(error)).not.toContain('arn:aws')
    expect(clientText(error)).not.toContain('internal-svc')
    expect(loggedErrors()).toContain('internal-svc')
    expect(outsideErr()).not.toContain('internal-svc')
  })

  it('keeps the request id the provider gave, so that its support can find the request', async () => {
    nextAnswer = { status: 500, code: 'InternalError', message: PROVIDER_SENTENCE }
    const error = await failureOf(answeringPort)

    expect(detailsOf(error).requestId).toBe('REQ-123')
  })

  it('keeps the error object off the exception, so even serializing the exception leaks nothing', async () => {
    // A host should send getResponse(); one that passes the exception itself to JSON.stringify must not
    // get the driver's text either, since no field of the exception holds it.
    nextAnswer = { status: 500, code: 'SlowDown', message: PROVIDER_SENTENCE }
    for (const port of [closedPort, silentPort, answeringPort]) {
      const error = await failureOf(port)

      expect(error.cause).toBeUndefined()
      expect(wholeText(error)).not.toMatch(/127\.0\.0\.1|ECONN|bucket-internal-7|requestTimeout/)
    }
  })

  it('logs a fixed projection of the error, never the error: no response, no header, no secret', async () => {
    // A logger serializes what it is given, so the entry holds named fields and a fresh error only.
    // The stand-in answers with a header and a message that carry a signature; none of it may reach
    // the entry, `err` included.
    nextAnswer = {
      status: 403,
      code: 'AccessDenied',
      message: 'Denied for X-Amz-Signature=abc123def&other AWSAccessKeyId=AKIASECRET99',
    }
    const error = await failureOf(answeringPort)
    const [entry] = entries()
    const whole = inspect(entry, { depth: 6 })

    expect(error).toMatchObject({ code: 'STORAGE_PROVIDER_ERROR' })
    expect(entries()).toHaveLength(1)
    expect(entry).toMatchObject({
      event: 'STORAGE_PROVIDER_CALL_FAILED',
      awsCode: 'AccessDenied',
      httpStatus: 403,
      requestId: 'REQ-123',
    })
    expect((entry?.err as Error & { awsCode?: string }).awsCode).toBe('AccessDenied')
    expect((entry?.err as Error).message).toContain('X-Amz-Signature=[redacted]')
    expect(whole).not.toMatch(/abc123def|AKIASECRET99/)
    expect(whole).not.toMatch(
      /\$response|\$metadata|x-amz-request-id|content-type|application\/xml|headers/i,
    )
    expect(whole).not.toMatch(/'k'|bucket/i)
  })

  it('says nothing about a request the caller cancelled', async () => {
    // The server never answers, so only the signal ends the call; the request timeout is later.
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort()
    }, 30)

    const error = await failureOf(silentPort, controller.signal)

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(warn).not.toHaveBeenCalled()
  })
})
