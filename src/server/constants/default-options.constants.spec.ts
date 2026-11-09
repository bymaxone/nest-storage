/**
 * @fileoverview Pins every default the module applies under an option the consumer leaves out, so a
 * changed or dropped default fails here instead of silently changing every host application.
 * @layer server/constants, tests
 */
import * as defaults from './default-options.constants'

describe('default-options constants', () => {
  it('holds exactly the published defaults', () => {
    // Each value is what a consumer gets by omitting the option; a change is a behaviour change.
    expect({ ...defaults }).toStrictEqual({
      DEFAULT_CACHE_CONTROL: 'public, max-age=31536000, immutable',
      DEFAULT_CONTENT_DISPOSITION: 'inline',
      DEFAULT_MAX_ATTEMPTS: 3,
      DEFAULT_REQUEST_TIMEOUT_MS: 30_000,
      DEFAULT_FORCE_PATH_STYLE: false,
      DEFAULT_PUBLIC_READ: false,
      DEFAULT_CHECKSUM_CALCULATION: 'WHEN_SUPPORTED',
      DEFAULT_CHECKSUM_VALIDATION: 'WHEN_SUPPORTED',
      DEFAULT_SIGNED_URLS: {
        defaultGetTtlSeconds: 300,
        defaultPutTtlSeconds: 300,
        maxTtlSeconds: 604_800,
      },
      DEFAULT_MULTIPART: { thresholdBytes: 5_242_880, partSizeBytes: 5_242_880, queueSize: 4 },
      DEFAULT_SCANNER_MODE: 'pre-upload',
      DEFAULT_SCANNER_REJECT_ON_UNKNOWN: false,
      DEFAULT_IDEMPOTENCY_CACHE_MAX_ENTRIES: 1000,
      DEFAULT_IDEMPOTENCY_CACHE_TTL_MS: 86_400_000,
    })
  })
})
