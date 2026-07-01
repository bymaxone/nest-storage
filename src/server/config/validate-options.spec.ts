/**
 * @fileoverview Unit tests for `validateOptions` — structural validation,
 * lazy-credential tolerance, and the conditional field checks.
 * @layer server/config
 */
import { validateOptions } from './validate-options'
import type { StorageException } from '../errors/storage-exception'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

const valid: BymaxStorageModuleOptions = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

function reasonOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    const body = (error as StorageException).getResponse() as {
      error: { code: string; details: { reason: string } }
    }
    expect(body.error.code).toBe('STORAGE_INVALID_CONFIG')
    return body.error.details.reason
  }
  throw new Error('expected validateOptions to throw')
}

describe('validateOptions', () => {
  it('should accept valid minimal options', () => {
    // Happy path — every guard passes.
    expect(() => {
      validateOptions(valid)
    }).not.toThrow()
  })

  it('should tolerate empty credentials so operations can fail lazily', () => {
    // Empty credential strings are allowed at bootstrap.
    expect(() => {
      validateOptions({ ...valid, credentials: { accessKeyId: '', secretAccessKey: '' } })
    }).not.toThrow()
  })

  it('should throw when options is not an object', () => {
    // `isObject` left-false branch — with the exact reason string.
    expect(reasonOf(() => {
      validateOptions(undefined)
    })).toBe('options object is required')
  })

  it('should throw when options is null', () => {
    // `isObject` left-true (typeof null === object) and right-false branch.
    expect(reasonOf(() => {
      validateOptions(null)
    })).toBe('options object is required')
  })

  it.each([
    ['endpoint missing', { ...valid, endpoint: undefined as unknown as string }, 'options.endpoint must be a non-empty string'],
    ['endpoint empty', { ...valid, endpoint: '' }, 'options.endpoint must be a non-empty string'],
    ['endpoint non-string', { ...valid, endpoint: 123 as unknown as string }, 'options.endpoint must be a non-empty string'],
    ['region empty', { ...valid, region: '' }, 'options.region must be a non-empty string'],
    ['bucket empty', { ...valid, bucket: '' }, 'options.bucket must be a non-empty string'],
  ])('should throw STORAGE_INVALID_CONFIG with the field reason when %s', (_label, opts, reason) => {
    // Each structural string field is mandatory and reports its own actionable reason.
    expect(reasonOf(() => {
      validateOptions(opts)
    })).toBe(reason)
  })

  it('should throw when credentials is missing', () => {
    // `isObject(options.credentials)` left-false branch — with the exact reason.
    expect(reasonOf(() => {
      validateOptions({ ...valid, credentials: undefined as unknown as BymaxStorageModuleOptions['credentials'] })
    })).toBe('options.credentials is required')
  })

  it('should accept a positive signedUrls.maxTtlSeconds', () => {
    // `maxTtlSeconds <= 0` right-false branch.
    expect(() => {
      validateOptions({ ...valid, signedUrls: { maxTtlSeconds: 100 } })
    }).not.toThrow()
  })

  it('should throw when signedUrls.maxTtlSeconds is not positive', () => {
    // `maxTtlSeconds <= 0` right-true branch.
    expect(reasonOf(() => {
      validateOptions({ ...valid, signedUrls: { maxTtlSeconds: 0 } })
    })).toMatch(/maxTtlSeconds/)
  })

  it('should accept a multipart partSizeBytes of at least 5 MB', () => {
    // `partSizeBytes < 5 MB` right-false branch.
    expect(() => {
      validateOptions({ ...valid, multipart: { partSizeBytes: 5 * 1024 * 1024 } })
    }).not.toThrow()
  })

  it('should throw when multipart.partSizeBytes is below 5 MB', () => {
    // `partSizeBytes < 5 MB` right-true branch.
    expect(reasonOf(() => {
      validateOptions({ ...valid, multipart: { partSizeBytes: 1024 } })
    })).toMatch(/5 MB/)
  })

  it('should accept aws:kms with a kmsKeyId', () => {
    // SSE `&&` right-false branch (kmsKeyId present).
    expect(() => {
      validateOptions({ ...valid, serverSideEncryption: 'aws:kms', kmsKeyId: 'key-1' })
    }).not.toThrow()
  })

  it('should throw when aws:kms is set without a kmsKeyId', () => {
    // SSE `&&` both-true branch.
    expect(reasonOf(() => {
      validateOptions({ ...valid, serverSideEncryption: 'aws:kms' })
    })).toMatch(/kmsKeyId/)
  })
})
