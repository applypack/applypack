# 0028 — Several searches run in parallel, scored by one call per posting

**Status:** Accepted (2026-09-02). **Supersedes [0004](./0004-single-active-profile.md)**,
whose own "when to revisit" named this table: *"If we ever truly need it, we'd
introduce a `JobScore { jobId, profileId, fitScore }`"*.

## Context

ADR 0004 kept exactly one active `Profile`. Stage 5 (`Profile.resumeId`, v1.9.0)
then made second searches easy to create — `/resumes/:id` → "Search profile"
mints one per resume — and every one of them is born inactive and does nothing.
A user with a backend CV and a QA CV has two searches and one running.

The obvious implementation, N classifier calls per posting, multiplies the only
expensive step by N. The plan proposed one call describing every search, and
required three numbers before any code. All were measured 2026-09-02 against
`claude-haiku-4-5-20251001` on real stored postings, the profiles in the live
database, and synthetic searches for N > 2.

**1. Prompt growth, and the prompt cache.** A multi-search system prompt costs
**816 tokens** at N=1 and **~150 tokens per added search** (N=5: 1639, N=8: 2096) —
shared rules are stated once, only the search block repeats. Against that, one
single-search prompt is 1216 tokens, so N single prompts cost 1216·N.

The plan's cache premise ("profiles are stable in a tick — the cache should
hold") turned out to be moot: `cache_creation_input_tokens` was **0 on every
call**, at every size. The minimum cacheable prefix is model-dependent and not
monotonic across generations — **4096 tokens on Haiku 4.5** against 512 on Opus 5 —
and no prompt we send comes close. Caching is not a design input here, and was
never buying anything for the classifier (see the note added to gotcha 3).

**2. One call vs N calls,** over the same three postings:

| N | N single calls | one multi call | input |
|---|---|---|---|
| 2 | 6 calls, in 13273, out 967, 14.0 s | 3 calls, in 6234, out 862, 9.1 s | **2.1× cheaper** |
| 3 | 9 calls, in 19593, out 1506, 21.9 s | 3 calls, in 6702, out 1155, 13.2 s | **2.9× cheaper** |
| 5 | 15 calls, in 32212, out 2354, 35.0 s | 3 calls, in 7611, out 1794, 18.7 s | **4.2× cheaper** |

The posting body (~887 tokens) dominates, and N single calls pay for it N times.
The advantage therefore *grows* with N. Output shrinks only slightly (~1.1–1.3×):
a per-search verdict has to be written either way.

**3. Does the two-stage prefilter survive?** Yes — and measuring it exposed a
latent bug in the shipped one. Over 24 postings spread across the fit range:

| gate | admits | of the 8 real matches |
|---|---|---|
| shipped wording, 1 search | 2/24 | **1/8** |
| corrected wording, 1 search | 17/24 | 5/8 |
| corrected wording, 2 searches | 13/24 | 6/8 |
| corrected wording, 5 searches | 12/24 | 6/8 |

The failure is the **wording, not the search count**: the gate sees only the
first 800 characters and read "the stack is not mentioned here" as "the stack
mismatches", rejecting seven of eight postings the full classifier scored 75–90.
It has never run in production (`classifierMode` is `single`), which is why
nobody saw it. Going multi-search *widens* the gate by construction — a union
admits what any member admits — and the bucket that matters goes up, 5/8 → 6/8.
So the prefilter stays available at N > 1, with the sentence that caused the
false negatives replaced.

**4. The cap.** The plan's hypothesis was ≤ 5 active searches. **Refuted.**
Through N=12 the model returned exactly N entries with the requested ids on 7 of
7 postings, zero wrong ids, zero truncations, and discrimination *sharpened* with
N (the PHP search averaged 45–63 where the alien searches averaged 16–25). The
union base filter saturates rather than explodes: 37.7 % of the corpus at N=1,
62.4 % at N=12 — and the second real search added exactly **zero** postings,
because its role types already sat inside the first's.

What does grow linearly is per-posting output (**≈ 90 + 100·N tokens**) and
latency (**≈ 2.7 s + 0.6 s per search**). Those are felt during "Fetch now" and
the wizard, so the ceiling is set where the *user* notices, not where the model
does.

## Decision

- **`Profile.active Boolean`** is the new switch; `AppSettings.activeProfileId`
  stays as the **primary** — the profile that supplies defaults (new-job
  preselects, "Fill from a resume", the `/settings` landing tab). Activating is
  no longer exclusive; the primary is always active.
- **`JobScore (jobId × profileId)`** holds `fitScore`, `locationMatch`,
  `techMatch`, `redFlags`, `summary`, `priorityRulesApplied`. `Job.fitScore` and
  the other classifier columns keep the **best-of** row so every existing list,
  sort, badge and digest renders unchanged.
- **One classifier call per posting.** `buildClassifyPrompt` takes a
  `Profile[]`; the reply is `{salary_min_usd, salary_max_usd, scores: [{profile_id,
  fit_score, location_match, tech_match, red_flags, summary}]}`. Salary is
  **hoisted** out of the per-search entries: it is a fact of the posting, and
  repeating it per search invites two searches to disagree about one number.
  A per-search entry is recombined with the hoisted salary into the existing
  `ClaudeClassification` shape, so `applyPriorityFloor`, `capFitForMissingStack`
  and `decideDismissReason` keep working per search, unchanged.
- **Union base filter.** A posting is admitted when **any** active search admits
  it. `passesBaseFilter` stays pure and single-profile; `passesAnyBaseFilter` is
  the wrapper.
- **Alerts: one per posting**, named for the winner (`Backend 87 · QA 41`), sent
  to the winning search's `telegramTargetId` (already in the schema). A search
  gates its own alerts with its own `minFitScore`; a posting alerts when at least
  one search clears its own bar, and the blank-profile flag still blocks it.
- **`MAX_ACTIVE_PROFILES = 8`**, not 5. Chosen from the latency and output
  curves — 8 searches cost ~8 s and ~900 output tokens per posting — with the
  measurements clean two thirds beyond it. `maxTokens` scales as `400 + 180·N`,
  which left headroom at every N tested.
- The **prefilter keeps its place** at N > 1, its gate rewritten as "false only
  when the posting is an unambiguous mismatch for *every* search", with the
  800-character truncation stated so absence of evidence stops reading as
  mismatch.

## Consequences

✅ N searches cost roughly one search's worth of input — the advantage grows with N.
✅ Existing scores are preserved, not orphaned: the migration copies each scored
`Job` into a `JobScore` against the profile that was active when it was scored.
✅ Per-direction Telegram routing needed no schema — `Profile.telegramTargetId`
was already there and unused.
✅ The two-stage prefilter comes back from being unusable (1 of 8 real matches)
to usable (6 of 8), for single and multiple searches alike.

❌ `Job.fitScore` is now a derived best-of. Anything reading it must accept that
it belongs to *some* search; the owning profile is in `JobScore`.
❌ A wrong score is now N wrong scores from one reply — a bad parse costs every
search on that posting, where N calls would have failed independently.
❌ Re-classify grows an axis: changing one search rescoring every posting rewrites
that search's `JobScore` rows only, but the best-of on `Job` must be recomputed.
❌ Eight searches is still one person's dashboard. The chips, the score row and
the digest were designed for a handful, not for a team.

## When to revisit

If someone actually runs 8 searches and the per-posting latency shows up as a
complaint during "Fetch now" — the answer then is not a lower cap but batching
postings per call, which the measured token curve says there is room for.
