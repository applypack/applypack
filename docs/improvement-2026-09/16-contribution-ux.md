# §16 — Contribution / issue UX

**Verdict: adopt one fix (P2): the `good first issue` promise is a dead end today. Everything else checks out.**

## What the plan proposes

Verify that users can create issues, templates work, links are valid,
good-first-issue labels are useful, CONTRIBUTING commands match, SECURITY is
current, no contributor flow dead-ends.

## What was checked (2026-09-10)

| Check | Result |
| --- | --- |
| Issues enabled, blank issues allowed | yes (`has_issues: true`, no `config.yml` restricting templates) |
| Templates | `bug_report.yml`, `feature_request.yml`, `new_source.yml`; the `new_source` deep link from CONTRIBUTING answers 200 |
| External links in README, CONTRIBUTING, SECURITY, the site, the launch drafts | 35 unique URLs, **all 200** |
| CONTRIBUTING commands | `npx prisma migrate deploy`, `npm run seed`, `npm run dev`, `npm run dev:web`, `npm run lint:types && npm test` — all exist in `package.json` |
| SECURITY.md | private vulnerability reporting link 200; scope list matches the code (fence, SSRF guard, keys, XSS) |
| CODEOWNERS, PR template | present |
| Discussions | off (fine for a solo project; nothing links to them) |
| **`good first issue` label** | **0 open issues.** The four labelled on 2026-09-04 (#90, #92, #96, #100) were fixed in the issue sweeps. Nine issues are open (#203–#208, #217–#219); **none carries any label** |

The promise is made in three places: landing `#open` (*"Take a good first
issue — scoped tasks with file pointers, labelled in the tracker"*),
README → Contributing, CONTRIBUTING → "Where to start". A visitor who follows
it lands on an empty list — exactly the plan's "documentation that leads to
unavailable actions".

## Steps → TASKS §20, block `metadata-drift` (same PR as §15, plus owner labels)

- [ ] Label 3–5 of the open issues that are scoped and one-file: #203
      (keyword table stale note), #204 (`countableFlags`), #208 (placeholder
      in a replacement) look right; #217–#219 are model-behaviour questions,
      not first issues. Owner or maintainer action — labels are not in the repo.
- [ ] The five copy issues from §11 are written `good first issue`-shaped and
      labelled at creation.
- [ ] Until the label has entries, the site/README line reads "issues
      labelled `good first issue` when there are any" — or is left as is
      once the labels exist. Prefer the labels.
