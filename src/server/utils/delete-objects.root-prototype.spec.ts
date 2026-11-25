/**
 * @fileoverview A refusal raised while a delete request is in flight reaches the caller; it is not
 * turned into a per-key failure.
 * @layer server/utils
 */
import type { S3Client } from '@aws-sdk/client-s3'
import { deleteObjectsChunk } from './delete-objects'
import { assertCleanRoot, isRootRefusal } from './prototype-guard'

describe('deleteObjectsChunk with the runtime changed mid-flight', () => {
  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, 'plantedByTest')
  })

  it('rethrows the library refusal instead of reporting every key as failed', async () => {
    const client = {
      send: jest.fn(() => {
        // What the client middleware does before an attempt, after a key was planted meanwhile.
        Object.defineProperty(Object.prototype, 'plantedByTest', { value: 1, configurable: true })
        assertCleanRoot()
        return Promise.resolve({})
      }),
    } as unknown as S3Client

    const outcome = await deleteObjectsChunk(client, 'b', ['k1', 'k2'], (key) => key).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(isRootRefusal(outcome)).toBe(true)
  })

  it('reports every key as failed for an ordinary provider failure', async () => {
    const client = { send: jest.fn(() => Promise.reject(new Error('boom'))) } as unknown as S3Client

    const result = await deleteObjectsChunk(client, 'b', ['k1'], (key) => key)

    expect(result.deleted).toEqual([])
    expect(result.failed).toHaveLength(1)
  })
})
