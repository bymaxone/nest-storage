import type { Config } from 'jest'

/**
 * Base Jest configuration. Specs are transformed by ts-jest against the
 * CommonJS-flavored `tsconfig.jest.json`. Worker count is capped at 50% to keep
 * memory bounded in CI and local runs. The global coverage threshold is 100% so
 * the per-PR `pnpm test:cov` gate enforces the same floor as the release gate,
 * with no drift. A run that selects no test fails.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.jest.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@bymax-one/nest-storage/shared$': '<rootDir>/src/shared/index.ts',
    '^@bymax-one/nest-storage$': '<rootDir>/src/server/index.ts',
  },
  clearMocks: true,
  restoreMocks: true,
  // Stryker sandboxes hold copies of the package and its specs.
  modulePathIgnorePatterns: ['<rootDir>/.stryker-tmp/'],
  maxWorkers: '50%',
  collectCoverageFrom: ['src/**/*.ts', '!**/index.ts', '!**/*.spec.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
}

export default config
