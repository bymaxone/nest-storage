import type { Config } from 'jest'
import base from './jest.config.ts'

/**
 * End-to-end test configuration. Targets specs under `test/e2e` that exercise
 * the library against a real MinIO instance (Testcontainers). The package name
 * is mapped to the source entry points so fixtures consume the public API
 * exactly as a downstream app would. Worker count stays capped at 50% (from the
 * base config) so only one container is exercised at a time. `passWithNoTests`
 * keeps the job green until end-to-end specs are added.
 */
const config: Config = {
  ...base,
  rootDir: '.',
  // Root at the repository so the suite stays green on a scaffold without an
  // end-to-end directory; specs are scoped to `test/e2e` via `testMatch`.
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  collectCoverageFrom: undefined,
  coverageThreshold: undefined,
  testTimeout: 60_000,
  passWithNoTests: true,
  // Testcontainers keeps a background reaper connection alive for the process;
  // force a clean exit once the suite (which stops the container) has finished.
  forceExit: true,
  moduleNameMapper: {
    '^@bymax-one/nest-storage/shared$': '<rootDir>/src/shared/index.ts',
    '^@bymax-one/nest-storage$': '<rootDir>/src/server/index.ts',
  },
}

export default config
