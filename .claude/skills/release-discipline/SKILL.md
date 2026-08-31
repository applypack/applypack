---
name: release-discipline
description: Tag and GitHub-release rules for this repository — when a merge gets a version tag, how releases stay in parity with tags, and the release-notes format. Read after every PR merge, before tagging, and at the start of a new stage (parity check).
---

# Release Discipline

One runtime feature = one branch = one PR = one annotated minor tag = one
GitHub release. Tags without releases are a process failure the same way
finished-but-uncommitted work is (we shipped v0.3.0 and v0.4.0 tags while
the release list still ended at v0.2.0 — this skill exists so that never
repeats).

## When a merge gets a tag

| Merge | Tag |
|---|---|
| Runtime feature (new behaviour, schema, sources, UI) | **`vX.Y.0`** — minor bump, annotated, on the merge commit |
| Follow-up fix to an already-released feature | **`vX.Y.1`** — patch bump on that feature's minor |
| Docs-only / process-only / `.claude` skills / CI config | **no tag** — rides with the next minor |
| Pure-module prerequisite invisible to the user (e.g. F7 fact gate before F8) | may skip its own tag and be tagged with the feature that surfaces it |

Tag numbers follow **actual integration order**, not the plan registry.
Annotated only (`git tag -a`), never lightweight; never move or reuse a
pushed tag — a wrong tag is followed by the next number, not rewritten.

```
git tag -a v0.5.0 -m "<feature name>" <merge-sha>
git push origin v0.5.0
```

## What the tag has to agree with

A tag is not just a git ref: `package.json` `version` and the top entry of
`CHANGELOG.md` must name the same number, in the commit being tagged. Both
drifted to `0.2.1` while tags ran to `v0.9.0` — seven releases missing from
the changelog — because nothing said they were part of tagging. They are:

- bump `package.json` `version` in the feature branch, before the PR
- add the `CHANGELOG.md` section in the same commit (Keep a Changelog
  headings, plus the compare link at the bottom of the file)
- the release notes on GitHub and the changelog entry say the same thing;
  draft once in the PR body and reuse it

## Release parity (the rule this skill enforces)

**Every pushed `vX.Y.*` tag gets a GitHub release immediately — the
latest release must always equal the latest tag.** Patch tags get a
release too when they changed deployed behaviour (our v0.2.1 did).

```
gh release create vX.Y.0 --title "vX.Y.0 — <feature name>" --notes "<notes>"
```

- Claude drafts the release notes inside the PR description (a "Release
  notes" section), so after Nazar merges + tags, creating the release is
  one command with no writing left.
- After the tag is pushed, create the release right away in the same
  session; if Nazar tags outside a session, the next session creates it
  during the parity check.

## Parity check (start of every stage)

Before starting a new feature branch, compare:

```
git fetch --tags && git tag -l | tail -3 && gh release list | head -3
```

If tags lead the releases, **backfill the missing releases first** —
notes reconstructed from the PR body / merge commit of that tag. Only
then start the new stage.

## Release-notes format

Short and scannable — this is a solo project's changelog, not marketing:

```
## What's new
- 3–6 bullets, user-visible behaviour first
## Schema
- one line per migration (or "no schema changes")
## Verification
- one line: tests count, smoke runs, screenshots
## References
- ADR links, plan section (docs/feature-expansion-plan.md §N)
```

## Division of labour

Nazar reviews, merges and tags (Claude puts the exact `git tag` command
in the PR summary). Claude keeps releases in parity: draft notes in the
PR, create the release after the tag appears, backfill on parity-check
misses.
