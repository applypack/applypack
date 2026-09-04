# 0033 — A search says where its candidate lives; the model decides whether a posting is open to them

**Status:** Accepted (2026-09-04)

## Context

ADR 0032 gave a search the job's vocabulary: `countries`, `regions`,
`workplace`. That answers "where do I want to work". It cannot answer the
question a Ukrainian, Polish or Indian candidate actually asks — "can I take
this job from where I am". The two are different: a search that lists `PL`
and `DE` is a wish; a candidate living in Ukraine still needs a work permit
for a Warsaw office, and "Remote · EU only" means EU work rights, not EU
geography.

Nothing in the pipeline knew that. The classifier's location rules read the
search's list against the posting's place, so "Remote · EU only" matched a
search listing EU no matter who was doing the searching, and an on-site
Berlin role matched anyone who had ticked Germany. The verdict was
technically right and practically useless.

Measured before this change, over the 1 059 stored postings: 115 mention
"sponsorship" and only 12 state a policy. Of 24 sampled hits, 7 were real
("authorized to work in the United States without … employer-sponsored work
authorization"), 3 were the ATS application-form question scraped into the
description, and 14 were benefits or an org chart ("co-sponsored Multisport
card", "under the direct sponsorship of the CTO"). A keyword rule over that
corpus would produce more noise than signal.

## Decision

**Two new fields on the search, and one rule about who decides.**

- `Profile.residence` (ISO-2, nullable) — where the candidate lives now.
  A fact, not a wish; it is never added to the places a search hunts in.
- `Profile.relocation` (`no` | `yes` | `sponsorship`) — whether they would
  move, and whether a visa has to come with the job.

**The model decides eligibility; the code explains it.** The classifier
prompt gains an ELIGIBILITY block (four lines, sent only once) and a
per-search line naming the residence and the relocation choice — emitted
only when one of them is set, so a search that does not care pays nothing.
The two new red flags, `work-permit-required` and `no-visa-sponsorship`,
are model verdicts like every other flag. `filter.ts` stays out of it: the
evidence lives in prose that a regex reads wrong three times out of four.

**Silence is not a refusal.** A posting that says nothing about permits
keeps the verdict the ADR 0032 rules gave it. The absence of a sentence is
not evidence, and a stricter default would hide most of the market.

**The code answers only what the columns prove.** `src/eligibility.ts` is
pure: the vocabulary, and `residenceCovered(job, residence)` — is this
posting's own list of places one the candidate lives in, read through the
gazetteer's groups. That is enough for the job page to say "open to
European Union; you live in Ukraine and this search does not relocate",
which is the sentence the search's own country list could never produce.
Whether relocation, sponsorship, an employer of record or a B2B contract
rescues the posting is left to the model, which read the text.

## Consequences

- `/jobs` gains an "Open to me" filter reading the same per-search
  `locationMatch` the chips already read — honest now that residence exists.
- The Telegram line shows the country flags and the arrangement from the
  ADR 0031 columns, so a phone reader sees the place before the link.
- The prompt budget guard now measures the worst case a user pays (eight
  searches that all state a residence) and allows 12 000 characters.
- Salary in EUR / PLN / GBP is still the model's silent conversion. It is
  deliberately out of scope here; the plan's §5.0 note records the
  measurements and recommends conversion constants in code when it lands.
- A search created before this stage has `residence = null` and
  `relocation = 'no'`: the eligibility rules stay dormant, and every
  existing verdict keeps its meaning until the user says where they live.
