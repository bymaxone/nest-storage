/**
 * @fileoverview Unit tests for `applyDefaults` — default merging, credential
 * detection, public-base-URL derivation, and exact-optional handling.
 * @layer server/config
 */
import { inspect } from 'node:util'

import { applyDefaults } from './apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { IFileScanner } from '../interfaces/file-scanner.interface'
import type { IUploadValidator } from '../interfaces/upload-validator.interface'

const base: BymaxStorageModuleOptions = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

const validator: IUploadValidator = { name: 'v', validate: () => Promise.resolve({ ok: true }) }
const scanner: IFileScanner = {
  scan: () => Promise.resolve({ status: 'clean', engine: 'noop' }),
}

const full: BymaxStorageModuleOptions = {
  endpoint: 'http://localhost/',
  region: 'auto',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't' },
  forcePathStyle: true,
  publicBaseUrl: 'https://files.example.com',
  cdnBaseUrl: 'https://cdn.example.com',
  defaultPublicRead: true,
  keyPrefix: 'tenant-x',
  defaultCacheControl: 'no-cache',
  defaultContentDisposition: 'attachment',
  signedUrls: { defaultGetTtlSeconds: 60, defaultPutTtlSeconds: 120, maxTtlSeconds: 1000 },
  multipart: { thresholdBytes: 10_000_000, partSizeBytes: 6_000_000, queueSize: 8 },
  validation: { mimeWhitelist: ['image/png'], maxSizeBytes: 1000, customValidators: [validator] },
  scanner: { impl: scanner, mode: 'post-upload', rejectOnUnknown: true },
  serverSideEncryption: 'aws:kms',
  kmsKeyId: 'key-1',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  maxAttempts: 5,
  requestTimeoutMs: 60_000,
}

describe('applyDefaults', () => {
  it('should derive publicBaseUrl from endpoint + bucket when not provided', () => {
    // Default branch of the publicBaseUrl `??`.
    expect(applyDefaults(base).publicBaseUrl).toBe('http://localhost/b')
  })

  it('should keep an explicit publicBaseUrl and trim a trailing slash before deriving', () => {
    // Provided branch of the publicBaseUrl `??`.
    expect(applyDefaults(full).publicBaseUrl).toBe('https://files.example.com')
  })

  it('should mark hasCredentials true when both keys are present', () => {
    // Both operands of the `&&` are truthy.
    expect(applyDefaults(base).hasCredentials).toBe(true)
  })

  it('should mark hasCredentials false when the access key is empty', () => {
    // Left operand of the `&&` is falsy.
    const r = applyDefaults({ ...base, credentials: { accessKeyId: '', secretAccessKey: 's' } })
    expect(r.hasCredentials).toBe(false)
  })

  it('should mark hasCredentials false when the secret key is empty', () => {
    // Right operand of the `&&` is falsy.
    const r = applyDefaults({ ...base, credentials: { accessKeyId: 'k', secretAccessKey: '' } })
    expect(r.hasCredentials).toBe(false)
  })

  it('should apply every default when only the required fields are provided', () => {
    // Default branch of every `??` and absence branch of every conditional spread.
    const r = applyDefaults(base)
    expect(r.forcePathStyle).toBe(false)
    expect(r.defaultPublicRead).toBe(false)
    expect(r.keyPrefix).toBe('')
    expect(r.defaultCacheControl).toBe('public, max-age=31536000, immutable')
    expect(r.defaultContentDisposition).toBe('inline')
    expect(r.signedUrls).toEqual({
      defaultGetTtlSeconds: 300,
      defaultPutTtlSeconds: 300,
      maxTtlSeconds: 604_800,
    })
    expect(r.multipart).toEqual({
      thresholdBytes: 5_242_880,
      partSizeBytes: 5_242_880,
      queueSize: 4,
    })
    expect(r.requestChecksumCalculation).toBe('WHEN_SUPPORTED')
    expect(r.responseChecksumValidation).toBe('WHEN_SUPPORTED')
    expect(r.maxAttempts).toBe(3)
    expect(r.requestTimeoutMs).toBe(30_000)
    expect(r.cdnBaseUrl).toBeUndefined()
    expect(r.validation).toBeUndefined()
    expect(r.scanner).toBeUndefined()
    expect(r.serverSideEncryption).toBeUndefined()
    expect(r.kmsKeyId).toBeUndefined()
    expect(r.credentials.sessionToken).toBeUndefined()
    // The conditional spreads must OMIT the keys entirely (not set them to undefined),
    // so `exactOptionalPropertyTypes` holds — the `in` check distinguishes absence from
    // a present-but-undefined value that `toBeUndefined()` alone cannot catch.
    expect('cdnBaseUrl' in r).toBe(false)
    expect('validation' in r).toBe(false)
    expect('scanner' in r).toBe(false)
    expect('serverSideEncryption' in r).toBe(false)
    expect('kmsKeyId' in r).toBe(false)
  })

  it('should strip every trailing slash from the endpoint when deriving publicBaseUrl', () => {
    // The trailing-slash regex is `/\/+$/` (one-or-more) with an empty replacement:
    // multiple trailing slashes must all collapse, and the replacement must be '' —
    // never a single-slash strip and never an injected sentinel string.
    expect(applyDefaults({ ...base, endpoint: 'http://localhost///' }).publicBaseUrl).toBe(
      'http://localhost/b',
    )
  })

  it('should pass through every provided option', () => {
    // Provided branch of every `??` and presence branch of every conditional spread.
    const r = applyDefaults(full)
    expect(r.forcePathStyle).toBe(true)
    expect(r.defaultPublicRead).toBe(true)
    expect(r.keyPrefix).toBe('tenant-x')
    expect(r.defaultCacheControl).toBe('no-cache')
    expect(r.defaultContentDisposition).toBe('attachment')
    expect(r.signedUrls).toEqual({
      defaultGetTtlSeconds: 60,
      defaultPutTtlSeconds: 120,
      maxTtlSeconds: 1000,
    })
    expect(r.multipart).toEqual({
      thresholdBytes: 10_000_000,
      partSizeBytes: 6_000_000,
      queueSize: 8,
    })
    expect(r.requestChecksumCalculation).toBe('WHEN_REQUIRED')
    expect(r.responseChecksumValidation).toBe('WHEN_REQUIRED')
    expect(r.maxAttempts).toBe(5)
    expect(r.requestTimeoutMs).toBe(60_000)
    expect(r.cdnBaseUrl).toBe('https://cdn.example.com')
    expect(r.validation).toBe(full.validation)
    expect(r.scanner).toBe(full.scanner)
    expect(r.serverSideEncryption).toBe('aws:kms')
    expect(r.kmsKeyId).toBe('key-1')
    expect(r.credentials.sessionToken).toBe('t')
  })

  it('should keep the credentials out of every incidental serialization path', () => {
    // The resolved options are injected into every service, so whatever
    // serializes one of them incidentally reaches this object: a structured
    // logger rendering its arguments, an error reporter capturing the scope of
    // a throw, an object spread. A circular-safe stringifier stands in for the
    // logger because that is what pino and winston use, and because plain
    // `JSON.stringify` only fails here by accident — it throws on the S3
    // client's circular graph rather than by withholding anything.
    const secret = 'wJalrXUtnFEMI-canary'
    const r = applyDefaults({
      ...base,
      credentials: { accessKeyId: 'AKIA', secretAccessKey: secret },
    })

    const safeStringify = (value: unknown): string => {
      const seen = new WeakSet()
      return JSON.stringify(value, (_key: string, val: unknown): unknown => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        return val
      })
    }

    expect(safeStringify(r)).not.toContain(secret)
    expect(safeStringify({ ...r })).not.toContain(secret)
    expect(inspect(r, { depth: null })).not.toContain(secret)
    // `showHidden` is why the property is an accessor and not merely a
    // non-enumerable value: a hidden data property is still printed here.
    expect(inspect(r, { depth: null, showHidden: true })).not.toContain(secret)
    expect(Object.keys(r)).not.toContain('credentials')
    // …and the accessor has to be non-configurable, which is the guarantee behind all of the
    // above. A configurable one can be redefined back into a plain enumerable value by anything
    // holding the object — the exact serialization these assertions exist to prevent — and this
    // object is injected into every service. Nothing else here can tell `false` from `true`,
    // because every assertion above passes either way, and this options object is NOT frozen, so
    // the flag is the only thing enforcing it.
    const descriptor = Object.getOwnPropertyDescriptor(r, 'credentials')
    expect(descriptor?.configurable).toBe(false)
    expect(() => {
      Object.defineProperty(r, 'credentials', { value: 'rewritten', enumerable: true })
    }).toThrow(TypeError)
  })

  it('should still expose the credentials to code that reads them on purpose', () => {
    // Containment must cost nothing at the supported surface: the S3 client
    // provider reads these fields to authenticate, so hiding the property from
    // serialization must not hide it from property access.
    const r = applyDefaults({
      ...base,
      credentials: { accessKeyId: 'AKIA', secretAccessKey: 's3cret', sessionToken: 'tok' },
    })

    expect(r.credentials.accessKeyId).toBe('AKIA')
    expect(r.credentials.secretAccessKey).toBe('s3cret')
    expect(r.credentials.sessionToken).toBe('tok')
    expect(r.hasCredentials).toBe(true)
  })

  it('should shallow-merge a partial signedUrls over the defaults', () => {
    // Present branch of `options.signedUrls ?? {}` with a partial object.
    const r = applyDefaults({ ...base, signedUrls: { defaultGetTtlSeconds: 60 } })
    expect(r.signedUrls.defaultGetTtlSeconds).toBe(60)
    expect(r.signedUrls.maxTtlSeconds).toBe(604_800)
  })
})
