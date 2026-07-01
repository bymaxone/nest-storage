# Development Tasks — @bymax-one/nest-storage

> **Last updated:** 2026-06-30
> **Source roadmap:** [`../development_plan.md`](../development_plan.md) · **Spec:** [`../technical_specification.md`](../technical_specification.md)

Tasks live **one file per phase** in this folder (`phase-NN-<slug>.md`), following the Bymax task-doc convention (same pattern as `bymax-one/rust-auth`). Each phase file is self-contained: context, rules-of-phase, reference docs, a task index, the tasks (each with an executable 4-backtick **Agent prompt**), and a completion log.

> **Canonical phase status lives in the plan's [Phase dashboard](../development_plan.md#15-phase-dashboard) (§1.5).** This folder index mirrors it for convenience — when a phase/task changes state, update the plan dashboard first, then this table.

---

## Phase files (folder index)

| Phase | File | Tasks | Status |
|---|---|---|---|
| 1 | [`phase-01-foundation-s3-client-config.md`](./phase-01-foundation-s3-client-config.md) | 17 / 17 | ✅ Done |
| 2 | [`phase-02-upload-download.md`](./phase-02-upload-download.md) | 14 / 14 | ✅ Done |
| 3 | [`phase-03-signed-urls-validation-scanner.md`](./phase-03-signed-urls-validation-scanner.md) | 12 / 12 | ✅ Done |
| 4 | [`phase-04-listing-async-e2e-mutation.md`](./phase-04-listing-async-e2e-mutation.md) | 12 / 12 | ✅ Done |
| 5 | [`phase-05-release.md`](./phase-05-release.md) | 8 / 9 | ✅ Done |
| | **Total** | **63 / 64** | ✅ Done |

---

## Status legend

| Symbol | Meaning |
|---|---|
| 📋 | ToDo |
| 🔄 | In Progress |
| 👀 | Review |
| ✅ | Done |
| ⛔ | Blocked |
| 🟡 | Partial |

Task sizes: **S** (< ~100 LoC), **M** (~100–250), **L** (~250+). Priorities: **P0** (blocking), **P1** (important), **P2** (nice-to-have).

---

## Execution guidance for AI agents

> **Read this before executing any task.**

### Token economy
1. **Do not load a whole phase file** — jump to your task's anchor (e.g. `#task-2-5`); use `Read` with `offset`/`limit`.
2. **Do not load the plan or spec entirely** — each task lists "REQUIRED READING" with exact sections; read only those.
3. **Do not load sibling libs entirely** (`nest-auth`/`nest-logger`/`nest-cache`) — copy only the specific file a task references.

### Phase execution mode (`/bymax-workflow:task phase <N>`)
- Resolve the phase's tasks in dependency order (the `Depends on` column), execute sequentially, and after each task confirm `Status: ✅` was applied. The phase closes when all its tasks are done and the §1.7 Done criteria hold.

### Self-update protocol (mandatory at the end of each task)
Update **these places**, then the cross-doc rows:
1. The task block's **Status** + tick its acceptance criteria.
2. The phase file's **Task index** row + the header **Progress** counter (`X / Y`).
3. The phase file's **Completion log** (append `- <id> ✅ <YYYY-MM-DD> — <summary>`).
4. The phase row in the **[plan dashboard](../development_plan.md#15-phase-dashboard)** (canonical) and this README's folder index, then recompute the plan's **Overall progress** (§1.4).
5. Commit with Conventional Commits: `<type>(storage): <subject> (<phase>.<task>)` — **no `Co-Authored-By` trailer**.

### Blocked / review
- Blocked → `Status: ⛔`, add `> **Blocker:** …` under the task header, no destructive commit.
- Acceptance fails after 2 red-green cycles → `Status: 👀` + an inline note.

---

## Project-wide constraints (apply to every task)

- **Zero `dependencies`** — `package.json` ships `"dependencies": {}`. `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`, `@nestjs/*`, `reflect-metadata` are **peer** deps.
- **Provider-compat checksums (the #1 trap)** — non-AWS S3 providers (R2, B2, MinIO, DO Spaces) reject the SDK's default CRC32 integrity headers; the options expose `requestChecksumCalculation`/`responseChecksumValidation` and every non-AWS provider recipe sets them to `'WHEN_REQUIRED'`. Never reintroduce a `signatureVersion` option (v3 is SigV4-only); use `maxAttempts`, not `maxRetries`.
- **Security** — mandatory path-traversal guard in `KeyResolverService`; signed-URL TTL clamped to ≤ 7 days (SigV4 max) and **never logged**; ACL-based `publicRead` documented as failing on modern AWS S3 (ACLs disabled) and as a no-op on R2.
- **Code-Craft Standard** — TS strict (no `any`); **100% line/branch coverage per file**; mutation **break 95** (high 100 / low 95); functions ≤ 50 lines, files ≤ 800; `@fileoverview` + `@layer` header per file; official-docs-first (context7) before using any AWS SDK API; English-only, timeless comments (no Phase/Task references in committed code).
- **CI green from the first PR** — the four workflows (`ci`/`codeql`/`scorecard`/`release`) are created in **Phase 1** and every per-PR gate is incremental-safe (jest `passWithNoTests`, coverage on implemented files, size budgets in **brotli**). Mutation is a pre-release gate only; `release.yml` is tag-driven.
- **No placeholder files** — never create `.gitkeep`/`.keep` or pre-create empty directories; directories emerge from real files.
- **MVP scope** — v0.1 is S3-compatible only. `IIdempotencyStore` (Redis), async-iterable `listAll()`, and built-in magic-byte sniffing are deferred to v0.2.
