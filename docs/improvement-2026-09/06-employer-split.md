# §6 — Separate candidate and employer positioning

**Verdict: adopt (P2, site only, no version tag).**

## What the plan proposes

`applypack.dev/` stays the candidate page; employer functionality moves to
`applypack.dev/employers`; the main page keeps one secondary CTA — *"Hiring
instead? Screen resumes with ApplyPack →"*.

## What the repo has today

- `site/public/index.html:230–298`, section `#employer`: **626 of the page's
  2 007 words** (31 %), four feature cards, four screenshots
  (`img/screening-*.webp`, 8 files), placed between the scoring section and
  the founder story. The nav has an "Employers" link to it.
- README has its own "Employer mode" section with the legal note; the site
  section links there.
- ADR 0049 says employer mode is *a mode, not a product*; PRODUCT.md and
  DESIGN.md do not mention it at all (a drift noted in the audit report).

## Assessment

The plan is right and the numbers say so: a candidate reading down the page
meets the employer's four cards before the founder's one paragraph, and a
third of the words are about the side of the table the visitor is not on.
Splitting also gives the employer page room for what the README carries
today (the legal note, the applicant notice) without lengthening the
candidate page.

Cost: one static HTML file that reuses `style.css` and the existing
screenshots, one CTA line, nav change, `robots.txt` / canonical / OG for the
new page. Half a day. No product code.

## Steps → TASKS §20, block `site-employers`

1. `site/public/employers/index.html`: the `#employer` section as it is, plus
   the README's legal note and the applicant-notice paragraph, a link back to
   the candidate page, canonical + OG.
2. Candidate page: replace the section with one secondary CTA under `#score`
   (*Hiring instead? Screen a folder of resumes →*); nav "Employers" points
   to the new page.
3. Optional in the same pass: the §5 contrast graphic beside the four theses;
   the §7 "Not our cloud" three-liner if it replaces rather than adds words.
4. Re-run the site checks the 2026-09-02 pass used (Lighthouse mobile, the
   `source-count.test.ts` guard still passes on `index.html`).
