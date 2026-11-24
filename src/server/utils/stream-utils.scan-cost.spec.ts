/**
 * @fileoverview The root scan a stream read costs does not grow with the number of chunks: the read is
 * guarded as a whole, and each chunk is only followed and checked for a `then`.
 * @layer server/utils
 */
import { Readable } from 'node:stream'

import type * as Guard from './prototype-guard'
import { isRootRefusal } from './prototype-guard'
import { readStream, readStreamUpTo } from './stream-utils'

const scans = jest.fn()

jest.mock('./prototype-guard', () => {
  const actual = jest.requireActual<typeof Guard>('./prototype-guard')
  return {
    ...actual,
    assertCleanRoot: (): void => {
      scans()
      actual.assertCleanRoot()
    },
  }
})

/** A stream of `count` chunks of 16 KiB. */
function chunked(count: number): Readable {
  const chunk = Buffer.alloc(16384, 1)
  return Readable.from(
    (function* () {
      for (let i = 0; i < count; i++) yield chunk
    })(),
  )
}

/** The number of root scans one read of `count` chunks makes. */
async function scansFor(
  read: (stream: Readable) => Promise<unknown>,
  count: number,
): Promise<number> {
  scans.mockClear()
  await read(chunked(count))
  return scans.mock.calls.length
}

describe('the root scans of a stream read', () => {
  it('stay the same for 1 chunk and for 64 chunks, in readStream', async () => {
    // A scan per chunk made an 8 MiB read about 175 times slower; the count must not depend on the chunks.
    const few = await scansFor(readStream, 1)
    const many = await scansFor(readStream, 64)

    expect(few).toBeGreaterThan(0)
    expect(many).toBe(few)
  })

  it('stay the same for 1 chunk and for 64 chunks, in readStreamUpTo', async () => {
    // The size-bounded read walks the same chunk loop, so it holds the same property.
    const read = (stream: Readable): Promise<unknown> => readStreamUpTo(stream, 64 * 16384)
    const few = await scansFor(read, 1)
    const many = await scansFor(read, 64)

    expect(few).toBeGreaterThan(0)
    expect(many).toBe(few)
  })

  it('still refuse a key planted on the root prototype while the read runs and left in place', async () => {
    // The chunks carry no scan, so the plant is caught by the scan that closes the read, not lost.
    const root = Object.prototype as unknown as Record<string, unknown>
    const source = Readable.from(
      (function* () {
        yield Buffer.alloc(8, 1)
        root.plantedDuringRead = 1
        yield Buffer.alloc(8, 2)
      })(),
    )
    let refused: unknown
    try {
      await readStream(source)
    } catch (error) {
      refused = error
    } finally {
      Reflect.deleteProperty(root, 'plantedDuringRead')
    }

    expect(isRootRefusal(refused)).toBe(true)
  })

  it('refuse a chunk step that answers with an object carrying a then, without a scan of its own', async () => {
    // The step keeps the check of its answer: a forged `then` on the iterator result never reaches the loop.
    const forged = { done: true, value: undefined, then: (): void => undefined }
    const source = {
      [Symbol.asyncIterator]: () => ({
        next: () => ({
          then: (resolve: (answer: unknown) => void): void => {
            resolve(forged)
          },
        }),
      }),
    } as unknown as NodeJS.ReadableStream
    let refused: unknown
    try {
      await readStream(source)
    } catch (error) {
      refused = error
    }

    expect(isRootRefusal(refused)).toBe(true)
  })
})
