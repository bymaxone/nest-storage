/**
 * @fileoverview Every log line goes out as one object through one helper that a host logger cannot break.
 * @layer server/utils
 */
import { emit, type LogSink } from './log-event'

function sink(): { [K in keyof LogSink]: jest.Mock<unknown, [unknown]> } {
  return {
    debug: jest.fn<unknown, [unknown]>(),
    log: jest.fn<unknown, [unknown]>(),
    warn: jest.fn<unknown, [unknown]>(),
    error: jest.fn<unknown, [unknown]>(),
  }
}

describe('emit', () => {
  it.each(['debug', 'log', 'warn', 'error'] as const)('hands the entry to the %s method and to no other', (level) => {
    const logger = sink()
    const entry = { event: 'STORAGE_TEST', message: 'text', field: 1 }

    emit(logger, level, entry)

    for (const name of ['debug', 'log', 'warn', 'error'] as const) {
      expect(logger[name]).toHaveBeenCalledTimes(name === level ? 1 : 0)
    }
    expect(logger[level]).toHaveBeenCalledWith(entry)
  })

  it('does not fail when the logger throws', () => {
    const logger = sink()
    logger.warn.mockImplementation(() => {
      throw new Error('host logger')
    })

    expect(() => {
      emit(logger, 'warn', { event: 'STORAGE_TEST', message: 'text' })
    }).not.toThrow()
  })

  it('absorbs the rejection of a logger method that is async although it is typed void', async () => {
    const logger = sink()
    const rejected = Promise.reject(new Error('host logger'))
    const handled = jest.fn()
    rejected.catch(handled)
    logger.error.mockReturnValue(rejected)

    emit(logger, 'error', { event: 'STORAGE_TEST', message: 'text' })

    await new Promise((resolve) => setImmediate(resolve))
    expect(handled).toHaveBeenCalledTimes(1)
  })
})
