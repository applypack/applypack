# Contributing

Thanks for helping. applypack is a small, sharp codebase: TypeScript
strict, pure functions where possible, every non-obvious decision written
down in an ADR. You can be productive here in one evening.

## Dev setup

```bash
docker compose up -d postgres   # or any Postgres 16 you already have
cp .env.example .env            # DATABASE_URL is preset for the compose postgres
npm install
npx prisma migrate deploy
npm run seed

npm run dev       # the cron worker
npm run dev:web   # the dashboard → http://localhost:4747
```

An AI engine key in `.env` is only needed for classifier/resume work;
fetchers, filters and the dashboard run without one.

```bash
npm run lint:types && npm test   # must be green before every PR; CI runs the same
```

## Where to start

- **Add a job source.** The highest-value contribution and close to a
  one-file change. Copy the closest template from
  [CLAUDE.md](./CLAUDE.md) → "ATS templates", wire it into
  `src/fetchers/index.ts:fetchOne`, add the `AtsType` enum value with a
  hand-written migration, and unit-test the pure mapper. Unsure the
  source qualifies? Open a [source proposal](https://github.com/nazboyko/applypack/issues/new?template=new_source.yml)
  first.
- **Grab a [good first issue](https://github.com/nazboyko/applypack/labels/good%20first%20issue).**
  Scoped tasks with file pointers.
- **Report bugs.** Use the issue template; logs beat prose.

## Ground rules

- Read [CLAUDE.md](./CLAUDE.md) first: conventions, "where to look"
  tables, and the gotchas we already paid for.
- **Sourcing policy is non-negotiable**: official public APIs and RSS
  feeds only, never scraping. LinkedIn, Indeed, Glassdoor, Workday and
  Wellfound are permanently out of scope
  ([ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md)).
- Branch off `main`; short kebab-case branch names (`himalayas-fetcher`,
  `fix-remoteok-meta`).
- Commits: small, one purpose, verb-first subject ≤ 72 chars.
- Pure logic gets a `*.test.ts` next to it. Modules that touch Prisma or
  an AI SDK are verified by smoke runs instead (see CLAUDE.md → Testing);
  say in the PR which smoke run you did.
- Schema changes ship a hand-written migration (CLAUDE.md gotcha 7:
  `prisma migrate dev` can't reach the compose Postgres from the host).
- Changes to architecture, schema or policy get an ADR in
  [docs/adr/](./docs/adr/).
- Dashboard changes: check light and dark themes, keep it keyboard
  reachable, no build step in `src/web/public/`.

## PR checklist

- [ ] `npm run lint:types && npm test` green
- [ ] One purpose per PR; small diffs get reviewed fast
- [ ] Tests next to new pure logic; smoke-run note for I/O paths
- [ ] Hand-written migration for any schema change
- [ ] ADR if architecture, schema or policy changed
