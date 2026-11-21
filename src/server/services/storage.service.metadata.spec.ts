/**
 * @fileoverview The `metadata` of an upload is the caller's object, and what is checked is what is sent: the pairs
 * are read once, an object that is not an object of pairs is refused before any request, and a pair that throws
 * when read fails with the library's code and the error as the cause.
 * @layer server/services
 */
import type { PutObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { Test } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { StorageService } from './storage.service'

async function serviceWith(send: jest.Mock<unknown, [unknown]>): Promise<StorageService> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BymaxStorageModule.forRoot({
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'b',
        credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      }),
    ],
  })
    .overrideProvider(S3ClientProvider)
    .useValue({
      isConfigured: () => true,
      getClient: () => ({ send }),
      getClientOrNull: () => null,
    })
    .compile()
  return moduleRef.get(StorageService)
}

const REQUEST = { key: 'a', body: Buffer.from('x'), contentType: 'text/plain' }

describe('StorageService — upload metadata', () => {
  it('sends the pairs it checked, even when a value answers differently on a later read', async () => {
    // A value that is plain text on the first read and a header-splitting line afterwards must not pass the check
    // and be sent.
    const send = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ ETag: '"e"' })
    const service = await serviceWith(send)
    let reads = 0
    const metadata: Record<string, string> = {}
    Object.defineProperty(metadata, 'owner', {
      enumerable: true,
      get: () => {
        reads += 1
        return reads === 1 ? 'alice' : 'alice\r\nx-amz-acl: public-read'
      },
    })

    await service.upload({ ...REQUEST, metadata })

    const readsDuringUpload = reads
    const input = (send.mock.calls[0]?.[0] as PutObjectCommand).input
    expect(readsDuringUpload).toBe(1)
    expect(input.Metadata).toStrictEqual({ owner: 'alice' })
  })

  it.each([
    ['a Map', new Map([['owner', 'alice']])],
    ['a string', 'abc'],
    ['an array', ['a']],
    ['null', null],
  ])('refuses metadata that is %s, and sends nothing', async (_label, metadata) => {
    const send = jest.fn<unknown, [unknown]>()
    const service = await serviceWith(send)

    await expect(service.upload({ ...REQUEST, metadata: metadata as never })).rejects.toMatchObject(
      {
        response: { error: { code: 'STORAGE_VALIDATION_FAILED', details: { field: 'metadata' } } },
      },
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('fails with the library code and the host error as the cause when a pair throws when read', async () => {
    const send = jest.fn<unknown, [unknown]>()
    const service = await serviceWith(send)
    const failure = new Error('SENTINEL pair getter ran')
    const metadata: Record<string, string> = {}
    Object.defineProperty(metadata, 'owner', {
      enumerable: true,
      get: () => {
        throw failure
      },
    })

    const thrown = await service.upload({ ...REQUEST, metadata }).catch((error: unknown) => error)

    expect(thrown).toMatchObject({
      response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
      cause: failure,
    })
    expect(JSON.stringify((thrown as { response: unknown }).response)).not.toContain('SENTINEL')
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['size', 'body', 'contentType', 'metadata'])(
    'fails with the library code and the host error as the cause when the request field %s throws when read',
    async (field) => {
      const send = jest.fn<Promise<unknown>, [unknown]>()
      const service = await serviceWith(send)
      const failure = new Error('SENTINEL request getter ran')
      const request = { ...REQUEST }
      Object.defineProperty(request, field, {
        enumerable: true,
        get: () => {
          throw failure
        },
      })

      const thrown = await service.upload(request as never).catch((error: unknown) => error)

      expect(thrown).toMatchObject({
        response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
        cause: failure,
      })
      expect(JSON.stringify((thrown as { response: unknown }).response)).not.toContain('SENTINEL')
      expect(send).not.toHaveBeenCalled()
    },
  )

  it('fails with the library code and the host error as the cause when the metadata throws when its kind is read', async () => {
    const send = jest.fn<Promise<unknown>, [unknown]>()
    const service = await serviceWith(send)
    const failure = new Error('SENTINEL tag getter ran')
    const metadata = {
      get [Symbol.toStringTag](): string {
        throw failure
      },
    }

    const thrown = await service.upload({ ...REQUEST, metadata }).catch((error: unknown) => error)

    expect(thrown).toMatchObject({
      response: { error: { code: 'STORAGE_VALIDATION_FAILED', details: { field: 'metadata' } } },
      cause: failure,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('destroys a stream body the caller handed over when a later field of the request throws when read', async () => {
    // The copy of the request fails after it has read the body, and the stream is the library's to release.
    const send = jest.fn<Promise<unknown>, [unknown]>()
    const service = await serviceWith(send)
    const stream = new Readable({ read() {} })
    const request = { key: 'a', body: stream, contentType: 'text/plain' }
    Object.defineProperty(request, 'metadata', {
      enumerable: true,
      get: () => {
        throw new Error('SENTINEL metadata getter ran')
      },
    })

    const thrown = await service.upload(request as never).catch((error: unknown) => error)

    expect(thrown).toMatchObject({ response: { error: { code: 'STORAGE_VALIDATION_FAILED' } } })
    expect(stream.destroyed).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('releases nothing and still refuses when the body field itself throws when read', async () => {
    const send = jest.fn<Promise<unknown>, [unknown]>()
    const service = await serviceWith(send)
    const request = { key: 'a', contentType: 'text/plain' }
    Object.defineProperty(request, 'body', {
      enumerable: true,
      get: () => {
        throw new Error('SENTINEL body getter ran')
      },
    })

    await expect(service.upload(request as never)).rejects.toMatchObject({
      response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
    })
  })
})
