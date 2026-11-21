/**
 * @fileoverview Every option is read once. `forRoot` copies each known key into a plain object a single time and
 * validates and resolves that copy, so a value that reads differently the second time (a getter that was valid for
 * the check and hostile for the use) can neither pass the check nor be used.
 * @layer server/config
 */
import { Test } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from './resolved-options'
import type { IFileScanner } from '../interfaces/file-scanner.interface'
import { snapshotOptions } from './snapshot-options'

const scanner: IFileScanner = { scan: () => Promise.resolve({ status: 'clean', engine: 't' }) }

const base = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

/** An object whose `key` is a getter that serves `values` in turn, the last one for every later read. */
function serving(key: string, values: unknown[], reads: string[]): Record<string, unknown> {
  let index = 0
  return Object.defineProperty({}, key, {
    enumerable: true,
    get: () => {
      reads.push(key)
      const value = values[Math.min(index, values.length - 1)]
      index += 1
      return value
    },
  })
}

describe('snapshotOptions', () => {
  it('copies every known key of the options and of each group, and nothing else', () => {
    const snapshot = snapshotOptions({
      ...base,
      keyPrefix: 'p',
      extra: 'dropped',
      signedUrls: { maxTtlSeconds: 90, extra: 1 },
      multipart: { queueSize: 2 },
      validation: { maxSizeBytes: 5, mimeWhitelist: ['a/b'] },
      scanner: { impl: scanner, mode: 'post-upload' },
    }) as Record<string, Record<string, unknown>>

    expect(snapshot).toEqual({
      ...base,
      keyPrefix: 'p',
      signedUrls: { maxTtlSeconds: 90 },
      multipart: { queueSize: 2 },
      validation: { maxSizeBytes: 5, mimeWhitelist: ['a/b'] },
      scanner: { impl: scanner, mode: 'post-upload' },
    })
  })

  it('keeps a value that is not an object where an object is expected, for validation to refuse', () => {
    expect(snapshotOptions({ ...base, scanner: 'on', validation: null })).toMatchObject({
      scanner: 'on',
      validation: null,
    })
    expect(snapshotOptions('not options')).toBe('not options')
    expect(snapshotOptions(null)).toBeNull()
    expect(
      snapshotOptions({
        ...base,
        validation: { mimeWhitelist: 'image/png', customValidators: { s: 1 } },
      }),
    ).toMatchObject({
      validation: { mimeWhitelist: 'image/png', customValidators: { s: 1 } },
    })
  })

  it('reads a value that a non-enumerable own getter serves, in a group and at the top level', () => {
    const credentials = {}
    Object.defineProperty(credentials, 'accessKeyId', { get: () => 'key-id', enumerable: false })
    Object.defineProperty(credentials, 'secretAccessKey', {
      get: () => 'secret',
      enumerable: false,
    })
    const options = { ...base, credentials }
    Object.defineProperty(options, 'maxAttempts', { get: () => 7, enumerable: false })

    const snapshot = snapshotOptions(options) as {
      credentials: Record<string, unknown>
      maxAttempts: unknown
    }

    expect(snapshot.credentials).toEqual({ accessKeyId: 'key-id', secretAccessKey: 'secret' })
    expect(snapshot.maxAttempts).toBe(7)
  })

  it('reads a value that a prototype getter serves', () => {
    class Group {
      private readonly limit = 1234

      get maxSizeBytes(): number {
        return this.limit
      }
    }

    expect(snapshotOptions({ ...base, validation: new Group() })).toMatchObject({
      validation: { maxSizeBytes: 1234 },
    })
  })

  it('copies the arrays of the validation group, so a hole reaches validation as a value that is not a string', () => {
    const sparse = new Array<string>(2)
    sparse[1] = 'a/b'

    const snapshot = snapshotOptions({ ...base, validation: { mimeWhitelist: sparse } }) as {
      validation: { mimeWhitelist: unknown[] }
    }

    expect(snapshot.validation.mimeWhitelist).toEqual([undefined, 'a/b'])
    expect(snapshot.validation.mimeWhitelist).not.toBe(sparse)
  })

  it('copies the custom validators once as well, and adds no key for a group or an array that was not given', () => {
    const validators = [{ name: 'v', validate: () => Promise.resolve({ ok: true }) }]

    const snapshot = snapshotOptions({ ...base, validation: { customValidators: validators } }) as {
      validation: { customValidators: unknown[] }
    }
    const bare = snapshotOptions({ ...base, validation: { maxSizeBytes: 5 } }) as {
      validation: object
    }

    expect(snapshot.validation.customValidators).toEqual(validators)
    expect(snapshot.validation.customValidators).not.toBe(validators)
    expect(Object.keys(bare.validation)).toEqual(['maxSizeBytes'])
    expect(Object.keys(snapshotOptions(base) as object).sort()).toEqual(Object.keys(base).sort())
  })

  it('does not catch an array whose iterator throws: forRoot refuses it with the host error as the cause', () => {
    const hostile = ['image/png']
    Object.defineProperty(hostile, Symbol.iterator, {
      value: () => {
        throw new Error('iterator ran')
      },
    })

    expect(() => snapshotOptions({ ...base, validation: { mimeWhitelist: hostile } })).toThrow(
      'iterator ran',
    )
  })
})

describe('forRoot refuses an option group of the wrong kind', () => {
  it.each(['validation', 'signedUrls', 'multipart', 'scanner', 'credentials'])(
    '%s that is an array is refused and not copied into an empty group',
    (group) => {
      for (const value of [[], ['x']]) {
        expect(() => BymaxStorageModule.forRoot({ ...base, [group]: value })).toThrow(
          expect.objectContaining({ code: 'STORAGE_INVALID_CONFIG' }) as Error,
        )
      }
    },
  )

  it('keeps an array where an option group is expected, for validation to refuse', () => {
    const list = ['x']

    expect(snapshotOptions({ ...base, validation: list })).toMatchObject({ validation: list })
    expect(
      (snapshotOptions({ ...base, validation: list }) as { validation: unknown }).validation,
    ).toBe(list)
  })
})

describe('forRoot reads each option once', () => {
  it.each([
    ['scanner', 'mode', ['pre-upload', 'preupload']],
    ['scanner', 'rejectOnUnknown', [true, 'false']],
    ['scanner', 'timeoutMs', [1000, Number.NaN]],
    ['validation', 'maxSizeBytes', [1000, Number.NaN]],
    ['validation', 'mimeWhitelist', [['image/png'], 'x']],
    ['signedUrls', 'maxTtlSeconds', [3600, Number.NaN]],
    ['multipart', 'queueSize', [4, Number.POSITIVE_INFINITY]],
  ] as [string, string, unknown[]][])(
    '%s.%s: a value that is valid once and hostile after is read once',
    async (group, key, values) => {
      const reads: string[] = []
      const groupValue = serving(key, values, reads)
      if (group === 'scanner') groupValue.impl = scanner

      const moduleRef = await Test.createTestingModule({
        imports: [BymaxStorageModule.forRoot({ ...base, [group]: groupValue })],
      }).compile()
      const resolved = moduleRef.get<ResolvedBymaxStorageOptions>(BYMAX_STORAGE_OPTIONS)
      await moduleRef.close()

      expect(reads).toEqual([key])
      const resolvedGroup = resolved[group as 'scanner'] as unknown as Record<string, unknown>
      expect(resolvedGroup[key]).toEqual(values[0])
    },
  )

  it.each([
    ['region', ['us-east-1', 'bad region']],
    ['bucket', ['b', '']],
    ['keyPrefix', ['p', 5]],
  ] as [string, unknown[]][])(
    '%s: a top-level value that is valid once and hostile after is read once',
    async (key, values) => {
      const reads: string[] = []
      const options = Object.defineProperties(
        { ...base },
        {
          [key]: {
            enumerable: true,
            get: () => {
              reads.push(key)
              return values[Math.min(reads.length - 1, values.length - 1)]
            },
          },
        },
      )

      const moduleRef = await Test.createTestingModule({
        imports: [BymaxStorageModule.forRoot(options)],
      }).compile()
      await moduleRef.close()

      expect(reads).toEqual([key])
    },
  )

  it('reads the credentials once', async () => {
    const reads: string[] = []
    const credentials = Object.defineProperties(
      {},
      {
        accessKeyId: {
          enumerable: true,
          get: () => {
            reads.push('accessKeyId')
            return 'k'
          },
        },
        secretAccessKey: {
          enumerable: true,
          get: () => {
            reads.push('secretAccessKey')
            return 's'
          },
        },
      },
    )

    const moduleRef = await Test.createTestingModule({
      imports: [BymaxStorageModule.forRoot({ ...base, credentials } as never)],
    }).compile()
    await moduleRef.close()

    expect(reads.sort()).toEqual(['accessKeyId', 'secretAccessKey'])
  })
})
