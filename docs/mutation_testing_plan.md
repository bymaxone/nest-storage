# Mutation Testing Plan — @bymax-one/nest-storage

## Strategy

Mutation testing uses [StrykerJS](https://stryker-mutator.io/) configured in `stryker.config.json`. The goal is to verify that the test suite catches every real fault the library could ship — not just that coverage is 100%, but that every assertion is tight enough to detect a meaningful code change.

### Thresholds

```
high:  100   (target — alert when the score drops below 100%)
low:    95   (warning zone)
break:  95   (the run fails below this score; a CI job or release gate that uses
              this threshold will exit non-zero, blocking the release)
```

A mutation score of 100% means every mutant is either killed by an assertion or documented as a provable equivalent. The `break: 95` floor prevents a regression from shipping undetected.

### When to run

Mutation testing is **not** run on every CI commit — a full run takes 10–20 minutes and would bottleneck pull-request feedback. It runs:

1. **Manually, pre-release** — before tagging `v*.*.*`, run `pnpm mutation` and confirm the score is at or above the break threshold.
2. **After any change to a critical path** — when `key-resolver.service.ts`, `validate-options.ts`, `ttl-clamp.ts`, `mime-match.ts`, `idempotency-cache.ts`, or `header-utils.ts` are modified, run mutation testing before the PR merges.

```bash
# Full run (10–20 min):
pnpm mutation

# Incremental (re-checks only files changed since last run — much faster):
pnpm mutation:full        # cold — deletes the baseline first, measures the truth
pnpm mutation:dry-run
```

### HTML report

After each run, StrykerJS generates a report at `reports/mutation/mutation.html`. Open it in a browser to inspect survivors and understand which assertions need strengthening.

---

## Equivalent Mutants

When a mutation cannot be killed by any test — because no observable behaviour changes regardless of which path is taken — it is a **provable equivalent mutant**. These are not test gaps; they are cases where the mutated code and the original code are indistinguishable from the outside.

Equivalent mutants are **never suppressed with a blanket disable**. Each is disabled at its exact source line using:

```typescript
// Stryker disable next-line <MutatorName>: <reason why this mutation is equivalent>
```

For example:

```typescript
// Stryker disable next-line ConditionalExpression: An empty normalized string can never contain '/'
// so the second operand already covers the length-0 case — forcing this to false is equivalent.
if (normalized.length === 0 || !normalized.includes('/')) { ... }
```

Suppressing a non-equivalent mutant to raise the score artificially is a critical finding in code review. Every suppression must include a written reason that explains why the mutation cannot change observable behaviour for any valid input.

---

## Critical Paths

The following files are held at the highest scrutiny and are verified at or above the `break: 95` threshold:

| File | Security / correctness concern |
|---|---|
| `src/server/services/key-resolver.service.ts` | Path-traversal guard; keyPrefix isolation; any survivor here could allow a security bypass |
| `src/server/config/validate-options.ts` + `resolved-options.ts` | Module-options validation; a survivor could allow malformed config to pass through |
| `src/server/utils/ttl-clamp.ts` | Signed-URL TTL enforcement; a survivor could allow an unbounded TTL |
| `src/server/utils/mime-match.ts` | MIME whitelist matching; a survivor could allow a blocked type through |
| `src/server/utils/idempotency-cache.ts` | Cache key lookup and eviction; a survivor could cause incorrect deduplication |
| `src/server/utils/header-utils.ts` | Content-Type normalisation; a survivor could misclassify a MIME type |

These files target 100% mutation score. Survivors in these files block a release regardless of the global score.

---

## Stryker Configuration

```json
// stryker.config.json (abbreviated)
{
  "mutate": ["src/server/**/*.ts", "!src/server/**/*.spec.ts"],
  "testRunner": "jest",
  "coverageAnalysis": "perTest",
  "thresholds": { "high": 100, "low": 95, "break": 95 },
  "reporters": ["html", "progress", "summary"],
  "htmlReporter": { "fileName": "reports/mutation/mutation.html" }
}
```

The TypeScript checker plugin runs alongside mutation testing to reject type-invalid mutants before they reach the test runner — this prevents false survivors caused by TypeScript type errors rather than missing assertions.

---

## Interpreting Results

| Metric | Meaning |
|---|---|
| **Killed** | Mutant was caught by at least one test — good |
| **Survived** | Mutant ran but no test detected the change — needs a new assertion or is an equivalent |
| **No coverage** | Mutant was not reached by any test — indicates a coverage gap (should not happen with the 100% coverage gate) |
| **Timeout** | Test exceeded the timeout when the mutant was active — treated as detected |
| **Ignored / Disabled** | Suppressed inline with a documented reason |

A **Survived** result is always either:
1. A real assertion gap → add or strengthen a test assertion.
2. A provable equivalent → suppress inline with a written reason.

Never raise the break threshold to accommodate a survivor. Fix the survivor instead.

---

## Suppression policy

An equivalent mutant — one no test can kill because the mutation preserves observable
behaviour — is documented **in the source**, on the line it applies to:

```ts
// Stryker disable next-line <Mutator>[,<Mutator>]: <why the mutant is equivalent>
```

The reason belongs next to the code it explains, where it cannot drift away from it. A
separate report can, and does: line references rot after a reformatting, and a report can
claim a score the branch no longer measures.

Four rules keep that documentation real rather than decorative:

- **The reason goes after the colon, on one line.** Stryker parses a directive with
  `/^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)(?::(.+)?)?/`. The mutator
  list accepts letters, commas and spaces only, and the reason is captured exclusively
  after the colon and only to the end of that line. Written after `--`, or wrapped onto a
  second comment line, the reason is silently dropped and the report shows Stryker's
  fallback text, `Ignored using a comment`.
- **A directive that does not attach uses the block form.** `next-line` does not reach a
  catch-clause body, a multi-line call argument, or anything inside a builder chain. Those
  take `// Stryker disable <Mutator>` … `// Stryker restore <Mutator>` around the whole
  statement.
- **The reason must be true.** Where a mutant is not equivalent but Stryker fails to
  attribute the killing test to it, the directive says exactly that. Calling it equivalent
  would be false, and a false justification is worth less than a lower score.
- **A mutant a test could kill is never disabled.** Strengthen the test instead. The break
  threshold is never lowered to accommodate a survivor.

`pnpm check:mutants` enforces the first rule mechanically, and also rejects a mutator name
Stryker does not know — which matches nothing, so the directive silences nothing while
looking like it does. Stryker warns about that case, but only during a mutation run, which
is too late to block the change that introduced it.

These comments ship in the unminified bundle. The measured cost is small — seven directives
cost 0.10 kB brotli in a server subpath of roughly 13 kB — because brotli compresses their
repeated prefixes almost for free. Where a bundle budget is genuinely tight, the budget is
raised deliberately in the same change with the measurement recorded beside it, rather than
the documentation being dropped: a budget exists to catch code bloat, and the reason a
mutant survives is not bloat.

This policy is identical across the `@bymax-one/nest-*` libraries.
