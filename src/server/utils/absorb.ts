/**
 * @fileoverview Calls a host-supplied function so that nothing it does reaches the caller.
 * @layer server/utils
 */

/**
 * Calls a function of the host's (a logger method, an observer) so that nothing it does reaches the caller.
 * A function typed `=> void` still accepts an async one, and a `try`/`catch` alone misses the rejected
 * promise such a function returns: the process would then end on an unhandled rejection. A synchronous
 * throw, a rejected promise and a thenable that throws are all absorbed here.
 *
 * @param call - Invokes the host's function.
 */
export function absorb(call: () => unknown): void {
  try {
    // Adopts a promise or any thenable, so a rejection (or a `then` that throws) is handled here.
    void Promise.resolve(call()).then(undefined, () => undefined)
  } catch {
    // A faulty host function must never fail what it observes.
  }
}
