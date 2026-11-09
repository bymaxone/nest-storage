/**
 * @fileoverview QA's 17-row content-type probe against `getUploadUrl`, run twice: with a MIME
 * whitelist and with none. A whitelist narrows the types a caller may sign, but a control or
 * non-ASCII character is refused whether or not one is set.
 * @layer server/services
 */
import { Test } from '@nestjs/testing'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { SignedUrlService } from './signed-url.service'

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/o?X-Amz-Signature=sig'),
}))

type Outcome = 'signed' | 'STORAGE_MIME_NOT_ALLOWED' | 'STORAGE_VALIDATION_FAILED'

/** label, content type, outcome with the whitelist ['text/plain', 'image/*'], outcome with none. */
const ROWS: readonly (readonly [string, string, Outcome, Outcome])[] = [
  ['plain type', 'text/plain', 'signed', 'signed'],
  ['charset utf-8', 'text/plain; charset=utf-8', 'signed', 'signed'],
  ['tab before the parameter', 'text/plain;\tcharset=utf-8', 'signed', 'signed'],
  ['quoted parameter', 'text/plain; charset="utf-8"', 'signed', 'signed'],
  ['wildcard match', 'image/png', 'signed', 'signed'],
  ['wildcard match with parameter', 'image/png; name=a.png', 'signed', 'signed'],
  [
    'CR in the parameter',
    'text/plain; charset=utf-8\r',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  [
    'LF in the parameter',
    'text/plain; charset=utf-8\nx',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  [
    'CRLF header injection',
    'text/plain; charset=utf-8\r\nX-Injected: 1',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  [
    'NUL in the parameter',
    'text/plain; charset=utf\u00008',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  [
    'DEL in the parameter',
    'text/plain; charset=utf\u007f8',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  [
    'vertical tab in the parameter',
    'text/plain; charset=utf\u000b8',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  [
    'non-ASCII letter',
    'text/plain; charset=café',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  [
    'no-break space',
    'text/plain; charset=utf-8',
    'STORAGE_MIME_NOT_ALLOWED',
    'STORAGE_VALIDATION_FAILED',
  ],
  ['emoji', 'text/plain; name=\u{1F600}', 'STORAGE_MIME_NOT_ALLOWED', 'STORAGE_VALIDATION_FAILED'],
  ['comma list', 'text/plain; charset=utf-8, text/html', 'STORAGE_MIME_NOT_ALLOWED', 'signed'],
  ['type outside the whitelist', 'text/html', 'STORAGE_MIME_NOT_ALLOWED', 'signed'],
]

async function signerWith(mimeWhitelist?: string[]): Promise<SignedUrlService> {
  const options = {
    bucket: 'b',
    signedUrls: { defaultGetTtlSeconds: 300, defaultPutTtlSeconds: 300, maxTtlSeconds: 604800 },
    ...(mimeWhitelist === undefined ? {} : { validation: { mimeWhitelist } }),
  } as unknown as ResolvedBymaxStorageOptions
  const moduleRef = await Test.createTestingModule({
    providers: [
      SignedUrlService,
      { provide: BYMAX_STORAGE_OPTIONS, useValue: options },
      { provide: S3ClientProvider, useValue: { isConfigured: () => true, getClient: () => ({}) } },
      { provide: KeyResolverService, useValue: { normalize: (key: string) => key } },
    ],
  }).compile()
  return moduleRef.get(SignedUrlService)
}

async function outcomeOf(service: SignedUrlService, contentType: string): Promise<Outcome> {
  try {
    await service.getUploadUrl({ key: 'g70/object.txt', contentType })
    return 'signed'
  } catch (error) {
    return (error as { code: Outcome }).code
  }
}

/** The details of the error `getUploadUrl` throws for `contentType`, or `undefined` when it signs. */
async function detailsOf(
  service: SignedUrlService,
  contentType: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    await service.getUploadUrl({ key: 'g70/object.txt', contentType })
    return undefined
  } catch (error) {
    return (
      error as { getResponse: () => { error: { details?: Record<string, unknown> } } }
    ).getResponse().error.details
  }
}

describe('getUploadUrl content-type table', () => {
  it.each(ROWS.filter(([, , withWhitelist]) => withWhitelist === 'STORAGE_MIME_NOT_ALLOWED'))(
    'does not repeat a value that is not a header value in the whitelist error: %s',
    async (_label, contentType) => {
      const service = await signerWith(['text/plain', 'image/*'])

      const details = await detailsOf(service, contentType)

      // A type made of header characters is shown so the caller can see what was refused; any other is not.
      const printable = /^[\t \x21-\x7E]*$/.test(contentType)
      expect(details?.contentType).toBe(printable ? contentType : undefined)
      expect(details?.whitelist).toStrictEqual(['text/plain', 'image/*'])
      expect(JSON.stringify(details)).toContain(printable ? contentType.slice(0, 4) : 'whitelist')
    },
  )

  it.each(ROWS)('with a whitelist: %s', async (_label, contentType, withWhitelist) => {
    const service = await signerWith(['text/plain', 'image/*'])

    expect(await outcomeOf(service, contentType)).toBe(withWhitelist)
  })

  it.each(ROWS)(
    'without a whitelist: %s',
    async (_label, contentType, _withWhitelist, withoutWhitelist) => {
      const service = await signerWith()

      expect(await outcomeOf(service, contentType)).toBe(withoutWhitelist)
    },
  )
})
