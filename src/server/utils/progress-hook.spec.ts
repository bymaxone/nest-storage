/**
 * @fileoverview A caller's `onProgress` hook cannot change what an upload returns: one that throws leaves the
 * upload resolving with its stored result, on the single-shot path and on the multipart listener alike.
 * @layer server/utils
 */
import { EventEmitter } from 'node:events'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Upload } from '@aws-sdk/lib-storage'
import { BymaxStorageModule } from '../bymax-storage.module'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { StorageService } from '../services/storage.service'
import { emitProgress, forwardProgress } from './upload-support'

const THROWING = (): void => {
  throw new Error('host hook')
}

describe('emitProgress', () => {
  it('hands the hook the event, with total and part only when they are known', () => {
    const hook = jest.fn()

    emitProgress(hook, 5, 10, 2)
    emitProgress(hook, undefined, undefined)

    expect(hook).toHaveBeenNthCalledWith(1, { loaded: 5, total: 10, part: 2 })
    expect(hook).toHaveBeenNthCalledWith(2, { loaded: 0 })
  })

  it('does not throw when the hook throws', () => {
    expect(() => {
      emitProgress(THROWING, 1, 1)
    }).not.toThrow()
  })
})

describe('forwardProgress', () => {
  it('relays each event of the uploader, and a hook that throws does not reach the uploader', () => {
    const uploader = new EventEmitter()
    const hook = jest.fn(THROWING)
    forwardProgress(uploader as unknown as Upload, hook)

    expect(() =>
      uploader.emit('httpUploadProgress', { loaded: 3, total: 9, part: 1 }),
    ).not.toThrow()

    expect(hook).toHaveBeenCalledWith({ loaded: 3, total: 9, part: 1 })
  })

  it('adds no listener without a hook', () => {
    const uploader = new EventEmitter()

    forwardProgress(uploader as unknown as Upload, undefined)

    expect(uploader.listenerCount('httpUploadProgress')).toBe(0)
  })
})

describe('upload with a throwing onProgress', () => {
  it('resolves with the stored result when the single-shot upload succeeded', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const send = jest.fn().mockResolvedValue({ ETag: '"e"' })
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

    const result = await moduleRef
      .get(StorageService)
      .upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain', onProgress: THROWING })

    expect(result).toMatchObject({ key: 'a', etag: '"e"', multipart: false })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
