/**
 * @fileoverview The ceiling on a timer duration is the value Node documents, 2**31 - 1 milliseconds.
 * @layer server/constants
 */
import { MAX_TIMER_MS } from './timer.constants'

describe('timer constants', () => {
  it('holds the longest delay Node gives a timer before it clamps it to 1 ms', () => {
    // setTimeout with a larger delay fires after 1 ms; the value is 2**31 - 1.
    expect(MAX_TIMER_MS).toBe(2 ** 31 - 1)
  })

  it('is the largest delay a real timer keeps', async () => {
    // A timer at the ceiling is still waiting after a tick; one above it has fired by then.
    const fired: string[] = []
    const atCeiling = setTimeout(() => fired.push('ceiling'), MAX_TIMER_MS)
    const aboveCeiling = setTimeout(() => fired.push('above'), MAX_TIMER_MS + 1)
    atCeiling.unref()
    aboveCeiling.unref()
    await new Promise((resolve) => setTimeout(resolve, 50))
    clearTimeout(atCeiling)
    clearTimeout(aboveCeiling)

    expect(fired).toEqual(['above'])
  })
})
