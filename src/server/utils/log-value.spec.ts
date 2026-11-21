/**
 * @fileoverview A value placed in a log line is one quoted token whose control characters show as
 * escapes, so text a caller controls cannot end the line or start another.
 * @layer server/utils
 */
import { escapeForLog, logValue } from './log-value'

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

  it.each([
    ['a\u202eb', '"a\\u202eb"'],
    ['a\u202ab', '"a\\u202ab"'],
    ['a\u2066b', '"a\\u2066b"'],
    ['a\u2069b', '"a\\u2069b"'],
    ['a\u200bb', '"a\\u200bb"'],
    ['a\u200fb', '"a\\u200fb"'],
    ['a\u00adb', '"a\\u00adb"'],
    ['a\u2060b', '"a\\u2060b"'],
    ['a\ufeffb', '"a\\ufeffb"'],
  ])(
    'escapes the format character in %j that can reorder or hide text in a viewer',
    (raw, expected) => {
      // A right-to-left override in a key can make a log viewer show `a.txt` + `exe.txt` reversed as something else.
      expect(logValue(raw)).toBe(expected)
    },
  )

  it.each([
    ['a\u061cb', '"a\\u061cb"'],
    ['a\u206ab', '"a\\u206ab"'],
    ['a\ufff9b', '"a\\ufff9b"'],
    ['a\u180eb', '"a\\u180eb"'],
    ['a\u200db', '"a\\u200db"'],
  ])('escapes every format character, not a list of them: %j', (raw, expected) => {
    // The class is the Unicode category Cf, so a format control nobody listed is still covered.
    expect(logValue(raw)).toBe(expected)
  })

  it.each([
    ['a\u{1f600}b', '"a\u{1f600}b"'],
    ['a\u65e5\u672cb', '"a\u65e5\u672cb"'],
    ['e\u0301', '"e\u0301"'],
    ['a\ufe0fb', '"a\ufe0fb"'],
  ])(
    'leaves %j readable: letters, emoji, combining marks and variation selectors are not controls',
    (raw, expected) => {
      // Escaping by category must not turn ordinary text in a key into escapes.
      expect(logValue(raw)).toBe(expected)
    },
  )

  it('escapes a Unicode tag character, which is invisible, as a code point escape', () => {
    // Tag characters are outside the BMP and print as nothing; they are shown as \\u{...}.
    expect(logValue(String.fromCodePoint(0xe0041))).toBe('"\\u{e0041}"')
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

describe('escapeForLog', () => {
  it.each([
    ['a"b', 'a"b'],
    ['a\\b', 'a\\b'],
    ['say "hi" \\ bye', 'say "hi" \\ bye'],
  ])('leaves the quote and the backslash of %j as they are', (raw, expected) => {
    // The logger escapes them when it serialises the field; escaping them here would show them twice.
    expect(escapeForLog(raw)).toBe(expected)
  })

  it.each([
    ['a\nb', 'a\\nb'],
    ['a\rb', 'a\\rb'],
    ['a\tb', 'a\\tb'],
    ['a\bb', 'a\\bb'],
    ['a\fb', 'a\\fb'],
    ['a\u001b[31mb', 'a\\u001b[31mb'],
    ['a\u0000b', 'a\\u0000b'],
    ['a\u007fb', 'a\\u007fb'],
    ['a\u009bb', 'a\\u009bb'],
    ['a\u2028b', 'a\\u2028b'],
    ['a\u202eb', 'a\\u202eb'],
    ['a\u200bb', 'a\\u200bb'],
    ['a\u{e0041}b', 'a\\u{e0041}b'],
  ])('escapes the control, format or separator character of %j', (raw, expected) => {
    // A newline or a right-to-left override in a key must read as text, not act on the log.
    expect(escapeForLog(raw)).toBe(expected)
  })

  it.each([
    ['a\ud800b', 'a\\ud800b'],
    ['a\udfffb', 'a\\udfffb'],
    ['\udc00\ud800', '\\udc00\\ud800'],
  ])(
    'escapes the lone surrogate of %j, which a logger would otherwise write as an invalid character',
    (raw, expected) => {
      expect(escapeForLog(raw)).toBe(expected)
    },
  )

  it('leaves a well-formed surrogate pair, an emoji, readable', () => {
    expect(escapeForLog('ok \u{1f600} ok')).toBe('ok \u{1f600} ok')
  })

  it('returns text with nothing to escape unchanged', () => {
    expect(escapeForLog('tenant/a-b_c.txt é 日本')).toBe('tenant/a-b_c.txt é 日本')
  })
})
