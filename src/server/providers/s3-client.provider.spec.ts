/**
 * @fileoverview Unit tests for `S3ClientProvider` — lazy lifecycle, credential
 * tolerance, singleton reuse, and shutdown cleanup.
 * @layer server/providers
 */
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
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(true)
    expect(provider.getClient()).toBeInstanceOf(S3Client)
  })

  it('should create the client when a session token is provided', () => {
    // sessionToken spread branch.
    const provider = makeProvider({
      credentials: { accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't' },
    })
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(true)
  })

  it('should skip creation and stay unconfigured when credentials are missing', () => {
    // hasCredentials false branch — warn and return.
    const provider = makeProvider({ credentials: { accessKeyId: '', secretAccessKey: '' } })
    provider.onModuleInit()
    expect(provider.isConfigured()).toBe(false)
    expect(() => provider.getClient()).toThrow()
    expect(provider.getClientOrNull()).toBeNull()
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
