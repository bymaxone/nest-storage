/**
 * @fileoverview The root scans that presigning the parts of a multipart upload costs do not grow with the
 * number of parts: the batch is guarded as a whole, and each part is only followed and checked for a `then`.
 * @layer server/services
 */
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}))

import { Test } from '@nestjs/testing'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { SignedUrlService } from './signed-url.service'
import { KeyResolverService } from './key-resolver.service'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type * as Guard from '../utils/prototype-guard'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'

const scans = jest.fn()

jest.mock('../utils/prototype-guard', () => {
  const actual = jest.requireActual<typeof Guard>('../utils/prototype-guard')
  return {
    ...actual,
    assertCleanRoot: (): void => {
      scans()
      actual.assertCleanRoot()
    },
  }
})

const URL_OF_PART = 'https://s3.example.com/bucket/key?X-Amz-Signature=abc'

async function service(): Promise<SignedUrlService> {
  const client = { send: jest.fn().mockResolvedValue({ UploadId: 'upload-1' }) }
  const options = {
    bucket: 'b',
    signedUrls: { defaultGetTtlSeconds: 300, defaultPutTtlSeconds: 300, maxTtlSeconds: 604800 },
    keyPrefix: '',
    hasCredentials: true,
    region: 'us-east-1',
  } as unknown as ResolvedBymaxStorageOptions
  const module = await Test.createTestingModule({
    providers: [
      SignedUrlService,
      { provide: BYMAX_STORAGE_OPTIONS, useValue: options },
      {
        provide: S3ClientProvider,
        useValue: { isConfigured: () => true, getClient: () => client },
      },
      { provide: KeyResolverService, useValue: { normalize: (key: string) => key } },
    ],
  }).compile()
  return module.get(SignedUrlService)
}

/** The number of root scans one request for `parts` part URLs makes. */
async function scansFor(parts: number): Promise<number> {
  ;(getSignedUrl as jest.Mock).mockResolvedValue(URL_OF_PART)
  const subject = await service()
  scans.mockClear()
  const result = await subject.getMultipartUploadUrls({ key: 'k', contentType: 'image/png', parts })
  expect(result.partUrls).toHaveLength(parts)
  return scans.mock.calls.length
}

describe('the root scans of presigning the parts of a multipart upload', () => {
  it('stay the same for 2 parts and for 64 parts', async () => {
    // A scan per part made 1,000 parts take about a second; the count must not depend on the parts.
    const few = await scansFor(2)
    const many = await scansFor(64)

    expect(few).toBeGreaterThan(0)
    expect(many).toBe(few)
  })
})
