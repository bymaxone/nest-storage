import type { Config } from 'jest'
import base from './jest.config.ts'

/**
 * Jest configuration consumed by the Stryker mutation-testing runner. Coverage
 * collection is disabled because Stryker tracks mutant kills itself.
 */
const config: Config = {
  ...base,
  collectCoverage: false,
  coverageThreshold: undefined,
  // `check-api-surface.spec.ts` runs a repository script on fixture directories and touches no code
  // in `src`, so it kills no mutant; `pnpm test` still runs it. The two `*.source.spec.ts` scans read
  // the source text: under Stryker that text is the instrumented copy, so they would fail the dry run
  // on the mutants' own alternatives and kill mutants by text alone, which hides behavioural survivors.
  testPathIgnorePatterns: [
    ...(base.testPathIgnorePatterns ?? ['/node_modules/']),
    '/check-api-surface\\.spec\\.ts$',
    '/[\\w-]+\\.source\\.spec\\.ts$',
  ],
}

export default config
