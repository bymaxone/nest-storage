/**
 * @fileoverview The size checks on an upload body that are not about a stream's bytes as they flow:
 * a body read into memory for a pre-upload scan is compared with the size its caller declared.
 * @layer server/utils
 */
import { Readable } from 'node:stream'
import type { StorageException } from '../errors/storage-exception'
import { assertScannedSize } from './upload-body'

const THRESHOLD = 1000
const CONTEXT = { key: 'k', bucket: 'b' }

/** The code and details of the error the check throws, or `undefined` when it does not. */
function outcome(body: Buffer | Readable, declared: number | undefined): { code: string; details: Record<string, unknown> } | undefined {
  try {
    assertScannedSize(body, declared, THRESHOLD, CONTEXT)
  } catch (error) {
    const response = (error as StorageException).getResponse() as {
      error: { code: string; details: Record<string, unknown> }
    }
    return response.error
  }
  return undefined
}

describe('assertScannedSize', () => {
  it('accepts a buffer of exactly the declared size, and one with no declared size', () => {
    expect(outcome(Buffer.alloc(500), 500)).toBeUndefined()
    expect(outcome(Buffer.alloc(500), undefined)).toBeUndefined()
  })

  it('ignores a body that is still a stream', () => {
    expect(outcome(Readable.from([Buffer.alloc(5)]), 500)).toBeUndefined()
  })

  it('refuses a buffer longer than declared with STORAGE_SIZE_EXCEEDED naming the declared size', () => {
    expect(outcome(Buffer.alloc(501), 500)).toMatchObject({
      code: 'STORAGE_SIZE_EXCEEDED',
      details: { key: 'k', bucket: 'b', declaredSize: 500 },
    })
  })

  it('refuses a longer buffer even when the declared size is multipart-sized', () => {
    expect(outcome(Buffer.alloc(THRESHOLD + 1), THRESHOLD)?.code).toBe('STORAGE_SIZE_EXCEEDED')
  })

  it('refuses a shorter buffer when the declared size is below the multipart threshold', () => {
    expect(outcome(Buffer.alloc(10), THRESHOLD - 1)).toMatchObject({
      code: 'STORAGE_VALIDATION_FAILED',
      details: { field: 'size', declaredSize: THRESHOLD - 1, receivedSize: 10 },
    })
  })

  it('accepts a shorter buffer when the declared size is at or above the multipart threshold', () => {
    expect(outcome(Buffer.alloc(10), THRESHOLD)).toBeUndefined()
    expect(outcome(Buffer.alloc(10), THRESHOLD + 500)).toBeUndefined()
  })
})
