# 0043 — A posting refreshed from the company's own listing keeps its original and is re-judged

**Status:** Accepted (2026-09-05)

## Context

Half of what the aggregators hand us is a teaser: Jobicy's rows are 220 to
260 characters ("Hiring company: Branch. Type: full time. About us: …"),
Remotive's and Himalayas' are often cut mid-sentence, and a posting pasted
by hand is whatever the user copied. Every judgment in ApplyPack reads that
text — each search's classifier verdict, the keyword frame, the hard
requirements, the fact gate's sources — so a truncated description makes
every one of them shallow, and no later step can repair it.

The verifier ("Is this job real?", ADR 0009) already finds the company's
own page for the role when it checks the careers page; it just never wrote
the URL down. Meanwhile `jobs/posting-url.ts` already fetches one
user-requested posting page for the letter flow, with the ADR 0005 blocklist
and the private-host guard in front of it.

The posting's text is not context (ADR 0042) — it IS the evidence — so
replacing it is a different kind of change from reading a snapshot: it
moves verdicts, scores and keywords, and it has to be reversible.

## Decision

1. **The verifier records the listing.** `VerificationSchema.posting_url`
   (nullable; older rows parse without it) and `JobVerification.postingUrl`
   hold the company's own page for this role — the page one would apply
   on — when the careers-page check found it, and null when only an
   aggregator carries it.
2. **The user confirms the swap on a diff.** *Refresh the description from
   it* on the verification card fetches that page through the same
   `fetchPostingText` as the letter flow (blocklist, SSRF guard, bot-check
   honesty), shows the stored text against the page line by line with the
   sizes, and says when the page does not even mention the posting's title
   (a board's index or a login wall). Nothing is written until *Replace
   the description and re-classify*; the text the user saw is what gets
   written, carried in the form. An Ashby URL is the one exception to "one
   GET": Ashby draws its job pages in the browser, so the listing is read
   from the board API the fetcher already uses — by id for a job page, by
   the posting's title for a board root.
3. **The original is kept and the swap is dated.** `Job.descriptionOriginal`
   receives the text the job was stored with — the first refresh keeps the
   original, later ones keep that same first text — and
   `descriptionRefreshedAt` is set on every swap, restore included.
   *Restore the original* on the job page swaps back.
4. **Everything that read the old text is re-judged, each where it lives.**
   The classifier runs at once (`classifyExistingJob`, status kept: the
   user just showed they care about this posting, so a search that now
   rejects it must not dismiss it under them). The keyword frame is not
   re-run by the swap; instead `planKeywordFrame` refuses to inherit a
   frame from a comparison older than `descriptionRefreshedAt` — reason
   `posting-changed`, the card says so in place of the version delta, and
   the user's own keyword edits still carry over as they do on a rebuild.
   The memo (`match-reuse.ts`) does not reuse a row older than the swap
   either: same resume text or not, it judged another posting. The
   fingerprint follows the text so the dedupe scan keeps seeing this
   posting; the cross-listing link, annotation only, stays.

## Alternatives considered

- **Refresh silently when the verifier finds a longer page.** Rejected: the
  page might be the wrong role, the board's index, or a login wall, and
  the swap changes every verdict on the row. A diff and a button cost the
  user ten seconds and make the change theirs.
- **Overwrite and forget the original** (the ADR 0028-era "accept stale
  scores" answer). Rejected: the original is what the searches alerted on
  and what the user may have read; keeping it costs one nullable column
  and makes the swap reversible.
- **Re-run the keyword frame from the swap.** Rejected: that is a
  resume-model call the user did not ask for, against a resume they have
  not chosen. Declaring the old frame un-inheritable does the same work on
  the next comparison, when a resume is on the table.
- **Let the user type the listing URL on the card.** Not here: the letter
  page (`/letter`) already takes a URL for a new posting; the point of
  this stage is that the verifier's finding does the work. It can be added
  if the verifier's hit rate turns out low.

## Consequences

- A refreshed posting shows *Replaced with the company's own listing …; the
  original (N characters) is kept* above its description, with *Restore the
  original*; the verification card shows the listing's URL with the button.
- Stored comparisons of a refreshed posting stay in the history with their
  scores; the next comparison starts a fresh frame and the card says why.
- Measured on five Jobicy teasers (219–263 characters) on a copy of the
  live database: the listings came back at 4 170–10 772 characters (three
  Greenhouse pages, one Ashby job page, one Ashby board root matched by
  title), the quick check's keyword list grew from 2–3 terms to 11–19, and
  the re-classify took 8–23 s. Two of the five had failed with "may need
  JavaScript" before the Ashby API path existed.
- Migration `20260905210000_posting_refresh` adds the three nullable
  columns; nothing is backfilled.
