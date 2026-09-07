# 0044 — The posting is read once, on its own, and the reading is kept

**Status:** Accepted (2026-09-06)

## Context

Every comparison was one call that did three jobs at once: extract the
posting's keywords, judge them against the resume, and write the edit
suggestions. Three failures on a live row (match 13, "Web Development
Specialist" vs a senior full-stack resume) trace back to that shape.

**The frame drifted, so it was hand-stabilised.** Because keywords were
re-derived from the description on every run, comparing resume v2 with v1
compared two keyword lists as well as two resumes.
`keyword-frame.ts:planKeywordFrame` exists only to carry the previous
run's terms forward — a workaround for a call that should not have been
re-answering a question about the posting in the first place.

**Nothing ever characterised the posting.** The rules asked for terms,
levels and a primary stack. They never asked what the role *is*: its
discipline, its seniority band, the industry, the product, who reads the
resume first, or what that reader would be impressed by. Suggestions were
therefore written blind to the audience — the report's two actions were a
hedge on the title ("Consider adding 'Web Developer' framing…", no
wording) and one summary rewrite, on a resume whose title graded `off` and
whose most recent role graded `partial`.

**Either/or requirements were charged three times.** "Proficient in …
frameworks like React, Next.js, or Vue.js" is one requirement; the model
returned three `must` keywords, and `score.ts` charged three must-weights.
The same happened to "PHP, Python, or Node.js" and to "content management
systems (e.g., WordPress, Drupal, Shopify)". On match 13 that was 12 of 66
weighted units lost on requirements the resume either met outright or
failed once.

A posting does not change while its reader edits a resume. The reading of
it was the one part of the call that never needed repeating, and it was
the part being repeated every time.

## Decision

1. **The brief is its own call, with no resume in the prompt.**
   `buildBriefPrompt` sends the posting and nothing else, so the answer is
   a property of the POSTING: the role (posted title, discipline,
   seniority, minimum years, what the person does daily), the company
   (industry, product, audience, stage), the screening block (who reads
   first, what they scan for in six seconds, what a bullet that impresses
   them looks like, what gets a resume set aside), the requirement groups,
   the keyword frame and the gates. Nothing in it describes a candidate,
   and no status, grade or gate is decided there.

2. **It is stored against the posting text.** `posting_brief` is keyed by
   `jobId + postingHash + promptVersion`, where `postingHash` covers title
   and description — so a description refreshed from the company's own
   listing (ADR 0043) asks for a new brief rather than reusing a reading of
   text the posting no longer shows. `BRIEF_PROMPT_VERSION` is separate
   from `PROMPT_VERSION`: a change to the match rules must not throw away
   every stored reading. The second comparison of an edited resume pays one
   indexed lookup instead of a model call, and the progress page says so.

3. **The brief IS the keyword frame.** When a brief is present the match
   copies `term` / `priority` / `requirement` / `primary` / `group` and
   judges only `status` / `where` / `aliases` / `note`; `previousKeywords`
   is not sent at all, because two answers to the same question is worse
   than one. `planKeywordFrame` and the user's own overrides
   (`carryOverrides`) are unchanged and still ride on top — the brief
   decides what the posting says, the user decides what to do about it.

4. **An either/or group is one requirement.** Keywords carry the group
   label the brief gave them, and `foldGroups` collapses same-label entries
   to one before the formula runs: the strongest level among them, the best
   credit, one primary slot. Only a `satisfy: "any"` list is a group — "HTML,
   CSS and JavaScript" arrives as `all` and stays three demands. And because
   the fold is the one place a model-written string moves the number,
   `reconcileGroups` checks every label against the brief at persist time: a
   label the brief did not write, or one on a term its group does not name, is
   dropped, and a comparison with no brief carries no groups at all.
   `SCORING.version` goes to 4 and the fold is mirrored in `score.mjs`
   (parity test as ADR 0012 requires). Scores from before this are not
   comparable with scores after it, and that is the point: the old ones were
   wrong in a direction that punished honest resumes.

5. **The advice has a floor, not only a ceiling.** "NO TREADMILL" is
   replaced by REQUIRED COVERAGE: an alignment grade below `strong` on the
   title, the summary or the most recent role must produce a high-priority
   action *with wording*, and a must-level keyword that lives only in a
   skills list must produce an action that puts it in a bullet. The
   anti-padding half survives verbatim — an edit still has to change the
   outcome. A `cannot_claim` keyword still never enters a replacement as
   experience, but it may be the *reason* for an honest edit; the retitle
   case below is why that distinction had to be drawn.

6. **The posted title on the headline is not a fabricated claim.**
   `gateActions` exempts a priority-2 keyword (the posted job title) on an
   action whose section is `title` or `summary`. Writing the role one is
   applying for on one's own headline is ordinary tailoring; blocking it made
   the single highest-leverage edit on any resume unreachable, which is how
   match 13 ended up with a hedge instead of a rewrite. Inside a bullet
   ("Web Developer at Acme") it would be a claim about the past, so the
   exemption stops at those two sections — and every other keyword blocks
   everywhere, as before.

7. **Removal quotes are gated in code.** Gotcha 11's second lesson was
   paid for once with prompt text and broke again: the model quoted
   `"Symfony, React, Vue, Laravel, Lumen, Phalcon"` whole to advise
   dropping three of the six, with React (must, primary) and Vue.js (must)
   inside the struck-through span. `gateRemovals` mirrors `gateActions`: a
   quote covering contact details or a wanted keyword loses its `quote`
   and keeps its advice, so nothing is highlighted and nothing is deletable
   in one press. The rule is a unit-tested code path now, as ADR 0012 made
   the primary-stack gate one.

## Consequences

- **One more call on a posting's first comparison — in both modes.** The
  brief is the shortest prompt of the family and the only one with no resume
  in it, but it is not free, and the quick check is the path the user waits on
  (ADR 0029). It runs there anyway: the groups are what make the quick check's
  score honest, and a `fast` row that scored a posting differently from a
  `full` one would be worse than a slower first run. It is paid once per
  posting text; the run shows it as its own step, and a reused reading
  finishes instantly with the line that says so (22 s, then 3 ms, on the live
  row). The tradeoff was taken deliberately: a comparison that takes longer
  and reads the posting properly beats a fast one that does not.
- **The full report and the suggestions call got longer.** Their budgets
  went to 12 000 and 10 000 answer tokens (still inside the headroom rule
  of gotcha 16), the suggestions timeout to 180 s, and `BE FAST` became
  `BE COMPLETE, then brief` on both — the quick check keeps `BE FAST`,
  since that is the path the user waits on.
- **Stored scores shifted.** A resume that met an either/or requirement
  now keeps the weight it always deserved. Rows written before v8 carry no
  groups, fold to themselves, and score exactly as they did.
- **The KEEP WANTED KEYWORDS block got narrower.** A rewrite that drops a
  term the resume still carries outside the quoted span now warns instead of
  blocking: nothing is lost, and the rule as written killed a good rewrite of
  a bullet whose one "SQL" was the phrase "SQL injection".
- **A bad brief degrades, it does not break.** Every consumer treats a null
  brief as "no brief": the match derives the frame itself as before, the
  suggestions aim at the posting's requirements as before. A stored brief
  that no longer parses is rewritten rather than trusted.
- **The brief is untrusted text.** It is a model's reading of an
  outsider's posting — ADR 0022 tier 2 — so it is fenced in both prompts
  that read it, and the fence registry guards it.

---

## Addendum, 2026-09-06: what a keyword is, and what the cap asks

Two defects surfaced together on a live session, and both come from the same
place: the keyword list is not just displayed, it is **scored**, and it is
turned into "+ add" chips that offer to type a term into the user's skills
line. A row that is not a term is bad advice with a number attached.

**A keyword is a thing a recruiter would search for.** Measured over six
comparisons, 12 of 42 distinct keywords were not terms: two were gates in
disguise (`5+ years of experience`, `Bachelor's Degree` — both `must`, both
worth three weighted units, both offered as something to add), and the rest
were fragments cut out of a responsibility line (`0 to 1`, `troubleshoot`,
`landing pages`, `product sense`). The old rule invited exactly this: it told
the model to reduce a long requirement to "its shortest distinctive verbatim
phrase", which is how a duty becomes a keyword. `RULE_KEYWORDS` now states the
test — *would a recruiter type this into a search box?* — and lists what is
never a keyword: a duty, a quality, a quantity, a requirement about the person
rather than their skills. `keyword-shape.ts:dropMalformedKeywords` is the floor
under it, in code where the score can see it: a years-of-experience or degree
shape, a bare quantity, or more than five words is dropped. A keyword the user
typed themselves is never dropped.

**`present` has to be findable.** The browser re-checks that status on every
keystroke — the live estimate credits a term by finding it in the text, and the
missing-keyword chips are exactly the terms it could not find. A `present` the
matcher cannot see makes the page contradict itself. 5 of 137 present keywords
were paraphrases ("automated testing" against "Unit, integration & E2E
testing"); `keyword-anchor.ts:anchorStatuses` turns those into `add`, which is
what they are, and the chip they now get is correct advice.

**The primary cap asks whether the candidate HAS the stack.** Folding an
either/or group (§4) can leave a primary stack of one, and `primaryCap(0, 1)`
is 30 — so the whole score rode on whether one keyword was called `present` or
`add`. A live pair scored **79 with TypeScript `present` and 30 with the same
resume and the same TypeScript called `add`**; a second independent judgment of
that pair produced the same flip. `SCORING.primaryCovered` now counts `add` as
coverage. Sibling technology is forbidden from `add` by the rules gotcha 11 put
in the prompt, so this does not re-open that hole — the gold bench's
"stack mismatch stays capped ≤30" and "Node.js not claimable from PHP" both
still pass. Half the keyword credit stays the penalty for a word that is not
written down, which is the right size of penalty for a word that is not
written down.

**And the words on screen.** `no evidence` read as a verdict on the person and
told them nothing to do; `add` was labelled `missing`, which hid the easiest win
on the page. The four statuses now describe the candidate's side of each term —
*in your resume · add the word · do you have it? · missing* — with the
requirement level in the column beside them, so "missing" next to "must" says
the thing the user needs to hear.
