/**
 * @fileoverview One read of the options. `forRoot` copies each known key of the options, and of each option
 * group, into a plain object a single time; the copy is what is validated and what is resolved. A value that
 * reads differently the second time (a getter that is valid for the check and hostile for the use) can then
 * neither pass the check nor be used, because there is no second read.
 * @layer server/config
 */
import {
  CREDENTIAL_KEYS,
  MULTIPART_KEYS,
  OPTION_KEYS,
  SCANNER_KEYS,
  SIGNED_URL_KEYS,
  VALIDATION_KEYS,
} from './option-keys'
import { readField } from '../utils/read-once'
import { isBoundedLength, OVERSIZED_ARRAY } from './option-array-bound'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Copies the listed keys of `source` that are not `undefined` into an object with no prototype, reading each one once; a key that only the root prototype supplies is left out. */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    const value = readField(source, key)
    if (value !== undefined) copy[key] = value
  }
  return copy
}

/**
 * The copy of an option group; a value that is not an object, and an array (which would otherwise become an
 * empty group), is kept as it is, for validation to refuse.
 */
function pickGroup(value: unknown, keys: readonly string[]): unknown {
  return isObject(value) && !Array.isArray(value) ? pick(value, keys) : value
}

/**
 * The array copied by index: the length is read once and each index from `0` up to it is read once, so a hole
 * becomes `undefined` (which validation refuses as a value that is not a string), a later change to the
 * caller's array is not seen, and an array of a subclass whose iterator is empty or hostile is copied as what
 * its indexes hold. A value that is not an array is kept as it is. An array longer than the bound, or whose
 * length is not a count, becomes {@link OVERSIZED_ARRAY} and is not walked. A read that throws is not caught
 * here: `forRoot` refuses it with the library's code and keeps the host's error as the cause.
 */
function copyArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const length: unknown = value.length
  if (!isBoundedLength(length)) return OVERSIZED_ARRAY
  const copy: unknown[] = []
  for (let index = 0; index < (length as number); index += 1) {
    copy.push((value as unknown[])[index])
  }
  return copy
}

/**
 * A custom validator copied once: its `name` and `validate` are read a single time, and `validate` is bound to the
 * validator, so a getter that answers differently on a later read has no later read, and the call still has the
 * validator as `this`.
 * An entry that is not an object is kept as it is, and one whose `validate` is not a function keeps what it
 * holds as its own `validate`, for validation to refuse.
 */
function copyValidator(entry: unknown): unknown {
  if (!isObject(entry)) return entry
  const name = readField(entry, 'name') as string | undefined
  const validate = readField(entry, 'validate')
  return {
    ...(name === undefined ? {} : { name }),
    // An own `validate` even when it is not a function, so validation refuses what the entry holds and not a
    // `validate` that only the root prototype supplies.
    validate:
      typeof validate === 'function'
        ? (validate as (...args: unknown[]) => unknown).bind(entry)
        : validate,
  }
}

/**
 * The scanner implementation copied once: its `scan` is read a single time, by the own-or-class lookup, and bound to
 * the implementation, so a `scan` that only the root prototype supplies is not one and a later change to the
 * caller's object is not seen. An implementation that is not an object is kept as it is; one without a function
 * keeps what it holds as its own `scan`, for validation to refuse.
 */
function copyScanner(impl: unknown): unknown {
  if (!isObject(impl)) return impl
  const scan = readField(impl, 'scan')
  return {
    scan: typeof scan === 'function' ? (scan as (...args: unknown[]) => unknown).bind(impl) : scan,
  }
}

/** The groups and their key lists; the arrays of the `validation` group are copied once more, below. */
const GROUPS = {
  credentials: CREDENTIAL_KEYS,
  signedUrls: SIGNED_URL_KEYS,
  multipart: MULTIPART_KEYS,
  validation: VALIDATION_KEYS,
  scanner: SCANNER_KEYS,
} as const

/**
 * Reads every known key of the module options once and returns the plain copy.
 *
 * @param options - The options as the caller passed them, whatever they are.
 * @returns A plain object with the known keys that were set, each group copied the same way; anything that
 *   is not an object is returned unchanged, for `validateOptions` to refuse.
 */
export function snapshotOptions(options: unknown): unknown {
  if (!isObject(options)) return options
  const copy = pick(options, OPTION_KEYS)
  for (const [group, keys] of Object.entries(GROUPS)) {
    if (group in copy) copy[group] = pickGroup(copy[group], keys)
  }
  const scanner = copy.scanner
  if (isObject(scanner) && 'impl' in scanner) scanner.impl = copyScanner(scanner.impl)
  const validation = copy.validation
  if (isObject(validation)) {
    for (const key of ['mimeWhitelist', 'customValidators']) {
      if (key in validation) validation[key] = copyArray(validation[key])
    }
    const validators = validation.customValidators
    if (Array.isArray(validators)) validation.customValidators = validators.map(copyValidator)
  }
  return copy
}
