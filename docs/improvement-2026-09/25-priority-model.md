# §25 — Priority model (P0–P3)

**Verdict: adopt as written; it is the model the audit report uses, and it matches the severities the repo has been using in issues since §14.**

P0 data loss / secret leak / RCE / auth bypass / blind-mode PII leak /
install impossible · P1 workflow broken, silently wrong result, realistic
exploit · P2 confusing UX, recoverable defect, avoidable AI call, missing
validation, doc drift that misleads · P3 wording, dead code, DX, small
refactor, non-blocking a11y.

Two local rules the repo adds: an AI-cost item is judged by measured calls
per tick, not by theory (TASKS §1.4), and a rule the user can lose data to
belongs in code, not in a prompt (gotcha 11) — so a prompt-only guard is P2
even when the prompt "works".

## Steps

None; the audit report's findings carry these labels.
