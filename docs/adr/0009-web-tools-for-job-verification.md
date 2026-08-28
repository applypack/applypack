# 0009 — Web tools through the AI seam, for job verification only

**Status:** Accepted (2026-08-28)

## Context

"Is this posting real, and should I bother?" cannot be answered from the
posting text alone — the ghost-job checklist (careers page, LinkedIn
footprint, reputation, repost history) needs the web. Until now the
`AiProvider` seam ([ADR 0007](./0007-ai-provider-seam.md)) ran Claude with
no tools at all (`--tools ''` on the CLI, no `tools` on the API), which is
exactly right for the classifier.

## Decision

- `AiRequest.webTools?: boolean` is the only switch. Off by default; on for
  `job-verify` only.
- **API path:** Anthropic server tools `web_search_20260209` (max 10 uses)
  and `web_fetch_20260209` (max 6). The server runs the search loop; on
  `stop_reason: pause_turn` the provider re-sends the turn, at most 5
  times. Only text blocks of the final response come back.
- **CLI path:** `--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch`
  (headless mode cannot prompt, so the allow-list is mandatory). The CLI
  runs its own loop and returns the final text in `result`.
- The prompt is the job-apply skill's checklist verbatim in spirit: every
  claim needs a URL, "could not verify" is a valid finding, thin startup
  footprint caps at *suspicious*, hard scam flags mean *fake*. Output is
  JSON → `JobVerification` row (verdict, recommendation, confidence,
  evidence with URLs, red flags, company snapshot).
- Verification runs synchronously in `POST /jobs/:id/verify` (2-4 min),
  same trade-off as the resume comparison ([ADR 0008](./0008-resume-module-in-web.md)).

## Consequences

✅ One boolean on the seam; the classifier and the resume calls are
unchanged and still tool-free.
✅ Evidence is linkable — the user can check the verdict instead of trusting it.
❌ The CLI path spends subscription usage on every search; a verification
is ~10-20× a classification.
❌ Search quality is the model's — the checklist tells it what to look for,
but a thin or ambiguous company name can yield "unverified" across the
board. That is reported as such, never upgraded to "legit".
❌ `pause_turn` resumes are capped, so a very long research turn can end
with a partial answer that fails the zod parse; the route reports failure
and the user re-runs.
