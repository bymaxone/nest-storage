/**
 * @fileoverview Without the optional package the span seam stays inert and the operation runs bare.
 * @layer server/observability
 */
import { StorageTracing } from './storage-tracing'

jest.mock('@opentelemetry/api', () => {
  throw new Error("Cannot find module '@opentelemetry/api'")
})

describe('StorageTracing without @opentelemetry/api', () => {
  it('loads quietly and runs the operation bare, with its result and its error unchanged', async () => {
    const tracing = new StorageTracing()
    const run = jest.fn(() => Promise.resolve('bare'))
    const failure = new Error('operation failed')

    await expect(tracing.onModuleInit()).resolves.toBeUndefined()
    await expect(tracing.span('storage.upload', {}, run)).resolves.toBe('bare')
    await expect(tracing.span('storage.upload', {}, () => Promise.reject(failure))).rejects.toBe(
      failure,
    )

    expect(run).toHaveBeenCalledTimes(1)
  })
})
