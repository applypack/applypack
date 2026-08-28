# Contributing

Issues and pull requests are welcome.

- Read [CLAUDE.md](./CLAUDE.md) first — it holds the conventions, the
  "where to look" table and the gotchas.
- Branch off `main`. Keep commits small and messages short (subject ≤ 72
  chars).
- Run `npm run lint:types && npm test` before opening a PR. CI runs the same.
- New sources follow the templates in CLAUDE.md → "ATS templates". Official
  public APIs and RSS only — see [ADR 0005](./docs/adr/0005-no-linkedin-indeed-workday.md).
- Decisions that change architecture, schema or policy get an ADR in
  [docs/adr/](./docs/adr/).
