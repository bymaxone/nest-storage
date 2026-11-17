/**
 * @fileoverview The options whose kind is checked at boot: `keyPrefix`, `validation.mimeWhitelist`,
 * `validation.customValidators`, `region`, and a `null` where an absent value would mean "no limit" or "protection
 * off". A refusal names the option and the kind it needs, and repeats nothing of the value.
 * @layer server/config
 */
import { validateOptions } from './validate-options'
import type { StorageException } from '../errors/storage-exception'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

const SENTINEL = 'SENTINEL-OPTION-KIND'

const valid: BymaxStorageModuleOptions = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

/** The `details.reason` of the refusal, the whole response body beside it, or a failure when nothing was refused. */
function refusal(options: unknown): { reason: string; response: string } {
  try {
    validateOptions(options)
  } catch (error) {
    const response = (error as StorageException).getResponse() as { error: { code: string; details: { reason: string } } }
    expect(response.error.code).toBe('STORAGE_INVALID_CONFIG')
    return { reason: response.error.details.reason, response: JSON.stringify(response) }
  }
  throw new Error('expected validateOptions to throw')
}

function accepts(extra: Record<string, unknown>): void {
  expect(() => {
    validateOptions({ ...valid, ...extra })
  }).not.toThrow()
}

describe('options.keyPrefix', () => {
  it.each([[[SENTINEL]], [{ s: SENTINEL }], [5], [true], [Symbol(SENTINEL)]])('refuses %p without repeating it', (value) => {
    const result = refusal({ ...valid, keyPrefix: value })

    expect(result.reason).toBe('options.keyPrefix must be a string')
    expect(result.response).not.toContain('SENTINEL')
  })

  it.each(['', 'tenant-a', 'tenant/a/', undefined, null])('accepts %p', (value) => {
    accepts({ keyPrefix: value })
  })
})

describe('validation.mimeWhitelist', () => {
  it.each([[SENTINEL], [{ s: SENTINEL }], [5], [true], [[SENTINEL, 5]], [[null]], [[['image/png']]]])(
    'refuses %p without repeating it',
    (value) => {
      const result = refusal({ ...valid, validation: { mimeWhitelist: value } })

      expect(result.reason).toBe('validation.mimeWhitelist must be an array of strings')
      expect(result.response).not.toContain('SENTINEL')
    },
  )

  it('refuses null: an absent whitelist allows every type, so null may not stand for "none"', () => {
    expect(refusal({ ...valid, validation: { mimeWhitelist: null } }).reason).toBe(
      'validation.mimeWhitelist must not be null; omit it to allow every type',
    )
  })

  it.each([[[]], [['image/png', 'application/*']], [undefined]])('accepts %p', (value) => {
    accepts({ validation: { mimeWhitelist: value } })
  })
})

describe('validation.customValidators', () => {
  it.each([[SENTINEL], [{ s: SENTINEL }], [5], [true]])('refuses %p without repeating it', (value) => {
    const result = refusal({ ...valid, validation: { customValidators: value } })

    expect(result.reason).toBe('validation.customValidators must be an array')
    expect(result.response).not.toContain('SENTINEL')
  })

  it('refuses null: an absent list runs no validator, so null may not stand for "none"', () => {
    expect(refusal({ ...valid, validation: { customValidators: null } }).reason).toBe(
      'validation.customValidators must not be null; omit it to run no custom validator',
    )
  })

  it.each([[[]], [[{ name: 'v', validate: () => Promise.resolve({ ok: true }) }]], [undefined]])('accepts %p', (value) => {
    accepts({ validation: { customValidators: value } })
  })
})

describe('validation.maxSizeBytes', () => {
  it('refuses null: an absent limit means no limit, so null may not stand for it', () => {
    expect(refusal({ ...valid, validation: { maxSizeBytes: null } }).reason).toBe(
      'validation.maxSizeBytes must not be null; omit it for no size limit',
    )
  })

  it('still accepts an absent limit and a real one', () => {
    accepts({ validation: {} })
    accepts({ validation: { maxSizeBytes: 1024 } })
  })
})

describe('options.region', () => {
  it.each(['us east', 'a/b', 'x\ny', 'a'.repeat(64), `${SENTINEL}?x=1`, 'é-1', '-lead', '.lead'])(
    'refuses %p, which no region is called, without repeating it',
    (value) => {
      const result = refusal({ ...valid, region: value })

      expect(result.reason).toBe(
        "options.region must be 1 to 63 letters, digits, '.', '_' or '-', starting with a letter or digit",
      )
      expect(result.response).not.toContain('SENTINEL')
    },
  )

  it.each(['us-east-1', 'auto', 'eu-central-003', 'nyc3', 'us-gov-west-1', 'sa-east-1', 'R2', 'Region_1.a'])(
    'accepts %p',
    (value) => {
      accepts({ region: value })
    },
  )

  it('keeps the existing refusal for an absent or non-string region', () => {
    expect(refusal({ ...valid, region: '' }).reason).toBe('options.region must be a non-empty string')
    expect(refusal({ ...valid, region: 5 }).reason).toBe('options.region must be a non-empty string')
  })
})

describe('options.scanner', () => {
  it('refuses null: an absent scanner scans nothing, so null may not stand for "no scanner"', () => {
    expect(refusal({ ...valid, scanner: null }).reason).toBe('scanner must not be null; omit it for no scanner')
  })

  it('still accepts an absent scanner', () => {
    accepts({})
    accepts({ scanner: undefined })
  })

  it.each([false, 0, '', [], true, 'on', 42])('refuses a scanner that is %p without repeating it', (value) => {
    const result = refusal({ ...valid, scanner: value })

    expect(result.reason).toMatch(/^scanner(?: must be an object|\.impl must be an object with a scan function)$/)
    expect(result.response).not.toContain('SENTINEL')
  })
})
