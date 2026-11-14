/**
 * @fileoverview The longest delay a timer can hold. Node clamps a `setTimeout` above this to 1 ms, so a
 * configured duration beyond it would fire at once instead of never.
 * @layer server/constants
 */

/** `2**31 - 1` milliseconds, about 24.8 days. */
export const MAX_TIMER_MS = 2_147_483_647 as const
