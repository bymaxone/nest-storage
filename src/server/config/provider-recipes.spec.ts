/**
 * @fileoverview Unit tests for the Provider Recipes: endpoint/region/addressing
 * per provider, the R2 custom-domain requirement, the DO CDN host, the non-AWS
 * checksum opt-out (present on all five non-AWS recipes, absent on AWS), session
 * token forwarding, and determinism (same input → deep-equal output).
 * @layer server/config
 */
import { providerRecipes } from './provider-recipes'

const CREDS = { accessKeyId: 'AKIA', secretAccessKey: 'secret' }

describe('providerRecipes.awsS3', () => {
  it('builds the regional endpoint and keeps the SDK default checksum behaviour', () => {
    // AWS keeps 'WHEN_SUPPORTED' — no checksum overrides in the recipe.
    const config = providerRecipes.awsS3({ region: 'us-east-1', bucket: 'b', ...CREDS })
    expect(config.endpoint).toBe('https://s3.us-east-1.amazonaws.com')
    expect(config.forcePathStyle).toBe(false)
    expect(config.publicBaseUrl).toBe('https://b.s3.us-east-1.amazonaws.com')
    expect(config.serverSideEncryption).toBe('AES256')
    expect(config.requestChecksumCalculation).toBeUndefined()
    expect(config.responseChecksumValidation).toBeUndefined()
  })

  it('forwards a session token only when provided', () => {
    // Present → forwarded; absent → omitted.
    const withToken = providerRecipes.awsS3({ region: 'us-east-1', bucket: 'b', ...CREDS, sessionToken: 'tok' })
    expect(withToken.credentials.sessionToken).toBe('tok')
    const without = providerRecipes.awsS3({ region: 'us-east-1', bucket: 'b', ...CREDS })
    expect(without.credentials.sessionToken).toBeUndefined()
  })
})

describe('providerRecipes.digitalOceanSpaces', () => {
  it('builds the Spaces endpoint, a CDN host, and opts out of checksums', () => {
    // DO Spaces is public-by-default and needs the checksum opt-out.
    const config = providerRecipes.digitalOceanSpaces({ region: 'nyc3', bucket: 'b', ...CREDS })
    expect(config.endpoint).toBe('https://nyc3.digitaloceanspaces.com')
    expect(config.publicBaseUrl).toBe('https://b.nyc3.digitaloceanspaces.com')
    expect(config.cdnBaseUrl).toBe('https://b.nyc3.cdn.digitaloceanspaces.com')
    expect(config.defaultPublicRead).toBe(true)
    expect(config.requestChecksumCalculation).toBe('WHEN_REQUIRED')
    expect(config.responseChecksumValidation).toBe('WHEN_REQUIRED')
  })
})

describe('providerRecipes.cloudflareR2', () => {
  it('sets region auto, the account endpoint, and the custom domain as publicBaseUrl', () => {
    // R2 has no working default public host — customDomain drives publicBaseUrl.
    const config = providerRecipes.cloudflareR2({
      accountId: 'abc',
      bucket: 'b',
      customDomain: 'https://cdn.example.com',
      ...CREDS,
    })
    expect(config.region).toBe('auto')
    expect(config.endpoint).toBe('https://abc.r2.cloudflarestorage.com')
    expect(config.publicBaseUrl).toBe('https://cdn.example.com')
    expect(config.forcePathStyle).toBe(false)
    expect(config.requestChecksumCalculation).toBe('WHEN_REQUIRED')
  })
})

describe('providerRecipes.backblazeB2', () => {
  it('uses virtual-hosted addressing and opts out of checksums', () => {
    // B2 supports both styles; virtual-hosted matches publicBaseUrl.
    const config = providerRecipes.backblazeB2({
      region: 'us-west-002',
      bucket: 'b',
      endpointHost: 's3.us-west-002.backblazeb2.com',
      ...CREDS,
    })
    expect(config.endpoint).toBe('https://s3.us-west-002.backblazeb2.com')
    expect(config.forcePathStyle).toBe(false)
    expect(config.publicBaseUrl).toBe('https://b.s3.us-west-002.backblazeb2.com')
    expect(config.responseChecksumValidation).toBe('WHEN_REQUIRED')
  })
})

describe('providerRecipes.minio', () => {
  it('uses path-style addressing and defaults the region', () => {
    // Absent region → 'us-east-1'; a trailing slash is trimmed from publicBaseUrl.
    const config = providerRecipes.minio({ endpoint: 'http://localhost:9000/', bucket: 'b', ...CREDS })
    expect(config.forcePathStyle).toBe(true)
    expect(config.region).toBe('us-east-1')
    expect(config.publicBaseUrl).toBe('http://localhost:9000/b')
    expect(config.requestChecksumCalculation).toBe('WHEN_REQUIRED')
  })

  it('honors an explicit region', () => {
    // A provided region overrides the default.
    const config = providerRecipes.minio({ endpoint: 'http://localhost:9000', bucket: 'b', region: 'eu-1', ...CREDS })
    expect(config.region).toBe('eu-1')
    expect(config.publicBaseUrl).toBe('http://localhost:9000/b')
  })
})

describe('providerRecipes.wasabi', () => {
  it('builds the Wasabi endpoint and opts out of checksums', () => {
    // Wasabi rejects the SDK's default integrity headers.
    const config = providerRecipes.wasabi({ region: 'us-east-1', bucket: 'b', ...CREDS })
    expect(config.endpoint).toBe('https://s3.us-east-1.wasabisys.com')
    expect(config.publicBaseUrl).toBe('https://b.s3.us-east-1.wasabisys.com')
    expect(config.requestChecksumCalculation).toBe('WHEN_REQUIRED')
  })
})

describe('providerRecipes determinism', () => {
  it('returns deep-equal output for the same input across every recipe', () => {
    // Recipes are pure references — no hidden state between calls.
    const base = { region: 'us-east-1', bucket: 'b', ...CREDS }
    expect(providerRecipes.awsS3(base)).toEqual(providerRecipes.awsS3(base))
    expect(providerRecipes.digitalOceanSpaces(base)).toEqual(providerRecipes.digitalOceanSpaces(base))
    expect(providerRecipes.wasabi(base)).toEqual(providerRecipes.wasabi(base))
    const r2 = { accountId: 'abc', bucket: 'b', customDomain: 'https://cdn.example.com', ...CREDS }
    expect(providerRecipes.cloudflareR2(r2)).toEqual(providerRecipes.cloudflareR2(r2))
    const b2 = { region: 'r', bucket: 'b', endpointHost: 'h', ...CREDS }
    expect(providerRecipes.backblazeB2(b2)).toEqual(providerRecipes.backblazeB2(b2))
    const mi = { endpoint: 'http://localhost:9000', bucket: 'b', ...CREDS }
    expect(providerRecipes.minio(mi)).toEqual(providerRecipes.minio(mi))
  })
})
