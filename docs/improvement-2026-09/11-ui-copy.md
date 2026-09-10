# §11 — Reduce UI copy and "water"

**Verdict: adopt as a bounded, page-by-page pass driven by a candidate list, not a rewrite (P3). The candidate list is in the audit report, section "Copy".**

## What the plan proposes

Audit every page for text that repeats the heading, explains obvious UI,
describes implementation, is duplicated, is too long for a frequent screen,
belongs in docs, or sounds like marketing. Rule: every visible sentence tells
the user what to do, explains why a result happened, prevents a misunderstanding,
provides evidence, or explains a non-obvious state — else cut it.

## What the repo has today

- 32 page files in `src/web/pages/`; the five heaviest are `settings.tsx`
  (1 100+ lines), `target.tsx`, `screen-detail.tsx`, `welcome.tsx`,
  `job-detail.tsx`.
- The project's writing habit is explanatory by design: PRODUCT.md — *"The
  user is technical; density and precision beat hand-holding."* — and
  DESIGN.md set the voice; the `stop-slop` and `ui-review` skills exist for
  this kind of pass.
- Previous copy passes were per-page and per-PR (TASKS §6 audits, the
  resumes page P0 pass, issue #92), never a sweep.

## Assessment

The plan's five-reason rule is good and matches how the project already
writes; what it must not do is the thing the plan itself warns against in
§12. The right unit of work is one page per PR with a before/after word count
and the must-stay list from §12 pinned in the PR body. The audit agent
produced the candidate list (sentences with the reason each fails); those go
into five GitHub issues, `good first issue`-shaped — which also feeds §16.

## Steps → TASKS §20, block `copy-pass`

- [ ] Five issues, one per page, each with ≤ 8 quoted sentences and the rule
      each fails, plus the sentences that must stay.
- [ ] One PR per page; word count before/after in the PR body; `ui-review`
      skill on the screenshot.
- [ ] No sentence about a cap, an AI call, privacy, a destructive action or
      the employer legal note is cut without a replacement that says the same.

## Appendix — the candidate list (audit 2026-09-10)

Approximate helper-text load per page (Hint bodies, `hint=` / `desc=`,
prose `<p>`, ToggleRow bodies, long `title=`): settings ≈ 1 280 words ·
welcome ≈ 595 · screen-detail ≈ 560 · target ≈ 330 · resume-detail ≈ 240 ·
job-detail ≈ 45 on its own, ≈ 570 with the three cards it composes.

### settings.tsx — cut candidates

| Where | Sentence (abridged) | Fails |
| --- | --- | --- |
| `:362–363` | "Toggles apply the moment you click; forms like the profile editor save on submit." | explains the web's default |
| `:391` | "The master switch for new-job ingestion. Everything else keeps running while paused." | duplicated at `:403–405` |
| `:413` | "Defaults to what it has always done: every hour, around the clock, one message per match." | duplicated — `describeSchedule()` renders the live setting at `:258` |
| `:305–306` | "…Everything found outside them waits and arrives in one message when the window opens." | restates the `window` radio's body at `:298` |
| `:659` | "The funnel board and the nudge that keeps it honest." | marketing tone |
| `:1573` | "Defaults work for most people; open this to fine-tune." | the `<summary>` already says Advanced |
| `:1662` | "None set — most people never need these." | same reassurance one level down |
| `:1213–1214` | "Once both values are saved, the source appears on Companies → …" | `:1152` already says it |

Must stay: `:1640` (re-classify cost, duration, the APPLIED exemption), `:1089` (the personal-subscription paragraph), `:1098–1100` (not legal advice + the legal note), `:1110–1112` (GDPR art. 13–14 / AI Act), `:1053` (deleted with the screening), `:935–936` (the webhook URL is a secret), `:519` (the cap), `:1350–1352` (the dated Haiku measurement), `:1037` (turning off hides N screenings; files stay).

### target.tsx — cut candidates

| Where | Sentence (abridged) | Fails |
| --- | --- | --- |
| `:528–530` | "Green is already in your resume; red is what this posting requires…" | the legend swatches at `:516–520` say it |
| `:530–532` | "Benefits, perks and legal boilerplate are deliberately never keywords" | a statement about the prompt |
| `:532–533` | "hover a mark to see how often…, and re-level or ignore any of them in the keyword table" | obvious UI + points three cards away |
| `:375–377` | "…the posting itself is already analysed, so only the resume is judged." | why the call is cheap, not what the button does |
| `:626` | "Markdown, for the document your resume really lives in." | the button says what it copies |
| `:588` | "Locate on a suggestion outlines the text it targets." | one click demonstrates it |
| `:672` | "kept in this browser tab until you save" | duplicated at `:587–588` |

Must stay: `:290–293` (why the live number and the analysed verdicts differ — the most important sentence on the page), `:433` (Save as vN, patched in place, ~1 min), `:620` (Rewrite all spends a call; the score stays), `:187` (a fresh resume-model call), `:378` (nothing is added to Resumes / untouched until Save), `:319` (Ready to apply — gated by `readyToApply`), `:566` (`fileVerdict`).

### screen-detail.tsx — cut candidates

| Where | Sentence (abridged) | Fails |
| --- | --- | --- |
| `:100–101` | "Five cards, top to bottom: the position, the criteria…" | the numbered Step badges do this |
| `:102` | "The order in the results is a priority to talk to" | repeated at `:550` and in the bucket label |
| `:202–203` | "One row per criterion." | it is a table with one row per criterion |
| `:360–361` | "Runs on {engine.label}" | `:355` ends with the same |
| `:330–331` | "(On a folder, your browser asks once whether to upload its files; that question is the browser's, not ours.)" | defensive framing of someone else's dialog |
| `:549–550` | "Names are shown to you only — the model saw 'Applicant №N'." | in the upload Hint at `:332–333` and in compare |
| `:543` | "Decisions are the one thing the tool never writes (ADR 0047)" | the ADR number leaks; keep the claim |

Shape problem, not a cut: `:327–336` is one 120-word Hint carrying six unrelated, all load-bearing facts (what a pick does, the caps, what is skipped, the PII list, duplicates, scanned PDFs). Split into labelled lines.

Must stay: `:332–335` (the redaction list — the product's core promise), `:274–275` (protected characteristics refused), `:551–552` (a failed gate is about the posting's conditions), `:365–367` (why other people's resumes matter), `:91` (the delete confirm with its blast radius), `:328–331` (the caps), `:535–537` (the tool never changes a criterion — drop the parenthetical), `:273–274` (a changed yardstick makes every score stale).

### welcome.tsx — cut candidates

| Where | Sentence (abridged) | Fails |
| --- | --- | --- |
| `:176–178` | "Five short steps: connect an AI, prove the search works…" | the `<ol>` below lists them |
| `:377` | "The search works — now let's find the ones that match you." | transition with no fact |
| `:390–391` | "the ones that publish every posting they have" | what an aggregator is, mid-instruction |
| `:392` | "you'll watch them answer one by one" | the progress page shows it |
| `:646` | "Job boards that fit where your searches hunt, built from their stack." | repeats the step title |
| `:668` | "Curated employer boards, checked by hand." | marketing tone |
| `:817` | "profile filled." | the heading above says "Everything is set up" |

Must stay: `:283` (one tiny AI call), `:757–760` (the batch, what is skipped free, seconds per job on an API / half a minute on a CLI), `:290–291` (the key lives in your database), `:488–489` (nothing is saved until you press…), `:552–554` (built for software engineering roles), `:396–398` (nothing from N sources usually means no network), `:669–670` (boards land switched off).

### job-detail.tsx — cut candidates

| Where | Sentence | Fails |
| --- | --- | --- |
| `:391–393` | "By search" | uppercase-tracked, which DESIGN.md forbids; the links name the searches |
| `:178` | "Actions" | a title over a row of buttons |
| `:298` | "Show all fields" | third layer of chrome over one JSON tree |
| `:571–572` | "Recorded with the version you sent, for the follow-up nudge." | the first clause restates the label |

Must stay: `:294–295` (the licence asks for the whole offer), `:443` (also listed elsewhere — apply once), `:612` (kept as it was on the day), `:611` (not recorded — most likely '{name}'), `:375` (Re-classify runs the AI), `:313` (the replacement notice with the count).

### resume-detail.tsx — cut candidates

| Where | Sentence (abridged) | Fails |
| --- | --- | --- |
| `:308–309` | "Parsers should read this file the way you do." | restates the line before it |
| `:459` + `:471` | "Clean version in your typeface" | the title and the button, verbatim, 12 lines apart |
| `:401` | "a resume cannot know them" | obvious |
| `:221–222` | "…the history below shows how the score moves between versions." | the next card is that history |
| `:373–374` | "…that hunts the jobs you'd apply to with this resume" | restated at `:338` and by the button at `:394` |
| `:181–182` | "…follow its list." | instruction for its own sake |

Must stay: `:468` (not your original design back; nothing here changes this resume), `:508–509` (what Save can and cannot write, ADR 0038), `:520–522` (a template's author name), `:108` (the delete confirm), `:398–400` (starts switched off — and fix the word "Activate", COPY-1).
