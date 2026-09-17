# Contributing

Thanks for helping. ApplyPack is a small, sharp codebase: TypeScript
strict, pure functions where possible, every non-obvious decision written
down in an ADR. You can be productive here in one evening.

## Dev setup

All you need is Node.js 22 or newer ([docs/install.md](./docs/install.md));
the database comes with the repo.

```bash
npm install
npm run db        # the built-in Postgres 16, until Ctrl+C
npm run dev       # the cron worker (migrates and seeds on start)
npm run dev:web   # the dashboard → http://localhost:4747
```

`npm start` runs all three without watchers, the way a user runs it. A
Postgres of your own works too: set `DATABASE_URL` in `.env`.

An AI engine key is only needed for classifier/resume work; fetchers,
filters and the dashboard run without one.

```bash
npm run lint:types && npm test   # must be green before every PR; CI runs the same
```

## Where to start

- **Add a job source.** The highest-value contribution and close to a
  one-file change. Copy the closest template from
  [CLAUDE.md](./CLAUDE.md) → "ATS templates", wire it into
  `src/fetchers/index.ts:fetchOne`, add the `AtsType` enum value with a
  hand-written migration, and unit-test the pure mapper. Unsure the
  source qualifies? Open a [source proposal](https://github.com/applypack/applypack/issues/new?template=new_source.yml)
  first.
- **Grab a [good first issue](https://github.com/applypack/applypack/labels/good%20first%20issue).**
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
- Schema changes ship a hand-written migration (CLAUDE.md gotcha 7).
- Changes to architecture, schema or policy get an ADR in
  [docs/adr/](./docs/adr/).
- Dashboard changes: check light and dark themes, keep it keyboard
  reachable, no build step in `src/web/public/` — except the Tailwind
  build: a new utility class needs `npm run css` and the regenerated
  `tailwind.css` committed with it.
- Be decent to each other — [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
  applies in issues, PRs and discussions.
- By contributing you agree your work is licensed under the
  [MIT license](./LICENSE), the same as the project.

## PR checklist

- [ ] `npm run lint:types && npm test` green
- [ ] One purpose per PR; small diffs get reviewed fast
- [ ] Tests next to new pure logic; smoke-run note for I/O paths
- [ ] Hand-written migration for any schema change
- [ ] ADR if architecture, schema or policy changed
