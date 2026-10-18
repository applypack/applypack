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
  *Amended 2026-10-11 (#388).* That is the dry run's figure, and the dry
  run writes no letter. Read off the ledger in the live check of 2026-10-06,
  a ready pack with a cover letter — the brief, the comparison, the company
  check, the re-judge and the letter — came to about $0.86 at API prices,
  the company check most of it. The Settings hint (three to five AI calls,
  about three minutes) holds; this is the figure to quote for money.
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
   *Amended 2026-10-11 (v2.55.30, #383).* The form was read as leniently as
   the stored value: a number outside its range, text, or a letter mode
   nobody offers was replaced by the default and reported as saved — a fit of
   40 came back as 90. The form is now refused whole, with the field named
   (`packSettingsFromForm`), and a refused press changes nothing, the switch
   included. Falling back to a default is kept for reading what is already
   stored, which is what it was for.
2. **Asked once, about a posting the tick has just stored.** The trigger
   (`pack/trigger.ts`) is called in `process-jobs.ts` where a new match is
   inserted, and nowhere else. So the backlog is never walked — not when the
   feature is switched on, not by "Save & re-classify" — and a fresh install
   spends nothing. Any single job can be prepared by hand on its tab.
   *Amended 2026-10-11 (v2.55.31, #379).* "Published within N days" is the
   other half of keeping the backlog out, and it read `postedAt` — which
   every mapper sets to now when its source gives no date. A row imported
   with no date column, a row of a folder's file, and every role of a board
   that publishes none (BambooHR, Pinpoint, often Rippling) passed as
   published today: a file of last month's postings queued packs up to the
   day's limit, and with no limit, all of them. A posting now knows whether
   its date came from its source (`NormalizedJob.undated`: the row mapper
   says so, and `fetchers/dates.ts:markClockDated` marks, where a read ends,
   every date written at or after the moment that read began), and the
   trigger answers `undated` for one that did not. A posting the person
   saved themselves keeps its file's time, which is when they saved it. The
   fact is not stored: the trigger is asked once, while the posting is in
   hand. Two things are left: the date is still shown and filtered as
   "Posted" (#458), and a board that never publishes dates gets no automatic
   pack even for a role that appeared between two reads (#459).
   *Amended 2026-10-12 (v2.55.53, #380).* The trigger asked about the row
   and never about the role. The same posting from a second source — a row
   linked to its original by `crossListedOfJobId` (ADR 0018) — got a pack of
   its own: two comparisons, two company checks, the role twice in the
   morning message. And a copy of a posting stored before packs were
   switched on queued one too, which is the backlog by another door. A copy
   is now asked a second question (`trigger.ts:copyPack` over
   `store.ts:sameRole` — the posting it is linked to, what that one is
   linked to, and their other copies): no pack when one of them has a pack
   in any state, and none when the first of them was stored before the
   switch. That needs the moment of the switch, which nothing recorded:
   `AppSettings.pack.enabledAt` is stamped when a save turns packs on, kept
   while they stay on, cleared when they go off (`settings.ts:switchedOn`).
   An install that already had them on gets the moment of the upgrade
   (migration `20261012100000_pack_switched_on_at`): for a copy of a posting
   stored before it nothing shows the posting came after the switch, so it
   is left to the person's own **Prepare** — the error is on the side that
   spends nothing. A role stored since and never given a pack (the day's
   limit was spent) still gets one through its copy. The tab of the posting
   left without a pack points at the one that has it.
3. **The row is the queue.** `application_pack`, one per posting: queued →
   running → ready | stopped | failed. The dashboard only inserts the row;
   the worker's runner (`jobs/pack-job.ts`) beats every minute, takes an
   advisory lock, and prepares the queued rows one at a time, oldest first. A
   beat with nothing queued and no message owed is two small indexed reads
   (is a pack waiting; is a message owed) and writes no run row. No broker
   (ADR 0003).
   *Amended 2026-10-10 (v2.55.15, #376).* A queue can lag by hours, and the
   runner used to spend on a row without asking again whether it should.
   Now a pack the tick queued is asked once more when the runner takes it
   (`trigger.ts:autoPackUnwanted`): with packs switched off, the job
   dismissed, applied to by any road, or its company muted, the row is
   deleted — nothing was prepared, nothing is announced, and the day's limit
   gets its slot back. Switching packs off deletes the queued automatic rows
   at once and says how many. A pack asked for by hand is prepared whatever
   became of the job: the person asked.
   *Amended 2026-10-11 (v2.55.29, #382).* A row kept the trigger it was born
   with, so **Prepare again** on a pack the tick had queued started an
   automatic pack: it took a slot of today's limit, was announced a second
   time (rule 8), and — pressed with packs switched off, or for a job since
   dismissed — was deleted by the question above instead of prepared. The
   trigger now says who asked for the preparing the row holds: a pack the
   person starts over is theirs, whoever queued the first one. The price is
   one slot: a pack the tick queued today and the person prepared again no
   longer counts for today, so the worker may start one more on its own that
   day. A column that remembers the first asker would close that; one slot
   the person frees by their own press did not earn it.
   *Amended 2026-10-12 (v2.55.45, #384).* "Oldest first" put a pack asked
   for by hand behind every automatic one: with five queued it waited a
   quarter of an hour under a line saying "the worker starts it within a
   minute". The runner now takes a pack somebody asked for before the ones
   the tick queued, the oldest first among each
   (`pack/store.ts:claimNextPack`).
   *Amended 2026-10-12 (v2.55.50, #387).* A pack that is still queued can
   be taken out by the person (**Cancel** on its tab,
   `pack/store.ts:cancelQueuedPack`): the row is deleted, nothing was
   prepared, and an automatic one gives its slot of the day back. The
   delete lands only on a queued row; once the runner has it, Cancel says
   so and changes nothing. The tab also says what a pack spends before the
   press: the number of calls, and the kind of money of the engine that
   answers the analysis — no figure, since a pack's calls are filed under
   the features it reuses. Rows written before
   this cannot be told apart from packs nobody pressed and are left as they
   are: one such pack may still be announced once.
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
   *Amended 2026-10-12 (v2.55.53, #380).* A company check was reused only
   from the posting's own rows. A check under fourteen days old that another
   source's copy of the same posting has is reused too
   (`PackPosting.sameRole`), when both rows name the same hiring company
   (`Job.employerKey`, ADR 0056): a copy an agency lists under its own name
   is another company to check, and a row that names no company borrows
   nothing. On the live check that step was 189–216 s a posting.
6. **What may change is a policy held in code** (`pack/policy.ts`): the
   sections open to an edit, at most two experience bullets, nothing removed,
   only keywords the resume backs. Two rules came from the dry run: the
   posting's title is never written as a skill, and a rewrite that loses a
   figure waits for the person. The result is then checked without trusting
   how it was made (`pack/tailor.ts:tailorChecks`): undoing every recorded
   change must give the original back to the character, no change may take
   out words its suggestion did not quote, no email or phone may be touched,
   the score may not fall. A failed check drops every edit.
   *Amended 2026-10-12 (v2.55.45, #384).* Keywords were gated on their own
   box alone, so with **Skills** unticked they were still written onto
   skills lines. They are written only while Skills is among the open
   sections too, and the box says so.
   *Amended 2026-10-12 (v2.55.52, #351).* A keyword of the posting's
   priority 3 (methodology and process) or 4 (domain) is a phrase for a
   sentence, not a named skill: "code deployments" and "AI tooling" were
   appended to tools lines. A pack's plan leaves such a term out
   (`keyword-shape.ts:isNamedSkill`), as Apply all does on the Tailor page,
   where the list shows it unticked.
7. **The file is kept as bytes, and the resume is never changed.** A pack
   stores its `.docx` (and the PDF of a clean version) and bumps no resume
   version. "I sent this file" marks the job applied, records the pack's text
   as what went out and freezes the row: the resume's file can be replaced
   and the renderer changes between releases, and "what did I send them" has
   to have one answer a month later.
   *Amended 2026-10-10 (v2.55.13, #377).* Only that button kept the file.
   The rail's **Mark applied** recorded the untailored resume and left the
   pack free to be prepared again, which deleted the file that had gone out;
   so did a card moved to Applied on the board. Now the pack's file is an
   answer of the "Applied with" pickers — preselected on the rail while a
   ready pack exists — and choosing it records and freezes as the button
   does. A ready pack of a job applied to by any road is not started over,
   whether or not the person said which file went out: it may be that one.
   The choice names the preparing the page showed, so a pack prepared again
   in another tab is refused and nothing is recorded. The board still
   records nothing by itself: a guess would state a fact the person never
   gave.
8. **One message.** Packs the worker started on its own are announced
   together — the ready ones, then the postings not worth the evening — when
   the person's schedule lets a held message out (`shouldDeliverHeld`). A
   pack asked for by hand is not announced: its page is open.
   *Amended 2026-10-10 (v2.55.17, #381).* A pack that failed was in neither
   list, so five failed rows a day came with no word. The message now ends
   with the ones that could not be prepared, by name; the job's tab says
   why. And the commonest failure is gone: a search that names no resume —
   the field is optional, "empty = pick by skill overlap" — gets the resume
   the job page would preselect (`resume/pick.ts:preselectResume`), and a
   pack fails for want of one only when none is stored. A pack that failed
   before it compared anything takes no slot of the day's limit.
   *Amended 2026-10-12 (v2.55.45, #384).* The Overview's **Ready to send**
   counted the packs it listed (eight at most) and kept a posting found
   closed since. It counts every ready pack and leaves out one whose posting
   is `expired` (ADR 0016). And the job page no longer opens on the
   comparison a pack made of its own tailored text: that draft judges a
   file nobody has saved, and "Resume match · 100" headed a resume that
   scores 70 (`web/job-tabs.ts:shownMatch`).
   *Amended 2026-10-18 (#487).* The message named the packs and gave
   nothing to press: an install does not know the address it is opened at
   (127.0.0.1:4747 by default, perhaps behind a proxy). Settings →
   Notifications takes it, optional and empty by default
   (`AppSettings.dashboardUrl`, `notify/dashboard-link.ts`: http(s), no user
   name or password — the link goes into a chat). With it every pack's line
   has its tab under it, and a match alert its job under Apply, written out
   as addresses rather than text links: a chat may refuse a link to
   127.0.0.1 or a host on the home network, and a refused link must not
   cost the message. Without it the messages are as they were. Holding a
   match's own alert until its pack is ready, so a strong match is one
   message, is not done: it is a rule about when alerts arrive that nobody
   asked for, and it would hold a match back by the minutes a pack takes.
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
