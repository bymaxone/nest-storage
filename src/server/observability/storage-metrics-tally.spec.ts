/**
 * @fileoverview The tally keeps plain counts under closed keys: an operation and its outcome, the bytes
 * uploaded, the scan verdicts, and a duration listener that cannot break a count.
 * @layer server/observability
 */
import { STORAGE_OPERATIONS, STORAGE_OUTCOMES, SCAN_VERDICTS } from './storage-operations'
import { StorageMetricsTally } from './storage-metrics-tally'

describe('StorageMetricsTally', () => {
  it('starts with every operation, outcome and verdict at zero', () => {
    const snapshot = new StorageMetricsTally().snapshot()

    expect(Object.keys(snapshot.operations)).toEqual([...STORAGE_OPERATIONS])
    for (const operation of STORAGE_OPERATIONS) {
      expect(Object.keys(snapshot.operations[operation])).toEqual([...STORAGE_OUTCOMES])
      expect(Object.values(snapshot.operations[operation])).toEqual([0, 0, 0, 0])
    }
    expect(Object.keys(snapshot.scans)).toEqual([...SCAN_VERDICTS])
    expect(Object.values(snapshot.scans)).toEqual([0, 0, 0, 0, 0])
    expect(snapshot.bytesUploaded).toBe(0)
  })

  it('counts an operation under its own outcome and no other', () => {
    const tally = new StorageMetricsTally()

    tally.operation('upload', 'success', 0.1)
    tally.operation('upload', 'success', 0.2)
    tally.operation('head', 'not_found', 0.01)
    tally.operation('copy', 'aborted', 0.01)
    tally.operation('list', 'error', 0.01)

    const { operations } = tally.snapshot()
    expect(operations.upload).toEqual({ success: 2, not_found: 0, aborted: 0, error: 0 })
    expect(operations.head).toEqual({ success: 0, not_found: 1, aborted: 0, error: 0 })
    expect(operations.copy).toEqual({ success: 0, not_found: 0, aborted: 1, error: 0 })
    expect(operations.list).toEqual({ success: 0, not_found: 0, aborted: 0, error: 1 })
    expect(operations.delete).toEqual({ success: 0, not_found: 0, aborted: 0, error: 0 })
  })

  it('counts the verdict of a scan', () => {
    const tally = new StorageMetricsTally()

    tally.scan('clean')
    tally.scan('infected')
    tally.scan('infected')
    tally.scan('timeout')

    expect(tally.snapshot().scans).toEqual({
      clean: 1,
      infected: 2,
      unknown: 0,
      timeout: 1,
      error: 0,
    })
  })

  it.each([
    [[10, 5], 15],
    [[undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, 7], 7],
    // Two finite sizes whose sum overflows must not turn the count into Infinity, which no counter accepts.
    [[Number.MAX_VALUE, Number.MAX_VALUE, 5], Number.MAX_VALUE],
  ] as const)(
    'adds the bytes uploaded of %j and ignores what is not a positive finite number',
    (sizes, total) => {
      const tally = new StorageMetricsTally()

      for (const size of sizes) tally.bytesUploaded(size)

      expect(tally.snapshot().bytesUploaded).toBe(total)
    },
  )

  it('hands every duration to a listener, and a listener that throws or rejects changes no count', async () => {
    const tally = new StorageMetricsTally()
    const heard: [string, number][] = []
    tally.onDuration((operation, seconds) => {
      heard.push([operation, seconds])
    })
    tally.onDuration(() => {
      throw new Error('listener broke')
    })
    tally.onDuration(() => Promise.reject(new Error('listener rejected')))

    tally.operation('delete', 'success', 0.25)
    await new Promise((resolve) => setImmediate(resolve))

    expect(heard).toEqual([['delete', 0.25]])
    expect(tally.snapshot().operations.delete.success).toBe(1)
  })

  it('returns a copy, so a caller cannot change what is counted', () => {
    const tally = new StorageMetricsTally()
    const snapshot = tally.snapshot() as {
      operations: { upload: { success: number } }
      scans: { clean: number }
    }

    snapshot.operations.upload.success = 99
    snapshot.scans.clean = 99

    expect(tally.snapshot().operations.upload.success).toBe(0)
    expect(tally.snapshot().scans.clean).toBe(0)
  })
})
