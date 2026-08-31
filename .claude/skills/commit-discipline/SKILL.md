---
name: commit-discipline
description: Git branch naming, commit frequency, and commit message rules for this repository. Read before any commit, branch creation, or PR. Use whenever staging changes, writing commit messages, or deciding when to commit.
---

# Commit Discipline

The goal: a commit history that reads like a senior engineer's worklog and tells the story of the project - small, green, one purpose each, written by a human. Frequent commits are a project requirement, not a preference.

## Message style: short, natural, verb-first

Plain messages, 2 to 5 words, starting with an action verb. No conventional-commit prefixes (feat:, fix:, chore:) - natural wording is more readable for a solo project and looks human, not generated.

Approved verbs: add, create, setup, remove, rename, move, extract, refactor, optimize, improve, fix, update, support, test.

```
add batch classifier
extract ai provider
fix remoteok meta row
add himalayas fetcher
test hn parser entities
refactor settings toggles
update fit score badge
support claude code provider
```

An optional `phase-x.y:` prefix is fine when the work belongs to a numbered
phase from SPEC.md (`phase-8.1: add ai provider`).

The One Question Rule before every commit: "What changed after this commit?" If the answer fits naturally in 3 to 5 words, the size is right. If you need a paragraph, split the commit.

Body text only when the "why" is truly not obvious - one short line, plain English.

Authorship: single author (Nazar's git identity). Never add Co-Authored-By trailers, "Generated with" lines, or any AI attribution - includeCoAuthoredBy is disabled in settings and must stay disabled.

## When to commit

- After every coherent behavior with passing checks - roughly every 20 to 60 minutes of active work.
- Immediately after a test goes green.
- Before switching tasks and before any risky refactor.
- Target throughput: 5 to 10+ meaningful commits per working day. One giant end-of-day commit means the process failed.

## Never commit

Broken builds; failing tests; mixed unrelated changes; debug output or console.log; commented-out code; generated artifacts (dist/, __pycache__); formatting churn unrelated to the change; secrets (.env). CLAUDE.md, docs/ and .claude/ (skills, hooks, settings.json) ARE tracked here — only settings.local.json is not.

## Branch naming: name the outcome, not the phase

A branch is named after what it will merge into main: 2 to 4 words, kebab-case, no prefixes, no ticket numbers, no phase numbers. Anyone reading the branch list should understand the work in progress without opening a single diff.

```
ai-provider               batch-classifier
dashboard-tokens          jobs-table-redesign
job-verifier              fix-remoteok-meta
```

Existing `phase-x.y-<outcome>` names are acceptable while phases are tracked
in SPEC.md; the outcome part is mandatory. Bad: phase-8, wip, nazar-dev.

Branches are short-lived: merged within a day or two, deleted after merge. Never rewrite shared history, never force-push shared branches. When a feature branch passes its verification, push it and open a PR right away (standing policy 2026-08-31, one per feature); merging to main stays with Nazar.

## Split large refactors

Not "refactor classifier" but a sequence: extract ai provider, move prompt builders, remove duplicated retry loop. Small commits make history reviewable.

## Pre-commit gate

```
[ ] One clear purpose, message answers "what changed" in 2-5 words
[ ] Diff re-read: every line is needed (no dead code, unused imports/exports/props/CSS, no speculative abstractions)
[ ] Comments minimal: only non-obvious "why", one sentence max, no fluff
[ ] Code reads simply; any optimization has a measured reason
[ ] `npm run lint:types && npm test` pass
[ ] Pure logic has a *.test.ts next to it (see CLAUDE.md Testing)
[ ] Schema change ships a hand-written migration (CLAUDE.md gotcha 7)
[ ] Dashboard change checked in light + dark, keyboard reachable
```

The diff re-read is not optional. If a line does not earn its place, delete it before committing, not "later".
