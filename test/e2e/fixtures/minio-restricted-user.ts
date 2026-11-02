/**
 * @fileoverview Creates a MinIO user that may do everything in the test bucket except the actions
 * it is denied, so a spec can make one real provider call fail with `AccessDenied` while the rest
 * of the library keeps working. The user is created through the `mc` tool shipped in the image.
 * @layer test/e2e
 */
import { randomBytes } from 'node:crypto'
import type { MinioHandle } from './minio-container'

/** Credentials of a created user. */
export interface RestrictedUser {
  accessKeyId: string
  secretAccessKey: string
}

/** Runs one command in the container and fails with its output when it exits non-zero. */
async function run(handle: MinioHandle, command: string[]): Promise<void> {
  const result = await handle.container.exec(command)
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.slice(0, 4).join(' ')} exited ${String(result.exitCode)}: ${result.output}`,
    )
  }
}

/**
 * Creates a user allowed `s3:*` on the bucket and denied `denied` on its objects.
 *
 * @param handle - The running MinIO container.
 * @param denied - The S3 actions to deny on the bucket's objects, such as `s3:DeleteObject`.
 * @returns The new user's credentials.
 */
export async function createRestrictedUser(
  handle: MinioHandle,
  denied: string[],
): Promise<RestrictedUser> {
  const suffix = randomBytes(4).toString('hex')
  const user: RestrictedUser = {
    accessKeyId: `user${suffix}`,
    secretAccessKey: `secret${randomBytes(12).toString('hex')}`,
  }
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:*'],
        Resource: [`arn:aws:s3:::${handle.bucket}`, `arn:aws:s3:::${handle.bucket}/*`],
      },
      { Effect: 'Deny', Action: denied, Resource: [`arn:aws:s3:::${handle.bucket}/*`] },
    ],
  }
  const file = `/tmp/policy-${suffix}.json`
  await handle.container.copyContentToContainer([{ content: JSON.stringify(policy), target: file }])
  await run(handle, [
    'mc',
    'alias',
    'set',
    'local',
    'http://127.0.0.1:9000',
    handle.accessKeyId,
    handle.secretAccessKey,
  ])
  await run(handle, ['mc', 'admin', 'policy', 'create', 'local', `deny-${suffix}`, file])
  await run(handle, ['mc', 'admin', 'user', 'add', 'local', user.accessKeyId, user.secretAccessKey])
  await run(handle, [
    'mc',
    'admin',
    'policy',
    'attach',
    'local',
    `deny-${suffix}`,
    '--user',
    user.accessKeyId,
  ])
  return user
}
