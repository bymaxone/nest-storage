/**
 * @fileoverview The size checks on an upload body that are not about a stream's bytes as they flow:
 * a body read into memory for a pre-upload scan is compared with the size its caller declared.
 * @layer server/utils
 */
import { Readable } from 'node:stream'
import type { StorageException } from '../errors/storage-exception'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { assertScannedSize, boundStreamSize } from './upload-body'

const THRESHOLD = 1000
const CONTEXT = { key: 'k', bucket: 'b' }

/** The code and details of the error the check throws, or `undefined` when it does not. */
function outcome(body: Buffer | Readable, declared: number | undefined): { code: string; details: Record<string, unknown> } | undefined {
  try {
    assertScannedSize(body, declared, CONTEXT)
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

  it('refuses a shorter buffer when the declared size is at or above the multipart threshold', () => {
    for (const declared of [THRESHOLD, THRESHOLD + 500]) {
      expect(outcome(Buffer.alloc(10), declared)).toMatchObject({
        code: 'STORAGE_VALIDATION_FAILED',
        details: { field: 'size', declaredSize: declared, receivedSize: 10 },
      })
    }
  })
})

describe('boundStreamSize', () => {
  const options = (maxSizeBytes?: number): ResolvedBymaxStorageOptions =>
    ({
      multipart: { thresholdBytes: THRESHOLD },
      ...(maxSizeBytes === undefined ? {} : { validation: { maxSizeBytes } }),
    }) as unknown as ResolvedBymaxStorageOptions

  async function read(body: unknown): Promise<{ bytes: number; error: unknown }> {
    let bytes = 0
    try {
      for await (const chunk of body as AsyncIterable<Buffer>) bytes += chunk.length
      return { bytes, error: undefined }
    } catch (error) {
      return { bytes, error }
    }
  }

  it('leaves a buffer alone, and a stream with no declared size and no maximum', () => {
    const buffer = Buffer.alloc(5)
    const stream = Readable.from([Buffer.alloc(5)])

    expect(boundStreamSize(buffer, 5, options())).toBe(buffer)
    expect(boundStreamSize(stream, undefined, options())).toBe(stream)
  })

  it('holds a single-shot stream to exactly its declared size: shorter fails with a shortfall, longer with a limit', async () => {
    expect((await read(boundStreamSize(Readable.from([Buffer.alloc(120)]), 500, options()))).error).toMatchObject({
      name: 'SizeShortfallError',
    })
    expect((await read(boundStreamSize(Readable.from([Buffer.alloc(600)]), 500, options()))).error).toMatchObject({
      name: 'SizeLimitError',
      kind: 'declared',
    })
    expect((await read(boundStreamSize(Readable.from([Buffer.alloc(500)]), 500, options()))).error).toBeUndefined()
  })

  it('holds a multipart-sized stream to its declared size too: shorter fails with a shortfall, longer with a limit', async () => {
    const shorter = await read(boundStreamSize(Readable.from([Buffer.alloc(120)]), THRESHOLD + 500, options()))
    const longer = await read(boundStreamSize(Readable.from([Buffer.alloc(THRESHOLD + 600)]), THRESHOLD + 500, options()))

    expect(shorter.error).toMatchObject({ name: 'SizeShortfallError', declaredBytes: THRESHOLD + 500, receivedBytes: 120 })
    expect(longer.error).toMatchObject({ name: 'SizeLimitError', kind: 'declared' })
  })

  it('caps a stream with no declared size at the maximum', async () => {
    const outcome = await read(boundStreamSize(Readable.from([Buffer.alloc(30)]), undefined, options(20)))

    expect(outcome.error).toMatchObject({ name: 'SizeLimitError', kind: 'max', limitBytes: 20 })
  })
})

