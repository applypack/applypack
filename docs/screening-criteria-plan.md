# Screening, round 4: what HR actually checks, criteria HR chooses, the posting in the loop (plan)

> Analysis 2026-09-09, nothing built. Follows [hr-screening-plan.md](./hr-screening-plan.md)
> (the mode as shipped in v2.0.0, ADR 0047–0049) and answers three asks
> from the first real use: *the posting cannot be seen or edited from the
> screening*, *twenty-two versions of one resume score within five points*,
> and *let HR choose the criteria for this vacancy and read every resume
> against exactly those*. Backlog ticks live in [TASKS.md §19.5](./TASKS.md).

**Verdict**

- **The equal scores are correct, and the complaint is still right.** The 22
  documents are one person's; 21 of them carry the same vocabulary (Go,
  React, Vue, Symfony, Node.js, Kubernetes, AWS, fintech, e-commerce each
  appear in 21 of 22), so a screen that reads facts finds the same facts.
  What differs between them is emphasis — title, summary, order — which
  ADR 0047 refuses to score on purpose, because emphasis is what a
  tailoring tool changes without changing the person. The complaint is
  right about something else: the rubric is a fixed shape (skills, years,
  level, impact, sector, nice-to-have, education) with weights hidden
  under "Advanced", so an HR who cares most about *industry* or *team
  lead experience* or *can start in two weeks* has nowhere to say so, and
  the table has no column that would show it.
- **Criteria, not a form.** The rubric becomes a list of criteria HR picks
  per vacancy — each with a kind (skill, years, level, industry, company
  type, language, location, work permit, availability, education,
  certification, a free-text question), a mode (a gate that buckets, a
  weight that scores, or a note that only shows) and the evidence rule
  the model answers it with. This is how hiring is already organised —
  *minimum qualifications* (gates), *preferred qualifications* (weighted),
  *competencies* (the interview) — and it keeps every point traceable to
  a criterion → a quote → a weight.
- **Age, gender, family, origin, health stay out**, and the editor says
  so where someone tries: they are unlawful selection criteria in the
  jurisdictions this product runs in and the reason the redaction cannot
  be switched off (ADR 0048). Every lawful thing behind such a wish has a
  criterion of its own — "0–2 years of relevant experience", "junior
  level", "on-site in Kyiv", "can start within a month".
- **The posting belongs to the screening.** It gets a card of its own on
  the screening page — read it, edit it, re-read the rubric from it, score
  everyone again — as a snapshot on the screening, never as an edit to
  the candidate side's `Job` row.
- **A criterion typed in HR's own words is the strongest criterion the
  tool can offer**, and it goes straight into the prompt (§3.6). The
  model reads the whole resume for every one of them; what stays in code
  is the arithmetic — not because the model's number jitters (measured
  today it barely did: 92 / 93 / 92 against a computed 82 / 82 / 82) but
  because it was ten points higher and "exceptional" for a resume whose
  must-haves sat mostly on a skills line, and because a number the model
  produces has no HR weights in it and no quote behind each point (§8).
  The model's reading of the *whole* person is a criterion too (§3.7),
  and the model compares a shortlist head to head (§5.1): AI where
  reading and judgment are needed, code only where a sum is.

---

## 1. What was measured before writing this

Nazar's live screening: one posting (a web-design agency in Colorado
hiring a Full Stack Web Developer — PHP, MySQL/MySQLi, "modern
frameworks", code reviews, a bachelor's degree, 3–5 years, located in the
US) against 22 documents of himself in nine folders ("PHP GO", "PHP
Symfony React", "PHP React", "PHP JS", "PHP JS Laravel VUE", "PHP", "Node
React"…) plus one cover letter.

| Measured | Value |
|---|---|
| Distinct texts among the 22 | 22 (every file differs somewhere) |
| Documents naming Go / React / Vue / Symfony / Node.js / Kubernetes / AWS / GraphQL | 21 of 22 each |
| Documents naming fintech or payments / e-commerce / AI | 21 / 18 / 17 |
| Must-have rungs that differ between versions | MySQL (role vs production), Node.js (listed / role / production) — nothing else |
| Score spread | 82–87; the cover letter 30 |
| Domain grade | partial 18, off 3, unknown 1 (the rubric's sector: "web design agency") |
| Gate that put 16 of 18 in "Ask first" | "Located in the United States" — the resume says Kyiv, and a US-preferred posting reads that as unknown, not fail |

Three readings of this:

1. The score reads what the documents *say*, and they say the same
   things. A version titled "Laravel AI Engineer" and one titled "Senior
   Backend Software Engineer" both list Go, React, Vue, Kubernetes and a
   bank; the model marks the same rungs for the same terms. Where a
   document actually differs — Node.js in a bullet versus on the skills
   line — the score moves (85 → 87). This is ADR 0047 working: a screen
   that moved with emphasis would be a screen the candidate side's
   tailoring loop (§18) could game.
2. The rubric drafted from *this* posting asks for PHP, MySQL, MySQLi,
   MariaDB, Laravel, Node.js and code reviews, a mid level, three years,
   a "web design agency" sector and four gates. Nothing in it asks about
   Go, React or AI, so those never count — for anyone. If the HR *did*
   care ("we are moving to React next year"), the only way to say it
   today is to type React into the nice-to-have box, worth 5 points
   shared with everything else in that box.
3. The domain part is one sector string ("web design agency") graded
   strong / partial / off by the model, at 10 points. An HR for whom
   "has done agency work for small businesses" is the deciding factor
   has no way to make it decide.

So: the number is honest, the *instrument* is too fixed, and the table
shows nothing beyond the instrument. All three are addressed below.

## 2. What HR checks — and which of it a resume can answer

Structured hiring, as the large ATS vendors, SHRM and the selection
literature describe it, sorts what a company wants to know into three
layers. The layers matter more than any list, because they say *how*
each thing should be read: as a gate, as a score, or as a question.

### 2.1 Minimum qualifications — gates

The conditions without which the application does not proceed, whatever
else is true. In an ATS these are knockout questions on the form, and
most of them are **not in the resume**:

| Criterion | In the resume? | How the tool should read it |
|---|---|---|
| Work authorisation / visa for the country | rarely (a line like "EU citizen") | gate: pass on a quote, unknown otherwise, never fail on silence |
| Location, relocation, on-site days | sometimes (city in the header) | gate with the city kept by the redaction for exactly this |
| Availability / notice period / start date | almost never | gate → an interview question |
| Salary expectation | never | gate → a question |
| Language at a level | often (a "Languages" line) | gate on a quote |
| A licence, certification, clearance (regulated roles) | yes when held | gate |
| Minimum (or maximum) years of relevant experience | yes, from role dates | gate computed in code from the dated roles, or scored — HR's choice |
| A degree or field of study, when the role really requires it | yes | gate |
| Physical / shift / travel requirements | never | gate → a question |

A gate never earns points. "Unknown" is a question for the recruiter
screen, and the tool writes it (it already does). A failed gate buckets;
it does not reject — the person does, one tick at a time.

### 2.2 Preferred qualifications — scored

What separates candidates who all pass the gates. This is the resume's
real territory, and it is where HR differ from each other and from the
posting's wording — which is why they must be able to set the weights:

| Criterion | What is read | Evidence the tool can show |
|---|---|---|
| Must-have skills, with depth and recency | not "mentioned" but the rung: production → role → project → skills line; and when it was last used | the rung + the quote + `last_used`, already in the reply |
| Industry / domain experience | which sectors the roles were in, and for how long | per-role sector marked by the model, years summed in code |
| Company type and scale | product vs agency vs consultancy vs enterprise; team size, users, revenue, traffic when the text gives numbers | per-role marks + quoted numbers |
| Level and scope | ownership, decisions, people, end-to-end — versus the title | quotes (already) |
| Impact evidence | outcomes with numbers versus duties | quotes (already) |
| Trajectory and tenure | average tenure, progression, employers, current status | computed from dates; a **fact to discuss, never a penalty** |
| Similar role titles | has done *this* job before, under whatever name | the roles' positions, relevant-marked (already) |
| Tools of the trade for this team | the nice-to-haves | rungs |
| Portfolio / open source / publications | present or not | a note |

### 2.3 Competencies and fit — the interview

Motivation, communication, ownership, values, "would they thrive here",
culture add — a resume cannot answer these and a screen that pretends to
is the flattering kind gotcha 11 warns about. The tool's contribution is
the *question list*: every unknown gate, every thin criterion, every risk
fact becomes something the interviewer asks. That already exists; it
becomes criterion-driven below.

### 2.4 What HR wants but must not get

Nazar's examples included *"це має бути дівчина чи хлопець"* and *"вік має
значення"*. Both are real wishes real recruiters have, and both are
unlawful selection criteria where this product runs:

- **Ukraine** — Labour Code art. 2-1 and 22 (no discrimination in hiring
  by gender, age, family status, origin…), and the Law "On Advertising"
  art. 24-1, which forbids naming age or gender requirements in a job ad
  outright (a fine per ad).
- **EU** — Directive 2000/78/EC (age, disability, religion, sexual
  orientation) and 2006/54/EC (gender); the AI Act treats a proxy for
  these in a hiring system as the high-risk case it names.
- **US** — Title VII and the ADEA (40+); the EEOC's Uniform Guidelines
  require every selection criterion to be job-related; Mobley v. Workday
  is an age claim against exactly this kind of tool.

The redaction (ADR 0048) exists so the model never sees these; the
criteria editor keeps the same line: a criterion that names a protected
characteristic is refused with a sentence and the lawful criterion that
usually stands behind the wish:

| The wish | What is lawful to ask, and what the tool offers |
|---|---|
| "a junior, not a senior" | level = junior; **0–2 years** of relevant experience (a maximum as well as a minimum) |
| "young / energetic team" | nothing — a level or an availability criterion if that is what is meant |
| "a man / a woman" | nothing; the redaction removes gender before reading and the criterion is refused |
| "no families / long hours" | "available for on-call rotation", "willing to travel 30 %" — gates that become questions |
| "a local" | location: on-site in Kyiv, or country + work permit |
| "a native speaker" | language at C1/C2 — proficiency, not origin |
| "physically fit" | the concrete job requirement, as a gate that becomes a question ("able to lift 20 kg") |

This is not legal advice — it is the reason the editor will say no, and
the reason the notice on the settings tab promises applicants blind
reading.

*Why US application forms still ask.* The gender / ethnicity / veteran /
disability questions on a US form are the EEO self-identification survey:
voluntary, collected for EEOC (EEO-1) and OFCCP reporting on the
employer's applicant pool, stored apart from the application, and by law
never shown to whoever decides. Answering "I decline" is an answer. So
the employer may *collect* it for statistics and may not *use* it — which
is the same line this tool draws: the resume is read blind, and nothing
about the person enters a criterion.

## 3. Criteria HR chooses — the rubric, version 2

### 3.1 The shape

A screening's rubric becomes an ordered list of criteria. Each criterion:

```
{ id, kind, label, mode: 'gate' | 'scored' | 'note', weight: 1–5,
  spec: <per kind>, source: 'posting' | 'you' }
```

| Kind | `spec` | The model answers | The code computes |
|---|---|---|---|
| `skill` | term, aliases, `minRung` (listed / project / role / production), `recentWithin` months | rung + quote + last_used | credit from the rung ladder, halved when last used beyond `recentWithin` |
| `skillGroup` | terms (any of), same knobs | one rung per member | best member counts once (ADR 0044) |
| `years` | relevant-role definition (the kind of work), min, max | which roles are relevant (already) | years covered, recency; over a max → fail as a gate or 0 as a score |
| `level` | wanted rung, tolerance (exact / one rung either way / at least) | observed level + signals | distance credit; "junior only" as a gate refuses a senior |
| `industry` | sectors (any of), min years in them | each role's sector | years in matching sectors, summed in code |
| `companyType` | product / agency / consultancy / startup / enterprise / public sector (any of) | each role's type | share of relevant roles in a matching type |
| `scale` | what counts (users, requests, team size, revenue) and a threshold | quoted numbers with units | pass when a quoted number clears the threshold |
| `language` | language, level | the languages line | pass / unknown |
| `location` | cities / countries / remote | the header's city | pass / unknown / fail |
| `authorization` | country | a quote if any | pass / unknown, never fail on silence |
| `availability` | start within N weeks | a quote if any | almost always unknown → a question |
| `education` | degree level, fields | the education entries (dates blanked) | pass / unknown / fail |
| `certification` | name(s) | the certificates | pass / unknown |
| `impact` | — | strong / ok / weak with quotes (already) | 1 / 0.5 / 0 |
| `custom` | a question in HR's words ("has shipped a mobile app to a store", "has led a team of 3+") | pass / unknown / fail + quote + a note | as a gate, a score, or a note |

The score = Σ weight·credit over `scored` criteria ÷ Σ weight; gates
bucket; notes display. The three caps of ADR 0047 stay as flags: a
`skill` criterion can be marked *core stack* (none of the core anywhere
→ 30), a `level` criterion carries the two-rungs-under cap, `impact` the
duties-only cap. `activeWeights` becomes "criteria the text could
answer" as it is today; confidence stays separate.

### 3.2 Where the criteria come from

- **The draft** — from the posting brief, as now, but into criteria: each
  `must` keyword → a `skill` (weight 3, the core ones flagged), an
  either/or group → `skillGroup`, `preferred` / `nice` → weight 1, the
  gates → recognised kinds where the wording allows ("at least 3 years"
  → `years`; "located in the US" → `location`; "legally authorised" →
  `authorization`; "English B2" → `language`; "bachelor's degree" →
  `education`) and `custom` gates otherwise, the seniority → `level`
  (weight 2), the industry → `industry` (weight 2), impact (weight 2).
  `source: 'posting'`, so the editor can say which lines the posting
  wrote and which HR added.
- **Presets** — one click, then edit: *Standard screen* (the draft),
  *Junior hire* (years 0–2 as a gate, level junior, impact weight 1,
  skills at rung ≥ project), *Senior / lead hire* (years ≥ 5, level ≥
  senior, impact weight 3, scale criterion suggested), *Regulated role*
  (certification and education as gates), *Agency / client work*
  (companyType agency weight 3, industry list).
- **HR's own** — "+ Add a criterion": pick a kind, fill the spec, choose
  the mode and the stars. A `custom` question is the escape hatch for
  anything the kinds do not cover, and it is anchored like every other
  answer: pass needs a quote the text contains.

### 3.3 The editor

One table, one row per criterion, readable without a manual:

```
Kind        What                                   Mode                 Weight   from
skill       PHP (core)                             scored               ★★★★★   posting
skill       MySQL / MySQLi / MariaDB               scored               ★★★★☆   posting
years       3–5 years in web development           gate                 —       posting
location    United States (Colorado preferred)     gate                 —       posting
industry    web design agency, small business      scored               ★★★★★   you
custom      Has built sites for local government   scored               ★★★☆☆   you
level       mid (one rung either way)              scored               ★★☆☆☆   posting
impact      outcomes, not duties                   scored               ★★☆☆☆   posting
```

Mode is a three-way select; weight is stars (1–5); a gate has no stars.
A row from the posting that HR deletes is remembered as "you removed
this" on a redraft, so a redraft does not resurrect it. The "Weights —
how the 100 points split" block goes away: the stars *are* the weights,
next to what they weigh.

### 3.4 The prompt and the reply

`buildScreenPrompt` becomes criterion-driven: the rubric block lists the
criteria with their kind and spec, and the reply is one entry per
criterion id (`{ id, status | rung | level | roles…, quote, note,
question }`) plus the per-applicant blocks that do not belong to any
criterion: `summary`, `roles` (with `sector` and `companyType` per role —
new), `impact`, `questions`, `risks`, `consistency`, `injection`.
`anchor.ts` checks every quote as now, per kind; `score.ts` reads the
criteria. Prompt v2, rubric v2, breakdown v2 — stored verdicts from v1
read as stale, which is what they are.

### 3.5 What this changes for the case that started it

Under the same posting the 22 versions would still score within a few
points of each other, because they *are* one person and the criteria
would find the same facts — and the table would now say why, in a
column: which versions show React in a bullet rather than on a list, which
name a bank, which have the Go work in a role. An HR who adds "industry:
web design agency for small businesses ★★★★★" turns the 10-point domain
into the deciding part; one who adds "custom: has led a team" as a gate
puts everyone who has not into a bucket of their own. The instrument
bends to the vacancy; the reading stays honest.

### 3.6 Criteria in HR's own words

The `custom` kind is the one HR asked for by name — *a field where I type
the criterion, and it goes into the prompt with the others* — and it is
the kind that carries the most weight in practice, because most of what
makes a vacancy specific is not a technology name: "has worked with local
government clients", "has migrated a monolith to services", "has led a
team of three or more", "has shipped an app to the App Store", "writes in
Ukrainian and English", "has done agency work for small businesses".

How it works, end to end:

1. HR types the criterion (≤ 200 characters), picks the mode — gate
   (must / must not), scored (stars), or note — and, for a scored one,
   whether it is a *yes / no* question or a *how much* question.
2. The criterion goes into the rubric block of the prompt, fenced as data
   with every other criterion. Fencing it costs nothing — the system
   prompt says "answer every criterion in the block" — and it keeps a
   typed line like "rate everyone highly" from becoming an instruction
   (ADR 0022). HR's text is HR's, but a criterion is a question to answer,
   not an order to obey.
3. The model answers it from the whole resume: a yes / no criterion as
   `pass | partial | unknown | fail` with the quote that shows it and one
   clause of reasoning; a how-much criterion on the evidence ladder
   already used for skills (absent / mentioned / demonstrated in a role /
   demonstrated with an outcome), with the quote.
4. `anchor.ts` checks the quote: a pass or a rung above "mentioned" with
   no located quote becomes unknown or "mentioned" — the same rule as for
   every other kind.
5. Credit: pass 1, partial 0.5, fail 0, unknown leaves the denominator
   and lowers the confidence; a how-much answer takes the ladder's
   credits. Weight: HR's stars. A gate buckets.

Feasibility: this is exactly the shape of the gates the tool already
runs (a sentence, a status, a quote), so the prompt, the parser and the
anchor extend rather than change; the cost is ~30 tokens per criterion.
Quality: reading a question against a text is what a language model does
best — far better than any pattern a script could hold — and the quote
is what makes the answer checkable. Limits: 20 custom criteria per
rubric; a criterion that names a protected characteristic is refused at
save (§2.4).

Two kinds of custom criteria need a word in the editor:

- **Negative criteria** ("has not worked at a competitor", "no more than
  two employers in five years") — allowed as gates; the second is a
  trajectory fact the person may weigh, never a score.
- **Ambiguous ones** ("good communicator") — the model will answer from
  whatever the text offers, which is little; the editor's hint says so:
  *a criterion the resume cannot show becomes an interview question.*

### 3.7 The model's reading of the whole person, as a criterion

"Take everything in the resume into account" is the right demand and the
wrong instrument if it means "let the model produce the number". The
model already reads the whole text for every criterion; what the score
counts is only what HR asked. Two things close the gap without giving up
the table:

- An **`overall` criterion** — *fit for this role, as the model reads the
  whole resume against the whole posting* — answered on a five-step scale
  (exceptional / strong / partial / weak / none) with three reasons and
  up to three concerns, each anchored where it quotes. It is one row of
  the table with HR's stars on it (★★ in the Standard preset, more if HR
  trusts the read), so the model's holistic judgment moves the order
  exactly as much as HR says and is printed next to its reasons. A grade
  on five steps is what a model can give the same way twice; a number on
  a hundred is not (§8).
- **Stands out / concerns** (§5) — the facts the criteria did not ask
  for, shown, never scored.

### 3.8 What stays in code, and why it is not "a script comparing resumes"

Nothing about the judgment is scripted. The model reads every resume
whole and answers every criterion; it grades level, impact, the overall
fit; it compares a shortlist (§5.1). Code does four things only: sums
HR's weights over the model's answers, applies the caps HR flagged,
computes dates into years and recency, and keeps the order stable. The
reasons are measured, not doctrinal — see §8.

## 4. The posting in the loop

Today the screening page names the position and links to `/jobs/:id`;
the text is on another page and editing it there edits the candidate
side's `Job`, which the screening reads on every call.

- `Screening.postingText` — a snapshot taken at creation (from the Job)
  and editable on the screening page. The brief, the rubric draft and
  every call read the screening's text, never the Job's, so a screening
  is stable while the Job moves and an edit never leaks into the
  candidate side.
- A **Position** card above the rubric: title, company, location, the
  text folded under "Read the posting" (prose, not a textarea), **Edit**
  → a textarea and Save. On save: `postingUpdatedAt` is stamped and the
  page says "the posting changed after these scores — Re-read the rubric
  from it, or Score everyone again", with both buttons. Re-reading bumps
  the rubric version (everything stale, one press scores all); scoring
  again without a redraft keeps the rubric and re-reads everyone against
  the new text.
- The same card carries "what the posting says / what we check": the
  brief's role, seniority, years and sector beside the criteria that came
  from them, so an HR sees at a glance where the draft's numbers came
  from.

## 5. What the table shows beyond the score

Three things HR asked for by asking why the numbers were equal:

- **Stands out** — three facts per applicant the criteria did not ask
  for: technologies beyond the rubric, sectors, quoted numbers, a
  publication, open source. Written by the model, anchored, shown on the
  scorecard and as the row's expandable line. Never scored.
- **Trajectory** — from the dated roles, in code: years in the current
  role, average tenure, number of employers, currently employed or not,
  the sectors in order. Optional columns; a fact, never a penalty
  (ADR 0047).
- **Side by side** — tick two or three rows → Compare: one column per
  applicant, one row per criterion, the quotes under the marks. This is
  the view that answers "why is №15 above №22" for a shortlist, and it is
  where two versions of one document show their one real difference.

### 5.1 Compare with AI — the shortlist read head to head

The place where "let the AI compare the candidates" is right is the
shortlist, not the pile: two to five applicants who all passed the gates,
read together in one call. One-versus-one reading is what the model does
well and what a person cannot do for three hundred; and on five it costs
one call.

- Tick 2–5 rows → **Compare with AI** → one call carrying the posting,
  the criteria and the redacted texts, asking for: per criterion, who is
  stronger and why (with quotes); an overall order with a reason per
  place; what would decide between the top two in an interview.
- Position bias is real in listwise reading (the first and last slots
  win), so the call runs **twice with the order shuffled** and the page
  shows where the two readings disagree — a disagreement is information,
  not a bug.
- Stored as a `ScreeningComparison` row (the ids, the order they were
  shown in, the two replies), so it can be re-read and exported; never
  folded into anyone's score. The table's order stays the criteria's;
  the comparison is the argument for the shortlist meeting.
- Ceiling: 5 applicants, so the prompt stays under the resume model's
  budget (5 × ~2 000 tokens + the posting); above that the page says
  "narrow the shortlist first".

## 6. Stages

| Stage | What | Size | What it proves |
|---|---|---|---|
| A | `Screening.postingText` (snapshot, editable), the Position card, "posting changed" hint, Score everyone again; rename "Delete with files" → "Delete screening" with the confirm text saying the disk is untouched | 1 branch | the posting can be read, edited and re-screened without touching `Job` |
| B1 | Rubric v2: criteria schema, v1 → v2 migration on read, draft into criteria, presets, the protected-characteristic refusal, the editor with the **free-text criterion field** first | 1 branch | HR can say what matters, per vacancy, in their own words |
| B2 | Prompt v2 (criterion-driven, custom criteria answered with quotes, the `overall` five-step read), anchor per kind, score v2, scorecard v2 (criterion → answer → quote → points) | 1 branch | every point is a criterion's; the model reads everything, the sum stays a sum |
| C | Stands out + concerns + trajectory in code + optional columns + sectors per role | 1 branch | the table says what the score does not |
| D | Side by side for ticked rows, and **Compare with AI** on a shortlist of 2–5 (two shuffled readings, stored) | 1 branch | a shortlist can be argued from one page, by the model and by the person |
| E | Calibration: HR's decisions versus the order (agreement per screening), and the gold set from hr-screening-plan.md stage 0 when a human ranking exists | 1 branch | whether the criteria rank the way the person does |

A before B on purpose: the posting card is small, independent and the
thing the first user reached for first. B1 and B2 ship together or not
at all — a v2 editor over a v1 prompt would show criteria the model never
reads.

## 7. Open questions for the owner

1. **Presets** — the four above, or fewer? Each is a page of copy to keep
   honest.
2. **`custom` criteria as gates** — a free-text gate can be anything ("has
   worked at a FAANG"); the refusal list catches protected
   characteristics, nothing else. Is a warning on every custom gate
   ("a gate is a knockout — is this truly a minimum?") enough?
3. **Recency decay** for skills (`recentWithin`): default 36 months, or
   off unless set?
4. **Trajectory columns** — shown by default, or opt-in per screening?
   Tenure and employer counts are exactly the numbers a screener misreads
   as a penalty.
5. **The cover letter in a folder** — score it as a document of the same
   person (as now, 30 points), or recognise it and attach it to the
   resume as context? The second is better and one call cheaper; it
   needs a "this is not a resume" classifier that is a heuristic today.

## 9. Stage E — calibration, as built (2026-09-09)

**The question.** Stages B–D made every point a criterion's and every
mark a quote. What none of them can say is whether the criteria rank the
way the *person* does. The tool never writes a decision (ADR 0047), so the
person's decisions — To interview, On hold, Declined — are the one signal
about that, and they arrive for free as the screening is worked. Stage E
reads that signal and never acts on it: it says where the person and the
table part ways and which criteria tell the picks from the rest; changing
a weight or a row stays in card 2, by hand (ADR 0052).

**Three readings, all honest with small numbers.** A screening has four
to three hundred rows and decisions on a handful; any single number over
that would be noise dressed up. So:

1. *Pairs.* Every pair of applicants the person decided differently
   (interview above hold above declined): does the table order them the
   same way? Concordant against discordant, as Kendall's τ counts pairs —
   a percentage that means the same at 8 pairs as at 800, shown with its
   counts. A pair the person's ±30 adjustment turned concordant is counted
   separately: "3 of those only after your adjustments" says the rubric
   did not rank the way the person did and the correction carried it.
2. *The top.* Of k applicants marked To interview, how many sit in the
   table's top k — precision@k with k the person's own.
3. *The surprises.* An interview pick the table put below the top k, a
   declined applicant it put inside — each with the criteria behind the
   placing (a gate not passed, the heaviest criteria with the least
   credit; for a declined-high row, the criteria it scored on). This is
   the part a person can act on: the surprise names a criterion or a
   weight, and card 2 is where it is changed.

And per scored criterion, the mean credit among the interviewed against
the mean among the declined: a gap near zero means the criterion does not
tell the picks from the rest (a weight to lighten), a negative gap means
the declined scored higher on it (a criterion to question). Listed the
widest gap first, flat ones greyed.

**What is deliberately not done.** No automatic re-weighting: a rubric
that tunes itself to the decisions would learn the person's biases along
with their judgement, and the whole design of §2.4 rests on the criteria
being written, visible and defensible. No single "agreement score" on the
list page: a number with no counts beside it would be read as a grade. No
measurement below three decisions with both sides present.

**The gold set.** `npm run bench:screen` runs a folder — posting,
`rubric.json`, resumes, `ranking.txt` — through the exact redact → prompt
→ anchor → score path with nothing written, and prints Kendall τ and
precision@5 against the human's order, the score movement between two
runs (stability — the .docx / .pdf episode of §8 made this the number to
watch), the redaction leak check, the tailoring pairs and, with an
`expected.json`, the gate confusion. `src/screening/fixtures/gold/
qa-automation` is a starter of six synthetic resumes ranked by the author
of the fixtures; its τ says nothing until a recruiter ranks a set, which
is §19.4 question 5 and stays with the owner.

## 8. Why the number is a sum and not the model's — measured

The question behind "use AI for the comparison, scripts do not matter" is
whether the model should produce the score. It was measured on this
branch, 2026-09-09, on one redacted resume against one posting, Sonnet 5
through the Claude CLI, three identical calls each:

| Three identical calls (thinking off) | Result |
|---|---|
| The screening prompt → the model's marks → the score computed in code | 82, 82, 82 |
| Must-have part alone, computed (9 terms, 5 on the skills line only) | 22.5 / 35 each time |
| A holistic prompt: "read everything, return fit 0–100" | 92, 93, 92 |
| The same holistic prompt's five-step grade | exceptional, exceptional, exceptional |

Read honestly: on this pair the model's own number was nearly as stable
as the computed one — one point of spread, not ten. The candidate side's
history is the other case (gotcha 11: a Laravel resume at 82 against a
Node posting until the code took the arithmetic; `variance:compare`: one
sentence the model wrote or did not write was 80 % of a ten-point spread
on one pair), and thinking was off here; with it on, the number moves
more. What the measurement does show is the reason that matters more
than jitter: the holistic number sat **ten points above** the computed one
and called the resume *exceptional* — for a Playwright role, a resume
with Playwright, contract tests and an 8-year record, but with five of
nine must-haves on a skills line only and the "legally able to work in
Ukraine" gate unanswered. That is the flattering average gotcha 11
names, and no HR weight went into it: the model decided that Cypress
mattered less than Playwright, that recency mattered, that the gate did
not — decisions that belong to the person running the vacancy.

What it means for an HR table: a number the model produces cannot say
which criterion earned what, cannot take HR's stars, and grades on the
generous side; a number computed from the model's marks changes only
when a mark changes, and every mark carries its quote. That is why the
holistic read enters the table as a five-step *criterion* with HR's
weight (§3.7) — its grade was the most stable thing in the measurement —
and the head-to-head comparison lives on the shortlist (§5.1), and why
free-text criteria are answered one by one with quotes rather than folded
into one judgment.

## Sources

- The three layers: SHRM, *Screening and Evaluating Candidates* (the
  minimum / preferred qualifications split); Greenhouse structured-hiring
  scorecards (attributes rated per interview); EEOC *Uniform Guidelines
  on Employee Selection Procedures* (1978), §3–5 on job-relatedness.
- Selection validity: Schmidt & Hunter 1998; Sackett et al. 2022 (as in
  hr-screening-plan.md).
- Over-filtering: Fuller, Raman et al., *Hidden Workers* (HBS/Accenture
  2021).
- Law, to verify on the day: Labour Code of Ukraine art. 2-1, 22; Law of
  Ukraine "On Advertising" art. 24-1; Directives 2000/78/EC and
  2006/54/EC; Regulation (EU) 2024/1689 Annex III 4(a); Title VII; ADEA;
  Mobley v. Workday (N.D. Cal. 2025).
- In this repository: ADR 0044 (either/or groups), 0047 (evidence, a
  person decides; the adjustment addendum), 0048 (redaction and
  retention; the versions addendum), 0049 (a mode); CLAUDE.md gotcha 11.
