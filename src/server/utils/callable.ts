/**
 * @fileoverview The shape of any function, for the helpers that call or bind one without knowing its arguments.
 * @layer server/utils
 */

/** A function with any parameters, returning `R`. */
export type Callable<R = unknown> = (...args: never[]) => R
