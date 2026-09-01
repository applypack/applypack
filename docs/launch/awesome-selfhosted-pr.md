# awesome-selfhosted PR — draft, DO NOT submit before 2026-12-28

> Their CONTRIBUTING requires the first release to be older than 4
> months. ApplyPack v0.1.0 shipped 2026-08-28, so the earliest
> submission day is 2026-12-28. Their guidelines threaten bans for
> machine-generated contributions that break the rules: Nazar reviews
> this draft and submits it by hand from his own account.

ApplyPack fits the list as a job-search console that checks 22 sources
hourly and keeps every AI report in the user's own Postgres; the live
scoring demo at https://applypack.dev/demo/ goes into the entry's
`demo_url`. Format below was checked against their CONTRIBUTING.md and a
live entry (`software/gitea.yml`) on 2026-08-31.

## Where it goes

The rendered list is generated from a data repo. The PR adds ONE file to
https://github.com/awesome-selfhosted/awesome-selfhosted-data:

- File: `software/applypack.yml` (kebab-case name, their convention)
- Branch: `add-applypack`
- Commit message and PR title: `add ApplyPack`

Fields like `stargazers_count`, `updated_at`, `current_release` and
`commit_history` are CI-maintained; a submission carries only the fields
in the entry below.

## Section (tag)

`Automation` — "Automation software designed to reduce human
intervention in processes". No jobs/career/recruitment tag exists
(checked the full `tags/` inventory 2026-08-31), and
`human-resources-management-hrm` is employer-side software, which
ApplyPack is not. The Automation tag hosts personal monitor-and-act
agents, which is what the worker is. Their own fallback rule
(`Miscellaneous` when nothing fits) stays available if maintainers
disagree.

## The entry (`software/applypack.yml`)

```yaml
name: ApplyPack
website_url: https://applypack.dev
source_code_url: https://github.com/applypack/applypack
demo_url: https://applypack.dev/demo/
description: Job-search console that watches company ATS boards and job feeds, scores postings against your profile using your own AI accounts, verifies ghost jobs and tracks applications, with Telegram alerts.
licenses:
  - MIT
platforms:
  - Nodejs
  - Docker
tags:
  - Automation
```

Description is 197 chars and avoids "self-hosted" / "open-source" /
"free" per their rules. `demo_url` points at the live scoring demo, one
real module of the app; if maintainers read `demo_url` as
full-application-only, drop the field rather than argue.

## Pre-submit checklist

- [ ] Date is 2026-12-28 or later (4 months since v0.1.0)
- [ ] Re-read their CONTRIBUTING.md for rule drift since 2026-08-31
- [ ] Repo shows recent commits (their dormancy bar: 6–12 months)
- [ ] Demo and applypack.dev both load
- [ ] Submit from Nazar's GitHub account, not from an agent
