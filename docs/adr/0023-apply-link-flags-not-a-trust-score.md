# 0023 — Trust is a handful of apply-link flags, not a score, because our corpus has nothing to score

**Status:** Accepted (2026-08-31)

## Context

F13 (feature-expansion-plan.md §14) proposed a `scoreTrust(job)` starting at
100 and subtracting: −40/−50 for a missing or invalid apply URL, −25 for a
shortener, −15 for a company↔apply-domain mismatch with an ATS allowlist and
a non-Latin-name exemption; the result stored as `trustScore`/`trustFlags`
and shown as a badge.

Every one of those penalties was measured against our 814 stored jobs before
any code was written, and three of the four are wrong for our data.

**The http penalty would mark 22.7% of the corpus, always wrongly.** All 185
non-https rows are one host, `block.xyz`, and Greenhouse's own board API is
what serves it: `"absolute_url":"http://block.xyz/careers/jobs/…"`. The host
answers `301 → https://block.xyz/…` and then `200`. The scheme is a stale
string in Block's Greenhouse configuration, not a property of the posting.

**The missing-URL penalty would only ever hit the operator.** All 13 rows
with an empty URL are `AtsType.MANUAL` — jobs pasted through `/jobs/new`,
which stores an empty URL by design. Zero *fetched* rows lack a URL.

**The mismatch rule has no calibration point at all.** Implemented three ways:

| Variant | Hits | What they are |
| --- | --- | --- |
| ATS allowlist + aggregator exemption | **0** | nothing to flag |
| ATS allowlist only (the plan as written) | **26** | 100% `HN_HIRING` |
| Strict company-name-in-domain | **302 (37%)** | 185 block.xyz + every aggregator on its own feed |

The 26 are false by construction: an HN posting's `Company` row is the
synthetic aggregator `HN Who is Hiring`, so its apply host is *always* some
other domain. That is the same trap ADR 0018 documented for same-company
SimHash matches. The 22 with non-HN hosts are Brandfetch, Nango, PermitFlow,
Gem, Kula, Featurebase — all real employers.

**The non-Latin exemption protects zero rows.** The only two non-ASCII
company names are `WeWorkRemotely · Back-End` and `· Full-Stack`, and the
character is a middle dot in our own synthetic row names. There is no
Cyrillic, CJK, Greek or Arabic in the `Company` table.

**The shortener rule cannot be calibrated: n = 1.** The single hit is
`forms.gle` on job 1030 — Sitewire, posted on HN by its head of engineering
with a salary band and equity. A Google Form is not a destination-hiding
redirector; it announces what it is.

Underneath all of it, the premise itself does not hold. Across all 814
descriptions, every classic scam marker returns **zero**: Telegram/WhatsApp
apply instructions, `t.me`/`wa.me` handles, application fees, crypto
payment, "no experience needed", free-email contact addresses. Positive
controls pass (`engineer` 547, `bitcoin` 186 — Block is a bitcoin company),
so the zeros are real. ADR 0005 is why: we do not fetch from the venues
where scam postings live, and the curated two-tier coverage model is itself
the filter.

What did measure real is narrower and different in kind — **links you cannot
apply through**: job 945's apply URL is a YouTube video, job 956's is a
LinkedIn company page. Two rows, both genuine, both from HN comments.

## Decision

No score, no schema. `src/apply-link.ts` is pure and exports
`checkApplyLink({ url, pasted }): string[]` plus `withApplyLinkFlags`, and
the tags join the model's own in `Job.redFlags` — the array that already
renders as a danger `TagRow` on `/jobs/:id` and already travels in the
Telegram alert. F12's `prompt-injection-attempt` set the precedent; these
are the first flags produced by *code* rather than by the model, so they
describe the posting's metadata where the model's describe its content.

| Tag | Fires when | Corpus |
| --- | --- | --- |
| `apply-url-missing` | empty URL on a **fetched** row | 0 |
| `apply-url-unusable` | unparseable, or a non-http(s) scheme | 0 |
| `apply-url-shortened` | destination-hiding redirector (`bit.ly`, `t.co`, …) | 0 |
| `apply-url-not-an-application` | host that cannot serve an application (`youtube.com`, `linkedin.com`, `t.me`, …) | 2 |

Three penalties are **dropped outright**: the http scheme, the company↔domain
mismatch, and with it the non-Latin exemption — which becomes structural
rather than conditional, because the company name is not an input to this
module at all. `forms.gle` is deliberately absent from the shortener list.

Every remaining rule is **true by definition rather than tuned to a
threshold**. That is what makes a flag firing zero times acceptable here and
not evidence of a mis-set constant: there is no constant. A `bit.ly` link
genuinely hides where it goes and a video page genuinely cannot take a
submission, whether or not either has appeared yet. Host matching is on a
domain boundary, never a substring, so `mylinkedin.com` is not LinkedIn.

Flags only, never a filter: nothing here rejects, hides, reorders or
rewrites a row, in keeping with ADR 0018's "annotate, never merge" and
ADR 0012's "the model judges evidence, code owns the verdict".

The merge happens at all three paths that persist `redFlags` — ingest,
re-classify, classify-one — through one shared helper; a merge in only some
of them would drop the tags at the next re-classification.

## Consequences

✅ No migration, no columns, no badge to design: the tags surface everywhere
red flags already surface. Cost stays proportional to a signal that fires on
0.2% of the corpus. The dropped penalties are pinned by regression fixtures,
so nobody re-adds the http rule without a failing test.
❌ A trust *level* cannot be sorted or filtered on, and a job whose only
problem is its apply link looks like a job with a stack mismatch — both are
red flags. Accepted: inventing a rank for two rows would be false precision.
❌ Three of the four rules are unexercised by real data. They are preventive,
in the same sense as ADR 0018's URL-key discipline, and are honestly labelled
as such rather than presented as measured.

## When to revisit

When the corpus stops being curated: F14 starter packs widen it, and HN
Who-is-hiring plus manual pastes are already the two uncurated intake
channels — the two real hits came from HN. Re-measure the flag rates once
packs have landed, and if scam markers appear at all, that is the moment to
reconsider a score with something to score. Reconsider the company↔domain
mismatch only with a per-posting employer name (HN descriptions carry one in
a `Company:` line), never against the aggregator's `Company` row.
