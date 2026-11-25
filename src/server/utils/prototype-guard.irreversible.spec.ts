/**
 * @fileoverview The one guard row that cannot be undone: a built-in made non-configurable stays so for the
 * rest of the realm, so the row lives in a file of its own, where no other row shares that realm.
 * @layer server/utils
 */
import type * as Guard from './prototype-guard'

describe('assertCleanRoot, a change that cannot be undone', () => {
  it('refuses a built-in made non-configurable after the module loaded', async () => {
    let loaded: typeof Guard | undefined
    await jest.isolateModulesAsync(async () => {
      loaded = await import('./prototype-guard')
    })
    Object.defineProperty(Math, 'floor', { configurable: false })
    let thrown: unknown
    try {
      loaded?.assertCleanRoot()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
  })
})
