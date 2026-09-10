# §9 — Clarify local vs self-hosted

**Verdict: done on the page; two metadata strings still lead with "self-hosted" (P3, one-line edits).**

## What the plan proposes

Prefer "Runs locally with Docker", then "Run it on your laptop. Move it to a
VPS later if you want."; keep "self-hosted" as a secondary descriptor.

## What the repo has today

- Hero trust list: *Runs locally or in Docker*. Sub-line: *On your own
  machine.* README: *"`docker compose up` on a laptop or a $5 VPS is the whole
  deployment."*
- "self-hosted" occurs 4× on the landing and 2× in the README — as a
  descriptor, not the lead.
- Still leading with it: `<meta name="description">` (*"Free, self-hosted job
  search: …"*, `index.html:7`) and `package.json` `description` (*"Self-hosted
  AI console …"*), which is also what npm/GitHub tooling shows.

## Steps

Fold into block `metadata-drift` ([15-metadata-consistency.md](./15-metadata-consistency.md)):
when the package description is corrected for the source count, open it with
"Runs locally with Docker" and keep "self-hosted" in the body; same for the
meta description.
