# applypack.dev + README refresh — analysis and plan (2026-09-02)

> Two analyses in one file, written before the `site-refresh` branch was
> started. Part A is content and structure, part B is design, mobile and
> code. Everything was measured against the live site on 2026-09-02
> (Lighthouse 12 from a local Chrome; the PageSpeed API had exhausted its
> daily quota). Product state at the time: v1.18.0. Part C is the log of
> decisions taken while building.

## 0. Verdict in 30 seconds

- **The content froze on 2026-08-31.** `site/public/index.html` was last
  touched on 2026-09-01 (repo URL only); the screenshots date from
  2026-08-31. Eighteen releases shipped since, and the page mentions none
  of them and about half of what came before.
- **The bigger fault is the order of thought, not staleness.** The hero
  sells "self-hosted" (a deployment model), not an outcome. The three main
  things (find jobs, fix the resume, write the letter) drown among nine
  identical cards. Open source is one footer link. There is no "I found a
  job with it".
- **The live demo at `/demo/` is the strongest asset** and sits behind the
  second button. It belongs in the hero: type "Redis", watch the score
  move. That is the "wow", and it is already written.
- **Technically the site is almost clean** (SEO 100, best practices 100,
  a11y 92) but slow on a phone: mobile performance 75, LCP 4.8 s, from one
  422 KB PNG and a render-blocking Google Fonts stylesheet. An hour of work,
  no redesign needed.
- **Mobile is the desktop squeezed into a column:** navigation hidden with
  no replacement, a 1720 px screenshot in 340 px, the third hero button
  overflowing, pipeline arrows between stacked rows, buttons under 44 px.
- **Sober numbers:** GitHub saw 524 views from 18 people in 14 days;
  applypack.dev referred 4 of them. The redesign must pair with the
  distribution drafts in `docs/launch/`, which still say "I'm mid job hunt".

---

## Part A — content and structure

### A1. Audit of the current page

The live HTML is byte-identical to `site/public/index.html`, so the repo is
what gets fixed.

| Block | Now | Problem | Decision |
| --- | --- | --- | --- |
| Title, description, OG | "The whole job search, self-hosted" | Sells the deployment model. None of the words people search for: ATS, resume keywords, open source, cover letter. | rewrite |
| Nav | What you get · Honest scoring · Quick start · GitHub | No Demo, no Open source. | rewrite |
| Hero | H1 + 3 buttons + full target-page screenshot | The pain is unnamed. The screenshot is too dense to read at hero size. The demo is the second button. | rewrite |
| "What you get" | 9 emoji cards, a paragraph each | Equal weight for everything: Telegram next to the resume editor. Emoji as section markers. | three pillars + "and the rest" |
| "How it works" | 5 boxes with arrows | Correct, answers "how", not "why". Keep, compress, make it an ordered list. | keep |
| "Scores you can argue with" | 4 theses | Best copy on the page; the Overview screenshot next to it is unrelated. | keep, swap the visual for the demo |
| Quick start | 4 commands, `# add one AI engine key` | Stale since v1.8: the key is pasted in the dashboard, nothing to fill in before the first boot. | update |
| Engine chips | 5 engines | Still true. | keep |
| Footer | GitHub · Releases · Contributing · Security · "MIT licensed" | The only place that says open source. | add a section |
| `/demo/` | Live score on the Fernway / Dana Ruiz fixture | 90-word intro; no install CTA after the demo; CSS lacks the v1.17 weight-tier classes `kw-w0…kw-w4` that the vendored `target.mjs` already emits. | update |
| Screenshots | target/jobs/overview from 2026-08-31 | target.png predates the v1.17–1.18 keyword table; jobs/overview in `docs/screenshots/` are newer than the site copies. | reshoot |

### A2. What the site does not mention

Grouped by the three pillars. Version in brackets.

- **Finding jobs:** several searches at once, up to eight, one AI call per
  posting (1.10); the `/welcome` first-run wizard (1.7); "Fetch now" (1.6);
  the AI key pasted in the dashboard (1.8); the free liveness check before
  any AI verification (0.3); company starter packs (0.5); "also listed
  elsewhere" (0.6); source health (0.7).
- **Resume:** quick check by default with suggestions as a second call
  (1.16); instant estimate on re-upload, no AI (1.15); per-keyword overrides
  (1.17); rebuild keywords (1.18); matcher tolerant of spellings, plurals
  and separators (1.14); one-call compare with free repeats (1.13); which
  resume version an application went out with (1.11); resume strength
  review (1.19).
- **Letters and the rest:** the `/letter` page for a posting not stored yet
  (URL or pasted text); one model call, ~30 s to a letter; the applications
  board with custom columns and drag-and-drop (1.3–1.4); the
  prompt-injection fence; search ↔ resume linking (1.9).

Not all of it goes on the site. Each pillar takes 3–4 lines; the rest is
one compact list.

### A3. What the site must say

| Requirement (owner's brief) | On the page |
| --- | --- |
| Companies screen with AI/ATS; strong candidates lose on a few keywords | The first screen. H1 names the pain, the subtitle names the cure. A three-line "why a strong resume gets filtered" block below, first person, no internet statistics. |
| The main things: search, resume, letters | Three full-width rows of text + screenshot, 3–4 lines each. Everything else in one compact list. |
| Find real, non-fake jobs faster | In the search pillar: 22 sources hourly, strict classifier rules, free liveness check, verdict with evidence. "Checks the job is real, with evidence", never "guaranteed". |
| Apply after checking and editing the resume | The resume pillar leads to the live demo: code computes the score, the model only marks facts, editing next to the posting costs no AI. |
| Free, open source, anyone can join, any idea | A section before Install: MIT, no accounts or telemetry, bring your own AI, three ways in for contributors, the feature-request template. Plus "open source" in the title and the trust line. |
| "I found a job with it, and you can too" | A first-person section with a date and 2–3 real counters from the Overview. The only block that cannot be written without the owner's facts. |
| Readable, no filler, "I want to try this" | Two sentences per paragraph at most. One thought per screen. The demo in the hero instead of a screenshot. No emoji markers. Larger H1. |
| Open, easy to bend | In the open-source section: 962 unit tests, an ADR per decision, CLAUDE.md with the where-to-look map, three fetcher templates. "A first change takes an evening, with an AI assistant or without." |

Copy rules: English, as now. Only numbers verifiable in the repo or measured
in CHANGELOG (22 sources, 5 engines, 962+ tests, quick check p50 15 s,
instant check ~30 ms). No "75% of resumes are rejected by ATS": it has no
reliable source; first-person experience instead. "Free" is about the
software; say the AI honestly (a subscription, a key, or a local model at
zero). No "guaranteed", "10× faster", "revolutionary".

### A4. The new landing, section by section

Order is the argument: pain → what it does → proof → story → openness →
install. Drafts in English, to be replaced by the owner's words where marked.

1. **Hero: pain and cure.** H1 ≤ 8 words about the pain, subtitle ≤ 25
   words about the three things, two buttons, a trust line. Visual: the
   **embedded live demo** (score, missing-keyword chips, resume editor on
   the Fernway / Dana Ruiz fixture); the posting pane collapses on phones.
   Fallback: a tight crop of the target page with a play button to `/demo/`.
   Nav: Demo · What it does · Open source · Install · GitHub.

   > **Stop losing interviews to a missing keyword.**
   > ApplyPack finds real openings, shows exactly which words a posting
   > wants and your resume lacks, helps you fix it in place, and writes the
   > cover letter. Free and open source, on your own machine.
   > [Try the live demo · no signup] [Install in four commands]
   > No ads · No payments · No accounts · Runs locally or in Docker · MIT

   H1 alternatives: "Your experience is real. Make the resume filter see
   it." / "Find real jobs. Fix your resume before the robot reads it."

2. **Why a strong resume gets filtered.** Three theses on one line, no
   shouting headline; the place for the owner's ATS story, not statistics.

   > **The filter counts words, not years.** A resume that says "PHP 8,
   > Laravel, Symfony" can miss a requirement that says "PHP", and a
   > recruiter never sees it.
   > **Half the postings are noise.** The wrong stack in paragraph four,
   > "Remote" that means remote in Germany, a listing nobody will ever fill.
   > **You end up being the cron job.** Refreshing boards, reading, guessing
   > what to change, rewriting the letter. ApplyPack was built during my own
   > search to take that over.

3. **Three pillars.** Full-width rows alternating text and screenshot; each
   answers "what do I get", not "how does it work".

   *Find real jobs, not noise* — 22 sources every hour: ten ATS vendors on
   the companies you pick, eleven aggregators, the monthly HN thread; starter
   packs add a whole segment at once. A classifier with rules that burned
   me: "full-stack" in a title is not a stack match, "Remote · Germany" is
   not US-remote; up to eight searches at once, one AI call per posting. Is
   it real? A free liveness check first, then a web-search verdict with
   evidence links: legit, suspicious, fake. Telegram only above your fit
   threshold; paste a posting from anywhere and it gets the same treatment.

   *Fix your resume for this posting. Honestly.* — Every keyword the
   posting wants, graded must / preferred / nice and marked present, missing
   or confirm-with-you. The model marks facts, code computes the score: no
   core-stack overlap caps it at 30, Vue is not React, typing a word is not
   evidence. Edit side by side with the score updating on every keystroke,
   free of AI calls; re-check with AI in about 15 seconds; save as v2 and the
   delta against v1 is real. Disagree with the model? Re-level a keyword,
   ignore it, add the one it missed, or rebuild the list; your edits survive
   every re-run.

   *A cover letter that cannot invent* — Drafted from the posting, your
   resume and the facts you confirmed, nothing else. A fact gate reads every
   claim back against that evidence; a number that is not in your resume
   never reaches the letter. Pick a tone, add your own angle, about 30
   seconds; edit in place, export PDF or DOCX. Works for a posting that is
   not stored yet: paste it or give the URL.

   *And the rest* (one line each): applications board with columns you name,
   drag and drop, which resume each application went out with, a nudge when
   one goes quiet · guided first run · five AI engines with failover
   (Claude Code, Gemini and Codex CLIs on subscriptions you already pay for,
   the Anthropic API, any OpenAI-compatible endpoint including free local
   models) · postings cannot hijack the prompt · board discovery from HN ·
   daily digest and source health · private by construction (localhost, no
   accounts, no telemetry, your own Postgres).

4. **Scores you can argue with.** The four theses from the current page,
   nearly verbatim. If the demo is in the hero, this section links to the
   full demo instead of repeating it.

5. **"I built this during my own job search. It found me a job."** First
   person, dated, with two or three real counters. Cannot be written
   without the owner's facts: month, whether to name the employer, how long
   the search took with the tool, counters from the Overview (postings
   fetched, alerts, applied). "And you can too" is better left unsaid: "It
   is the same tool you install, unchanged" says it without a promise.

6. **Free, open source, yours to bend.** MIT, no hosted version, no
   accounts, subscription or telemetry; bring your own AI. Built to be
   changed: 962 unit tests on the pure modules, a decision record for every
   non-obvious choice, a CLAUDE.md that says where everything lives. Three
   ways in: add a job source (close to a one-file change, three templates),
   take a good first issue, bring an idea (feature template; if it fits the
   sourcing policy it can land here). Buttons: Read CONTRIBUTING · Open an
   issue · Fork on GitHub. **Blocker:** zero open issues carry the
   `good first issue` label while README already links there.

7. **Install.** The four commands with v1.8+ comments (`# nothing to fill
   in yet`, `# → http://localhost:4747, a four-step setup opens`), then:
   "Paste an AI key on the first screen. Fetching starts paused until you
   finish the setup, so a blank profile never burns your quota. A laptop or
   a $5 VPS is the whole deployment." Engine chips as now, plus the honest
   note about consumer-subscription terms that README carries and the site
   did not.

8. **Footer.** GitHub · Releases · Changelog · Contributing · Security ·
   "Built by Nazar Boyko" · MIT. No star counter until it is an argument.

### A5. Visual language

This is a rewrite of the page, not a rebrand: emerald, Inter, light theme,
hairline borders stay, so dashboard screenshots look native on the site.

- "Wow" comes from motion with meaning: the live score in the hero
  reacting to typing; a pipeline strip where one posting travels fetched →
  filtered → 92 → Telegram (CSS keyframes, static under
  `prefers-reduced-motion`); a delta counter 54 → 82 when it enters the
  viewport. Three things, not ten.
- Type larger and shorter: H1 `clamp(40px, 6vw, 68px)`, tracking −2%,
  subtitle ≤ 35 words, two sentences per paragraph. Pillars as alternating
  rows instead of a 3×3 grid.
- No emoji markers. Either 16 px inline SVG glyphs or none at all.
- Screenshots reshot on the synthetic Fernway / Dana Ruiz pair at 1440 px,
  2×, cropped per row; a full page only for the OG card; nothing real in
  frame.
- Demo on phones: one pane (resume) with the score and chips, the posting
  behind a button. Check at 375 / 768 / 1440.
- Zero dependencies and zero build step, as now. The embedded demo reuses
  `demo/demo.mjs`: same element ids, fixture path `demo/fixture.json`, the
  weight-tier CSS carried over from `src/web/pages/target.tsx`.
- Dark theme stays out of this stage (PRODUCT.md pins light; the tokens
  allow it later).

### A6. README

README is 20 KB and 330 lines; the pitch is there, but the 14-row "What you
get" table gives everything equal weight and open source comes last. The
top 60 lines should repeat the site; the deep sections stay below.

- New top: name + the tagline the site uses → the problem in three
  sentences → three pillars, two lines each with a demo link → two
  sentences "built during my own search, found my job with it" → Quick
  start unchanged → "Free and open source, contribute" moved up from the end.
- The "What you get" table shrinks to 8 rows or folds into `<details>`;
  How it works, Bring your own AI, What it costs, Day to day, Under the hood
  stay.
- Stale facts: "860 unit tests" → the current count; "Re-analyze with AI"
  → "Re-check with AI"; the resume-toolkit paragraph gains the quick check,
  suggestions on demand, keyword overrides, Rebuild and the instant check.
- A hero GIF of the demo (10–15 s, type Redis, the score moves, < 3 MB):
  GitHub renders it, and it is the only motion possible there.
- Contributing: an "Ideas welcome" paragraph with the feature-request
  template, "roadmap = open issues", #24 as an example of an open task.
- Badges: add "Live demo"; "good first issues" only once they exist.
- `docs/launch/*.md`: "I'm mid job hunt" is no longer true; "I found my job
  with it" makes both posts stronger.

Draft top:

> **Free, open-source job search that gets your resume past the keyword filter.**
>
> Companies screen resumes with AI and ATS keyword filters. The filter
> counts words, not years: "PHP 8, Laravel, Symfony" can miss a requirement
> that says "PHP". ApplyPack watches 22 job sources, drops the fake and
> wrong-fit postings, shows exactly which words a posting wants and your
> resume lacks, helps you fix it, and writes the cover letter. Everything
> runs on your machine.
>
> - **Find real jobs.** 22 sources hourly, a classifier with strict stack and location rules, a ghost-job check with evidence, Telegram above your threshold.
> - **Fix the resume for this posting.** The model marks facts, code computes the score. Edit side by side with a live score; honest deltas between versions. Try it live →
> - **Write the letter without inventing.** Fact-gated against your resume and confirmed facts. PDF / DOCX.
>
> I built it during my own search and found my job with it. MIT, no
> accounts, no telemetry. Bring your own AI: a subscription, a key, or a
> local model.

### A7. Owner inputs

1. Facts for the story: month, whether to name the company and role, how
   long the search took with the tool, 2–3 counters from the Overview. Only
   what he is ready to say publicly. Blocks the story section only.
2. Approve the H1 (three options in A4.1) and one tagline for README, the OG
   card and GitHub About.
3. Label 3–5 issues `good first issue` (candidates: #77, #74, #24).
4. GitHub About and social preview after the new OG card.
5. Read Cloudflare Web Analytics for a before/after baseline (the beacon
   is already on the page).
6. Decide: demo embedded in the hero (recommended) or a screenshot with a
   link to `/demo/`.

### A8. Implementation plan

1. Branch `site-refresh` off main. Nothing is tagged: release-discipline
   tags runtime features; this is a docs/site PR.
2. Copy → short approval (H1, subtitle, story); the rest is finished by the
   session under the A3 rules.
3. `index.html` + `style.css`: 8 sections, embedded demo, JSON-LD, new meta.
   Demo page: weight-tier CSS, shorter intro, an Install CTA after the panes.
4. Screenshots + OG on the synthetic pair, 1440 / 2×;
   `docs/brand/social-card.html` → png; copies into `site/public/img/` and
   `docs/screenshots/`.
5. README top and stale facts; `docs/launch/` fixes.
6. Verify: local preview (`python3 -m http.server`), 375 / 768 / 1440, no
   horizontal scroll, keyboard focus, reduced motion, every link alive,
   Lighthouse ≥ 95 (static, fonts only), `npm test` green (the parity test on
   the vendored `score.mjs` / `target.mjs` does not change).
7. PR → Workers Builds preview URL → merge = deploy. After the merge: About,
   social preview, domain check.

Estimate: site with the demo 4–6 h of session time, screenshots and OG 1–2 h,
README 1 h; about 30 minutes of the owner's time for facts and approval.

### A9. Honesty rules

| Temptation | Write instead |
| --- | --- |
| "Free" | The software is free, the AI is not: "bring your own AI: a subscription you already pay for, a key, or a local model that costs nothing." |
| "No fake jobs" | "Checks whether a posting is live and real, with evidence links." The verdict is legit / suspicious / fake with a confidence, not a guarantee. |
| "Faster" | Only measured numbers: quick check p50 15 s, instant estimate ~30 ms, hourly fetch, a letter in ~30 s. |
| ATS statistics | "75% of resumes are rejected by ATS" circulates without a source. First person: "a resume with fifteen years of Laravel filtered out because the requirement said PHP." |
| "I found a job" | The owner's words and facts, dated. No "and you will too". |
| Social proof | 12 stars and 6 forks are not an argument; show product facts (962 tests, 22 sources, 30 ADRs) instead. TASKS §8 decided the same. |
| Subscriptions as an engine | Consumer-subscription terms do not describe background services; one note in the Install section, as in README. |
| "No signup" | About the demo. The product is not a hosted service; the site must not hint at "register and use". |

### A10. Meta, OG, SEO

Queries worth ranking for: *open source ATS resume checker*, *self-hosted
job search*, *resume keyword match*, *ghost job checker*, *cover letter
generator open source*.

```html
<title>ApplyPack: open-source job search and ATS resume check</title>
<meta name="description" content="Free, self-hosted job search: watches 22 boards, drops fake and wrong-fit postings, shows which keywords your resume lacks, helps you fix it, writes the cover letter. MIT.">
<meta property="og:title" content="Stop losing interviews to a missing keyword">
<meta property="og:description" content="ApplyPack finds real jobs, scores your resume without flattering it, and writes a cover letter that cannot invent. Free, open source, on your machine.">
```

- OG card with the same H1 and a fresh crop; source `docs/brand/social-card.html`.
- JSON-LD `SoftwareApplication`: name, applicationCategory, operatingSystem
  (Docker / Node), offers price 0, license MIT, codeRepository.
- The demo page gets its own og:title ("Watch the score move") and a link
  back to Install: it leads the Show HN and awesome-selfhosted entries.

---

## Part B — design, mobile, code

### B1. Measured

Lighthouse 12, local Chrome, against `https://www.applypack.dev/`; mobile
profile (Moto G, 4G throttling) and desktop.

| | Mobile | Desktop |
| --- | --- | --- |
| Performance | 75 | 98 |
| Accessibility | 92 | 92 |
| Best practices · SEO | 100 · 100 | 100 · 100 |
| FCP | 2.9 s | 0.7 s |
| LCP | 4.8 s | 1.1 s |
| CLS | 0 | 0.002 |
| Page weight | 488 KiB | 643 KiB |

| Finding | Cause | Fix |
| --- | --- | --- |
| LCP 4.8 s mobile | LCP element = `img/target.png`, PNG 1720×1640, 422 KB. Mobile breakdown: TTFB 470 ms, load 290 ms, **render delay 3 910 ms**. | WebP/AVIF, a mobile crop via `<picture>`, `fetchpriority="high"`, preload. |
| Render-blocking 1 090 ms mobile | Google Fonts CSS (904 ms) + `style.css` (231 ms). The font itself is one 47 KB file; the request chain to `fonts.googleapis.com` blocks. | Self-host Inter variable (latin subset, one woff2), preload, `font-display: swap`, a `size-adjust` fallback. |
| Unsized images (2) | `target.png` and `overview.png` without `width`/`height`. CLS is 0 by luck. | Attributes; CSS keeps `width:100%; height:auto`. |
| Contrast (3 elements) | White on `#059669` (primary button, the AP mark) = 3.76:1; `#64748b` on `#0f172a` (terminal comments) = 3.75:1. AA for small text is 4.5:1. | Fills `#047857` (5.5:1 with white), comments `#94a3b8`. |
| Cache | Every asset ships `max-age=0, must-revalidate` + ETag. Right for HTML, a spare round trip for images/CSS. | Low priority: hashed names + long TTL, or leave it. |
| HTTPS | `http://applypack.dev/` answers 200 over plain HTTP, no redirect, no HSTS. `www` and apex both 200 without a redirect between them; canonical is apex. | Cloudflare: Always Use HTTPS, HSTS, a redirect rule www → apex. Owner's dashboard. |
| Analytics | `beacon.min.js` (Cloudflare Web Analytics) is on the page. | A baseline exists; read it. |

Images (measured with `cwebp -q 82` in a scratch directory):

| File | Pixels | PNG | WebP | Note |
| --- | --- | --- | --- | --- |
| img/target.png | 1720×1640 | 421 KB | 171 KB | 760 px mobile crop: 41 KB |
| img/jobs.png | 1440×900 | 187 KB | 66 KB | not referenced by the page |
| img/overview.png | 1440×900 | 154 KB | 58 KB | lazy, desktop only |
| img/og.png | 1280×640 | 117 KB | 39 KB | OG stays PNG/JPEG: not every messenger takes WebP |

### B2. Design: what to improve now

P0 = before the redesign, a small separate PR; P1 = in the redesign; P2 = after.

| Element | Now | Effect on the visitor | Fix | |
| --- | --- | --- | --- | --- |
| Hero text | 62 words before the first button | Nobody reads 55 words on the first screen; the 5-second test fails. | H1 ≤ 8 words, subtitle ≤ 25 (B5). | P1 |
| Hero screenshot | Full target page at 980 px | UI text ~7 px on desktop, ~2 px on a phone: decoration, not proof; 422 KB. | Live demo, or a tight crop ≤ 800 px wide at 2× in a browser frame. | P1 |
| Three buttons | Equal weight | Three calls = none; GitHub pulls away before the product is understood. | One primary (demo), one secondary (install); GitHub in the nav. | P1 |
| 9-card grid | 320 words in one block, emoji markers | Equal weight for Telegram and for the main thing; the eye skips it. | Three rows for three pillars; the rest one compact list. | P1 |
| Emoji | 🔭 🧠 📲 … | Render differently per OS; color noise on a one-accent brand; screen readers read "telescope". | Remove, or 16 px single-color inline SVG. | P0 |
| Alignment | Everything centered | Centered multi-line text reads slower. | Center only the H1 and short leads; paragraphs and lists left. | P0 |
| Typography | H1 ≤ 52 px at weight 650; steps 14 / 15 / 16.5 / 19 without a scale | At 1440 px the H1 reads as a section title, not a thesis. | H1 `clamp(40px, 6vw, 68px)` weight 700 line-height 1.05; a `clamp()` scale. | P1 |
| Color | One accent, good; primary button and terminal comments fail contrast | The main button with pale text in phone sunlight. | `#047857` for fills, `#94a3b8` for comments. | P0 |
| "How it works" | 5 static boxes with "→" | The one place the page could show the system moving, and it stands still. | `<ol>` (it is a sequence) plus one animation: a posting travels fetched → filtered → 92 → Telegram. | P1 |
| Score section | Strong copy, unrelated Overview screenshot | The picture does not support the thesis. | The demo, or the v1 → v3 delta from real numbers. | P1 |
| Section rhythm | 72 px everywhere, alternating white/gray | Monotone: no climax, no pause. | Hero on the ground, pillars on white, the story on an `--accent-soft` band, install on the dark terminal band. | P1 |
| Trust line | None | "Is it free? Is it SaaS? Do I register?" stay unanswered until the footer. | One line under the buttons: Open source (MIT) · No ads, no payments, no accounts · Runs locally or in Docker · Updated weekly. | P0 |
| Favicon, color scheme | SVG only; no `theme-color`, `color-scheme`, `apple-touch-icon` | iOS "add to home screen" gives a blank tile; dark-OS phones draw dark scrollbars on a light page. | 180 px PNG, `theme-color`, `color-scheme: light`. | P0 |
| Dark theme | None, by decision | Acceptable for a landing. | Not this stage. | P2 |

### B3. Mobile

One breakpoint at 560 px and one at 860. What breaks at 375 px (iPhone
SE / 13 mini) and 390–430 px, plus tablet 768:

| Problem | Cause in code | Fix | |
| --- | --- | --- | --- |
| No navigation | `.nav a.plain { display: none }` at ≤ 560 px, no replacement; the AP mark is not a link home. | Keep two short items (Demo · Install) or a no-JS `<details>` menu; mark and wordmark become `<a href="/">`. | P0 |
| Hero buttons | Three `.btn` with `white-space: nowrap` in a flex-wrap row: the third wraps or clips. | At ≤ 560 px stack full-width, `min-height: 44px`, and there are two. | P0 |
| Hero screenshot | `.shot img { width: 100% }` serves the desktop PNG everywhere. | `<picture>` with a 760 px WebP crop (41 KB), or the compact demo instead of an image. | P0 |
| Long column | 9 cards stacked. | Three pillars + "and the rest" in a collapsed `<details>` on phones. | P1 |
| Pipeline | `.pipe` flex-wrap with "→" as separate elements. | Vertical list with a left rail at ≤ 560 px; arrows rotated or hidden, `aria-hidden` either way. | P1 |
| Tap targets | `.btn` ≈ 37 px tall; nav links without padding. | `min-height: 44px` on touch, 10–12 px padding on links. WCAG 2.2 AA needs 24 px, comfort is 44. | P0 |
| Overflow | `body { overflow-x: hidden }` masks horizontal scroll instead of fixing causes; breaks `position: sticky` in descendants. | Remove; fix the causes (nowrap buttons, `min-width` on pipeline boxes). | P0 |
| Smooth scroll | `html { scroll-behavior: smooth }` unconditional. | Wrap in `@media (prefers-reduced-motion: no-preference)`. | P0 |
| Demo on phones | Two 380 px panes; textarea at 14 px (iOS zooms fields < 16 px); transparent-text overlay hard to scroll by finger; chip hints via `title` do not exist on touch; no CSS for `kw-w0…kw-w4`. | One pane (resume) with a "Show posting" toggle; 16 px on the textarea; `autocapitalize="off" autocorrect="off"`; chip hint inline on tap; carry the tier CSS from `target.tsx`. | P1 |
| Tablet 768 | 2-column grid, split in one column: works. | Only the image crop and the three pillars. | P2 |

```css
@media (max-width: 560px) {
  .nav a.plain { display: inline-block; padding: 10px 6px; }   /* two short links stay */
  .hero .cta { flex-direction: column; align-items: stretch; }
  .btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; white-space: normal; }
  .hero p.sub, .lead, .card p, .qs-note { text-align: left; }
  .pipe { flex-direction: column; align-items: stretch; }
  .pipe .arrow { transform: rotate(90deg); align-self: center; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
:root { color-scheme: light; }
```

### B4. Code

`<head>`:

| Line | Problem | Effect | Fix |
| --- | --- | --- | --- |
| Google Fonts, 6 weights | 400/450/500/550/600/650 through `fonts.googleapis.com`: 42 `@font-face` blocks, the DNS → CSS → woff2 chain blocks render 904 ms on mobile. | First paint on 3G at 2.9 s. | One self-hosted `Inter` variable latin woff2 (~45 KB), `<link rel="preload" as="font" crossorigin>`, `font-display: swap`, fallback `@font-face { src: local("Arial"); size-adjust: 107% }`. The 450/550/650 weights survive: the variable file covers them. |
| og:*, twitter:card | No `og:image:width/height/alt`, no `twitter:title`. | Previews sometimes render without the image on the first fetch. | Four meta lines. |
| Structured data | None. | Google does not know it is software, free, MIT. | `SoftwareApplication` JSON-LD with `offers.price: 0`, `license`, `codeRepository`. |
| Image preload | None; the LCP image is discovered after HTML and CSS parse. | +100–300 ms on LCP. | `<link rel="preload" as="image">` or `fetchpriority="high"`. |
| theme-color, color-scheme, apple-touch-icon | Missing. | See B2. | Three lines. |

Markup:

| Place | Problem | Effect | Fix |
| --- | --- | --- | --- |
| header → div.nav | No `<nav>`, no skip link, the mark and wordmark are not links. | Screen readers find no navigation; keyboard walks every link. | `<nav aria-label="Primary">`, `<a href="/" class="brand">`, a skip link first in body. |
| Hero `<em>` | `<em>self-hosted</em>` used for color. | Minor: screen readers may change intonation. | `<span class="accent">`. |
| Hero `<img>` | PNG, unsized, no `srcset`/`<picture>`, no `fetchpriority`, no `decoding="async"`. | B1. | `<picture>` + WebP + size attributes + `fetchpriority="high"`. |
| Emoji cards | `<div class="emo">🔭</div>` without `aria-hidden`. | Announced before every heading. | Remove, or `aria-hidden="true"` on SVG glyphs. |
| Pipeline | Boxes in `div`, arrows as text in separate `div`s. | Four "rightwards arrow" announcements; the sequence is not marked as one. | `<ol class="pipe">`, arrows via `::after` or `aria-hidden`. |
| Inline styles | `style="margin-top:18px"`, `style="font-size:15px"`, `style="flex:1"`. | Breaks under a `style-src` CSP; three exceptions to the system. | Classes. |
| Engine chips | `<span class="chip">` ×5. | A list without list semantics. | `<ul class="engines"><li>`. |
| Terminal | `<pre>` without a copy button. | Hard to select four lines on a phone. | Ten lines of inline JS for Copy, or leave it. |

CSS:

| Rule | Problem | Fix |
| --- | --- | --- |
| Tokens | 10 color variables, good. No spacing or type scale: 72 / 52 / 44 / 36 / 30 / 28 / 22 / 18 / 14 px scattered. | `--space-1…9` on a 4 px base and `--text-sm…3xl` via `clamp()`; then the mobile breakpoint changes three variables, not thirty rules. |
| Radii | 7 / 8 / 10 / 12 / 999 px; the dashboard system has 4 / 6 / 8. | 6 / 8 / 12 / 999 through `--r-*` tokens. |
| `.wrap` 1080 px | Narrow at 1440–1920 px. | 1080 for text, 1200–1280 for the text + screenshot rows and the demo. |
| `.grid` 3 columns | Breakpoints 860 and 560; between 860 and 1080, three ~300 px columns of 14 px text. | `repeat(auto-fit, minmax(280px, 1fr))`. |
| `:focus-visible` | Undefined; default rings differ, nearly invisible on the primary button. | One rule: `outline: 2px solid var(--accent-ink); outline-offset: 2px`. |
| `.btn` | No `min-height`. | 40 px desktop, 44 px touch, `display: inline-flex`. |
| `.term` | Hard-coded colors are fine (a committed dark surface); comments at 3.75:1. | `--term-comment: #94a3b8`. |
| Animations | None but smooth scroll. | Two or three from B7, all under `prefers-reduced-motion`. |

Demo page (`demo/`):

- `demo.mjs`: `await fetch('fixture.json')` without error handling; on failure
  the score shows "—" forever. Wrap in try/catch and show one sentence.
- `render()` repaints both panes on every character. Cheap on the fixture;
  measure on a phone when the demo is embedded, debounce 50 ms if needed.
- No styles for `kw-w0…kw-w4` (v1.17) although the vendored `target.mjs`
  emits them. Carry them over from `src/web/pages/target.tsx`. The parity
  test covers only the `.mjs` files, so CSS is free to change.
- Panes fixed at 520 px; `min-height: 60vh` on desktop shows more text.
- No CTA after the demo. Whoever just watched the score move is the warmest
  visitor of all: "This runs on your machine too" + Install.

### B5. First screen: the text budget

One rule: at most 45 words before the demo. Each line has a limit.

| Line | Text | Words |
| --- | --- | --- |
| H1 | Stop losing interviews to a missing keyword. | 7 |
| Subtitle | ApplyPack finds real openings, shows what your resume is missing for each one, and writes the cover letter. On your machine, no account needed. | 25 |
| Buttons | Try the live demo · Install with Docker | 7 |
| Trust line | No ads · No payments · No accounts · Runs locally or in Docker · 22 job sources · v1.18.0 | 16 |
| Then | The live demo: score, missing-keyword chips, editor. One hint: "Type Redis into the skills line." | — |

- "Constantly updated" is shown as data, not words: a
  `img.shields.io/github/v/release/applypack/applypack` badge in the trust
  line updates itself without a build step. Alternative: a "v1.18.0 · 2 Sep
  2026" line that release-discipline updates on every tag.
- "Open source" and "no payments" sit next to each other in the trust
  line: the answers to every visitor's first two questions, before scrolling.
- No numbers in the H1. "22 sources" and "5 engines" live in the trust line
  or the pillars; in the headline they compete with the thesis.

### B6. Landing-page methodologies (2025–2026)

| Method | Essence | Here |
| --- | --- | --- |
| Message first | Copy and the 5-second test before layout. PAS: problem → agitate → solve; one call per screen; proof next to the claim. | Yes; the A4 copy is written in that order. |
| Product-led hero | Show the product instead of describing it: a live interactive in the hero (Linear, Vercel, Raycast, Excalidraw), not a video or a mockup. | Yes; the demo exists, it only needs lifting into the hero. |
| Tokens + fluid scale | CSS custom properties, `clamp()` for type and space, a 4/8 px scale, container queries for components. | Yes, without a build. Nine variables added to the ten. |
| Modern CSS | `text-wrap: balance/pretty`, `:has()`, subgrid, scroll-driven animations (`animation-timeline: view()`), `@starting-style`, `light-dark()`, `color-mix()`, logical properties. | Selectively, as progressive enhancement. |
| Performance budget | Core Web Vitals: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. A page budget (≤ 250 KB mobile), AVIF/WebP, `<picture>`, `fetchpriority`, self-hosted subset fonts, zero JS by default. | Yes; the landing is JS-free already, only images and the font are missing. |
| Accessibility as the floor | WCAG 2.2 AA: contrast 4.5:1, targets 24 px minimum (44 comfort), visible focus, reduced motion, landmarks, skip link, semantic lists. | Yes; three contrast defects and the nav close 92 → 100. |
| Static first | Plain HTML for 1–5 pages; Astro / 11ty with islands once pages multiply; never an SPA for a landing. | Stay plain HTML; revisit if docs pages appear. |
| Motion with intent | One signature interaction + micro-interactions ≤ 200 ms; scroll reveals via IntersectionObserver or CSS `view()`; no parallax, no cursor effects; reduced motion = static. | Yes: the demo, the pipeline strip, the delta counter. Three, not ten. |
| Measurement | Privacy-friendly analytics, Lighthouse CI per PR against the preview URL, 5-second tests with 3–5 people, A/B on the headline only with traffic. | Cloudflare Web Analytics exists. Lighthouse CI is cheap (P2). No A/B: traffic too small. |
| AI-landing anti-patterns | Gradient blobs, glassmorphism, 3×3 emoji cards, everything centered, "Revolutionize your…", meaningless stat rows, purple gradient on white. | The current site has three: emoji cards, centering, the 9-card grid. |

### B7. Modern, clear, readable, with "wow"

Three layers; "wow" comes from the product, not from effects.

- **Understood in 5 seconds:** H1 about the pain, subtitle about three
  things, the trust line; one reading order (left to right, top to bottom);
  every section opens with the answer.
- **One living thing:** the demo in the hero (type a word, the number
  changes and changes color); the pipeline strip (one posting, 3 s, CSS
  keyframes); the 54 → 82 delta counter on entering the viewport.
- **Craft in the details:** a type scale and a 4 px spacing grid;
  screenshots in a browser frame with a soft shadow, cropped at 2×; one
  accent that appears where something acts; 150–250 ms transitions on hover
  and focus, nothing over 400 ms except the strip.

Do not: parallax, cursor effects, floating gradient blobs, autoplay video in
the hero, scroll hijacking, GitHub star counters, testimonial carousels.

### B8. Skills and tools to have before starting

Checked: the claude.ai skills marketplace and the plugin catalog return
nothing for "landing page", "web design", "accessibility", "performance",
"SEO". The base is already in the repo.

| Skill / tool | What it gives | Status | Recommendation |
| --- | --- | --- | --- |
| impeccable 4.1.1 | `critique` (UX scoring), `adapt` (mobile as rethinking, not scaling), `audit` (a11y / perf / responsive), `polish`, `typeset`, `layout`, `animate`, `optimize`, the `detect.mjs` slop detector, `live` for in-browser variants. | in the repo | Primary. Order: critique → adapt → build → audit → polish. `.impeccable/config.json` ignores `site/**` for the detector: lift that before working on the landing. PRODUCT.md describes the dashboard (Operate mode); the landing is Persuade and needs its own surface brief. |
| frontend-design (Anthropic) | Aesthetic direction: how to avoid the templated look, how to tie type and palette to the subject. | plugin, installed | Read before the hero and pillars. It advises against Inter as a default; the brand pins Inter, and the brief wins (the skill says so itself). |
| stop-slop | Removes AI writing patterns. | in the repo | Run over every site and README text before committing. |
| accessible-interactions, ui-review | Focus, semantics, reduced-motion rules; dashboard page reviews. | in the repo | Written for the dashboard; the a11y rules apply. `ui-review` is replaced by `impeccable critique` for the landing. |
| web-design-guidelines (Vercel) | file:line review of HTML/CSS against the Web Interface Guidelines: a11y, forms, animation, `inputmode` / `autocomplete` details. Fetches the rules over the network on each run. | install | A second pair of eyes after `impeccable audit`: `npx skills add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code`. Read its SKILL.md first: it goes online. |
| design (Claude Design canvas) | Artboards to compare hero variants before code. | available | Optional: three H1 variants on one canvas. |
| web-artifacts-builder (Anthropic) | React + Tailwind + shadcn for complex claude.ai artifacts. | skip | Not for a static site without a build. |
| Lighthouse CLI | The numbers in B1; `npx lighthouse <url> --preset=desktop` with the local Chrome. | works | Before and after every P0 item. Lighthouse CI against the Workers Builds preview URL in P2. |
| Playwright MCP | Screenshots at 375 / 768 / 1440 and DOM measurements. | plugin, installed | Shares one browser profile across sessions ("Browser is already in use" while another session runs). Shoot when the session is alone, or use headless Chrome with a scratch profile. |
| cwebp / sips | PNG → WebP, resizing. | on the machine | A ten-line script in `scripts/`, run by hand when screenshots change. AVIF optional via `npx @squoosh/cli`. |
| Tailwind Play CDN, UI libraries | The dashboard uses them. | not for the site | The Play CDN adds ~300 KB of JS to 6 KB of CSS and blocks render: LCP gets worse. The landing stays on its own CSS. |

### B9. Priorities and expected effect

**P0 · an hour, a separate small PR, `site/` only**

1. Images: WebP + mobile crop via `<picture>`, `width/height`,
   `fetchpriority="high"`. 422 → 41–171 KB; render delay from 3.9 s to a
   fraction of a second.
2. Font: self-hosted Inter variable latin, preload, size-adjust fallback.
   Minus 0.9 s of blocking on mobile, no FOUT shift.
3. Contrast: `#047857` on fills, `#94a3b8` in the terminal. a11y 92 → ~100.
4. Mobile nav and buttons: two links visible, stacked 44 px buttons, the AP
   mark leads home. A phone can reach Install.
5. Small things: `theme-color`, `color-scheme`, apple-touch-icon,
   reduced-motion on smooth scroll, drop `overflow-x: hidden`, `aria-hidden`
   on emoji and arrows, `<nav>` + skip link.
6. Cloudflare (by hand): Always Use HTTPS, HSTS, www → apex.

Expected after P0 (estimate, not a measurement): mobile performance 75 →
95+, LCP 4.8 s → ≈ 1.5–2 s, first paint on 3G 2.9 s → ≈ 1.2 s, page weight
488 → ≈ 120 KB. Verify with the same Lighthouse run.

**P1 · the redesign from part A:** hero within the 45-word budget + live
demo + trust line; pillars as rows; the story; the open-source section; the
pipeline as `<ol>` with one animation; no emoji; a type and spacing scale;
fresh 2× screenshots. Effect: the 5-second test passes; the first scroll
shows the product, not a list; the page reads on a phone without zooming.

**P2 · after:** Lighthouse CI on PRs; `sitemap.xml`; AVIF next to WebP; long
cache for hashed assets; dark theme through tokens; a Copy button on the
terminal.

---

## Part C — decisions taken while building

Appended by the implementing session; each line names the rule it follows.

- **No eyebrow above the H1.** The impeccable craft floor bans a kicker
  above a heading outright. The open-source / no-payments / local facts go
  into the trust line under the buttons instead, which the brief asked for.
- **P0 and P1 shipped together.** The redesign rewrites `index.html`
  wholesale, so a separate P0 PR would have been thrown away a day later.
  The P0 items are still the first commits on the branch.
- **The story section carries no numbers yet.** The owner has not supplied
  the counters, and placeholders must never deploy (a merge to main
  publishes). It ships with the true, number-free version and a comment
  marking where the facts go.
- **Built in a git worktree** (`../job-hunter-site-refresh`) because another
  session was working in the main checkout at the time.
