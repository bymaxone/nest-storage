/**
 * @fileoverview Tests for the shared MIME whitelist check: when it passes, and what its error shows.
 * @layer server/utils
 */
import type { StorageException } from '../errors/storage-exception'
import { assertMimeAllowed } from './mime-allowed'

/** The code and details of the StorageException the call throws, or fails the test when it does not. */
function refusal(fn: () => void): { code: string; details: Record<string, unknown> } {
  try {
    fn()
  } catch (err) {
    const body = (err as StorageException).getResponse() as {
      error: { code: string; details: Record<string, unknown> }
    }
    return body.error
  }
  throw new Error('expected the call to throw')
}

describe('assertMimeAllowed', () => {
  it.each([
    ['no whitelist', undefined],
    ['an empty whitelist', []],
  ])('passes any type with %s', (_label, whitelist) => {
    expect(() => {
      assertMimeAllowed(whitelist, 'text/html')
    }).not.toThrow()
    expect(() => {
      assertMimeAllowed(whitelist, 'x\r\ny')
    }).not.toThrow()
  })

  it('passes a type the whitelist allows', () => {
    expect(() => {
      assertMimeAllowed(['text/plain', 'image/*'], 'image/png; name=a.png')
    }).not.toThrow()
  })

  it('refuses a type outside the whitelist and shows it, without the configured whitelist', () => {
    const { code, details } = refusal(() => {
      assertMimeAllowed(['image/png'], 'text/html')
    })

    expect(code).toBe('STORAGE_MIME_NOT_ALLOWED')
    expect(details).toStrictEqual({ contentType: 'text/html' })
  })

  it('shows the media type alone, without its parameters', () => {
    // The parameters after `;` are the caller's text, and the type is what the whitelist was compared with.
    const { details } = refusal(() => {
      assertMimeAllowed(['image/png'], 'text/html; charset=utf-8; token=abc123')
    })

    expect(details).toStrictEqual({ contentType: 'text/html' })
  })

  it.each(['text/plain\r\nX-Injected: 1', 'text/plain\u0000', 'text/plain; name=café'])(
    'refuses %j without repeating it',
    (contentType) => {
      const { code, details } = refusal(() => {
        assertMimeAllowed(['text/plain'], contentType)
      })

      expect(code).toBe('STORAGE_MIME_NOT_ALLOWED')
      expect(details).toStrictEqual({})
    },
  )
})
