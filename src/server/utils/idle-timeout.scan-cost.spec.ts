/**
 * @fileoverview The root scans the idle guard makes do not grow with the number of chunks: the runtime is
 * checked before the first bytes and when the source ends.
 * @layer server/utils
 */
import { Readable } from 'node:stream'

import { withIdleTimeout } from './idle-timeout'
import type * as Guard from './prototype-guard'

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

/** Reads the wrapper to its end and answers how it ended. */
async function drain(wrapper: Readable): Promise<{ bytes: number; failure: unknown }> {
  let bytes = 0
  let failure: unknown
  wrapper.on('data', (chunk: Buffer) => {
    bytes += chunk.length
  })
  await new Promise<void>((resolve) => {
    wrapper.once('error', (error: unknown) => {
      failure = error
    })
    wrapper.once('close', resolve)
  })
  return { bytes, failure }
}

describe('the root scans of the idle guard', () => {
  it('stay the same for 2 chunks and for 64 chunks', async () => {
    // A scan per chunk made a 512-chunk stream about 25 times slower; the count must not depend on the chunks.
    scans.mockClear()
    await drain(withIdleTimeout(chunked(2), 1000))
    const few = scans.mock.calls.length
    scans.mockClear()
    await drain(withIdleTimeout(chunked(64), 1000))
    const many = scans.mock.calls.length

    expect(few).toBeGreaterThan(0)
    expect(many).toBe(few)
  })

  it('still refuse a key planted after the first chunk and left in place, before the stream ends', async () => {
    // The chunks after the first carry no scan, so the plant is caught by the scan made when the source ends.
    const root = Object.prototype as unknown as Record<string, unknown>
    // A source whose second step plants the key, so the plant is made after the first chunk was handed on.
    let steps = 0
    const source = {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<Buffer>> => {
          steps += 1
          if (steps === 2) root.zzPlantedAfterFirstChunk = 1
          return Promise.resolve(
            steps <= 2
              ? { done: false, value: Buffer.alloc(8, steps) }
              : { done: true, value: undefined },
          )
        },
      }),
    } as unknown as NodeJS.ReadableStream
    let outcome: { bytes: number; failure: unknown }
    try {
      outcome = await drain(withIdleTimeout(source, 1000))
    } finally {
      delete root.zzPlantedAfterFirstChunk
    }

    expect(outcome.failure).toBeInstanceOf(Error)
  })
})
