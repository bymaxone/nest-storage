// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/**
 * Flat ESLint configuration. Type-aware linting on the source tree with the
 * strict + stylistic typescript-eslint presets. Prettier is applied last to
 * disable formatting rules that would conflict with the formatter.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '.stryker-tmp/**',
      'reports/**',
      '**/*.mjs',
      '**/*.cjs',
      '*.config.ts',
      'jest.*.config.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // NestJS module/provider classes are decorated and may legitimately carry
      // only static factory methods.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // AGENTS.md: a function over 50 lines is a finding for what a change introduces. Lines are
    // counted raw (blank lines and comments included), the way a reviewer reads the file. Tests are
    // out of scope: their unit is the body of a single `it`, and `describe` callbacks are grouping
    // constructs this rule cannot tell apart.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    // An `eslint-disable` comment would otherwise accept a long function without a trace: inline
    // configuration is ignored here, so the directive does nothing and the rule still reports.
    linterOptions: { noInlineConfig: true },
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: false, skipComments: false, IIFEs: true },
      ],
    },
  },
  {
    // Every await on a library path goes through a hop that follows the work with the `then` captured at load
    // and hands back a promise with a pinned own constructor. A bare `await` reads the `constructor` of what it
    // awaits at that moment, and a promise whose constructor is not the engine's is resolved through the live
    // `then`; a host hook that ran just before could have planted either. `return await` is required so a
    // returned promise is awaited, never resolved through `then` by the async function's own return.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/return-await': ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AwaitExpression > :not(CallExpression[callee.name=/^(verdictOf|stepOf|settleOrCut|abortable|allOf|pinnedWork)$/])',
          message:
            'Await a decision-path promise through verdictOf, stepOf, allOf, settleOrCut or abortable, which follow it with the then captured at load.',
        },
        {
          selector: 'ForOfStatement[await=true]',
          message:
            'Read an async iterator step by step, awaiting each next() through verdictOf: for await awaits every step bare.',
        },
      ],
    },
  },
  {
    // The hop primitives await promises they built themselves, pinned and handled one line before.
    files: ['src/server/utils/settle-or-cut.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  prettier,
)
