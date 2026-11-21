/**
 * @fileoverview `readOnce` reads each named field of a request exactly once and returns a plain copy, so a
 * getter that answers differently on a later read has no later read to answer.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { copyRequest, readOnce } from './read-once'

describe('readOnce', () => {
  it('reads each named field once and copies what it read', () => {
    // A getter that counts its reads stands for any value the caller can change between two reads.
    const reads: string[] = []
    const request = {
      get a(): string {
        reads.push('a')
        return 'A'
      },
      get b(): string {
        reads.push('b')
        return 'B'
      },
      c: 'C',
    }

    const copy = readOnce(request, ['a', 'b'])

    expect(reads).toEqual(['a', 'b'])
    expect(copy).toEqual({ a: 'A', b: 'B' })
    expect(Object.getOwnPropertyDescriptor(copy, 'a')).toMatchObject({ value: 'A' })
  })

  it('leaves out the fields it was not asked for and one the request does not set', () => {
    const request: { a?: string; c: string } = { c: 'C' }

    const copy = readOnce(request, ['a'])

    expect(copy).toStrictEqual({})
    expect('c' in copy).toBe(false)
  })

  it('wraps an error thrown by a field, with the error as the cause and none of its text in the response', () => {
    const failure = new Error('SENTINEL field getter ran')
    const request = {
      get a(): string {
        throw failure
      },
    }
    let thrown: unknown
    try {
      readOnce(request, ['a'])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(StorageException)
    expect((thrown as StorageException).cause).toBe(failure)
    expect(JSON.stringify((thrown as StorageException).getResponse())).not.toContain('SENTINEL')
    expect((thrown as StorageException).getResponse()).toMatchObject({
      error: { code: 'STORAGE_VALIDATION_FAILED' },
    })
  })
})

describe('copyRequest', () => {
  it('copies the own enumerable fields once, so a later read of the original changes nothing', () => {
    let reads = 0
    const request = {
      get a(): string {
        reads += 1
        return reads === 1 ? 'first' : 'later'
      },
      b: 2,
    }

    const copy = copyRequest(request)

    expect(copy).toStrictEqual({ a: 'first', b: 2 })
    expect(reads).toBe(1)
  })

  it('wraps an error thrown by a field, with the error as the cause and none of its text in the response', () => {
    const failure = new Error('SENTINEL field getter ran')
    const request = {
      get a(): string {
        throw failure
      },
    }
    let thrown: unknown
    try {
      copyRequest(request)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(StorageException)
    expect((thrown as StorageException).cause).toBe(failure)
    expect(JSON.stringify((thrown as StorageException).getResponse())).not.toContain('SENTINEL')
  })
})
