# 0026 — Database tables are snake_case, mapped with `@@map()`

**Status:** Accepted (2026-09-01)

## Context

Prisma's default names tables after models (PascalCase), so every psql
session quotes them (`SELECT … FROM "Job"`), and the DB reads unlike
conventional Postgres. PR #59 shipped the rename via `@@map()` on all 13
models plus one rename migration. The rename reaches every deployment on
next boot — `init.ts` runs `prisma migrate deploy`, and a failed statement
means the container does not start — so every named object must be covered
exactly. Two raw-SQL sites (`ai-runtime.ts:recordUsage`,
`cleanup-job.ts`) still referenced `"AppSettings"` by name: the first
fails silently (try/catch, debug log), the second crashes the nightly
cleanup. #59 also left the 12 autoincrement sequences PascalCase.

## Decision

- Every model carries `@@map("snake_case")`; new models must add one.
- Columns stay camelCase (no `@map`) — only table-level identifiers move.
- Table/constraint/index renames are **strict** (fail loud → transaction
  rolls back). Sequence renames ride a separate follow-up migration with
  `IF EXISTS` — a merged migration file is never edited (checksum), and
  sequence names are cosmetic: Prisma neither tracks nor drifts on them.
- Enum types (`"AtsType"`, `"JobStatus"`, …) stay PascalCase: no raw SQL
  names them, and renaming them would double the surface for zero gain.
- Raw SQL writes table names unquoted (`app_settings`), columns quoted
  (`"aiUsage"`).

## Consequences

✅ quote-free psql; conventional naming for every future table
❌ one all-tables rename migration on every existing deployment (backup
   first); enum types stay as-is

## When to revisit

If a raw-SQL site ever needs an enum type name, rename the enums then, in
their own migration with the same strict/tolerant split.
