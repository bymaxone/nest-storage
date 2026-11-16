/**
 * @fileoverview What a client can read in the body of a failed call: never the text of the driver or
 * of the provider. A failure of the connection, of a deadline or of the provider's answer reaches a
 * host's default exception handler as `getResponse()`, so that body must hold a fixed `reason` and the
 * protocol-level `awsCode`, `httpStatus` and `requestId`, and nothing a client could use to map the
 * host (an address, a port, a driver sentence, a bucket detail the provider wrote). The original error
 * rides on `cause`, which is for the host's own logs. Driven through the real SDK.
 * @layer server/services
 */
import { createServer, type Server, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
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

/** The text of the original failure, for the host's own logs. */
function causeText(error: StorageException): string {
  return error.cause instanceof Error ? error.cause.message : String(error.cause)
}

describe('the body of a failed call', () => {
  let answering: Server
  let answeringPort: number
  let silent: Server
  let silentPort: number
  let closedPort: number
  let moduleRef: TestingModule | undefined
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

  afterEach(async () => {
    await moduleRef?.close()
    moduleRef = undefined
  })

  async function failureOf(port: number): Promise<StorageException> {
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
      .download({ key: 'k' })
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
    expect(causeText(error)).toContain(String(closedPort))
  })

  it('does not tell a client what the SDK said about a deadline', async () => {
    const error = await failureOf(silentPort)

    expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
    expect(detailsOf(error).reason).toBe('timeout')
    expect(clientText(error)).not.toMatch(/requestTimeout|smithy|node-http-handler|300 ms/i)
    expect(causeText(error)).toMatch(/requestTimeout|300/)
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
    expect(causeText(error)).toContain('bucket-internal-7')
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
    expect(causeText(error)).toContain('internal-svc')
  })

  it('keeps the request id the provider gave, so that its support can find the request', async () => {
    nextAnswer = { status: 500, code: 'InternalError', message: PROVIDER_SENTENCE }
    const error = await failureOf(answeringPort)

    expect(detailsOf(error).requestId).toBe('REQ-123')
  })

  it('holds no string of an Error in any details value', async () => {
    // The boundary in one assertion: nothing the original error said is in what a client reads. A host
    // must send getResponse() and never the exception object itself, whose cause carries the text.
    nextAnswer = { status: 500, code: 'SlowDown', message: PROVIDER_SENTENCE }
    for (const port of [closedPort, silentPort, answeringPort]) {
      const error = await failureOf(port)
      const original = causeText(error)

      expect(error.cause).toBeInstanceOf(Error)
      expect(original.length).toBeGreaterThan(0)
      expect(clientText(error)).not.toContain(original)
    }
  })
})
