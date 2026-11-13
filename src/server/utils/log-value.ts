/**
 * @fileoverview The one way a value that a caller or a provider controls is placed in a log line:
 * as a single quoted token whose control characters show as escapes.
 * @layer server/utils
 */
import { describeError } from './describe-error'

/**
 * The characters JSON leaves literal that a terminal or a log viewer can still act on: DEL and the C1
 * controls, the Unicode line and paragraph separators and the bidirectional embeddings and
 * overrides (which can make a viewer show a key as different text), the zero-width and invisible
 * format characters, the byte order mark and the Unicode tag characters.
 */
const LEFT_LITERAL_BY_JSON =
  /[\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu

/**
 * Renders a value for a log line. A string becomes one quoted token, so a key or a message holding
 * a newline, a carriage return or an escape sequence cannot end the line or start another: those
 * show as `\n`, `\r` and `\u001b`. JSON already escapes the C0 controls, the quote and the
 * backslash; the characters in `LEFT_LITERAL_BY_JSON` (U+009B, for one, is a control sequence
 * introducer in some terminals) are escaped here.
 *
 * @param value - A key, a provider message or any other text that is not the library's own.
 * @returns The value as one quoted, escaped token; never throws.
 */
export function logValue(value: unknown): string {
  const text = typeof value === 'string' ? value : describeError(value)
  return JSON.stringify(text).replace(
    LEFT_LITERAL_BY_JSON,
    (char) => {
      const codePoint = Number(char.codePointAt(0))
      const hex = codePoint.toString(16)
      return codePoint > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`
    },
  )
}
