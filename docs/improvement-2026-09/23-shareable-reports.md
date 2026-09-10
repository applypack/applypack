# §23 — Shareable reports

**Verdict: drop as a feature; note that the pieces exist if a user asks.**

## What the plan proposes

Anonymised outputs to share on purpose — match report, search health, skill
demand, source performance, improvement delta — with explicit privacy
controls; an organic acquisition channel.

## What the repo has today

- The exports already exist as Markdown / CSV: "Copy all suggestions"
  (`change-sheet.ts:suggestionSheet`), "Copy my changes", the screening CSV
  and Markdown, the calibration Markdown, the comparison Markdown; the cover
  letter as PDF / DOCX.
- An anonymiser exists: `screening/redact.ts:redactApplicant` removes name,
  contacts, links, dates of birth, family, gender, citizenship, street,
  graduation years — built for the employer side, pure.

## Assessment

Sharing a match report is copying the Markdown that is already one button
away; the missing part is only the promise "nothing personal in it", which is
one pass of `redactApplicant` over the resume quotes. As an acquisition
channel it is a guess with no user asking for it, and PRODUCT.md is explicit:
*"Nothing on the surface persuades or markets; every screen serves a task."*

## Steps

None. If a user asks for a shareable report, the answer is a "Copy
anonymised" variant of the existing Copy buttons — a day, no new model.
