# 0056 — A company can be muted, and a company applied to can rest, before any AI reads its postings

**Status:** Accepted (2026-09-28). The feature-gap analysis rated it P0 ("a
user who was rejected, or does not want a company, sees it again every
tick"). Rules that needed a default were settled the way the 2026-09 plan
recommends: off by default, reversible, zero AI.

## Context

Nothing in ApplyPack could say "not this company". `Profile.stackExclude`
excludes title words, not employers. `Company.active` stops *reading* a
source and hides nothing already stored. `DISMISSED` is per posting.
`JobStageEvent` records one job's stages, never a company's. A user who was
rejected by Acme, or who does not want to work there, met Acme again every
hour. On the two-stage and single-stage classifier alike, every such posting
was paid for.

The harder half is knowing who hires. A vendor board (Greenhouse, Lever …),
the user's own feed and a pasted posting ARE the employer: the `Company` row
is the company. An aggregator is not. Remotive, RemoteOK, Arbeitnow, Adzuna,
HN and the rest are one synthetic `Company` row each, carrying hundreds of
employers. Their fetchers knew the employer. Each feed names it in a field of
its own (`company_name`, `company.display_name`, the Atom `author`, the
"Company: Role" title of We Work Remotely, "X (YC W23) Is Hiring" on HN).
But eleven of them only folded it into the description as a
`Hiring company: X.` line, and three (RemoteOK, Remotive, Arbeitnow) dropped
it altogether. So the list, the alerts, the classifier prompt, the
verifier's web search and the cover letter's greeting all said "Remotive"
where the employer should be.

## Decision

- **Who hires is stored.** `NormalizedJob.employer` is set by every
  aggregator's mapper from its structured field (null when the feed did not
  say). It is absent on a source that is the employer, and the absent/null
  difference is the rule `employer.ts:hiringKey` reads. `Job.employer` keeps
  the name as the feed wrote it. `Job.employerKey` is the key of whoever
  hires: that name, else the source's own when the source is the employer.
  It is written at every insert (`process-jobs.ts`, `manual-job.ts`), and
  NULL only when an aggregator did not say. A NULL key matches nothing.
- **One key for two spellings, and never a fuzzy one.**
  `employer.ts:employerKey` folds accents and case, reads `&` as "and",
  drops punctuation, a leading "the" and a closed list of trailing legal
  forms (Inc, LLC, GmbH & Co. KG, Sp. z o.o., S.A. …). So "Acme, Inc." from
  one feed and "ACME" from another are one company. "Acme Labs" stays
  another company: a mute that swallowed a different employer would hide
  postings nobody asked to hide.
- **A mute is a gate before the AI.** A `company_mute` row holds the key,
  the name as the user saw it, an optional reason and the date. A posting
  whose key is muted is turned away in the tick like a filter reject: no
  classification, no row, no alert. The funnel counts it as "from companies
  you muted". "Save & re-classify" and the wizard's scoring pass skip its
  stored rows too. Stored postings of a muted company are **hidden** on
  `/jobs` and the Overview by default, with one line saying how many and a
  link to show them. Their
  status never changes: an application stays an application. Unmuting
  undoes both. The next tick meets the postings as new and scores them, and
  the list shows the stored ones again.
- **The re-apply window is the same gate, opt-in.**
  `AppSettings.reapplyDays` (off by default; 30 / 60 / 90 / 180) turns away
  new postings at a company with a job whose `appliedAt` falls inside the
  window, read once per tick. It counts as "at companies you applied to
  recently". A watched company whose policy is "every posting" is exempt:
  the watch is the more specific instruction (ADR 0036), as it already is
  for the base filter. A mute is never exempt.
- **The rows stored before the columns get their keys once.** `init.ts`
  runs `employer-store.ts:fillEmployerKeys` when
  `AppSettings.employersFilledAt` is NULL:
  - a vendor, feed or pasted row takes its company's key, in one update per
    company;
  - an aggregator row gives back the `Hiring company: …` (or HN's
    `Company: …`) line its fetcher wrote, grouped into one update per
    employer.

  The key is computed in TypeScript, not in the migration's SQL, because a
  second copy of the normaliser would drift. A failure leaves the flag
  unset, and the next boot tries again.
- **The name reaches the places that were wrong.** Every place that names a
  posting's company now reads `employer ?? company.name`:
  - the prompts: the classifier's input, the verifier's web search, the
    cover letter's greeting, the resume comparison;
  - the messages: the live and held alerts, the digest, the stale-application
    nudge;
  - the pages: the job pickers, the applications board, the wizard, employer
    mode.

  The list and the job page write "Acme · via Remotive". No prompt grew: the
  field that said "Remotive" now says "Acme".

  *Amended 2026-10-11 (v2.55.21, #401; v2.55.27, #444).* `employer ??
  company.name` is right only where the source is the employer. For a row
  from an aggregator, an imported file or a folder that names no company it
  gave the source's own name: the classifier read `Company: Saved postings`,
  an alert said "@ Export A", the company check researched a folder's name
  on the web, and a letter was addressed to it. The prompts and the messages
  read `employer.ts:companyForPrompt` / `companyForMessage` instead, which
  say the posting names no company; a call about a stored job takes the
  posting whole from `postingForPrompt`, whose type asks for the source's
  kind. v2.55.21 did the worker's prompts, the messages, the letter and the
  company check; v2.55.27 did the calls a press on the dashboard starts
  (the brief, Compare, Rewrite, a screening). The pages still read
  `employer ?? company.name`, and what they should say for such a row is
  open in #444.

## Consequences

- **Tokens saved, never spent.** A muted posting costs nothing, not even
  the prefilter. Measured on the scratch run: two muted postings and one
  inside the window made no call, and two fresh ones made one prefilter call
  each. After an unmute, the three were scored as new.
- **Not every aggregator names the employer.** Djinni's feed carries none,
  and Golang Projects hides it in a slug nobody can split. Those rows keep a
  NULL key and pass every gate. A mute can only act on a name it can see.
- **A vendor board of a muted company is still read.** The gate drops its
  postings before any AI, but the request is still made. Switching the
  source off on `/companies` is how the request stops. Muting does not do
  it silently, because unmuting would then have to guess what to switch
  back on.
- **Matching is by name, so a rename splits a company.** "Facebook" and
  "Meta" are two keys. The Muted companies card on `/companies` lists what
  is muted, so a second name is one more row.
- **Not built:** a mute that expires, a mute suggested by a rejection,
  per-role windows (the feature-gap analysis's "same role for N days" and
  "cross-role bucket"). One window for all roles is the rule until someone
  asks for the finer one.
