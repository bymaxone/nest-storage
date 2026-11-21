/**
 * @fileoverview The contributor registers every collector on a real registry and scrapes with closed labels: a
 * sample for each operation and outcome before any event, the counts the tally holds after, the same numbers on a
 * second scrape, and a duration histogram that is fed as operations end.
 * @layer observability
 */
import { Registry } from 'prom-client'
import {
  SCAN_VERDICTS,
  STORAGE_OPERATIONS,
  STORAGE_OUTCOMES,
  StorageMetricsTally,
} from '@bymax-one/nest-storage'
import { METRICS_CONTRIBUTOR_METADATA, StorageMetrics } from './storage-metrics'

/** A registry with the contributor registered on it, and the tally behind it. */
function registered(): { registry: Registry; tally: StorageMetricsTally } {
  const registry = new Registry()
  const tally = new StorageMetricsTally()
  new StorageMetrics(tally).registerMetrics(registry)
  return { registry, tally }
}

/** The sample lines of a scrape, without the comments. */
function samples(text: string): string[] {
  return text.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
}

describe('StorageMetrics', () => {
  it('is discovered by the documented metadata key', () => {
    expect(METRICS_CONTRIBUTOR_METADATA).toBe('bymax-one:metrics-contributor')
    expect(Reflect.getMetadata(METRICS_CONTRIBUTOR_METADATA, StorageMetrics)).toBe(true)
  })

  it('registers every collector with its help text and type', async () => {
    const { registry } = registered()

    const text = await registry.metrics()

    for (const [name, type] of [
      ['bymax_storage_operations_total', 'counter'],
      ['bymax_storage_operation_duration_seconds', 'histogram'],
      ['bymax_storage_bytes_uploaded_total', 'counter'],
      ['bymax_storage_scans_total', 'counter'],
    ] as const) {
      expect(text).toContain(`# HELP ${name} `)
      expect(text).toContain(`# TYPE ${name} ${type}`)
    }
  })

  it('shows a zero sample for every operation and outcome, every verdict and the bytes before any event', async () => {
    const { registry } = registered()

    const text = await registry.metrics()

    for (const operation of STORAGE_OPERATIONS) {
      for (const outcome of STORAGE_OUTCOMES) {
        expect(text).toContain(
          `bymax_storage_operations_total{operation="${operation}",outcome="${outcome}"} 0`,
        )
      }
      expect(text).toContain(
        `bymax_storage_operation_duration_seconds_count{operation="${operation}"} 0`,
      )
    }
    for (const verdict of SCAN_VERDICTS) {
      expect(text).toContain(`bymax_storage_scans_total{verdict="${verdict}"} 0`)
    }
    expect(text).toContain('bymax_storage_bytes_uploaded_total 0')
  })

  it('shows what the operations counted, and the same numbers when nothing happened since', async () => {
    const { registry, tally } = registered()
    tally.operation('upload', 'success', 0.2)
    tally.operation('upload', 'success', 0.4)
    tally.operation('head', 'not_found', 0.01)
    tally.bytesUploaded(1500)
    tally.scan('infected')

    const first = await registry.metrics()
    const second = await registry.metrics()

    expect(first).toContain(
      'bymax_storage_operations_total{operation="upload",outcome="success"} 2',
    )
    expect(first).toContain(
      'bymax_storage_operations_total{operation="head",outcome="not_found"} 1',
    )
    expect(first).toContain('bymax_storage_bytes_uploaded_total 1500')
    expect(first).toContain('bymax_storage_scans_total{verdict="infected"} 1')
    expect(second).toBe(first)
  })

  it('still answers a scrape when the bytes uploaded overflow a number', async () => {
    // Two finite sizes whose sum is Infinity: prom-client refuses `inc(Infinity)`, which would fail the whole scrape.
    const { registry, tally } = registered()
    tally.bytesUploaded(Number.MAX_VALUE)
    tally.bytesUploaded(Number.MAX_VALUE)

    await expect(registry.metrics()).resolves.toContain(
      `bymax_storage_bytes_uploaded_total ${String(Number.MAX_VALUE)}`,
    )
  })

  it('counts an operation that ended before the contributor registered', async () => {
    const tally = new StorageMetricsTally()
    tally.operation('copy', 'error', 0.1)
    const registry = new Registry()

    new StorageMetrics(tally).registerMetrics(registry)

    expect(await registry.metrics()).toContain(
      'bymax_storage_operations_total{operation="copy",outcome="error"} 1',
    )
  })

  it('feeds the duration histogram as operations end, by operation, and the sum is the seconds taken', async () => {
    const { registry, tally } = registered()

    tally.operation('download', 'success', 0.3)
    tally.operation('download', 'error', 1.2)
    tally.operation('list', 'success', 0.004)

    const text = await registry.metrics()
    expect(text).toContain('bymax_storage_operation_duration_seconds_count{operation="download"} 2')
    expect(text).toContain('bymax_storage_operation_duration_seconds_sum{operation="download"} 1.5')
    expect(text).toContain('bymax_storage_operation_duration_seconds_count{operation="list"} 1')
    expect(text).toContain(
      'bymax_storage_operation_duration_seconds_bucket{le="0.005",operation="list"} 1',
    )
    expect(text).toContain('bymax_storage_operation_duration_seconds_count{operation="upload"} 0')
  })

  it('keeps the number of series fixed however many operations run, and no label holds anything else', async () => {
    const { registry, tally } = registered()
    const before = samples(await registry.metrics()).length

    for (let index = 0; index < 50; index += 1) {
      tally.operation(
        STORAGE_OPERATIONS[index % STORAGE_OPERATIONS.length] ?? 'upload',
        'success',
        0.01 * index,
      )
      tally.bytesUploaded(index)
      tally.scan('clean')
    }

    const text = await registry.metrics()
    expect(samples(text).length).toBe(before)
    const labelNames = new Set([...text.matchAll(/[{,](\w+)="/g)].map((match) => match[1]))
    expect([...labelNames].sort()).toEqual(['le', 'operation', 'outcome', 'verdict'])
    const values = new Set(
      [...text.matchAll(/(?:operation|outcome|verdict)="([^"]*)"/g)].map((match) => match[1]),
    )
    const allowed = new Set<string>([...STORAGE_OPERATIONS, ...STORAGE_OUTCOMES, ...SCAN_VERDICTS])
    for (const value of values) expect(allowed.has(value ?? '')).toBe(true)
  })
})
