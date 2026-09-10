# §14 — Improve GitHub README conversion

**Verdict: done in the 2026-09-02 refresh; only the §13 loop and the §15 numbers touch it.**

## What the plan proposes

Open with name → workflow line → screenshot/GIF → "Free · Open Source · Local
· No Accounts" → Try demo | Install | Documentation → "Why ApplyPack?" → then
the detail.

## What the repo has today (`README.md`, 595 lines)

1. Centred name + one-line promise, six badges (CI, live demo, MIT, Node,
   TypeScript strict, release).
2. Quick-links row (Quick start · What you get · How it works · Bring your
   own AI · What it costs · Contributing).
3. Hero screenshot with a real caption.
4. Three paragraphs of "why" and the three pillars, each with the demo link.
5. The founder line, then privacy / MIT / bring-your-own-AI in one paragraph.
6. `<details>` "The whole list, one line each" — 17 rows — the progressive
   disclosure the plan wants.
7. Quick start (four commands, "nothing to fill in yet").

## Assessment

That is the plan's structure, already shipped. The only fault the plan names
that still holds — a static picture where a loop would convert better — is
§13.

## Steps

None of its own; [13-demo-gif.md](./13-demo-gif.md) swaps the picture,
[15-metadata-consistency.md](./15-metadata-consistency.md) keeps the numbers
honest.
