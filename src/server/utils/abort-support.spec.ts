/**
 * @fileoverview The deadline of the cleanup that follows an abandoned call is a duration a timer can
 * hold, and the helpers give the SDK a signal only when the caller has one.
 * @layer server/utils
 */
import { MAX_TIMER_MS } from '../constants/timer.constants'
import { CLEANUP_DEADLINE_MS, sendOptions } from './abort-support'

describe('abort-support', () => {
  it('keeps the cleanup deadline within what a timer can hold', () => {
    // AbortSignal.timeout over 2**31 - 1 ms would fire at once and cancel the very cleanup it bounds.
    expect(CLEANUP_DEADLINE_MS).toBeGreaterThan(0)
    expect(CLEANUP_DEADLINE_MS).toBeLessThanOrEqual(MAX_TIMER_MS)
  })

  it('hands the SDK the caller signal, and nothing when there is none', () => {
    // With no signal the send options are absent, so a call behaves exactly as it did without the option.
    const signal = new AbortController().signal

    expect(sendOptions(signal)).toEqual({ abortSignal: signal })
    expect(sendOptions(undefined)).toBeUndefined()
  })
})
