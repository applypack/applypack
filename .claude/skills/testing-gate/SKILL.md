---
name: testing-gate
description: Required verification per change type for ApplyPack (pure module → unit test, fetcher → smoke run, schema → hand-written migration, dashboard → rebuild + screenshot). Read before implementing any feature and before every commit.
---

# Testing Gate

Verification ships in the same commit as the behaviour. The repo has two
kinds of code and they are verified differently — see CLAUDE.md "Testing".

## Required verification by change type

| Change | Required |
|---|---|
| Pure logic (filter, text-utils, parsers, mappers, format helpers) | `*.test.ts` next to the source, `node:test` + `assert/strict` |
| New fetcher / ATS source | Pure `mapXFeed` mapper + unit test; then `npm run fetch:once` smoke against the real endpoint (or `docker compose exec app node dist/scripts/fetch-once.js`) |
| Classifier prompt or parser | Parser test (`parsePrefilterResponse`, `parseClaudeCodeOutput` pattern); smoke one real classification via the once-script |
| AI provider | `ai-provider-parse.test.ts` for output parsing; one live `complete()` smoke per provider before commit |
| Prisma schema | Hand-written migration under `prisma/migrations/` (CLAUDE.md gotcha 7 — host `migrate dev` P1010s); `npx prisma format` after the edit — CI runs `prisma format --check` and a new field that widens a column realigns the whole block; verify with `docker compose build app && up -d app` and read init logs |
| Settings toggle | Column → `settings.ts` getter/setter → page → route, all in one commit; click it in the dashboard |
| Dashboard page / primitive | `npm run lint:types`; `docker compose build web && up -d web`; curl every route for 200; screenshot at 1200px, 768px and 375px with the playwright plugin; browser console has 0 errors |
| Telegram formatting | `notifier.test.ts` for escaping; `npm run test:telegram` for a real send |

## Commands

```
npm run lint:types                 # every commit
npm test                           # every commit (pure modules only)
npx prisma format --check          # after any schema edit (CI gates on it)
npm run build                      # before a web/app container rebuild
docker compose build web && docker compose up -d web   # dashboard changes
docker compose build app && docker compose up -d app   # worker changes
docker compose logs -f app         # watch a tick
```

There is no e2e suite and no axe run — modules that touch Prisma or the
Anthropic SDK are verified by smoke runs and by using the dashboard.

## Honesty rule

Never weaken or skip a failing test to go green. A failing test is
information: fix the code or fix the wrong expectation, and say which in
the commit body. Report a skipped smoke run as skipped.
