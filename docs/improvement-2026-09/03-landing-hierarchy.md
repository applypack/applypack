# §3 — Simplify the landing page

**Verdict: mostly done; one real item remains and it is §6 (move the employer section off the page).**

## What the plan proposes

Hero → interactive demo → Find / Verify / Match / Tailor / Track → why the
scoring is trustworthy → privacy → short video → founder proof → open source →
install. Everything else behind progressive disclosure.

## What the repo has today (`site/public/index.html`, 2 007 words)

| Order on the page | Section | Words |
| --- | --- | --- |
| 1 | Hero **with the live demo inside it** and the "Type Redis" hint | — |
| 2 | `#why` Why a strong resume gets filtered | short |
| 3 | `#what` Three things it does for you (find / fix / letter, then "and the rest") | — |
| 4 | `#how` five boxes (33 sources → base filter → AI classifier → your Postgres → Telegram) | short |
| 5 | `#score` Scores you can argue with (four theses + ADR link) | short |
| 6 | `#employer` The other side of the table | **626 (31 % of the page)** |
| 7 | `#story` I built this during my own job search | short |
| 8 | `#open` Free, open source, yours to bend | — |
| 9 | `#install` Install in four commands | short |

That is the plan's order already, except: privacy has no section of its own
(it sits in the hero trust list, in `#how` and in `#open`), there is no video
(§13), and the employer block is the longest thing on the page and sits before
the founder story.

## Assessment

The 2026-09-02 rewrite did this work; the plan describes the page as it was
before that. What is left is one structural fault, the employer section — the
plan's own §6 — and the missing video, §13. A separate privacy section (§7)
would repeat three sentences already on the page.

## Steps

See [06-employer-split.md](./06-employer-split.md) and
[13-demo-gif.md](./13-demo-gif.md). Nothing else.
