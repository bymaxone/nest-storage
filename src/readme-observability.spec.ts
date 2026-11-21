/**
 * @fileoverview The README "Observability" section lists the metrics the contributor registers, the closed sets
 * the labels come from, and the spans the library starts, and nothing else.
 * @layer root
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Registry } from 'prom-client'
import {
  SCAN_VERDICTS,
  STORAGE_OPERATIONS,
  STORAGE_OUTCOMES,
  StorageMetricsTally,
} from '@bymax-one/nest-storage'
import { StorageMetrics } from './observability/storage-metrics'

const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')
const section = README.slice(
  README.indexOf('## 📊 Observability'),
  README.indexOf('## 📋 Log events'),
)

/** The members of the closed set named by the bullet that starts with `label`: the back-ticked words before any `(`. */
function listed(label: string): string[] {
  const bullet =
    (section.split('\n- ').find((text) => text.startsWith(`\`${label}\``)) ?? '').split(
      '\n\n',
    )[0] ?? ''
  return [...bullet.replaceAll(/\([^)]*\)/g, '').matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1] ?? '')
    .slice(1)
}

describe('the README observability section', () => {
  it('lists the metrics the contributor registers, once each', async () => {
    const registry = new Registry()
    new StorageMetrics(new StorageMetricsTally()).registerMetrics(registry)
    const registered = (await registry.getMetricsAsJSON()).map((metric) => metric.name).sort()

    const rows = [...section.matchAll(/^\| `(bymax_storage_[a-z_]+)` \|/gm)].map(
      (match) => match[1],
    )

    expect(rows.sort()).toEqual(registered)
  })

  it('names the operations, the outcomes and the verdicts of the closed sets, in order', () => {
    expect(listed('operation')).toEqual([...STORAGE_OPERATIONS])
    expect(listed('outcome')).toEqual([...STORAGE_OUTCOMES])
    expect(listed('verdict')).toEqual([...SCAN_VERDICTS])
  })

  it('lists the spans the library starts', () => {
    const tracing = readFileSync(join(__dirname, 'server/observability/storage-tracing.ts'), 'utf8')
    const started = [
      ...(/StorageSpanName =([^\n]+)/.exec(tracing)?.[1] ?? '').matchAll(/'(storage\.[a-z_]+)'/g),
    ].map((match) => match[1])

    const rows = [...section.matchAll(/^\| `(storage\.[a-z_]+)` \|/gm)].map((match) => match[1])

    expect(started).toHaveLength(3)
    expect(rows).toEqual(started)
  })
})
