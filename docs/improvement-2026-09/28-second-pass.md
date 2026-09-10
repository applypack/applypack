# §28 — Separate the audit from the implementation

**Verdict: already how the project works; nothing to adopt.**

The plan wants audit → issues → human prioritisation → one issue →
implementation → tests → review → commit, in separate sessions. That is the
standing process in CLAUDE.md and the `commit-discipline` / `testing-gate`
skills: every stage begins as a written analysis (TASKS §15–§19 each link
one), the owner orders it, one branch = one block = one PR, `code-review-expert`
before the PR, the owner merges and tags. This analysis is the "audit" half;
TASKS §20 is the ordered list; each block is its own branch.
