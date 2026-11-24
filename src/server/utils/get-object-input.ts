/**
 * @fileoverview Builds the `GetObject` request a download sends.
 * @layer server/utils
 */
import { GetObjectCommand } from '@aws-sdk/client-s3'
import type { DownloadOptions } from '../interfaces/download-options.interface'

/** The `GetObject` a download sends: the key and the conditional and range headers of the request. */
export function getObjectInput(
  bucket: string,
  key: string,
  options: DownloadOptions,
): GetObjectCommand {
  return new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    Range: options.range,
    IfNoneMatch: options.ifNoneMatch,
    IfMatch: options.ifMatch,
  })
}
