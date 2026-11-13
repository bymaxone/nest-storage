/**
 * @fileoverview The one way a value that a caller or a provider controls is placed in a log line:
 * as a single quoted token whose control characters show as escapes.
 * @layer server/utils
 */
import { describeError } from './describe-error'

/** The characters JSON leaves literal that a terminal or a log viewer can still act on. */
const LEFT_LITERAL_BY_JSON = /[\u007f-\u009f\u2028\u2029]/g

/**
 * Renders a value for a log line. A string becomes one quoted token, so a key or a message holding
 * a newline, a carriage return or an escape sequence cannot end the line or start another: those
 * show as `\n`, `\r` and `\u001b`. JSON already escapes the C0 controls, the quote and the
 * backslash; DEL, the C1 controls (U+009B is a control sequence introducer in some terminals) and
 * the Unicode line separators are escaped here.
 *
 * @param value - A key, a provider message or any other text that is not the library's own.
 * @returns The value as one quoted, escaped token; never throws.
 */
export function logValue(value: unknown): string {
  const text = typeof value === 'string' ? value : describeError(value)
  return JSON.stringify(text).replace(
    LEFT_LITERAL_BY_JSON,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}
