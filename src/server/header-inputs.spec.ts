/**
 * @fileoverview Inventory of the public API: every per-call option that takes a caller string
 * must be classified as either bound for an HTTP header (or a signed query value) or not, and
 * every header-bound one must refuse a line break, a control character and a non-ASCII character
 * before any request is made, whether or not a MIME whitelist is set. A new string option fails
 * the first test until it is classified, so it cannot reach a header unchecked.
 * @layer server
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Test, type TestingModule } from '@nestjs/testing'
import { S3Client } from '@aws-sdk/client-s3'
import ts from 'typescript'
import { BymaxStorageModule } from './bymax-storage.module'
import { providerRecipes } from './config/provider-recipes'
import { SignedUrlService } from './services/signed-url.service'
import { StorageService } from './services/storage.service'

const INTERFACES = join(__dirname, 'interfaces')

/** Caller strings that become a header value, a header name or a signed query value. */
type Call = (bad: string) => Promise<unknown>

interface Bound {
  readonly call: Call
  /** Whether the whitelist is consulted first, so a refused type keeps its 1.1.9 code. */
  readonly whitelisted?: boolean
}

let storage: StorageService
let signed: SignedUrlService
let moduleRef: TestingModule

const body = (): Buffer => Buffer.from('x')

/** The header-bound option of every public method, by `Interface.property`. */
const HEADER_BOUND: Record<string, Bound> = {
  'UploadOptions.contentType': {
    call: (bad) => storage.upload({ key: 'k', body: body(), contentType: bad }),
  },
  'UploadOptions.cacheControl': {
    call: (bad) =>
      storage.upload({ key: 'k', body: body(), contentType: 'text/plain', cacheControl: bad }),
  },
  'UploadOptions.contentDisposition': {
    call: (bad) =>
      storage.upload({
        key: 'k',
        body: body(),
        contentType: 'text/plain',
        contentDisposition: bad,
      }),
  },
  'UploadOptions.kmsKeyId': {
    call: (bad) =>
      storage.upload({
        key: 'k',
        body: body(),
        contentType: 'text/plain',
        serverSideEncryption: 'aws:kms',
        kmsKeyId: bad,
      }),
  },
  'UploadOptions.metadata': {
    call: (bad) =>
      storage.upload({
        key: 'k',
        body: body(),
        contentType: 'text/plain',
        metadata: { owner: bad },
      }),
  },
  'CopyOptions.cacheControl': {
    call: (bad) => storage.copy({ sourceKey: 'a', destinationKey: 'b', cacheControl: bad }),
  },
  'DownloadOptions.range': { call: (bad) => storage.download({ key: 'k', range: bad }) },
  'DownloadOptions.ifNoneMatch': {
    call: (bad) => storage.download({ key: 'k', ifNoneMatch: bad }),
  },
  'DownloadOptions.ifMatch': { call: (bad) => storage.download({ key: 'k', ifMatch: bad }) },
  'SignedGetUrlOptions.responseContentDisposition': {
    call: (bad) => signed.getDownloadUrl({ key: 'k', responseContentDisposition: bad }),
  },
  'SignedGetUrlOptions.responseContentType': {
    call: (bad) => signed.getDownloadUrl({ key: 'k', responseContentType: bad }),
  },
  'SignedPutUrlOptions.contentType': {
    call: (bad) => signed.getUploadUrl({ key: 'k', contentType: bad }),
  },
  'SignedPutUrlOptions.metadata': {
    call: (bad) =>
      signed.getUploadUrl({ key: 'k', contentType: 'text/plain', metadata: { owner: bad } }),
  },
  'MultipartUploadUrlsOptions.contentType': {
    call: (bad) => signed.getMultipartUploadUrls({ key: 'k', contentType: bad, parts: 2 }),
  },
}

/** Every other string-typed option, with the reason it never reaches a header. */
const NOT_HEADER: Record<string, string> = {
  'UploadOptions.key': 'object key, normalised by KeyResolverService',
  'UploadOptions.bucket': 'bucket name, resolved into the request path or host by the SDK',
  'UploadOptions.idempotencyKey': 'local cache key, never sent',
  'CopyOptions.sourceKey': 'object key, normalised by KeyResolverService',
  'CopyOptions.destinationKey': 'object key, normalised by KeyResolverService',
  'CopyOptions.sourceBucket': 'bucket name, percent-encoded into CopySource',
  'CopyOptions.destinationBucket': 'bucket name, resolved into the request path or host by the SDK',
  'DeleteManyOptions.bucket': 'bucket name, resolved into the request path or host by the SDK',
  'DownloadOptions.key': 'object key, normalised by KeyResolverService',
  'DownloadOptions.bucket': 'bucket name, resolved into the request path or host by the SDK',
  'ListOptions.prefix': 'query parameter, encoded by the SDK',
  'ListOptions.bucket': 'bucket name, resolved into the request path or host by the SDK',
  'ListOptions.continuationToken': 'query parameter, encoded by the SDK',
  'ListOptions.delimiter': 'query parameter, encoded by the SDK',
  'SignedGetUrlOptions.key': 'object key, normalised by KeyResolverService',
  'SignedGetUrlOptions.bucket': 'bucket name, resolved into the request path or host by the SDK',
  'SignedPutUrlOptions.key': 'object key, normalised by KeyResolverService',
  'SignedPutUrlOptions.bucket': 'bucket name, resolved into the request path or host by the SDK',
  'MultipartUploadUrlsOptions.key': 'object key, normalised by KeyResolverService',
  'MultipartUploadUrlsOptions.bucket':
    'bucket name, resolved into the request path or host by the SDK',
  'LifecycleBucketOptions.bucket': 'bucket name, resolved into the request path or host by the SDK',
  'ExpirationRuleInput.id': 'lifecycle rule id, sent in an XML body',
  'ExpirationRuleInput.prefix': 'lifecycle rule prefix, sent in an XML body',
  'AbortMultipartRuleInput.id': 'lifecycle rule id, sent in an XML body',
  'AbortMultipartRuleInput.prefix': 'lifecycle rule prefix, sent in an XML body',
}

/** Per-call input interfaces: names ending in `Options` or `Input`, one `Interface.property` per string. */
function stringOptions(): string[] {
  const found: string[] = []
  for (const file of readdirSync(INTERFACES).filter((name) =>
    name.endsWith('-options.interface.ts'),
  )) {
    if (file === 'storage-module-options.interface.ts') {
      continue
    }
    const source = ts.createSourceFile(
      file,
      readFileSync(join(INTERFACES, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    source.forEachChild((node) => {
      if (!ts.isInterfaceDeclaration(node) || !/(Options|Input)$/.test(node.name.text)) {
        return
      }
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.type?.getText(source).includes('string')) {
          found.push(`${node.name.text}.${member.name.getText(source)}`)
        }
      }
    })
  }
  return found.sort()
}

/** Characters a header value cannot carry, each with the reason it matters. */
const BAD = [
  ['CRLF injection', 'x\r\nX-Injected: 1'],
  ['LF', 'x\ny'],
  ['NUL', 'x\u0000y'],
  ['DEL', 'x\u007Fy'],
  ['non-ASCII', 'café'],
] as const

describe('public API: caller strings bound for a header', () => {
  let send: jest.SpyInstance

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot(
          providerRecipes.minio({
            endpoint: 'http://127.0.0.1:9',
            bucket: 'b',
            accessKeyId: 'AK',
            secretAccessKey: 'SK',
          }),
        ),
      ],
    }).compile()
    await moduleRef.init()
    storage = moduleRef.get(StorageService)
    signed = moduleRef.get(SignedUrlService)
  })

  afterAll(async () => {
    await moduleRef.close()
  })

  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send')
  })

  afterEach(() => {
    send.mockRestore()
  })

  it('classifies every string option of every per-call interface, and nothing that no longer exists', () => {
    // A new option has to be added to one table, which is the moment to decide whether it is a header.
    const classified = [...Object.keys(HEADER_BOUND), ...Object.keys(NOT_HEADER)].sort()

    expect(stringOptions()).toStrictEqual(classified)
  })

  it('lists no option as both header-bound and not', () => {
    const both = Object.keys(HEADER_BOUND).filter((name) => name in NOT_HEADER)

    expect(both).toStrictEqual([])
  })

  describe.each(Object.entries(HEADER_BOUND))('%s', (_name, { call }) => {
    it.each(BAD)(
      'refuses %s with STORAGE_VALIDATION_FAILED before any request',
      async (_label, bad) => {
        const error: unknown = await call(bad).catch((err: unknown) => err)

        expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
        const details = (
          error as { getResponse: () => { error: { details: Record<string, unknown> } } }
        ).getResponse().error.details
        expect(typeof details.field).toBe('string')
        expect(typeof details.reason).toBe('string')
        expect(JSON.stringify(details)).not.toContain(bad)
        expect(send).not.toHaveBeenCalled()
      },
    )
  })
})
