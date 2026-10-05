# 0062 — Rows the user brings are read from what they hand over, and nothing is fetched

**Status:** Accepted (2026-10-05). [ADR 0005](./0005-no-linkedin-indeed-workday.md)
is untouched by this decision: ApplyPack still requests no page of the hosts
it names, and no site or tool is named anywhere in the product.

## Context

Postings reached ApplyPack in two ways: a fetcher read a public API or feed,
or the user pasted one posting (`AtsType.MANUAL`, phase 8.2). People also
hold postings in bulk: an export, a spreadsheet they keep, the output of a
tool they run for themselves. Each of those rows cost one paste.

A file of rows is the bulk form of a pasted posting. It is already on the
user's disk, so reading it needs no request, no key and no account anywhere.

What makes it more than "parse a file" is that every file names its fields
its own way. Four row shapes written to match what such tools produce, and a
spreadsheet with the user's own headers, are the fixtures of this decision
(`src/datasets/fixtures/`). Across them the title is `title`, `Position` or
unnamed; the employer is `companyName`, `employer.name` or `Organisation`;
the text arrives as HTML, as plain text, or as an object holding both; the
place is a string or an object with a country code; the pay is a sentence or
four numbers. Rows also carry what ApplyPack has no business keeping: who
posted the job, who recruits for it, their profile links, emails and phones.

## Decision

**What is read.** A body the user uploads on `/jobs/import`: a JSON array of
objects, an object holding one list (`data`, `items`, `results`, `records`,
`jobs`, else the only list of objects inside, a few levels down), JSON Lines,
CSV or TSV. The format is read off the text, never off the file name
(`datasets/rows.ts`). One body is at most 5 MB and gives at most 2 000 rows;
rows past the ceiling are counted and said, never read and never dropped in
silence.

**The mapping is detected, shown, corrected and kept.** `datasets/map.ts`
decides which column is which from the names (an alias table, with case,
spaces and punctuation set aside) and, where the names say nothing, from the
values: all links is the link, the longest text is the description, dates are
the date, short and repeated is the employer. The title is never guessed.
The preview shows every field with a sample and a select to change it, three
rows as they would be stored, and the counts. The mapping the user confirms
is stored in `Company.sourceConfig` and parsed with zod on every read. A row
becomes a job only with a title and an id or a link; the others are counted
by reason.

**Safety rules.** These hold for every source the user brings, this file
import and the ones that follow it:

1. **No request.** Nothing is fetched: not the file's links, not a listing,
   not a company page. What ApplyPack does later with a stored job (the
   liveness ladder, "Is it real?") is what it does with every job, under the
   rules those already have, ADR 0005's host list included.
2. **Only mapped columns are read.** A column about a person (poster,
   recruiter, contact, author, email, phone, photo) is left out of the
   column list, so it cannot be mapped and is never stored.
3. **What arrives is data.** A link is kept only when it is http(s). Every
   field has a length cap. Markup is stripped to text once and never
   rendered. The description reaches a model only through the fenced prompt
   builders (ADR 0022).
4. **Nothing is written to disk.** Between the preview and the import the
   parsed rows wait in the web process's memory, four files at most, for
   half an hour (`web/import-stash.ts`). The uploaded file itself is never
   stored.
5. **The preview spends no AI and says what an import would.** It runs the
   running searches' base filter over the mapped rows and states how many
   are new and pass: that many classifier calls, with the cost line every
   AI button carries. While fetching is paused the rows are stored unscored.

**The model.** `AtsType.IMPORT`: one `Company` row per source the user names
(the token is the name as a slug, so the same name is the same source). The
row is never active and `fetchOne` returns `[]` for it, as for `MANUAL`. Its
rows carry many employers, so they take the aggregator's semantics of
ADR 0056: `NormalizedJob.employer` is set on every row, a name or null, and
the source's own name is never an employer. `source-groups.ts:bringsRows`
says so; `sourceFamily` files the type under the user's own sources, and
`sourceIsEmployer` answers false for it.

**The import is the pipeline every posting takes.** `jobs/import-job.ts`
hands the mapped rows to `processNormalizedJobs`: filter, mute, dedupe,
classify, persist, alert. It takes the fetch lock, because it shares the
classifier with the tick, and is recorded as an `import` run on `/runs`. A
newer export of the same source adds only what is new: the unique key
`(companyId, externalId)` settles it, where the id is the row's own or a
hash of its link.

**Which link is the job's.** The apply link when the row has one on a host
of its own. A link back into a host ADR 0005 names is that site's own
application flow, so the listing link stands instead. `jobs/blocked-hosts.ts`
holds the list, moved out of `posting-url.ts` unchanged so a pure module can
ask the question.

## Consequences

- **A user with rows needs no account anywhere.** The file door serves a
  spreadsheet and a tool's output alike, and makes no promise about where
  the rows came from.
- **The text is the user's to bring, as a pasted posting is.** ApplyPack
  cannot know where a row was written and does not ask. Scoring sends its
  title, place and description to the engine the install runs; a local
  engine keeps them on the machine. The upload page says both.
- **A loose file is classifier spend.** Every new row past the base filter
  is one call. The ceiling, the preview's count and the funnel are the
  answer; a narrower file is the user's lever.
- **A thin row is scored on what there is.** A row with a snippet or no
  description ends with a line saying so and takes the normal path. Storing
  such rows unscored as leads is a later decision.
- **A wrong mapping stores wrong jobs.** The preview is the guard: nothing
  is stored before the user has seen three rows as they would be kept.
- **The public count of sources does not move.** An import is not a kind of
  source ApplyPack reads from the web; `source-count.test.ts` lists it with
  the pasted job.
- **Not built:** saved postings as files, a folder that is watched, any
  account at another service, a URL of rows. Each is its own change, and a
  connector to another service's data would have to amend ADR 0005 in an ADR
  of its own.

## When to revisit

- The ceilings prove wrong in use (a real export that needs more than 2 000
  rows at a time, or less than the preview can hold).
- Value detection guesses wrong often enough that users stop trusting the
  preview: then the guess goes and the select stays.
- Rows start arriving from anything other than the user's own hand, at which
  point rule 1 needs a decision of its own.
