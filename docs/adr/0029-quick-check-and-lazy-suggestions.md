# 0029 — A comparison is a quick check by default; suggestions are a second call

**Status:** Accepted (2026-09-02)

## Context

One `matchResumeToJob` call answered every comparison, and it wrote the whole
report: keywords, alignment grades, hard-requirement gates, red flags — and the
edit suggestions (actions with verbatim quotes, removals, strengths,
cautions). Measured on the CLI engine with Opus (block 1, plan §2.3), that call
is **78–109 s, p50 ≈ 94 s**, and it is the entire critical path of every
compare, re-upload and re-analysis.

The latency model (plan §2.1) says output tokens dominate: the reply is
2.5–4 k tokens and the suggestions are most of them. `score.ts` needs none of
them — since ADR 0012 the number comes from keyword statuses, alignment grades
and the red-flag count alone. So the expensive half of the reply is the half
the score never reads, and a user re-checking an edited resume usually wants
the number, not another to-do list.

The other question the plan left open (§8) was the model: keep Opus, or make
Sonnet the resume-role default. Both are measured below.

## Decision

**Two variants of one rulebook.** `prompts.ts` holds the match rules as named
constants (keyword extraction, requirement levels, statuses, primary stack,
alignment, gates, red flags, consistency, the keyword budget) and assembles
them into two system prompts:

- **`fast`** — the score-complete subset: `summary`, `alignment`, `red_flags`,
  `hard_requirements`, `keywords`. No actions, removals, strengths or cautions.
- **`full`** — the same rules plus the suggestion rules and their output shape.

Both variants are parsed by the **same `MatchSchema`**; the omitted arrays
already carried `.default([])`, so a quick check parses as a report with empty
suggestion lists and every downstream reader keeps working. The guard tests run
every gotcha-11 rule against **both** variants, so a rule cannot quietly go
missing from the short prompt.

**Fast is the default** for Compare, Re-check and `/target`; the full report is
an explicit, honestly-labelled button ("Full analysis"). The cover-letter flow
asks for `full` — it leads with strengths, which only the full report writes.

**Suggestions are a lazy second call.** `buildSuggestionsPrompt` +
`resume/suggestions.ts` send the resume, the posting and the **stored verdicts**
(keywords with requirement/primary/status/where, alignment, gates) back to the
model, which returns only actions, removals, strengths and cautions.
`store.ts:updateMatchSuggestions` writes them into the existing row. The
verdicts and the score are never re-judged, so a filled-in row equals a full
row, and "Get suggestions" on a quick check costs one call instead of two.

**The mode marker rides in the `breakdown` JSON**, next to the prompt version
(`match-mode.ts`) — no schema change, and rows written before the marker read
as `full`, which is what they are. The reuse memo learned the mode: identical
text under the same prompt version answers a fast request from any row, and a
full request from a fast row starts the suggestions call alone
(`match-reuse.ts:reuseDecision`).

**`PROMPT_VERSION` 5 → 6**, once, for all three prompt changes (the variant
split, the tiered keyword budget of plan §4 F1, the suggestions prompt). Stored
matches at v5 stop being reusable, which is the intended meaning of a bump.

**The resume-role default stays Opus.** The bench decided it — see below.

## Measured (2026-09-02, `claude_code` CLI engine, 5 gold fixtures per run)

`npm run bench:resume -- --model <id> --mode <fast|full> --out <file>`, then
`--table` for the comparison. Prompt v5 is the "before" column.

| Run | p50 | Suite total | Reply chars | Checks failed | Status agreement vs Opus full v6 |
| --- | --- | --- | --- | --- | --- |
| Opus, full, v5 (before) | 22 s | 136 s | 4899 | 0 | — |
| Sonnet, full, v5 (before) | 40 s | 231 s | 3261 | 0 | 95% vs Opus v5, 74% term overlap |
| **Opus, quick check, v6** | **15 s** | **77 s** | **2591** | 0 | 98% (45/46), 88% term overlap |
| Opus, full, v6 | 24 s | 116 s | 4373 | 0 | 100% (52/52) |
| Sonnet, quick check, v6 | 26 s | 161 s | 2126 | 0 | 93% (37/40), 77% term overlap |
| Sonnet, full, v6 | 52 s | 252 s | 3099 | 0 | 95% (38/40), 77% term overlap |

Two things they show:

- **The quick check is the win.** Same verdicts, 59% of the output, 63% of the
  time — and every gold check still green, including the primary-stack caps.
- **Sonnet is not faster here.** On the CLI engine it was *slower* than Opus in
  both modes (p50 52 s and 26 s against 24 s and 15 s) at 95% / 93% status
  agreement and only 77% term overlap — a less stable keyword frame, which is
  exactly what CONSISTENCY ACROSS RUNS exists to prevent. So the plan's §3.2
  item 7 condition ("2-3× faster at ≥85% agreement") is **not met**, the
  default stays `claude-opus-5`, and the per-engine "Resume model" select on
  `/settings` remains the speed dial for anyone whose engine says otherwise.

Live on a real posting (job #1393, Docker, Opus): quick check 39.5 s scoring
**66 — the number the v5 full analysis gave for the same resume** — then
"Get suggestions" 35.2 s; a full analysis of the same pair took 77.1 s.

## Consequences

✅ The default comparison writes ~60% of a full reply (2591 vs 4373 characters
on the fixtures, 6 003 vs 13 577 on a real posting) and answers in 15-40 s on
Opus; the score is identical because `score.ts` never read the suggestions.
Suggestions stay one click away and reuse the frame, so asking for them later
costs no re-judgment and cannot move the number. One rulebook means one place
to fix a rule, and the guard tests prove both variants carry it.

❌ Two AI call sites for one feature instead of one (registered in the fence
registry test), and a stored row now has two shapes — every reader must handle
a row with empty suggestion arrays. One reader degrades quietly:
`cover-letter.ts` distils the latest stored match into its shortlist, so when
that row is a quick check the letter gets the verdict and the evidenced
keywords but no `strengths` lines. The letter flow asks for `full` on the runs
it starts, and the prompt already handles a missing strengths list, so the
letter is thinner rather than wrong. A user who always wants suggestions pays
two calls where one used to do (~30 s more in total), which is why "Full
analysis" sits next to every quick-check button.

## When to revisit

If measurements show the suggestions call rarely follows a quick check, drop
the second call and keep only the fast prompt. If a future engine makes a
faster model both quicker *and* stable on the keyword frame, flip
`CLAUDE_MODEL_RESUME` and re-run the bench table in the same shape.
