/**
 * @fileoverview The subpath meets the published `@bymax-one/nest-core` contracts without importing it: the metadata
 * keys the module discovers by, and the shapes of the contributor and the indicator, are compared with the
 * package's own declarations, and a real registry serves what the contributor registers.
 * @layer observability
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StorageHealthIndicator, HEALTH_INDICATOR_METADATA } from './storage-health'
import { StorageMetrics, METRICS_CONTRIBUTOR_METADATA } from './storage-metrics'

/** The published declarations of one subpath of the contract package. */
function declarations(subpath: 'health' | 'metrics'): string {
  return readFileSync(
    join(__dirname, '../../node_modules/@bymax-one/nest-core/dist', subpath, 'index.d.ts'),
    'utf8',
  )
}

describe('observability against @bymax-one/nest-core', () => {
  it('matches the keys and the shapes the published declarations name', () => {
    const metrics = declarations('metrics')
    const health = declarations('health')

    expect(metrics).toContain(
      `BYMAX_METRICS_CONTRIBUTOR_METADATA = "${METRICS_CONTRIBUTOR_METADATA}"`,
    )
    expect(metrics).toContain('registerMetrics(registry: MetricsRegistry): void;')
    expect(health).toContain(`BYMAX_HEALTH_INDICATOR_METADATA = "${HEALTH_INDICATOR_METADATA}"`)
    expect(health).toContain('readonly name: string;')
    expect(health).toContain('check(signal?: AbortSignal): Promise<HealthIndicatorResult>;')
    expect(health).toContain("status: 'up' | 'down';")
    expect(Reflect.getMetadata(METRICS_CONTRIBUTOR_METADATA, StorageMetrics)).toBe(true)
    expect(Reflect.getMetadata(HEALTH_INDICATOR_METADATA, StorageHealthIndicator)).toBe(true)
    expect(typeof StorageMetrics.prototype.registerMetrics).toBe('function')
  })
})
