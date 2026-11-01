/**
 * @fileoverview Turns whatever a promise rejected with into a printable string without ever
 * throwing, so the code that reports a failure cannot replace it with one of its own.
 * @layer server/utils
 */

/** What is reported for a value that cannot be printed at all. */
export const NON_PRINTABLE_REJECTION = 'non-printable rejection value'

/**
 * Describes a caught value: its `message` when it has a string one, otherwise its string form,
 * otherwise {@link NON_PRINTABLE_REJECTION}. `String(value)` throws for an object with no usable
 * `toString` (`Object.create(null)`, or one whose `toString` or `Symbol.toPrimitive` throws), and
 * so can reading `message`, which is why both reads sit inside the guard.
 *
 * @param value - A caught value of any type.
 * @returns A string; never throws.
 */
export function describeError(value: unknown): string {
  try {
    if (typeof value === 'object' && value !== null) {
      const message = (value as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
    }
    return String(value)
  } catch {
    return NON_PRINTABLE_REJECTION
  }
}
