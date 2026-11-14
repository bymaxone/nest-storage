/**
 * @fileoverview The one way a value that a caller or a provider controls is placed in a log line:
 * as a single quoted token whose control characters show as escapes.
 * @layer server/utils
 */
import { describeError } from './describe-error'

/**
 * The characters JSON leaves literal that a terminal or a log viewer can still act on, by Unicode
 * category rather than by list: control characters (`Cc`, which covers DEL and the C1 range), format
 * characters (`Cf`: the bidirectional marks, embeddings and overrides that can make a viewer show a
 * key as other text, the zero-width and invisible characters, the byte order mark and the tag
 * characters) and the line and paragraph separators (`Zl`, `Zp`).
 */
const LEFT_LITERAL_BY_JSON = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

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
  // Stryker disable next-line ConditionalExpression: `describeError` returns a string as it is (`String(value)`), so sending strings through it too gives the same text (equivalent).
  const text = typeof value === 'string' ? value : describeError(value)
  return JSON.stringify(text).replace(
    LEFT_LITERAL_BY_JSON,
    (char) => {
      const codePoint = Number(char.codePointAt(0))
      const hex = codePoint.toString(16)
      // Stryker disable next-line EqualityOperator: no character the pattern matches has the code point U+FFFF (a noncharacter, not a control, format or separator), so `>=` and `>` pick the same form (equivalent).
      return codePoint > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`
    },
  )
}
