---
name: adr-writer
description: Use when a decision changes architecture, interfaces, the Prisma schema, dependencies, sources policy, or supersedes a prior decision. Contains the ADR template used in docs/adr/ and the register of standing decisions.
---

# ADR Writer

Architecture Decision Records live in `docs/adr/NNNN-slug.md` and are
indexed in `docs/adr/README.md` — add the index line in the same commit.

## When an ADR is required

- New process boundary, HTTP framework, queue, or scheduler choice
- New job source family or a change to the "never scrape" policy (ADR 0005)
- A new seam that swaps implementations (like the AI provider, ADR 0007)
- New dependency with operational weight (a CLI in the image, a DB)
- Superseding any prior ADR

Not required: a new fetcher that follows an existing template, a settings
toggle, UI changes, refactors that keep contracts.

## Template (as short as the decision allows)

```markdown
# NNNN — <decision, stated as a sentence>

**Status:** Accepted (YYYY-MM-DD) | Superseded by NNNN

## Context
What forces the decision; the facts that shaped it (numbers, measured
behaviour, external constraints).

## Decision
What we do, stated so a reviewer can check the code against it. A small
table or interface signature is welcome.

## Consequences
✅ what becomes easier   ❌ what we accept

## When to revisit
The concrete trigger that would reopen this.
```

## Supersede mechanics

The new ADR says `Supersedes NNNN` (or `Amends` / `Extends NNNN`) in its
status line; the old one's status line links back (`Superseded by MMMM`,
`amended by MMMM (what changed)`), and the register line in
`docs/adr/README.md` carries the same note. Both link.

Never rewrite the substance of an accepted ADR. A new decision gets a new
ADR. A fact that changed without a new decision (a renamed symbol, a count
that grew, a behaviour a later release reversed) gets a dated addendum at
the end: `## Addendum (YYYY-MM-DD): <what changed>`, one short line per
statement, naming the version, file or ADR that changed it.

## Standing register

Generated from `docs/adr/README.md` on 2026-09-24; the README is the source
of truth when the two disagree.

- 0001 Hono not Express
- 0002 Worker and web as separate processes
- 0003 No queue, just node-cron
- 0004 One active profile, not multi-tenant — *superseded by 0028*
- 0005 No LinkedIn / Indeed / Workday — *amended by 0034, 0036*
- 0006 Discovery via HN parser, not ATS-vendor lists
- 0007 One AI provider seam: Messages API or Claude Code CLI — *extended by 0013, 0014, 0027*
- 0008 Resume module lives in the web process, files in Postgres
- 0009 Web tools through the AI seam, for job verification only
- 0010 Two scores: live keyword coverage in the browser, AI match on demand — *amended by 0012, 0038*
- 0011 PDF resume text comes from unpdf, not a hand-rolled parser
- 0012 The resume-match score is computed by application code, not by the model — *amended by 0044, 0045*
- 0013 AI engine is chosen at runtime from AppSettings, with a Gemini CLI backend — *amended by 0014; extended by 0027*
- 0014 AI engines form a priority chain with automatic failover — *extended by 0027*
- 0015 The profile is drafted from the resume scan, never written by AI
- 0016 Job liveness via a free three-rung ladder before AI verify
- 0017 Starter-pack entries pin a hand-verified board — *extended by 0040*
- 0018 Cross-listing is annotated, never merged
- 0019 Source health is a per-company streak; `empty` resets it but does not prove health — *amended by 0035*
- 0020 The fact gate blocks fabrication, not imprecision
- 0021 Cover letters generate from stored inputs only — *extended by 0042*
- 0022 Fences make untrusted text data, and an attempt evidence
- 0023 Trust is apply-link flags, not a score
- 0024 Funnel history is an append-only stage ledger — *amended by 0025*
- 0025 Work columns are user-defined; fixed entry and exits
- 0026 Database tables are snake_case, mapped with `@@map()`
- 0027 Per-engine AI keys live in the database, `.env` as fallback
- 0028 Several searches run in parallel, scored by one call per posting *(supersedes 0004)*
- 0029 A comparison is a quick check by default; suggestions are a second call — *amended by 0042, 0043, 0044*
- 0030 The strength review grades; the code scores
- 0031 A job's location is three columns next to the string, filled by hints and a parser
- 0032 A search hunts in countries and groups; the classifier's place may only narrow the parser's
- 0033 A search says where its candidate lives; the model decides whether a posting is open to them
- 0034 A vendor's own licence governs keyed access, and the vendor's terms are code
- 0035 Many installs, one set of boards: spread the tick, shuffle the walk, revalidate
- 0036 Watched companies are checked by reading what a site publishes for machines, never by rendering it
- 0037 Suggestions carry replacement text; the fact gate decides what is applicable — *amended by 0044*
- 0038 Save patches the user's .docx in place; text-only versions are the fallback *(supersedes the text-only consequence of 0010)* — *extended by 0039*
- 0039 A resume that cannot be patched is re-typeset from JSON Resume, in the user's own typography *(extends 0038)*
- 0040 The default source set is the aggregators; employer boards are starter packs *(extends 0017)*
- 0041 Alerts go through a channel seam; Telegram and Discord are its first two channels
- 0042 The verifier's company facts are context for the match, never evidence *(extends 0021 and 0037)*
- 0043 A posting refreshed from the company's own listing keeps its original and is re-judged
- 0044 The posting is read once, on its own, and the reading is kept — *amended by 0045*
- 0045 The resume text decides whether a keyword is present
- 0046 The resume's domains are read at scan time and compared with the posting's
- 0047 A screening scores evidence, not keywords, and a person decides — *extended by 0050, which supersedes its score formula*
- 0048 Applicants' resumes are redacted before any model reads them, and they expire
- 0049 Employer mode is a switchable mode, not a second product and not a card
- 0050 The rubric is a list of criteria the person chooses, answered one by one with a quote
- 0051 A shortlist is compared head to head, twice, and the comparison is never a score
- 0052 Calibration reports agreement with the person's decisions and never tunes the rubric by itself
- 0053 Uniqueness lives in the database, and a row's state is written with the row
- 0054 `npm start` runs ApplyPack with a built-in Postgres; Docker is the server option

Check a proposal against these before touching process layout, sources,
scheduling, profiles, how the AI is called, the resume score or employer
mode.
