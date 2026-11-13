/**
 * @fileoverview No URL the library builds or returns can carry userinfo: a configuration that puts a
 * user or a password into the endpoint, `publicBaseUrl` or `cdnBaseUrl` (directly or through a
 * provider recipe) fails at boot without repeating it, for both `forRoot` and `forRootAsync`, and
 * every public URL produced from an accepted configuration is free of it.
 * @layer server
 */
import { Test } from '@nestjs/testing'
import { BymaxStorageModule } from './bymax-storage.module'
import { providerRecipes } from './config/provider-recipes'
import { StorageException } from './errors/storage-exception'
import type { BymaxStorageModuleOptions } from './interfaces/storage-module-options.interface'
import { StorageService } from './services/storage.service'

const KEY = 'AKIAEXAMPLE'
const SECRET = 'SECRETEXAMPLE'
const CREDENTIALS = { accessKeyId: 'k', secretAccessKey: 's' }
const BASE: BymaxStorageModuleOptions = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'b',
  credentials: CREDENTIALS,
}

/** Everything an operator or a log could read from a thrown error: its message and its response body. */
function readable(error: unknown): string {
  return error instanceof StorageException
    ? `${error.message} ${JSON.stringify(error.getResponse())}`
    : String(error)
}

describe('credentials in a URL option', () => {
  const carrying: [string, BymaxStorageModuleOptions][] = [
    ['endpoint', { ...BASE, endpoint: `https://${KEY}:${SECRET}@s3.example.com` }],
    ['publicBaseUrl', { ...BASE, publicBaseUrl: `https://${KEY}:${SECRET}@cdn.example.com` }],
    ['cdnBaseUrl', { ...BASE, cdnBaseUrl: `https://${KEY}:${SECRET}@cdn.example.com` }],
    [
      'publicBaseUrl',
      providerRecipes.cloudflareR2({
        accountId: 'acct',
        bucket: 'b',
        accessKeyId: 'k',
        secretAccessKey: 's',
        customDomain: `https://${KEY}:${SECRET}@media.example.com`,
      }),
    ],
  ]

  it.each(carrying)('forRoot refuses a configuration whose %s carries credentials, naming it and repeating neither', (name, options) => {
    let thrown: unknown
    try {
      BymaxStorageModule.forRoot(options)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'STORAGE_INVALID_CONFIG' })
    expect(readable(thrown)).toContain(name)
    expect(readable(thrown)).not.toContain(KEY)
    expect(readable(thrown)).not.toContain(SECRET)
  })

  it.each(carrying)('forRootAsync refuses it too: %s', async (name, options) => {
    const compiled = Test.createTestingModule({
      imports: [BymaxStorageModule.forRootAsync({ useFactory: () => options })],
    }).compile()

    const error: unknown = await compiled.catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_INVALID_CONFIG' })
    expect(readable(error)).toContain(name)
    expect(readable(error)).not.toContain(KEY)
    expect(readable(error)).not.toContain(SECRET)
  })

  it.each([
    ['the endpoint-derived default', BASE, 'https://s3.example.com/b/k.txt'],
    ['publicBaseUrl', { ...BASE, publicBaseUrl: 'https://media.example.com/files' }, 'https://media.example.com/files/b/k.txt'],
    ['cdnBaseUrl taking precedence', { ...BASE, publicBaseUrl: 'https://media.example.com', cdnBaseUrl: 'https://cdn.example.com' }, 'https://cdn.example.com/b/k.txt'],
  ])('a URL built from %s has no userinfo', async (_name, options, expected) => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxStorageModule.forRoot(options)],
    }).compile()
    const url = moduleRef.get(StorageService).getPublicUrl('k.txt')
    await moduleRef.close()

    expect(url).toBe(expected)
    expect(new URL(url).username).toBe('')
    expect(new URL(url).password).toBe('')
  })
})
