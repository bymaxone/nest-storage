/**
 * @fileoverview Every key the library returns can be passed straight back to it. A
 * local HTTP server records the real requests the SDK sends, so the check is on the
 * wire path and not on a mock: with a `keyPrefix` set, a returned key must not
 * carry the prefix, or feeding it back would address `prefix/prefix/key`.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { SignedUrlService } from './signed-url.service'
import { StorageService } from './storage.service'

const LIST_XML = (keys: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${keys
    .map((k) => `<Contents><Key>${k}</Key><Size>3</Size><ETag>"abc"</ETag></Contents>`)
    .join('')}</ListBucketResult>`

describe('keys the library returns can be passed back', () => {
  let server: Server
  let port: number
  let paths: string[] = []
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        const url = req.url ?? ''
        paths.push(`${req.method ?? ''} ${url.split('?')[0] ?? ''}`)
        res.setHeader('ETag', '"abc"')
        if (req.headers['x-amz-copy-source'] !== undefined) {
          res.setHeader('Content-Type', 'application/xml')
          res.end('<CopyObjectResult><ETag>"abc"</ETag></CopyObjectResult>')
        } else if (url.includes('list-type=2')) {
          res.setHeader('Content-Type', 'application/xml')
          res.end(LIST_XML(['tenant/listed.txt']))
        } else if (req.method === 'DELETE') {
          res.statusCode = 204
          res.end()
        } else {
          res.setHeader('Content-Type', 'text/plain')
          res.setHeader('Content-Length', '3')
          res.end(req.method === 'HEAD' ? undefined : 'abc')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  afterEach(async () => {
    await moduleRef?.close()
    moduleRef = undefined
    paths = []
  })

  async function setup(
    keyPrefix: string,
  ): Promise<{ storage: StorageService; signed: SignedUrlService }> {
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
          keyPrefix,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return { storage: moduleRef.get(StorageService), signed: moduleRef.get(SignedUrlService) }
  }

  it('returns upload and head keys without the prefix, and the wire path carries it exactly once', async () => {
    const { storage } = await setup('tenant')

    const uploaded = await storage.upload({ key: 'a.txt', body: Buffer.from('abc'), contentType: 'text/plain' })
    const head = await storage.head(uploaded.key)

    expect(uploaded.key).toBe('a.txt')
    expect(head.key).toBe('a.txt')
    expect(paths).toEqual(['PUT /b/tenant/a.txt', 'HEAD /b/tenant/a.txt'])
  })

  it('keeps the public URL complete, prefix included', async () => {
    const { storage } = await setup('tenant')

    const uploaded = await storage.upload({ key: 'a.txt', body: Buffer.from('abc'), contentType: 'text/plain' })

    expect(uploaded.publicUrl).toBe(`http://127.0.0.1:${String(port)}/b/tenant/a.txt`)
  })

  it('addresses the same object when the returned key is fed to every method', async () => {
    const { storage, signed } = await setup('tenant')
    const uploaded = await storage.upload({ key: 'dir/a.txt', body: Buffer.from('abc'), contentType: 'text/plain' })
    paths = []

    await storage.head(uploaded.key)
    await storage.exists(uploaded.key)
    const downloaded = await storage.download({ key: uploaded.key })
    downloaded.stream.resume()
    await storage.downloadBuffer({ key: uploaded.key })
    await storage.copy({ sourceKey: uploaded.key, destinationKey: 'copy.txt' })
    await storage.delete(uploaded.key)
    const get = await signed.getDownloadUrl({ key: uploaded.key })
    const put = await signed.getUploadUrl({ key: uploaded.key, contentType: 'text/plain' })

    expect(paths.every((p) => p.endsWith('/b/tenant/dir/a.txt') || p === 'PUT /b/tenant/copy.txt')).toBe(true)
    expect(paths.join('\n')).not.toContain('tenant/tenant')
    expect(new URL(get.url).pathname).toBe('/b/tenant/dir/a.txt')
    expect(new URL(put.url).pathname).toBe('/b/tenant/dir/a.txt')
  })

  it('addresses the same object when a listed key is fed to download', async () => {
    const { storage } = await setup('tenant')

    const page = await storage.list({ prefix: '' })
    const listedKey = page.objects[0]?.key ?? ''
    paths = []
    const downloaded = await storage.download({ key: listedKey })
    downloaded.stream.resume()

    expect(listedKey).toBe('listed.txt')
    expect(paths).toEqual(['GET /b/tenant/listed.txt'])
  })

  it('returns the same relative key from the download metadata', async () => {
    const { storage } = await setup('tenant')

    const downloaded = await storage.download({ key: 'a.txt' })
    downloaded.stream.resume()
    const buffered = await storage.downloadBuffer({ key: 'a.txt' })

    expect(downloaded.metadata.key).toBe('a.txt')
    expect(buffered.metadata.key).toBe('a.txt')
  })

  it('behaves the same with no prefix', async () => {
    const { storage } = await setup('')

    const uploaded = await storage.upload({ key: 'a.txt', body: Buffer.from('abc'), contentType: 'text/plain' })
    await storage.head(uploaded.key)

    expect(uploaded.key).toBe('a.txt')
    expect(paths).toEqual(['PUT /b/a.txt', 'HEAD /b/a.txt'])
  })
})
