/**
 * @fileoverview Unit tests for `S3ClientProvider` — lazy lifecycle, credential
 * tolerance, singleton reuse, and shutdown cleanup.
 * @layer server/providers
 */
import { Logger } from '@nestjs/common'
import { S3Client } from '@aws-sdk/client-s3'
import { S3ClientProvider } from './s3-client.provider'
import { applyDefaults } from '../config/apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'

function makeProvider(overrides: Partial<BymaxStorageModuleOptions> = {}): S3ClientProvider {
  const options = applyDefaults({
    endpoint: 'http://localhost',
    region: 'us-east-1',
    bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    ...overrides,
  })
  return new S3ClientProvider(options)
}

describe('S3ClientProvider', () => {
  it('should create the client on init when credentials are present', () => {
    // hasCredentials true branch + createClient without a session token.
    const provider = makeProvider()
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(true)
    expect(provider.getClient()).toBeInstanceOf(S3Client)
    // createClient logs the initialization line with the endpoint/region.
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('S3Client initialized'))
    logSpy.mockRestore()
  })

  it('should build the client with the configured credentials, not the ambient chain', async () => {
    // The client config object must carry the provided credentials verbatim; an empty
    // config would fall back to the ambient credential provider (never accessKeyId "k").
    const provider = makeProvider()
    provider.onModuleInit()
    const creds = await provider.getClient().config.credentials()
    expect(creds.accessKeyId).toBe('k')
    expect(creds.secretAccessKey).toBe('s')
  })

  it('should create the client and forward the session token when one is provided', async () => {
    // sessionToken spread branch — the token must reach the resolved client credentials.
    const provider = makeProvider({
      credentials: { accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't' },
    })
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(true)
    const creds = await provider.getClient().config.credentials()
    expect(creds.sessionToken).toBe('t')
  })

  it('should skip creation and stay unconfigured when credentials are missing', () => {
    // hasCredentials false branch — warn and return.
    const provider = makeProvider({ credentials: { accessKeyId: '', secretAccessKey: '' } })
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(false)
    expect(() => provider.getClient()).toThrow('S3Client is not available')
    expect(provider.getClientOrNull()).toBeNull()
    // The missing-credentials path must emit the specific warning.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('credentials are missing'))
    warnSpy.mockRestore()
  })

  it('should build the client on demand via getClientOrNull', () => {
    // getClientOrNull configured branch (create on first use).
    const provider = makeProvider()
    expect(provider.getClientOrNull()).toBeInstanceOf(S3Client)
  })

  it('should reuse the same client instance across calls', () => {
    // resolveClient already-built branch.
    const provider = makeProvider()
    provider.onModuleInit()
    const first = provider.getClient()
    expect(provider.getClientOrNull()).toBe(first)
  })

  it('should destroy the client and clear the reference on shutdown', () => {
    // Shutdown with a live client.
    const provider = makeProvider()
    provider.onModuleInit()
    const destroySpy = jest.spyOn(provider.getClient(), 'destroy')
    provider.onApplicationShutdown()
    expect(destroySpy).toHaveBeenCalledTimes(1)
    expect(provider.isConfigured()).toBe(false)
  })

  it('should be a no-op on shutdown when no client was created', () => {
    // Shutdown with no client.
    const provider = makeProvider({ credentials: { accessKeyId: '', secretAccessKey: '' } })
    provider.onModuleInit()
    expect(() => {
      provider.onApplicationShutdown()
    }).not.toThrow()
  })
})
