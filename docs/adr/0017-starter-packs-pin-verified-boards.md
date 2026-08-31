# 0017 — Starter-pack catalog entries pin a hand-verified board; a probe hit is never proof of identity

**Status:** Accepted (2026-08-31)

## Context

A fresh install starts with an almost empty `/companies` list, and adding
boards one at a time is the biggest onboarding cost (F14). We already own
both halves of the machinery: `extractAtsToken` recognises a board URL for
all ten per-company vendors, and `probeAts` answers "does this board exist
and how many jobs does it hold" for the same ten
(GREENHOUSE, LEVER, ASHBY, WORKABLE, SMARTRECRUITERS, RECRUITEE, BREEZY,
BAMBOOHR, PINPOINT, RIPPLING — re-verified 2026-08-31, no gaps).

The obvious design — ship a list of company *names* and let the resolver
guess the slug by trying each vendor in a fixed order — was tested against
the live vendor APIs before any code was written. It does not survive
contact with reality. A 200 with a non-empty payload proves a board
exists, **not that it belongs to the company we named**:

- `GREENHOUSE:aha` is "Animal Health Associates", a veterinary practice —
  not Aha! the roadmap tool.
- `GREENHOUSE:wise` is "Wise Worksite Field Sales", hiring supplemental
  sales agents in Anchorage — not Wise the fintech.
- `GREENHOUSE:prisma` sells finance onboarding, not the ORM.
- `ASHBY:ajax`, `ASHBY:genesis` and `ASHBY:headway` are unrelated US
  startups that happen to hold the slug an obvious guess would pick.

Two vendor behaviours make a count-only check worse still:

- **Pinpoint serves a shared demo board to registered-but-unconfigured
  tenants.** `bolt`, `clerk`, `jooble`, `aiven`, `ciklum` and `kraken` all
  return the same three postings ("Head of DEI – UK", "Marketing Manager",
  "Customer Service Rep"). An unregistered slug 404s, so the demo board
  reads as a healthy hit.
- **SmartRecruiters answers HTTP 200 `{"totalFound":0,"content":[]}` for a
  company that does not exist.** `probeAts` therefore reports
  `ok: true, jobsCount: 0` for any string.

Boards can also be real but worthless to seed: test boards
(`SMARTRECRUITERS:bigcommerce` → "Rene's Test Job"), sample boards
(`RECRUITEE:podia` → "Senior Marketer (Sample)"), decommissioned boards
(`SMARTRECRUITERS:allegro` → "SmartRecruiters will be decommissioned"), and
evergreen-only boards whose entire content is "General Application"
(`RIPPLING:xwp`, `ASHBY:doppler`, `BAMBOOHR:lullabot`).

## Decision

The catalog in `src/starter-packs/catalog.json` **pins a specific
`atsType` + `atsToken` for every entry**, hand-verified against the live
vendor API at authoring time by reading the board's identifying fields
(Greenhouse exposes an authoritative board `name`; elsewhere the first job
titles). Names that resolve to somebody else's board, to a demo/test/dead
board, or to an evergreen-only board are not shipped — the honest outcome
of curation is a shorter list, not a padded one.

`buildResolvePlan` (pure, `src/starter-packs/resolve.ts`) turns an entry
into an ordered list of attempts: the pinned board first, then the ten
vendors in the fixed order greenhouse → ashby → lever → workable →
smartrecruiters → recruitee → breezy → bamboohr → pinpoint → rippling
against a slug derived from the name. The fallback exists so an entry
whose board moved can still be found, and so the same function serves
un-pinned names later; it is a safety net, never the source of truth for
what we ship.

**An attempt counts as resolved only at `jobsCount >= 1`.** That is what
makes the resolver immune to the SmartRecruiters 200-on-nonsense payload,
and it is why the rule is stated here rather than left implicit in the
call site.

Companies are inserted **inactive**: a pack of thirty boards going live
inside the next cron tick would swamp the classifier and the digest. An
"Enable all added" button follows the import. Import is idempotent — the
existing `@@unique([atsType, atsToken])` is the dedupe key, an entry
already present is reported as such and skipped, and **an unresolved name
is always listed for manual follow-up, never silently dropped**.

The module is web-only, like `src/resume/` (ADR 0008): the worker never
imports it. No schema change, no new dependency; `tsc` copies the imported
JSON into `dist/`, so the Docker image needs no extra `COPY`.

## Consequences

- The catalog is a maintenance surface: boards move and companies get
  acquired, so entries rot. Re-verification belongs in the re-analysis
  step of whatever feature next touches this file; F4 (source health)
  covers rot in boards already imported.
- Two pre-existing holes are documented but **not** fixed here, because
  they live on `/companies` add and `/discovery`, not in this feature:
  `probeAts` accepts any SmartRecruiters token (`ok: true, jobsCount: 0`),
  and it cannot tell a Pinpoint demo tenant from a real board. Both are
  named as follow-ups on the F14 PR.
- Workable rate-limits bulk probing (HTTP 429 after a handful of calls).
  Because each catalog entry resolves through its pinned board, an import
  makes one request per company, and only four entries are Workable-pinned.
  A 429 surfaces the name as unresolved rather than failing the import.
- `WORKABLE:humanmade` and `WORKABLE:awesomemotive` are shipped on a
  job-count check only — Workable 429'd every retry of the title read.
  Both slugs are unambiguous, and a wrong guess is visible in the preview
  before anything is inserted.
