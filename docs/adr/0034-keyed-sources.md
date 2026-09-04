# 0034 — Keyed sources: a vendor's own licence governs keyed access, the keys live beside the AI keys, and the vendor's terms are code

**Status:** Accepted (2026-09-04)

## Context

Two of the sources the country-aware search plan wanted (§3e) are reached
only with a credential the vendor issues: Adzuna (ten European markets,
plus nine more) and France Travail (every job ad in France). Both are free
for our use. Both were parked on one question: their API hosts answer
`robots.txt` with `Disallow: /`, and ADR 0005's addendum, read literally,
rejects a host whose robots says that — while the same vendors publish
terms that invite exactly the programmatic use we would make.

The plan's other open point was where a source key would live. Until now
the only pasted secrets were engine keys (ADR 0027) and Telegram tokens.

## Decision

**1. robots.txt governs crawling; a vendor's published licence governs
keyed access.** A crawler discovers URLs and follows them — robots is
written for it. A keyed API is reached at one documented endpoint with a
credential the vendor issued to us under terms we accepted; the vendor's
own terms are the more specific instrument and the one we are actually
bound by. So a keyed source is admitted when, and only when, the vendor's
published terms permit our use — and every obligation those terms impose
is implemented in code, not remembered. ADR 0005 gains this sentence as
addendum rule 3. Reed stays out under either reading: its robots names
`AnthropicBot` explicitly, which is not a crawling rule but an answer.

**2. Source keys are stored like engine keys.** `AppSettings.sourceKeys`
holds `{SOURCE: {field: secret}}`, read only through `getSourceKeys`,
written per field with one `jsonb_set` (the same race-free merge as
`setAiKey`), pasted on `/settings` → Sources → "Source keys", masked to
the last four characters, with the `.env` variables as the fallback. A
key never appears in a log line, a flash message or a rendered page —
and because Adzuna's credentials are query parameters, every error a
keyed fetcher raises passes through `redactSecrets` before it can reach
source health or a log.

**3. The vendors' terms, as code.**

*Adzuna* (developer.adzuna.com/docs/terms_of_service, read 2026-09-04):
- Permitted use: publishing Adzuna listings, personal research. ApplyPack
  is a personal, self-hosted tool; an organisation deploying it falls under
  the vendor's 14-day trial and must arrange its own licence — the
  Companies page says so next to the source.
- Every displayed advert carries the label "Jobs by Adzuna", at least
  116 × 23 px, "Jobs" linked to the local Adzuna domain and "Adzuna" as the
  vendor's logo image, also linked. The job list, the job page and the
  Telegram alert render it (Telegram as text with the link — it cannot
  carry the image).
- Limits: 25 a minute, 250 a day, 1 000 a week, 2 500 a month. The
  monthly figure binds: an hourly tick would spend 720 calls a month on a
  single country. Adzuna rows are therefore polled four times a day (the
  ticks at 00, 06, 12 and 18 UTC, `max_days_old=1` so nothing is missed)
  and at most ten are accepted — 1 200 a month at the ceiling, leaving
  room for probes and a manual "Fetch now".
- Descriptions are snippets. The stored description says so in its last
  line, so the classifier and the resume match know the text is partial.
- On termination, data acquired from Adzuna must be removed: deleting the
  Adzuna rows on Companies cascades to their jobs.

*France Travail* — the Offres d'emploi API is under its own "Licence de
réutilisation de la base de données des offres d'emploi", not Etalab
(CGU §5.2 b; licence read in full 2026-09-04). Its obligations and how
each is met:
- Art. 4, mentions: every job page shows "Source: France Travail", the
  offer's last update date, and a link to the licence.
- Art. 5.2, freshness: the API must be polled at least every 24 hours and
  content created, deleted or modified there must be created, deleted or
  modified here. Each tick reads the row's whole current result set; a
  stored offer no longer in it is deleted, or — when the user has applied
  or saved it — kept as the user's own record with the offer's content
  anonymised as Art. 7 lists (employer, contact, description, offer URL,
  commune). Pausing fetching for longer than a day breaks this obligation;
  the Sources tab says so next to the source.
- Art. 5.3, integrity: the whole content the API provided for an offer is
  displayed. The offer is stored as received and the job page renders
  every field in a "Full offer as published" block; nothing is rewritten.
- Art. 3, exclusive access: the content must not be made available to
  third parties. A self-hosted, loopback-bound instance serves its owner;
  the same "personal use" note as DOU's applies.
- Art. 8, personal data: contact names and phones in an offer are used for
  applying and nothing else; they leave with the offer under Art. 7.
- Quota: 4 calls a second per application, 429 with `Retry-After` beyond
  it; a row makes one call per 150 offers per tick, sequentially.
- Art. 10: credentials lapse after twelve months without a call.

## Consequences

- `src/source-keys.ts` (pure) is the second key module beside `ai-keys.ts`;
  a third keyed source adds one entry to `SOURCE_KEY_FIELDS`.
- A keyed source with no key is a health status (`auth`) with a sentence
  pointing at the Sources tab, not a crash and not a silent empty.
- The attribution components are the terms' wording rendered; changing
  them is changing what we agreed to.
- Live verification of either source needs the owner's own credentials;
  the mappers are tested on the vendors' documented payloads, and the
  pull request that adds each source says what was and was not run live.
