/**
 * @fileoverview Unit tests for `KeyResolverService` — the security-critical
 * path-traversal guard, prefix application, and prefix stripping.
 * @layer server/services
 */
import { KeyResolverService } from './key-resolver.service'
import { StorageException } from '../errors/storage-exception'
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
      'should reject path traversal: %s',
      (input) => {
        // `..`-segment guard.
        expect(() => makeService().normalize(input)).toThrow(StorageException)
      },
    )

    it('should reject an empty key', () => {
      // Empty-key guard.
      expect(() => makeService().normalize('')).toThrow(StorageException)
    })

    it('should reject a key containing a null byte', () => {
      // Null-byte guard.
      expect(() => makeService().normalize('a\0b')).toThrow(StorageException)
    })

    it('should reject a leading slash', () => {
      // Leading-slash guard.
      expect(() => makeService().normalize('/foo')).toThrow(StorageException)
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
