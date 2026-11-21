/**
 * @fileoverview Unit tests for the request-header builders: Content-Disposition,
 * Cache-Control, server-side encryption (including the `'NONE'` sentinel), and
 * the ACL flag.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { buildACL, buildCacheControl, buildContentDisposition, buildSSE } from './header-utils'

describe('header-utils', () => {
  describe('buildContentDisposition', () => {
    it('falls back to the default when no per-call value is given', () => {
      // Default branch.
      expect(buildContentDisposition(undefined, 'inline')).toBe('inline')
    })

    it('prefers the per-call value over the default', () => {
      // Per-call override branch.
      expect(buildContentDisposition('attachment; filename="x"', 'inline')).toBe(
        'attachment; filename="x"',
      )
    })
  })

  describe('buildCacheControl', () => {
    it('falls back to the default when no per-call value is given', () => {
      // Default branch.
      expect(buildCacheControl(undefined, 'public, max-age=300')).toBe('public, max-age=300')
    })

    it('prefers the per-call value over the default', () => {
      // Per-call override branch.
      expect(buildCacheControl('no-store', 'public, max-age=300')).toBe('no-store')
    })
  })

  describe('buildSSE', () => {
    it('omits the header for the NONE sentinel even with a module default', () => {
      // The sentinel short-circuits any global default.
      expect(buildSSE('NONE', undefined, { serverSideEncryption: 'AES256' })).toEqual({})
    })

    it('returns an empty object when no SSE is configured anywhere', () => {
      // Neither per-call nor module SSE.
      expect(buildSSE(undefined, undefined, {})).toEqual({})
    })

    it('applies the module default when no per-call value is given', () => {
      // Falls back to module.serverSideEncryption.
      expect(buildSSE(undefined, undefined, { serverSideEncryption: 'AES256' })).toEqual({
        ServerSideEncryption: 'AES256',
      })
    })

    it('emits AES256 from a per-call value', () => {
      // Per-call AES256 branch.
      expect(buildSSE('AES256', undefined, {})).toEqual({ ServerSideEncryption: 'AES256' })
    })

    it('emits aws:kms with the per-call key id', () => {
      // KMS with an explicit per-call key.
      expect(buildSSE('aws:kms', 'key-id', {})).toEqual({
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: 'key-id',
      })
    })

    it('falls back to the module key id for aws:kms', () => {
      // KMS with the key id coming from module options.
      expect(buildSSE('aws:kms', undefined, { kmsKeyId: 'module-key' })).toEqual({
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: 'module-key',
      })
    })

    it('emits aws:kms without a key id when none is available', () => {
      // KMS with no key id at all.
      expect(buildSSE('aws:kms', undefined, {})).toEqual({ ServerSideEncryption: 'aws:kms' })
    })
  })

  describe('buildACL', () => {
    it.each<[string, boolean | undefined, boolean, 'public-read' | undefined]>([
      ['per-call true', true, false, 'public-read'],
      ['per-call false', false, true, undefined],
      ['default true', undefined, true, 'public-read'],
      ['default false', undefined, false, undefined],
    ])('%s → %s', (_label, perCall, defaultValue, expected) => {
      // Both ACL branches via per-call and default fallbacks.
      expect(buildACL(perCall, defaultValue)).toBe(expected)
    })

    it.each([['false'], ['true'], [0], [1], [null], [{}]])(
      'refuses a per-call flag of %p, which is not a boolean, instead of publishing the object',
      (value) => {
        // `'false'` is truthy: read as a flag it would make the object public-read.
        let thrown: unknown
        try {
          buildACL(value as never, false)
        } catch (error) {
          thrown = error
        }

        expect(thrown).toBeInstanceOf(StorageException)
        expect((thrown as StorageException).getResponse()).toMatchObject({
          error: {
            code: 'STORAGE_VALIDATION_FAILED',
            details: { field: 'publicRead', reason: 'must be a boolean' },
          },
        })
      },
    )
  })
})
