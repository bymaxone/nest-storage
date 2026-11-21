/**
 * @fileoverview Holds the README paragraphs on the checked options to the values the code refuses with: the
 * bound on a list, the code and the reason of an option that cannot be read, and the kind of the two flags.
 * @layer docs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BymaxStorageModule } from './server/bymax-storage.module'
import { MAX_OPTION_ARRAY_LENGTH } from './server/config/option-array-bound'
import type { StorageException } from './server/errors/storage-exception'
import type { BymaxStorageModuleOptions } from './server/interfaces/storage-module-options.interface'

const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')

const VALID: BymaxStorageModuleOptions = {
  endpoint: 'http://localhost',
  region: 'us-east-1',
  bucket: 'b',
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
}

/** What `forRoot` refuses with, as the response body and the cause. */
function refusal(options: unknown): { code: string; reason: string; cause: unknown } {
  try {
    BymaxStorageModule.forRoot(options as BymaxStorageModuleOptions)
  } catch (error) {
    const exception = error as StorageException
    const { error: body } = exception.getResponse() as {
      error: { code: string; details: { reason: string } }
    }
    return { code: body.code, reason: body.details.reason, cause: exception.cause }
  }
  throw new Error('expected forRoot to throw')
}

describe('README on the checked options', () => {
  it('names the bound a list is refused at, and the code refuses one entry past it', () => {
    // The paragraph states the number; a change to the bound has to change the README with it.
    const tooLong = Array.from({ length: MAX_OPTION_ARRAY_LENGTH + 1 }, () => 'image/png')

    expect(README).toContain(`hold at most \`${String(MAX_OPTION_ARRAY_LENGTH)}\` entries`)
    expect(refusal({ ...VALID, validation: { mimeWhitelist: tooLong } }).code).toBe(
      'STORAGE_INVALID_CONFIG',
    )
  })

  it('names the code, the reason and the cause of an option that cannot be read', () => {
    // A getter that throws stands for any read the host can make fail.
    const hostile = { ...VALID }
    const failure = new Error('host error')
    Object.defineProperty(hostile, 'bucket', {
      enumerable: true,
      get: () => {
        throw failure
      },
    })

    const result = refusal(hostile)

    expect(result).toMatchObject({ code: 'STORAGE_INVALID_CONFIG', cause: failure })
    expect(README).toContain(`reason: '${result.reason}'`)
  })

  it.each(['defaultPublicRead', 'forcePathStyle'])(
    'refuses %s as a string, which is what the README says it does',
    (name) => {
      // `'false'` is the value an environment variable gives, and it is truthy.
      expect(README).toContain(`\`${name}\``)
      expect(refusal({ ...VALID, [name]: 'false' }).code).toBe('STORAGE_INVALID_CONFIG')
    },
  )
})
