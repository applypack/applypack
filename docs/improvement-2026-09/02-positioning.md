# §2 — Product positioning

**Verdict: drop — decided on 2026-09-02, and the plan's alternatives are weaker.**

## What the plan proposes

Keep the pain headline but add a broader tagline: "Your open-source job-search
command center" / "An open-source operating system for your job search" /
"Find the job. Check the fit. Fix the resume. Track the application."

## What the repo has today

- `site/public/index.html:50` — H1 "Stop losing interviews to a missing
  keyword." The line under it already widens the frame: *"ApplyPack finds real
  openings, shows exactly which words a posting wants and your resume lacks,
  helps you fix it in place, and writes the cover letter. On your own machine."*
- `<title>` is "ApplyPack: open-source job search and ATS resume check";
  `og:description` names find / score / letter / free / open source / on your
  machine.
- The choice was made in [site-refresh-plan.md](../site-refresh-plan.md) §A:
  no numbers in the H1, the pain first, the product in the sub-line, and it
  shipped with TASKS §14.

## Assessment

"Operating system for your job search" and "command center" are the kind of
line every AI job tool uses; they say nothing a visitor can test. The current
sub-line does the plan's job in the plan's own order (find → fit → fix →
letter). The one thing the plan gets right — a visitor must see the workflow
on the first screen — is already true: the hero contains the live demo.

## Steps

None. If the H1 is ever revisited, do it with measured traffic (TASKS §14's
open "Cloudflare Web Analytics baseline" item), not by taste.
