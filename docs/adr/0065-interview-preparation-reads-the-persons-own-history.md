# 0065 — Interview preparation reads the person's own history, for one posting

**Status:** Accepted (2026-11-14). Builds on
[0009](./0009-web-tools-only-for-verification.md),
[0022](./0022-prompt-fences-for-untrusted-text.md),
[0042](./0042-company-facts-are-context-never-evidence.md) and
[0061](./0061-the-interface-speaks-several-languages.md).

## Context

ApplyPack went quiet once an application reached an interview. The evening
before one was done by hand: guess what will be asked, dig through old notes
for a project that answers it, write the answers into yet another file. A
person who has worked on many projects forgets most of what would have
answered the question.

The owner asked for the smallest thing that removes that evening: a place to
keep what happened at work, and for a posting they are working on, the
questions likely to be asked with answers built from what they wrote. Two
conditions came with it: the notes may be in any language, and the person
chooses the language the interview is held in.

A larger design was written first (roles, projects, stories, standing
answers, debriefs, web research, a practice mode). None of it is needed to
find out whether the core is useful, so none of it is built.

## Decision

1. **Two tables, nothing else.** `career_note` (a title and a text) is the
   person's history: global, like `CandidateFact`, typed or read from a
   file (.md, .txt, .docx, .pdf). `interview_prep` holds one preparation per
   job; preparing again replaces it.
2. **It lives on the job page.** A sixth tab, **Interview**, shows the
   preparation and the history under it. There is no page of its own and no
   menu item: the feature exists for the posting in hand.
3. **One call, on a press, from stored inputs.** The prompt reads the
   posting, the notes, the resume the person picked (or none), the skills
   they confirmed and the company snapshot of the last verification. It
   searches nothing: `webTools` stays the verification's alone (ADR 0009).
   A visit to the tab spends no call.
4. **The person's material is the only evidence about them.** The posting
   and the company snapshot decide which questions are likely; they are
   never a fact about the candidate (ADR 0042). Two rules are code, not
   prompt (gotcha 11): a source an answer names must be a note's own title
   or the resume, and a figure in an answer that the notes, the resume and
   the confirmed skills do not state is marked "check before you say it".
   The check reads digits, so it holds in every language. It marks; it does
   not rewrite or block.
5. **The language of the interview is a choice per preparation**, from a
   list wider than the interface's own. The questions, the reasons and the
   answers are written in it; the page around them stays in the reader's
   language, and what the model wrote is marked with its language in the
   markup. The notes are sent as written.
6. **Staleness is said, not hidden.** A preparation stores a hash of the
   posting and the notes it read; when either changes the tab says so and
   offers to prepare again.
7. **A new ledger feature, no new task.** `interview-prep` belongs to
   Resume analysis (ADR 0060) and reads the resume model slot.

## Alternatives considered

- **Structured rows (roles, projects, STAR stories).** More to fill in
  before the first answer, and a model reads free text as well as fields.
  Rejected until notes prove too loose.
- **The fact gate of the cover letter (`fact-check.ts`).** It reads English
  and blocks; here the text may be in any language and a talking point is
  not a sent document. The digit check covers the costly failure, an
  invented number, and leaves the rest to the person reading their own
  history.
- **Web research for interview questions.** Slow, bound to the engines that
  can search, and thin for small companies. The stored verification already
  carries what a search found about the company. Left for later, with its
  own decision.
- **Vectors.** A career's notes fit in one prompt; nothing needs retrieving.

## Consequences

- Notes are personal data in the person's own database; a backup and a SQL
  dump carry them. They leave the machine only inside the call to the
  engine the person chose.
- One preparation reads the notes changed most recently up to a ceiling
  (120 000 characters); past it the tab says how many were read.
- Without a note and without a resume there is nothing to answer from, and
  the press is refused with that sentence.
- The answers are as good as the history. An empty history gives answers
  from the resume alone, each saying what to recall.
