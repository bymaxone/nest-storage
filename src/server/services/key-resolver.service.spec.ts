/**
 * @fileoverview Unit tests for `KeyResolverService` — the security-critical
 * path-traversal guard, prefix application, and prefix stripping.
 * @layer server/services
 */
import { KeyResolverService } from './key-resolver.service'
import type { StorageException } from '../errors/storage-exception'
import { applyDefaults } from '../config/apply-defaults'

function makeService(keyPrefix = ''): KeyResolverService {
  const options = applyDefaults({
    endpoint: 'http://localhost',
    region: 'us-east-1',
    bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    keyPrefix,
  })
  return new KeyResolverService(options)
}

/** Runs `fn`, asserts it threw STORAGE_KEY_INVALID, and returns the details.reason. */
function reasonOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    const body = (error as StorageException).getResponse() as {
      error: { code: string; details: { reason: string } }
    }
    expect(body.error.code).toBe('STORAGE_KEY_INVALID')
    return body.error.details.reason
  }
  throw new Error('expected normalize to throw')
}

describe('KeyResolverService', () => {
  describe('normalize', () => {
    it('should return the key as-is when no prefix is configured', () => {
      // Empty-prefix constructor branch.
      expect(makeService().normalize('a/b.txt')).toBe('a/b.txt')
    })

    it('should prepend the configured prefix', () => {
      // Non-empty-prefix constructor branch.
      expect(makeService('tenant-x').normalize('a.txt')).toBe('tenant-x/a.txt')
    })

    it('should trim surrounding slashes from the prefix', () => {
      // Prefix normalization regex.
      expect(makeService('/tenant-x/').normalize('a.txt')).toBe('tenant-x/a.txt')
    })

    it('should preserve internal slashes in the prefix (only surrounding ones are trimmed)', () => {
      // The regex anchors are `^\/+` and `\/+$` — an internal slash is a real path
      // separator and must survive, so `a/b` becomes the prefix `a/b/`.
      expect(makeService('a/b').getPrefix()).toBe('a/b/')
      expect(makeService('a/b').normalize('c.txt')).toBe('a/b/c.txt')
    })

    it('should trim MULTIPLE leading slashes from the prefix', () => {
      // `^\/+` is one-or-more: two leading slashes must both go, not just one.
      expect(makeService('//tenant-x').getPrefix()).toBe('tenant-x/')
    })

    it('should trim MULTIPLE trailing slashes from the prefix', () => {
      // `\/+$` is one-or-more: two trailing slashes must both go, not just one.
      expect(makeService('tenant-x//').getPrefix()).toBe('tenant-x/')
    })

    it.each([['/'], ['///']])(
      'should treat an all-slash prefix as no prefix (no leading "/" leaks into the key): %s',
      (prefix) => {
        // All-slash prefix trims to empty — the resolved key must not start with "/".
        const key = makeService(prefix).normalize('a.txt')
        expect(key).toBe('a.txt')
        expect(key.startsWith('/')).toBe(false)
      },
    )

    it.each([['../etc/passwd'], ['a/../b'], ['../..'], ['./..'], ['a/b/../../c']])(
      'should reject path traversal with the ".." reason: %s',
      (input) => {
        // `..`-segment guard — carries the exact traversal reason in details.
        expect(reasonOf(() => makeService().normalize(input))).toBe(
          'Key must not contain ".." path segments',
        )
      },
    )

    it('should reject an empty key with its reason', () => {
      // Empty-key guard — exact reason string.
      expect(reasonOf(() => makeService().normalize(''))).toBe('Key must be a non-empty string')
    })

    it('should reject a key containing a null byte with its reason', () => {
      // Null-byte guard — exact reason string.
      expect(reasonOf(() => makeService().normalize('a\0b'))).toBe('Key must not contain null bytes')
    })

    it('should reject a leading slash with its reason', () => {
      // Leading-slash guard — exact reason string.
      expect(reasonOf(() => makeService().normalize('/foo'))).toBe('Key must not start with "/"')
    })

    it('should collapse duplicate slashes', () => {
      // Slash-collapse path.
      expect(makeService().normalize('a//b///c')).toBe('a/b/c')
    })
  })

  describe('stripPrefix', () => {
    it('should remove the prefix when present', () => {
      // Non-empty prefix that matches.
      expect(makeService('tenant-x').stripPrefix('tenant-x/a.txt')).toBe('a.txt')
    })

    it('should return the key unchanged when no prefix is configured', () => {
      // Empty-prefix branch.
      expect(makeService().stripPrefix('a.txt')).toBe('a.txt')
    })

    it('should return the key unchanged when the prefix does not match', () => {
      // Non-empty prefix that does not match.
      expect(makeService('tenant-x').stripPrefix('other/a.txt')).toBe('other/a.txt')
    })
  })

  describe('getPrefix', () => {
    it('should expose the resolved prefix', () => {
      // Read-only accessor.
      expect(makeService('tenant-x').getPrefix()).toBe('tenant-x/')
    })
  })
})
