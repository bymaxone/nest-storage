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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Copies the listed keys of `source` that are not `undefined`, reading each one once. */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const key of keys) {
    const value = source[key]
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
 * The array copied once, so a hole becomes `undefined` (which validation refuses as a value that is not a
 * string) and a later change to the caller's array is not seen. A value that is not an array is kept as it is.
 * An array whose iterator throws is not caught here: `forRoot` refuses it with the library's code and keeps
 * the host's error as the cause.
 */
function copyArray(value: unknown): unknown {
  return Array.isArray(value) ? Array.from(value as unknown[]) : value
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
  const validation = copy.validation
  if (isObject(validation)) {
    for (const key of ['mimeWhitelist', 'customValidators']) {
      if (key in validation) validation[key] = copyArray(validation[key])
    }
  }
  return copy
}
