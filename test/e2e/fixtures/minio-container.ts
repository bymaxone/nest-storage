/**
 * @fileoverview Testcontainers fixture that boots a single MinIO container,
 * creates the test bucket, and returns the connection handle. One container per
 * spec file (Jest-worker isolation); callers MUST stop it in `afterAll`.
 * @layer test/e2e
 */
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

/**
 * The S3 server the suite runs against, pinned by digest for reproducible runs (never
 * `latest`). `minio/minio` is no longer published on Docker Hub, so this is the community
 * fork that keeps its `server /data` entrypoint and `MINIO_ROOT_*` variables. The CI
 * workflow pre-pulls whatever this constant holds, so it is the only place to change.
 */
const MINIO_IMAGE =
  'docker.io/pgsty/silo:RELEASE.2026-10-26T00-00-00Z@sha256:7bb2aff6b89efe1cb1303c10fc21d579447434ed06649ac9ec05a5e2dbf30ad7'
const MINIO_PORT = 9000
const MINIO_ROOT_USER = 'minioadmin'
const MINIO_ROOT_PASSWORD = 'minioadmin'

/** Connection handle for a running MinIO container. */
export interface MinioHandle {
  container: StartedTestContainer
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/**
 * Spawns a MinIO container, creates the test bucket, and returns its connection
 * info. Callers MUST call `await handle.container.stop()` in `afterAll` to avoid
 * leaking the container.
 *
 * @param bucket - The bucket to create inside the container.
 * @returns The connection handle for the running container.
 */
export async function startMinio(bucket = 'test-bucket'): Promise<MinioHandle> {
  const container = await new GenericContainer(MINIO_IMAGE)
    .withCommand(['server', '/data'])
    .withEnvironment({
      MINIO_ROOT_USER,
      MINIO_ROOT_PASSWORD,
    })
    .withExposedPorts(MINIO_PORT)
    .start()

  const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(MINIO_PORT))}`
  await createBucket(endpoint, bucket)

  return {
    container,
    endpoint,
    accessKeyId: MINIO_ROOT_USER,
    secretAccessKey: MINIO_ROOT_PASSWORD,
    bucket,
  }
}

/**
 * Creates the bucket via a short-lived S3 client. Path-style addressing and the
 * non-AWS checksum opt-out are required for MinIO to accept the request.
 */
async function createBucket(endpoint: string, bucket: string): Promise<void> {
  const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: MINIO_ROOT_USER, secretAccessKey: MINIO_ROOT_PASSWORD },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
  } finally {
    client.destroy()
  }
}
