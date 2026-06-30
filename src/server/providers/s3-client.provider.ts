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

/**
 * When credentials are missing the module registers but never instantiates a
 * client; operations then fail with `STORAGE_NOT_CONFIGURED`. This keeps dev
 * workflows running without storage credentials in the environment.
 */
@Injectable()
export class S3ClientProvider implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(S3ClientProvider.name)
  private client: S3Client | undefined

  constructor(@Inject(BYMAX_STORAGE_OPTIONS) private readonly options: ResolvedBymaxStorageOptions) {}

  onModuleInit(): void {
    if (!this.options.hasCredentials) {
      this.logger.warn(
        'Storage credentials are missing — module is registered but operations will throw STORAGE_NOT_CONFIGURED.',
      )
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
   */
  getClient(): S3Client {
    if (!this.client) {
      throw new Error('S3Client is not available — storage is not configured')
    }
    return this.client
  }

  isConfigured(): boolean {
    return Boolean(this.client)
  }

  private resolveClient(): S3Client {
    this.client ??= this.createClient()
    return this.client
  }

  private createClient(): S3Client {
    const config: S3ClientConfig = {
      endpoint: this.options.endpoint,
      region: this.options.region,
      forcePathStyle: this.options.forcePathStyle,
      credentials: {
        accessKeyId: this.options.credentials.accessKeyId,
        secretAccessKey: this.options.credentials.secretAccessKey,
        ...(this.options.credentials.sessionToken
          ? { sessionToken: this.options.credentials.sessionToken }
          : {}),
      },
      maxAttempts: this.options.maxAttempts,
      // Data-integrity checksums: AWS SDK v3 defaults to 'WHEN_SUPPORTED' (CRC32
      // headers), which non-AWS S3-compatible providers reject. Provider recipes
      // pass 'WHEN_REQUIRED'.
      requestChecksumCalculation: this.options.requestChecksumCalculation,
      responseChecksumValidation: this.options.responseChecksumValidation,
    }

    this.logger.log(
      `S3Client initialized: endpoint=${this.options.endpoint} region=${this.options.region}`,
    )
    return new S3Client(config)
  }
}
