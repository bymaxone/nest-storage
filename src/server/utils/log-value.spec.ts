/**
 * @fileoverview A value placed in a log line is one quoted token whose control characters show as
 * escapes, so text a caller controls cannot end the line or start another.
 * @layer server/utils
 */
import { logValue } from './log-value'

describe('logValue', () => {
  it('quotes a plain string', () => {
    // The quotes mark where the value starts and ends inside the line.
    expect(logValue('tenant/a.txt')).toBe('"tenant/a.txt"')
  })

  it.each([
    ['a\nb', '"a\\nb"'],
    ['a\rb', '"a\\rb"'],
    ['a\u001b[31mb', '"a\\u001b[31mb"'],
    ['a\tb', '"a\\tb"'],
    ['a\u0000b', '"a\\u0000b"'],
  ])('shows the control character of %j as an escape', (raw, expected) => {
    // A newline or an escape sequence in a key must read as text, not act on the log.
    expect(logValue(raw)).toBe(expected)
  })

  it.each([
    ['a\u007fb', '"a\\u007fb"'],
    ['a\u009bb', '"a\\u009bb"'],
    ['a\u2028b', '"a\\u2028b"'],
    ['a\u2029b', '"a\\u2029b"'],
  ])('also escapes DEL, the C1 controls and the Unicode line separators in %j', (raw, expected) => {
    // JSON leaves these literal; a terminal reads U+009B as a control sequence introducer.
    expect(logValue(raw)).toBe(expected)
  })

  it('escapes a quote and a backslash so the token cannot be closed early', () => {
    // A key holding a quote must not end the quoted value and continue the line.
    expect(logValue('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it('keeps ordinary non-ASCII text readable', () => {
    // Accented and CJK characters are not control characters.
    expect(logValue('relatório/日本.txt')).toBe('"relatório/日本.txt"')
  })

  it('describes a value that is not a string without throwing', () => {
    // An error or undefined passed by mistake still yields one safe token.
    expect(logValue(undefined)).toBe('"undefined"')
    expect(logValue(new Error('x\ny'))).toBe('"x\\ny"')
  })
})
