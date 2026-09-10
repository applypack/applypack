# §13 — A short product GIF / video

**Verdict: adopt (P3, assets only). The site does not need it — the live demo is better — but the README, the launch drafts and social cards cannot run a demo.**

## What the plan proposes

A 15–25 s silent loop: new job → match score → missing evidence → resume edit
→ score improves → cover letter → applied; used on the homepage, README, DEV
article, LinkedIn, launch posts, docs.

## What the repo has today

- No `.gif` / `.mp4` / `.webm` anywhere in the tree.
- README's hero is a static `docs/screenshots/target.png` (2026-09-05).
- The landing hero holds the live demo; `docs/launch/*.md` lead with the demo
  link; `docs/brand/social-card.png` is static.
- The session has browser tooling (the in-app browser and the Playwright
  plugin) that can drive `/demo/` and the dashboard and capture frames.

## Assessment

A loop that shows the score move while a word is typed is the one thing a
README cannot otherwise show; a full seven-stage story (job → letter →
applied) in 20 s is too much and would be stale after the next release. Make
the short one from the demo page (nothing private on it, a synthetic fixture),
and keep it to the three moves the hint already scripts: type Redis (score
up), type Terraform (nothing), delete TypeScript (the cap bites).

## Steps → TASKS §20, block `demo-loop`

- [ ] Record `/demo/` at 1280×720, the three scripted moves, ≤ 20 s, as
      `.webm` + a `.gif` under 3 MB → `docs/screenshots/demo-loop.*`.
- [ ] README: the loop above the static screenshot (keep the PNG for the
      `alt`-text and for renderers that block animation).
- [ ] Launch drafts: mention the loop next to the demo link. The site keeps
      the live demo; no video there.
