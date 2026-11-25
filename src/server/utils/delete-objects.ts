/**
 * @fileoverview One `DeleteObjects` request of at most 1000 keys, reported per key.
 * @layer server/utils
 */
import { DeleteObjectsCommand, type S3Client } from '@aws-sdk/client-s3'
import type { DeleteManyResult, FailedDeletion } from '../interfaces/delete-many-options.interface'
import { providerFailureReason } from '../errors/provider-failure'
import { logProviderFailure } from './provider-failure-log'
import { isRootRefusal } from './prototype-guard'
import { verdictOf } from './settle-or-cut'

/**
 * Deletes one chunk (at most 1000 keys). Per-key outcomes come from the response, with the provider's
 * error code; a failure of the whole request fails every key, with a fixed reason.
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
    const response = await verdictOf(
      client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          // `Quiet: false` returns both successes and per-key errors.
          Delete: { Objects: chunk.map((key) => ({ Key: key })), Quiet: false },
        }),
      ),
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
          // The provider's code, which a caller can branch on; its sentence is not repeated.
          error: failure.Code ?? 'Unknown',
        })
      }
    }
  } catch (err) {
    // The library's own refusal is not a per-key failure; the caller must see it.
    if (isRootRefusal(err)) {
      throw err
    }
    // The whole request failed: a fixed word, never what the driver or the provider wrote.
    logProviderFailure(err, { op: 'deleteMany' })
    const reason = providerFailureReason(err)
    for (const key of chunk) {
      failed.push({ key: stripPrefix(key), error: reason })
    }
  }
  return { deleted, failed }
}
