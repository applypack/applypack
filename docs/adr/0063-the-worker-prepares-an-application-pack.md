# 0063 — The worker prepares an application pack for a strong new match

**Status:** Accepted (2026-10-05). Amends [0008](./0008-resume-module-in-web.md)
(the resume module is no longer called by the dashboard alone); builds on
[0037](./0037-suggestions-carry-replacement-text-gated-in-code.md) and
[0059](./0059-the-tailor-page-edits-the-resume-as-a-document.md).

## Context

Every step between "a strong match arrived" and "I applied" already existed
as a button: is the posting still open, Compare, "Is it real?", Apply all,
Download. Pressing them was the bottleneck. On the owner's install, over the
30 days before this decision: 44 postings with fit ≥ 90, 12 of them ever
compared with a resume, 2 applied to, and the company check run once.

The ask was the evening's work done overnight: is the company real and worth
it, what the resume lacks, the resume lightly tailored — every keyword it can
back, one or two bullets — and kept as a file, with the person saying what
may be touched. Read in the morning, download, apply.

Before a line of the feature was written, the pipeline was run dry over those
44 postings on a copy of the database (`npm run pack:dry`). What it measured:

- **A classifier fit is not a reason to tailor.** 42 of the 53 postings with
  fit ≥ 85 sit at exactly 92. Of the 44: 2 were closed, 17 failed a
  requirement the posting gates on (6 a location in another region, 11 a core
  stack the resume does not show), 7 could not reach 75 whatever was edited,
  1 the company check said to skip. **17 reached the end.**
- **Time.** Reading the posting 14 s, the comparison 34 s, the company check
  102 s at the median (186 s at the 90th percentile, 607 s at worst), judging
  the tailored text 23 s. A whole pack: about 170 s at the median.
- **Money**, at API prices: about $0.35 for a pack that reaches the end and
  $0.10 for one that stops at the comparison.
- **The edits are light and they land.** 3 to 7 lines of a 60-line resume;
  76 operations applied, 1 could not be placed.
- **Two things "Apply all" does that nobody should send unread.** Three of
  the 17 rewrites lost a figure the line had ("$10M+ ARR"); three of the seven
  keywords written onto a skills line were the posting's own job title.
- **The live score is a floor, not the answer.** It holds the alignment
  grades still, so it read +4 at the median where a fresh judgment of the same
  text read +20 to +30.
- **A first fetch brings old postings.** 15 of the 44 had been up for more
  than three days when they were found, 7 of them for two to four weeks.

## Decision

1. **Off until the person switches it on.** `AppSettings.pack` (JSON, NULL =
   off; `src/pack/settings.ts`): the fit a new posting needs (90), how many
   packs a day the worker starts on its own (5; 0 = no limit), how recently
   the posting must have been published (7 days), the cover letter (never ·
   when the posting's text asks · always) and the tailoring policy.
2. **Asked once, about a posting the tick has just stored.** The trigger
   (`pack/trigger.ts`) is called in `process-jobs.ts` where a new match is
   inserted, and nowhere else. So the backlog is never walked — not when the
   feature is switched on, not by "Save & re-classify" — and a fresh install
   spends nothing. Any single job can be prepared by hand on its tab.
3. **The row is the queue.** `application_pack`, one per posting: queued →
   running → ready | stopped | failed. The dashboard only inserts the row;
   the worker's runner (`jobs/pack-job.ts`) beats every minute, takes an
   advisory lock, and prepares the queued rows one at a time, oldest first. A
   beat with nothing queued and no message owed is one indexed lookup and
   writes no run row. No broker (ADR 0003).
4. **The worker calls the resume module.** A pack is the chain of calls the
   dashboard's buttons make, with nobody there to press them, and the worker
   is the process with the clock. Both run the same image; nothing else about
   ADR 0008 changes.
5. **Cheapest first, and every step may stop it** (`pack/prepare.ts`,
   `pack/gate.ts`): still open (no AI) → the comparison, a stored one of the
   same text reused → stop on a failed requirement or a ceiling under 75 →
   the company check, stop on a fake or a "skip" → the edits → the checks →
   the tailored text judged again → the file → the letter. A company check
   that fails is not a verdict: the pack goes on and says the company was not
   looked at.
6. **What may change is a policy held in code** (`pack/policy.ts`): the
   sections open to an edit, at most two experience bullets, nothing removed,
   only keywords the resume backs. Two rules came from the dry run: the
   posting's title is never written as a skill, and a rewrite that loses a
   figure waits for the person. The result is then checked without trusting
   how it was made (`pack/tailor.ts:tailorChecks`): undoing every recorded
   change must give the original back to the character, no change may take
   out words its suggestion did not quote, no email or phone may be touched,
   the score may not fall. A failed check drops every edit.
7. **The file is kept as bytes, and the resume is never changed.** A pack
   stores its `.docx` (and the PDF of a clean version) and bumps no resume
   version. "I sent this file" marks the job applied, records the pack's text
   as what went out and freezes the row: the resume's file can be replaced
   and the renderer changes between releases, and "what did I send them" has
   to have one answer a month later.
8. **One message.** Packs the worker started on its own are announced
   together — the ready ones, then the postings not worth the evening — when
   the person's schedule lets a held message out (`shouldDeliverHeld`). A
   pack asked for by hand is not announced: its page is open.
9. **Nothing is submitted.** The person applies.

## Consequences

✅ The morning starts with a verdict, a file and a link instead of 44 unread
alerts; the 61 % that are not worth tailoring say why in a sentence.
✅ One pipeline (`preparePosting`) for the worker and the dry run, so the
measurement and the feature cannot drift.
✅ The Tailor page opens on the tailored text: the pack stores the id of the
comparison that judged it.
❌ The worker now spends AI beyond the classifier with nobody watching. The
daily limit bounds it; the ledger (ADR 0055) prices it under its existing
features.
❌ A stop on a failed requirement trusts the model's reading of the posting's
gates. On the dry run all 17 were right. A wrong one stops the pack, and
preparing it again stops in the same place while that comparison stands; the
way round it is the Tailor page, where the person decides.
❌ The comparison a pack starts from is stale for the dashboard's memo once
the company check lands (ADR 0042's marker): the pack keeps the ids it read
instead of asking the memo.
❌ One threshold for every search and one policy for every resume. Both are
the person's to set, neither is per-search or per-resume yet.
❌ A worker stopped mid-pack puts the pack back in the queue; the calls that
had not stored a row are paid for again.

## When to revisit

- The owner wants a threshold per search or a policy per resume.
- The classifier's fit stops clustering — the trigger could then lean on it
  more and on the daily limit less.
- A gate proves wrong often enough that a failed requirement should warn
  rather than stop.
