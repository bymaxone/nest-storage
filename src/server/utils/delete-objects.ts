/**
 * @fileoverview One `DeleteObjects` request of at most 1000 keys, reported per key.
 * @layer server/utils
 */
import { DeleteObjectsCommand, type S3Client } from '@aws-sdk/client-s3'
import type { DeleteManyResult, FailedDeletion } from '../interfaces/delete-many-options.interface'
import { describeError } from './describe-error'

/**
 * Deletes one chunk (at most 1000 keys). Per-key outcomes come from the response; a failure of the
 * whole request fails every key, with the reason as text.
 *
 * @param client - The S3 client.
 * @param bucket - The bucket.
 * @param chunk - Final (prefixed) keys.
 * @param stripPrefix - Removes the module's `keyPrefix` from a key, for the result.
 * @returns The keys deleted and the keys that failed, both relative to `keyPrefix`.
 */
export async function deleteObjectsChunk(
  client: S3Client,
  bucket: string,
  chunk: string[],
  stripPrefix: (key: string) => string,
): Promise<DeleteManyResult> {
  const deleted: string[] = []
  const failed: FailedDeletion[] = []
  try {
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        // `Quiet: false` returns both successes and per-key errors.
        Delete: { Objects: chunk.map((key) => ({ Key: key })), Quiet: false },
      }),
    )
    for (const ok of response.Deleted ?? []) {
      if (ok.Key !== undefined) {
        deleted.push(stripPrefix(ok.Key))
      }
    }
    for (const failure of response.Errors ?? []) {
      if (failure.Key !== undefined) {
        failed.push({
          key: stripPrefix(failure.Key),
          error: `${failure.Code ?? 'Unknown'}: ${failure.Message ?? ''}`,
        })
      }
    }
  } catch (err) {
    // A non-Error throw (or an Error without a message) must still coerce to the
    // `string` that `FailedDeletion.error` declares — never `undefined`.
    const message = describeError(err)
    for (const key of chunk) {
      failed.push({ key: stripPrefix(key), error: message })
    }
  }
  return { deleted, failed }
}
