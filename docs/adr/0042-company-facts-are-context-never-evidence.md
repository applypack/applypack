# 0042 — The verifier's company facts are context for the match, never evidence

**Status:** Accepted (2026-09-05)

## Context

"Is this job real?" (ADR 0009) stores a `companySnapshot` next to its
verdict — two or three sentences on what the company builds, its size and
stage, its stack and practices. Until now the cover letter was its only
reader (ADR 0021). The comparison and the suggestions never saw it: on the
live row behind #162 the verifier had learned "PHP/Laravel backend, Angular
frontend, AI-forward (Cursor in the daily workflow)" three minutes before
the match wrote its edit suggestions without a word of it.

Letting the snapshot in raises two temptations, and both break an
invariant the resume module already rests on:

- **Use it as evidence.** The replacement gate's sources are the resume,
  the posting and the confirmed facts (ADR 0037); the score is code over
  the model's status marks (ADR 0012); every keyword is a verbatim span of
  the posting (`anchorKeywords`). A snapshot that "knows" the stack could
  add keywords the posting never asked for, or let a paste-ready wording
  claim something the resume cannot back.
- **Let it move the number.** The quick check is what the score reads
  (ADR 0029), and it is the hot path the user waits on (#184). A block
  that changes verdicts changes scores across resume versions and makes
  real improvement invisible.

## Decision

1. **Context, never evidence.** The snapshot enters the full analysis and
   the suggestions call as a fenced `COMPANY CONTEXT` block (ADR 0022,
   tier 2 — it is the verifier's own output, laundered untrusted text)
   under one rule: it steers what to emphasise, the `strengths` and each
   action's `why`. No keyword status, gate or replacement may rest on it; a
   technology it names that the posting does not is not a keyword; it says
   nothing about the candidate. The gate's source list does not grow.
2. **The quick check never sees it.** `fast` judges keywords and gates —
   exactly what the snapshot must not move — so its prompt is byte-for-byte
   what it was, and the snapshot costs nothing where the user waits.
3. **The memo carries the verification.** The `breakdown` JSON gains a
   fourth marker, `verificationId`, next to `promptVersion` / `mode` /
   `frame`. `reuseDecision` treats a full row that read another
   verification — or none — as stale for a full request; a fast request
   never looks at it. "Verify, then Full analysis" on unchanged text
   therefore re-runs once; "Full analysis, then Full analysis" stays free.
   A keyword re-score copies the marker from the locked row; the
   suggestions call stamps the verification it read.
4. **No prompt-version bump.** The issue's plan said bump. A bump makes
   `planKeywordFrame` rebuild every stored frame (`prompt-bump`), voids
   every stored comparison on every install and declares that verdicts
   changed. Here they must not: the shipping rule is **0 status flips and 0
   score changes** on the gold bench with and without a synthetic snapshot
   (`npm run bench:resume -- --company`, a snapshot naming a technology no
   fixture posting has, so a flip on it is the tell). The
   `RULE_COMPANY_CONTEXT` line in the full system prompt is inert when no
   block follows it.

## Measured (2026-09-05, CLI Sonnet 5, the five gold fixtures, two runs each way)

- **Keyword status flips, base vs. snapshot: 0** in all eight fixture
  pairs; the synthetic snapshot's tell (GKE) appears in no reply.
- What does move — a `primary` flag on the title term, `must` ↔
  `preferred` on Docker / CI/CD / PostgreSQL — moves exactly as much
  between two base runs as between a base run and a snapshot run (one base
  pair and one base-vs-snapshot pair differ on the same four terms; another
  base-vs-snapshot pair is identical). That is the model's own run-to-run
  wobble, not the block.
- Scores: laravel-vs-node 13 / 6 base against 9 / 6 with the snapshot (all
  capped at 30); laravel-vs-laravel 91 / 96 against 96 / 100 (a title term
  the model sometimes lists and sometimes does not); the other three
  fixtures identical. No gold check failed.
- The first wording ("never evidence: no status, gate or replacement") was
  not enough: with it the snapshot's "React front end" made React primary
  on the Node posting and the title term primary on the Laravel posting,
  which capped a 91 to 70 and failed a gold check. The rule now names every
  scored field, and the suggestions call — which outputs none of them — has
  its own shorter variant.

## Alternatives considered

- **The snapshot as a gate source, as the cover letter treats it.**
  Rejected: a letter makes claims about the company and the snapshot is
  evidence for those; a resume edit makes claims about the candidate, about
  whom the snapshot says nothing.
- **Show the snapshot on the targeted view instead of feeding the model.**
  Cheaper, and still open as a later pane — but #162 asks that the advice
  itself be aware of the company, and a pane the user reads after the
  suggestions were written does not do that.
- **Feed the verdict and the recommendation too** (`caution` = light
  tailoring). Not here: the hint line on the card (#162 stage 1) tells the
  user; a model told to go light would tone down its own suggestions,
  which is a product decision the user should make with the verdict in
  front of them.

## Consequences

- A full row stored before this ADR reads `verificationId` as null. If the
  job has a verification, the next Full analysis re-runs once; otherwise the
  row is reused as before.
- A new verification after a full analysis makes the row stale for the next
  full request only — the card keeps showing it until then.
- The snapshot is clipped at `MAX_SNAPSHOT_CHARS` (2 000) and fenced, and
  `prompt-fence-registry.test.ts` fails the build if a builder ever passes
  it unfenced.
- The canonical-listing refresh (#162 stage 3) is a separate decision: it
  changes the posting, which IS evidence, and so needs its own confirmation
  step.
