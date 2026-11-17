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
    expect(snapshotOptions({ ...base, scanner: 'on', validation: null })).toMatchObject({ scanner: 'on', validation: null })
    expect(snapshotOptions('not options')).toBe('not options')
    expect(snapshotOptions(null)).toBeNull()
    expect(snapshotOptions({ ...base, validation: { mimeWhitelist: 'image/png', customValidators: { s: 1 } } })).toMatchObject({
      validation: { mimeWhitelist: 'image/png', customValidators: { s: 1 } },
    })
  })

  it('reads a value that a prototype getter serves', () => {
    class Group {
      private readonly limit = 1234

      get maxSizeBytes(): number {
        return this.limit
      }
    }

    expect(snapshotOptions({ ...base, validation: new Group() })).toMatchObject({ validation: { maxSizeBytes: 1234 } })
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

  it('keeps an array whose iterator throws as it is, so its owner\'s error surfaces and nothing is hidden', () => {
    const hostile = ['image/png']
    Object.defineProperty(hostile, Symbol.iterator, {
      value: () => {
        throw new Error('iterator ran')
      },
    })

    const snapshot = snapshotOptions({ ...base, validation: { mimeWhitelist: hostile } }) as {
      validation: { mimeWhitelist: unknown }
    }

    expect(snapshot.validation.mimeWhitelist).toBe(hostile)
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
  ] as [string, string, unknown[]][])('%s.%s: a value that is valid once and hostile after is read once', async (group, key, values) => {
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
  })

  it.each([
    ['region', ['us-east-1', 'bad region']],
    ['bucket', ['b', '']],
    ['keyPrefix', ['p', 5]],
  ] as [string, unknown[]][])('%s: a top-level value that is valid once and hostile after is read once', async (key, values) => {
    const reads: string[] = []
    const options = Object.defineProperties({ ...base }, {
      [key]: {
        enumerable: true,
        get: () => {
          reads.push(key)
          return values[Math.min(reads.length - 1, values.length - 1)]
        },
      },
    })

    const moduleRef = await Test.createTestingModule({ imports: [BymaxStorageModule.forRoot(options)] }).compile()
    await moduleRef.close()

    expect(reads).toEqual([key])
  })

  it('reads the credentials once', async () => {
    const reads: string[] = []
    const credentials = Object.defineProperties({}, {
      accessKeyId: { enumerable: true, get: () => { reads.push('accessKeyId'); return 'k' } },
      secretAccessKey: { enumerable: true, get: () => { reads.push('secretAccessKey'); return 's' } },
    })

    const moduleRef = await Test.createTestingModule({
      imports: [BymaxStorageModule.forRoot({ ...base, credentials } as never)],
    }).compile()
    await moduleRef.close()

    expect(reads.sort()).toEqual(['accessKeyId', 'secretAccessKey'])
  })
})
