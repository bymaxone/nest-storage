/**
 * @fileoverview Owns the singleton `S3Client`. Builds it lazily (skipped when
 * credentials are absent so the module still registers), serves it through
 * `getClient()` / `getClientOrNull()`, and releases TCP connections via
 * `destroy()` on application shutdown.
 * @layer server/providers
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common'
import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import { BYMAX_STORAGE_OPTIONS } from '../bymax-storage.constants'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import { emit } from '../utils/log-event'
import { assertCleanRoot } from '../utils/prototype-guard'
import { STORAGE_LOG_EVENTS } from '../utils/log-events'

/**
 * When credentials are missing the module registers but never instantiates a
 * client; operations then fail with `STORAGE_NOT_CONFIGURED`. This keeps dev
 * workflows running without storage credentials in the environment.
 */
@Injectable()
export class S3ClientProvider implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(S3ClientProvider.name)
  private client: S3Client | undefined

  constructor(
    @Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.hasCredentials) {
      emit(this.logger, 'warn', {
        event: STORAGE_LOG_EVENTS.credentialsMissing,
        message:
          'Storage credentials are missing — module is registered but operations will throw STORAGE_NOT_CONFIGURED.',
      })
      return
    }
    this.resolveClient()
  }

  onApplicationShutdown(): void {
    if (this.client) {
      this.client.destroy()
      this.client = undefined
    }
  }

  /**
   * Returns the live client, building it on first use, or `null` when storage is
   * not configured. Used by the public raw-client token so its value does not
   * depend on lifecycle-hook ordering.
   *
   * @returns The singleton client, or `null` when no credentials are configured.
   */
  getClientOrNull(): S3Client | null {
    if (!this.options.hasCredentials) {
      return null
    }
    return this.resolveClient()
  }

  /**
   * Returns the singleton client. Throws when storage is not configured — call
   * `isConfigured()` first and surface a typed `STORAGE_NOT_CONFIGURED`.
   *
   * @returns The singleton `S3Client`.
   * @throws Error when storage is not configured.
   */
  getClient(): S3Client {
    if (!this.client) {
      throw new Error('S3Client is not available — storage is not configured')
    }
    return this.client
  }

  /**
   * Reports whether the singleton client has been built.
   *
   * @returns `true` once the client exists, `false` otherwise.
   */
  isConfigured(): boolean {
    return Boolean(this.client)
  }

  private resolveClient(): S3Client {
    this.client ??= this.createClient()
    return this.client
  }

  private createClient(): S3Client {
    assertCleanRoot()
    const config: S3ClientConfig = {
      endpoint: this.options.endpoint,
      region: this.options.region,
      forcePathStyle: this.options.forcePathStyle,
      credentials: this.credentials(),
      maxAttempts: this.options.maxAttempts,
      // `requestTimeout` bounds one attempt, from sending the request until the response
      // headers arrive; the SDK only throws a `TimeoutError` (mapped to
      // `STORAGE_TIMEOUT`) when `throwOnRequestTimeout` is set, otherwise it logs a warning.
      requestHandler: {
        requestTimeout: this.options.requestTimeoutMs,
        throwOnRequestTimeout: true,
      },
      // Data-integrity checksums: AWS SDK v3 defaults to 'WHEN_SUPPORTED' (CRC32
      // headers), which non-AWS S3-compatible providers reject. Provider recipes
      // pass 'WHEN_REQUIRED'.
      requestChecksumCalculation: this.options.requestChecksumCalculation,
      responseChecksumValidation: this.options.responseChecksumValidation,
    }

    // No endpoint and no region: both are the host's configuration and are not repeated.
    emit(this.logger, 'log', {
      event: STORAGE_LOG_EVENTS.clientReady,
      message: 'S3Client initialized',
    })
    const client = new S3Client(config)
    // Runs once per attempt, after the retry step, so a retry is refused too.
    guardClient(client)
    return client
  }

  /** Null-prototype, so nothing planted on the root reaches the SDK's reads of it. */
  private credentials(): NonNullable<S3ClientConfig['credentials']> {
    const { accessKeyId, secretAccessKey, sessionToken } = this.options.credentials
    return Object.assign(Object.create(null) as object, {
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken === undefined || sessionToken === '' ? undefined : sessionToken,
    }) as NonNullable<S3ClientConfig['credentials']>
  }
}

/** Refuses each attempt of each command while the root prototype is dirty; a retry is one more attempt. */
function guardClient(client: S3Client): void {
  const guard = (next: (args: unknown) => Promise<unknown>) => (args: unknown) => {
    assertCleanRoot()
    return next(args)
  }
  client.middlewareStack.addRelativeTo(
    guard as unknown as Parameters<S3Client['middlewareStack']['addRelativeTo']>[0],
    { name: 'rootPrototypeGuard', relation: 'after', toMiddleware: 'retryMiddleware' },
  )
}
