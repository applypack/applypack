# HR screening: rank a folder of resumes against one position (plan)

> Analysis 2026-09-04, nothing built. Answers the owner's question: could
> ApplyPack let an HR person or a hiring manager take a folder of resumes,
> pick a position (pasted, from a file, or one of the manually added jobs)
> and see who fits and whom to interview first — by content, not by
> keywords; what companies actually measure when they screen; which
> criteria and which score; how to organise it; and whether it belongs in
> this project at all. Backlog ticks live in [TASKS.md §19](./TASKS.md).
> Pairs with [ADR 0012](./adr/0012-deterministic-match-score.md),
> [ADR 0020](./adr/0020-fact-gate-blocks-fabrication-not-imprecision.md),
> [ADR 0022](./adr/0022-prompt-fences-for-untrusted-text.md),
> [ADR 0029](./adr/0029-quick-check-and-lazy-suggestions.md),
> [ADR 0030](./adr/0030-resume-strength-review.md),
> [ADR 0037](./adr/0037-suggestions-carry-replacement-text-gated-in-code.md)
> and [resume-ats-blueprint.md §9–10](./resume-ats-blueprint.md).
> The published report this plan condenses: «По той бік столу»
> (claude.ai artifact 46a1b699-d5b9-48b3-bb3d-0583c275a957).

**Verdict**

- **Technically: yes.** About two thirds of the primitives exist — four
  file formats extracted, `hard_requirements` gates (pass / unknown /
  fail), the code-computed score (ADR 0012), the JSON Resume `structure`
  with dates, the fact gate, the keyword frame that later runs inherit.
  New: an employer rubric, a date parser, redaction of personal data, a
  batch runner with its state in the database, the table.
- **As a product: it is the other side of the table.** README's first
  sentence is "gets your resume past the keyword filter"; bulk screening
  *is* the filter. Both sides can live in one product only as a separate,
  explicitly enabled mode — never as one more card.
- **Legally: the one feature that makes ApplyPack a "high-risk AI
  system"** under the EU AI Act (Annex III, 4(a)) and puts it under GDPR
  art. 22. The candidate side has nothing of the kind: there every call
  carries the owner's own data; here it carries three hundred other
  people's.
- **Recommendation.** (0) Measure first — a gold set of three postings ×
  thirty resumes ranked by a human, and a bench; without those numbers
  "deep reading of the content" is a promise, not a feature. (1) Build the
  single-resume **employer view**: cheap, safe, useful to both sides. (2)
  Build the bulk ranker only as an opt-in **employer mode** with the seven
  guardrails in §6, no automatic rejections, and only after stage 0.
  Whether that niche is worth the legal surface is the owner's call, not an
  engineering one.

**Ground rules for everything below**

- **The model marks facts and quotes; the code computes.** The rule of
  ADR 0012 / 0030 is a requirement here, not a taste: "why is №3 above №7"
  must be an answer read off a table, reproducible a month later under the
  same rubric.
- **Evidence, not keywords.** A screen that counts words loses to this
  product's own tailoring loop (§18). A screen that counts evidence levels
  does not — the fact gate keeps a tailored resume from claiming what it
  never had.
- **"Unknown" is a question, never a failure.** Half of what a company
  needs to know is not in a resume; the tool turns that into interview
  questions instead of points.
- **The tool ranks, a person decides.** No bucket is a rejection, no score
  is a verdict on a person, and the wording says "priority to talk to",
  never "best candidate".

---

## 1. What the idea asks for, and what already exists

| Component of the idea | Already there | Missing |
|---|---|---|
| Read a resume from a file | `resume-text.ts:extractResumeText` — .pdf / .docx / .md / .txt, 200-char minimum, no OCR | Bulk intake (zip, several files, a mounted folder); a scanned PDF → an "unreadable" bucket; the same person in two versions → dedupe (`fingerprint.ts` SimHash exists) |
| The position from a list, a file, or pasted | `manual-job.ts` makes a MANUAL Job; `/target` already takes pasted text and detects company, title, location | A posting as a file — the same extractor, a dozen lines |
| "Does this resume fit the position" | `match.ts` in `fast` mode: terms with statuses, three alignment grades, `hard_requirements` (pass / unknown / fail, "silence is NEVER fail"), red flags, `score.ts` | A different rubric: today's score measures the document's presentation, not the person (§4) |
| Understand what the person did | `scan.ts` → title, seniority, years, skills, primary stack, role types, and `structure`: roles with dates, education, skills, languages — every string a verbatim span (`structure-anchor.ts`) | Dates are strings → a date parser (Ukrainian and English months, "по теперішній час"); tenure, years in role, recency of a skill computed in code |
| A score across all criteria | ADR 0012 / 0030: the model grades, the code scores; `review-score.ts` has six dimensions with caps, including "duties only → at most 55" | An employer formula (`screen-score.ts`), its caps |
| The same yardstick for every resume | `keyword-frame.ts`: terms extracted from the posting once, inherited by later runs | Nothing — it is exactly the batch mechanism: one frame, N resumes |
| No invention | `fact-check.ts`, `prompt-fence.ts` (ADR 0020 / 0022): an evidence quote must be a verbatim span; resume text sits behind the fence | Unchanged; `prompt-fence-registry.test.ts` forces the new prompt to register |
| A batch with progress | `target-runs.ts` (in-memory registry), `reclassify-job.ts` (batches of 50, `createLimiter(AI_CONCURRENCY)`, `onProgress`) | State in the database, so a container restart does not lose 300 calls; resume from what is missing |
| Engines | The five-backend chain (`ai-runtime.ts`); a local model through the OpenAI-compatible URL | Batch API for the API engines (−50 %); a cached shared prefix |

**A trap in the existing tables.** `Resume` rows are the owner's, and
`store.ts:listOtherResumeSkills` reads every row to mark "in another
resume" evidence. Put applicants' resumes there and the owner's own match
starts "proving" Azure with a quote from applicant №17. `CandidateFact` is
the owner's facts, `CompanyCandidate` is discovery. Applicants therefore
get tables of their own, and the word "candidate" is taken in this code —
`Applicant` it is.

---

## 2. How companies actually screen

Two filters stand between an application and the first conversation, and
neither reads the resume carefully.

1. **Applications land in an ATS** — Greenhouse, Lever, Ashby, Workable:
   the same vendors whose boards ApplyPack reads from the other side.
2. **Knockout questions on the form:** work authorisation, location,
   salary expectation, minimum years, language. Binary gates — and half of
   them are *not in the resume*.
3. **The recruiter's screen:** the first pass takes 6–8 seconds (Ladders
   eye-tracking, 2018: 7.4 s). They look at the current title, company
   names, dates, stack overlap, obvious gaps. Result: yes / maybe / no.
4. **Recruiter phone screen** (15–30 min): confirm the gates, motivation,
   money, timing.
5. **Technical interview or a take-home.**
6. **The interview loop with a scorecard.** In Greenhouse every interviewer
   rates the same attribute list on a four-point scale (strong no / no /
   yes / strong yes) and gives an overall recommendation; Lever, Ashby and
   Workable do the same under other names.
7. **Debrief, references, offer.**

Two facts in that funnel shape the product.

**A resume is a weak predictor of job performance.** Thirty years of
meta-analyses of selection-method validity say the same thing:

| Selection method | r, Schmidt & Hunter 1998 | r, Sackett et al. 2022 |
|---|---:|---:|
| Structured interview | .51 | .42 |
| Job-knowledge test | .48 | .40 |
| Work sample | .54 | .33 |
| General cognitive ability | .51 | .31 |
| Unstructured interview | .38 | .19 |
| **Years of experience** | .18 | .16 |
| **Years of education** | .10 | — |

The exact values matter less than the order: everything readable off a
resume sits at the bottom. So the first product rule: a resume screen is
an instrument of **prioritisation** ("whom to call first"), never of
prediction ("who will be best"). Promise the first, never the second. The
owner's own wording — "whom to schedule an interview with first" — already
says this.

**An ATS does not reject resumes on its own — but human filters are
coarse.** "75 % of resumes are rejected by a robot" is a 2012 marketing
figure: an ATS searches, sorts and asks knockout questions; a person
rejects. The real problem is the other one: the Harvard Business School /
Accenture report "Hidden Workers" (2021) has 88 % of employers admitting
their filters screen out qualified candidates on rigid formal criteria. The
intuition in the ask ("not just keywords") is exactly the hole the market
admits to — the same hole README names in its first sentence, from the
candidate's side.

What that means for an AI screen: its job is the reading a human has no
seven seconds for, and its output is a *reason* handed to a person, not a
number.

---

## 3. Criteria: what a company wants to know about a candidate

Three groups; the boundaries matter more than any weight.

### A. What a resume can evidence — scorable

| Criterion | What is read | Source |
|---|---|---|
| Must-have skills with an evidence level | Not "mentioned" but a rung: owned in production recently → used in a role → project or study → skills list only → absent. A synonym and a sibling technology are different things (Vue ≠ React, already in the prompt) | The model marks the level and a verbatim quote; terms from the posting's frame |
| Relevant years and recency | Years in roles of this type and in the primary stack; when a must-have was last used (eight years ago ≠ last year) | Dates in `structure.work` → code |
| Level and scope | Title progression, end-to-end ownership, people, budget; under- or over-qualification against the posting's level | The model (as `seniority_signal` in the review) + titles from `structure` |
| Domain | Fintech, e-commerce, regulated industries; company scale and stage | The model |
| Impact evidence | Outcomes with numbers versus a list of duties — `review-score.ts` already caps "duties only" | The model, with quotes |
| Trajectory and stability | Average tenure, number of employers, promotions. Gaps only as a *fact to discuss*, never a penalty (see C) | Code, from dates |
| Education, certificates | Only when the posting really requires them (regulated roles, clearance) | `structure.education`, `certificates` |
| Languages | List and level | `structure.languages` |
| Location and arrangement | From an address or an explicit line; often absent | `parseLocation` exists |
| Consistency | Overlapping dates; title inflation; posting text copied into the resume; boilerplate generated text | Code + the model |

### B. What is not in a resume — gates with status "unknown"

Work authorisation and visa, salary expectation, notice period and
availability, willingness to relocate, to work on site, to travel,
motivation, references, the real depth of a skill (a take-home checks it,
text does not). The product conclusion: **"unknown" is not "bad", it is
"ask".** The most valuable output of a screen for a person is three to
five questions per applicant, built from their unknown gates and thin
evidence. The mechanism exists as `ask_user` in the match and `ask` in the
review; only the addressee changes — the questions go to the applicant,
not to the owner.

### C. What can never be a criterion — and must be removed before the model sees the text

Age (date of birth, and graduation years as a proxy), gender, photo,
marital status, citizenship and nationality, religion, health, home
location as a proxy. Ukrainian and European CVs carry a photo, a date of
birth and marital status in the header — blind screening is therefore a
mandatory stage (§5), not an option. Gaps in the dates — parental leave,
illness, care, war, military service: penalising them penalises protected
characteristics. Showing a gap as a fact that can be discussed is fine;
subtracting points for it is not.

---

## 4. The score: computed so it can be defended

The same principle as ADR 0012 and 0030: **the model marks facts and
quotes, the code computes.** For an employer this is a requirement, not a
taste.

### Why today's score is the wrong instrument

`score.ts` gives 60 points for term coverage (present 1, add 0.5) plus 40
for alignment of title, summary and the most recent role, minus penalties.
It measures how well *the document* is presented for a posting, because its
job is to tell the candidate what to fix. For an employer it has three
faults: a resume with a long skills list and no evidence in any role earns
the same 60; a badly written resume of a strong person loses to a well
written resume of a weak one; the candidate-side red flags ("unusable apply
link") mean nothing here.

And the main one — **the paradox of this product**: its other half (§18,
ADR 0037 / 0038) tailors resumes to postings. A screen that counts words
loses to its own tailoring tool. A screen that counts *evidence* does not:
the fact gate refuses to write in what was never there, and the level "used
in a role" cannot be reached by rearranging the summary. This is the
conclusion of [resume-ats-blueprint.md §9–10](./resume-ats-blueprint.md)
("resume parsing into evidence, not keywords"; the 1.0 / 0.9 / 0.8 / 0.65
/ 0.35 / 0.2 / 0 ladder) — written for the candidate, valid for both sides.

### Layer 1 — gates, tri-state

Drafted from the posting automatically (as `hard_requirements` today) and
**edited by HR before the run**: "5+ years Java", "EU work authorisation",
"German C1", "CS degree or equivalent". Each is pass / fail / unknown with
a quote or a question. "Fail" puts the applicant in the bucket "did not
pass gate X" — it deletes and rejects nobody. "Unknown" never equals
"fail"; the prompt already says so in the words "Silence is NEVER fail".

### Layer 2 — a weighted 0–100 score

A starting proposal; weights are edited per posting, and stage 0
calibrates them. Nothing below is carved in stone: the blueprint says "do
not hardcode them forever", and that applies to every number here.

| Dimension | Weight | The model marks | The code computes |
|---|---:|---|---|
| Must-have skills | 35 | Evidence level per term (0 / 0.3 / 0.5 / 0.8 / 1.0) and a quote | Σ weight·level ÷ Σ weight, as in `computeScore` |
| Relevant years and recency | 15 | Which roles are relevant to the posting's type | Years from `structure` dates; last use of each must-have |
| Level and scope | 15 | junior / mid / senior / lead and ownership signals | Distance to the posting's level, both directions |
| Impact evidence | 15 | strong / ok / weak with quotes — as `impact` in the review | Credit 1 / 0.5 / 0 |
| Domain | 10 | strong / partial / off | Credit 1 / 0.5 / 0 |
| Nice-to-have skills | 5 | Evidence level | As must-have |
| Education, certificates | 5 | pass / unknown / fail | Weight 0 when the posting does not require them; the five points move to must-have |

Caps — the judgment weights cannot express: primary stack 0 of N → at most
30 (the `score.ts` rule unchanged); a level two rungs below the posting →
at most 50; no impact evidence in the relevant roles → at most 60.

### Confidence — separate from the score

The share of criteria with evidence (pass or fail, not unknown), times the
parse quality. A short resume with ten unknowns is not "weak", it is
"unknown". Order: gate bucket first, score inside it, confidence on ties.
Both numbers always shown, side by side.

### Per-applicant output — a scorecard, not a number

Three lines "who, what they did, verdict"; the must-have table with
evidence level and quote; the gates; three to five screening questions;
risks as facts (over-qualification, short tenures). This is the format HR
already thinks in — a Greenhouse scorecard filled in before the interview
rather than after.

### Why not "every resume in one prompt"

Three hundred resumes at two thousand tokens each is six hundred thousand
tokens — it does not fit and is not needed. Listwise ranking in one prompt
has position bias (first and last positions win), does not parallelise and
leaves no per-applicant audit trail. The right shape is **independent
pointwise scoring of every resume against one posting frame** — what
`keyword-frame.ts` already does between versions of one resume. It
parallelises under the limiter, caches by prefix and reproduces. A
comparative step (pairwise or listwise) is a tie-break for the top ten
only, with shuffled order, and only in stage 5.

### Calibration — stage 0, not "later"

The gold set: three postings × ~30 resumes ranked by a human (the owner
plus a recruiter they know). Metrics: Kendall τ against the human order,
precision@5, the gate confusion matrix (pass / fail / unknown), stability
across two runs, a redaction-leak test (no name or date of birth reached
the model) and **the tailoring test**: one resume tailored to the posting
with ApplyPack's own loop, no new facts, must score the same. That is how
§15 (a fixture of 30 verdicts) and §17 (20 pages before the first line of
code) were done.

---

## 5. How to organise it

Flow: the posting and the resumes travel two branches and meet in
independent calls with a shared prefix; the model sees only redacted text;
every verdict is written to the database as it arrives; the number is
computed in code.

```
posting (Job · paste · file) ──▶ frame + rubric draft (1 call) ──▶ HR edits the rubric ──┐
                                                                                            ▼
resumes (zip · files) ──▶ extract + dedupe ──▶ redact → "Applicant №N" ──▶ N independent calls ──▶ screen-score.ts ──▶ table
                                                                                            │
                                                                                            └──▶ DB: every verdict at once, restart resumes
```

### Entities — own tables, `Job` reused

- **`Screening`** — the position (`jobId` → a MANUAL or any Job), the
  rubric (gates, weights, level) as JSON, prompt version, `retainUntil`.
- **`Applicant`** — belongs to one screening: file, text, `structure`,
  redacted text, parse status (ok / unreadable / duplicate). Name and
  contact in columns of their own, never in the text the model sees.
- **`ScreeningVerdict`** — the model's facts (JSON), breakdown, score,
  confidence, questions, model and prompt version; one per applicant ×
  rubric version.

No "talent pool" across screenings in v1: an applicant lives in exactly one
screening, and deleting the screening cascades everything. That is data
minimisation out of the box, not an extra feature.

### The flow in seven steps

1. **The position:** pick a Job from the list, paste text or give a file —
   the resume extractor reads it.
2. **Frame and rubric draft** — one model call per posting: must /
   preferred / nice terms (`RULE_KEYWORDS`, `RULE_REQUIREMENT`), gates
   (`RULE_GATES`), level. HR edits in the UI that exists on `/jobs/:id`:
   the "Wants it" select, ignore, "Add a keyword" (`keyword-overrides.ts`).
3. **Resumes:** several files or a zip (`zip.ts` already reads archives) →
   extraction → dedupe by email, phone and SimHash → `structure` from the
   scan or from the deterministic `structure-from-text.ts`.
4. **Redaction** — a new pure function with a test: drop name, contacts,
   URLs, date of birth and age, address, marital status, gender,
   citizenship; replace with "Applicant №17". The model sees the redacted
   text only; the UI shows the name from its own column.
5. **The batch:** N independent calls through `createLimiter(AI_CONCURRENCY)`
   with a shared prefix (rubric + posting + frame); every verdict is written
   to the database at once — a restart resumes from what is missing. For
   the API engines, the Batch API as an "overnight" option.
6. **The score in code** (`screen-score.ts`, pure, tested) from the model's
   facts and the date metrics.
7. **The table:** a row per applicant; columns for gates, score,
   confidence, must-have coverage, years, level, domain, flags; sorting,
   bucket filters, click → scorecard with quotes and questions; CSV and
   Markdown export for the hiring manager.

Example (invented rows). Order: gate bucket, then score, then confidence.
№15 sits in its own bucket with a reason, not "below everyone". The name is
shown in a separate column, to the person only.

| Applicant | Java 5+ | EU auth | DE C1 | Score | Confidence | Must-have | Years | Level | Flags |
|---|:-:|:-:|:-:|--:|---|--:|--:|---|---|
| №07 | ✓ | ✓ | ? | 81 | high | 6 / 7 | 9 | senior | — |
| №12 | ✓ | ? | ? | 74 | medium | 5 / 7 | 6 | senior | 2 gates to ask |
| №03 | ✓ | ✓ | ✓ | 58 | high | 4 / 7 | 14 | lead | over-qualified |
| №21 | ✓ | ✓ | ? | 52 | low | 3 / 7 | 3 | mid | short resume |
| №15 | ✗ | ✓ | ✓ | — | high | 2 / 7 | 7 | senior | failed gate "Java 5+" |
| №09 | unreadable: scanned PDF without a text layer | | | | | | | | |

### Cost and time — estimates

Per call: about 6 k input tokens (rubric 2.5 + posting 1.5 + resume 2) and
1.5 k output. Prices from the Claude API price list as of June 2026; times
extrapolated from the measured 78–109 s per comparison on the CLI
(TASKS §13) — for the API engines an assumption until measured.

| Engine | 1 resume | 100 | 300 | Time per 100 (3 in parallel) |
|---|--:|--:|--:|---|
| Sonnet 5, API ($2 / $10 per M) | ≈ $0.03 | ≈ $3 | ≈ $8 | ≈ 10–15 min |
| — with a cached prefix and the Batch API | ≈ $0.01 | ≈ $1 | ≈ $3 | hours, asynchronous |
| Opus 5, API ($5 / $25) | ≈ $0.07 | ≈ $7 | ≈ $20 | ≈ 20–25 min |
| Haiku 4.5, API ($1 / $5) | ≈ $0.015 | ≈ $1.5 | ≈ $4 | ≈ 5–8 min |
| Claude Code CLI, subscription, Opus | $0 | $0 | $0 | ≈ 50 min; 300 → ≈ 2.5 h |

The prompt cache would pay for the first time in this project: the shared
rubric-and-posting prefix repeats a hundred times in a row and exceeds the
Opus and Sonnet floors; Haiku's floor is 4096 tokens (CLAUDE.md gotcha 3)
— read `usage.cache_read_input_tokens` back, never assume.

### Where it lives — three options

- **A. One more card** on `/target` and `/jobs/:id`. Cheapest — and it
  mixes the sides, and the legal surface of §6 lands on the whole product.
- **B. A separate product** that vendors `src/resume/`. Cleanest — but the
  repo has no package structure, and extracting the module for one consumer
  is too expensive now.
- **C. "Employer mode" — recommended.** `AppSettings.employerMode`, off by
  default; enables a "Screening" menu item (`/screen`), its own tables, its
  own prompts in the fence registry, its own settings tab with the
  guardrails. The worker is untouched: everything is on-demand in web, as
  ADR 0008 already requires. README describes the mode in a section of its
  own with a paragraph on what it means legally.

ADRs needed: "screening scores evidence, not keywords" (successor to
0012 / 0030), "redaction and retention of applicant data", "a mode, not a
product" — why C and not B.

---

## 6. Why this is risky here

Not legal advice — a list of facts to verify on the day of the decision.
Each is real, and none applies to the candidate side of ApplyPack.

- **EU AI Act.** Annex III, point 4(a): AI systems used "to analyse and
  filter job applications, and to evaluate candidates" are high-risk. The
  open-source exemption (art. 2(12)) does *not* cover high-risk systems.
  The deployer (art. 26) owes human oversight, logging, information to
  applicants and workers; the provider owes risk management, documentation,
  conformity assessment. The Annex III obligations were scheduled for
  2 August 2026; the "Digital Omnibus" (November 2025) proposed a shift to
  late 2027 — check the status.
- **GDPR art. 22.** The right not to be subject to a decision based solely
  on automated processing that significantly affects the person; a hiring
  rejection is the textbook example in the WP29 guidelines. So the tool
  ranks and a person decides, visibly, in the UI and in the logs. Then
  art. 5 (minimisation, storage limitation), art. 13–14 (the applicant
  must be told an AI reads their CV), art. 35 (a DPIA — systematic
  evaluation of people with a new technology). The ApplyPack user becomes
  the controller of three hundred strangers' data.
- **USA.** NYC Local Law 144 (in force July 2023): automated employment
  decision tools need an independent bias audit and ten days' notice to
  candidates. Colorado SB 24-205 (30 June 2026) and Illinois HB 3773
  (1 January 2026) — high-risk AI in hiring. The EEOC four-fifths rule —
  selection statistics by protected group, which a single-user self-hosted
  tool cannot collect.
- **Precedent.** Mobley v. Workday: in May 2025 the Northern District of
  California allowed a collective action under the ADEA (age 40+) against
  Workday's AI screening to proceed. Not hypothetical.
- **Third-party data and the engines.** Today every call carries the
  owner's data — their right. Here it carries other people's. The CLI
  engines run on a personal subscription whose terms and data settings
  (training, retention) the subscriber controls, not the employer. For
  other people's personal data the defensible path is an API with a data
  processing agreement, or a local model (the OpenAI-compatible URL
  exists). Re-read the vendors' terms on the day.
- **Ukraine.** No AI-specific law; the personal-data law of 2010, the new
  draft aligned with GDPR. A CV market with a photo and a date of birth in
  the header — redaction is mandatory, not desirable.

### Guardrails without which the bulk screen is not built

1. **No automatic rejections.** Buckets and order — yes; a "reject" button
   only in a person's hand, with a log entry.
2. **Blind screening by default** — redaction before the model call, and
   it cannot be switched off.
3. **Every score explainable from a table:** criterion → evidence quote →
   points; rubric version and model stored on the verdict.
4. **Retention:** `retainUntil` on the screening (say, 90 days by default),
   auto-cleanup in `cleanup-job.ts`, a "delete the screening with its
   files" button.
5. **Only engines fit for other people's data:** a UI warning when the
   active engine is a CLI on a personal subscription.
6. **A notice template for applicants** — text HR can paste into a posting
   or a letter.
7. **Wording in the UI:** "priority to talk to", never "best candidate".

---

## 7. Recommendation and stages

The answer to "does it belong here" is **partly**. Checking one resume
against a position through an employer's eyes belongs unconditionally: it
is cheap, creates no new data and works for both sides of the table. The
bulk ranker is a separate product with a different user, a different legal
regime and a different posture towards data; it can be built here only as
an explicit mode and only after stage 0 shows the rubric ranks the way a
human does.

The market is not empty either: every large ATS already sells a match score
of some kind. The niche open to ApplyPack is small companies and managers
without an ATS, agencies, the Ukrainian SMB — people who value self-hosting,
their own engine and an explainable score. Whether that niche is worth the
legal surface of §6 is the owner's decision, not an engineering one.

| Stage | What | Size | What it proves |
|---|---|---|---|
| 0 | Gold set and bench (`npm run bench:screen`): 3 postings × ~30 resumes, human ranking | 1 branch, no UI | Kendall τ, precision@5, gates, stability, the tailoring test — the numbers stages 2–5 depend on |
| 1 | The employer view of one resume: a third button next to Compare and Full analysis, prompt `SCREEN_SYSTEM`, gates, evidence levels, screening questions; no edits, no editor | 1 branch | One feature for both sides; ADR "evidence, not words" |
| 2 | Employer mode: `Screening`, a rubric draft with an editor, `Applicant` with bulk intake, redaction | 1–2 branches | ADRs on the mode and on redaction; the leak test |
| 3 | The batch: limiter, state in the database, resume after restart, table, scorecard, export | 1–2 branches | 100 resumes end to end on the API and on the CLI, measured time and price |
| 4 | Retention and auto-cleanup, the engine warning, the notice template, a README section | 1 branch | Guardrails 1–7 in code, not in a document |
| 5 | Top-10 tie-break, calibration report, Batch API | 1 branch | Optional, from the results of 3 |

Altogether the size of §18 (five branches). Stages 0 and 1 make sense
regardless of the rest; the decision on 2–5 is taken with stage 0's numbers
in hand.

---

## 8. Questions only the owner can answer

1. **Who is the v1 user:** one HR person or manager without an ATS
   (compatible with single-user), or a team? Multi-user is hard
   out-of-scope in SPEC.md.
2. **Is the product ready to carry the "high-risk AI" label** in its own
   README — and does that hurt the candidate side, which is what ApplyPack
   is today?
3. **Where may other people's resumes go:** to a cloud engine under a data
   processing agreement, or is v1 local-model only?
4. **The Ukrainian market:** accept CVs with a photo and a date of birth
   and redact, or demand "clean" files from applicants?
5. **Stage 0:** where do 90 human-ranked resumes come from — anonymised
   real ones, synthetic ones, a recruiter the owner knows?

---

## Sources

- Schmidt & Hunter, "The validity and utility of selection methods in
  personnel psychology", Psychological Bulletin, 1998; Sackett, Zhang,
  Berry & Lievens, "Revisiting meta-analytic estimates of validity in
  personnel selection", Journal of Applied Psychology, 2022.
- Ladders, "Eye-Tracking Study", 2018 (7.4 seconds on the first pass).
- Fuller, Raman et al., "Hidden Workers: Untapped Talent", Harvard
  Business School and Accenture, 2021.
- Regulation (EU) 2024/1689 (AI Act): art. 2(12), art. 26, Annex III
  point 4; GDPR art. 5, 13–14, 22, 35; WP29 guidelines on automated
  decision-making (WP251).
- NYC Local Law 144 (2021, enforced from 5 July 2023); Colorado SB 24-205;
  Illinois HB 3773; Mobley v. Workday, N.D. Cal., order of 16 May 2025 on
  collective certification.
- Model prices: the Claude API price list, June 2026; measured times:
  [TASKS.md §13](./TASKS.md) (78–109 s per comparison on the CLI).
- In this repository: [resume-ats-blueprint.md §9–10](./resume-ats-blueprint.md),
  ADR 0012, 0020, 0022, 0029, 0030, 0037, 0038; CLAUDE.md gotchas 3, 8, 11.
