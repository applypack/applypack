# 0053 — Uniqueness lives in the database, and a row's state is written with the row

**Status:** accepted (2026-09-10) — audit 2026-09-10 (DATA-3, DATA-7, DATA-8, DATA-10), TASKS §20 block `data-integrity`

## Context

Three places kept an invariant by reading before writing: "this bot and
chat are not added yet" (a bare `create` on `notification_target`), "this
file is not in the screening yet" (a list read once at the top of the
upload loop), "this posting is not pasted yet" (`findUnique` then
`create`). Each held as long as one request ran at a time. Two tabs, an
hourly tick beside a "Fetch now", or a double-clicked submit made every one
of them write twice — two destinations that each get every alert, two
applicants of one person, a 500 on the paste. `Job (companyId, externalId)`
already did it the other way: a unique key, and a `P2002` on the insert
counted as the duplicate it is.

A fourth place wrote a row's state in a second statement: a match found
outside the alert window was inserted NEW and then stamped `alertHeldAt`.
Between the two, a crash left a match with no stamp, which the delivery
pass never picks up — and the unique key on the job means the posting is
never fetched again either.

## Decision

- **A "one of these" rule is a unique constraint**, and the write path
  catches `P2002` and reads it as the duplicate: `notification_target`
  on (`botToken`, `chatId`) and on `webhookUrl` — NULLs are distinct to
  Postgres, so a Telegram row never collides with a Discord one; `applicant`
  on (`screeningId`, `textHash`), where a file no text came out of is
  hashed by its bytes; the pasted job inside one transaction with its
  company row. A request-time check stays where it saves a side effect
  (the target form asks before it sends a test message), never as the only
  guard.
- **The migration collapses what is already duplicated onto the oldest
  row** and re-points what referenced a later copy (a search routed to a
  duplicate destination follows it). A constraint that fails to apply on a
  populated database is worse than none.
- **What is known when the row is inserted is written with the row.**
  Whether a match is held for the alert window is decided before the
  insert, so the stamp goes in the same statement as the verdicts (the
  nested `scores.create` already made a scored job atomic for the same
  reason).
- **The referencing side of a foreign key is indexed** when a delete on the
  referenced table is routine: cleanup deletes jobs nightly, and each delete
  scanned `job` for cross-listings.

## Consequences

- A repeat destination or a repeat file is refused by the database with a
  plain sentence on the page; nothing is written twice.
- Two uploads of the same folder at once produce one row per file, whichever
  tab wins; the loser's copy is counted as a repeat, not an error.
- Existing duplicates disappear at upgrade. Later copies of an applicant
  take their verdicts with them; `sameAsId` pointers to a removed copy
  already read as "no longer here" on the page.
- `alertHeldAt` is never set by a second statement; `deliverHeldAlerts` is
  unchanged.
