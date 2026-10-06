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
(`datasets/rows.ts`). One body is at most 5 MB and gives at most 2 000 rows,
and a table is at most 200 columns wide; rows past the ceiling are counted
and said, never read and never dropped in silence. A row is built from the
cells it has, so what a file costs in memory follows its size.

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
2. **Only mapped columns are read.** A column whose name says it is about a
   person (who posted, who recruits, who owns or made the row, a contact, a
   profile link, an e-mail, a phone, a photo), or whose cells are e-mail
   addresses or phone numbers, is left out of the column list. It cannot be
   mapped, by the page or by a hand-made request, and is never stored.
3. **What arrives is data.** A link is kept only when it is http(s). Every
   field has a length cap, and no control character or half a character
   reaches the database. Markup is stripped to text once, in one pass
   whatever the markup, and never rendered. The description reaches a model
   only through the fenced prompt builders (ADR 0022).
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
- **The people filter knows names and two shapes of value, not meaning.** A
  person's name in a column called `Field7` cannot be told from a company's.
  The preview shows what each field took, and the user decides.
- **The public count of sources does not move.** An import is not a kind of
  source ApplyPack reads from the web; `source-count.test.ts` lists it with
  the pasted job.
- **Not built:** saved postings as files, any account at another service, a
  URL of rows. Each is its own change, and a connector to another service's
  data would have to amend ADR 0005 in an ADR of its own.

## When to revisit

- The ceilings prove wrong in use (a real export that needs more than 2 000
  rows at a time, or less than the preview can hold).
- Value detection guesses wrong often enough that users stop trusting the
  preview: then the guess goes and the select stays.
- Rows start arriving from anything other than the user's own hand, at which
  point rule 1 needs a decision of its own.

## Addendum (2026-10-05): a folder a tool writes into (v2.47.0)

The second way in for the same rows: instead of uploading each export, the
user names a folder that a tool of theirs writes files into, and the tick
reads what is new. Everything above holds; this adds what a folder needs.

**The model.** `AtsType.FOLDER`: the token is the folder's real absolute
path, `sourceConfig` is `{ mapping, include }` (the mapping of the file
import, and an optional name filter such as `jobs-*.json`). Unlike an
import it is a source the tick reads, so it has a switch, an interval and a
health row like any other; `bringsRows` keeps its rows on the aggregator's
employer semantics. The ledger is `source_file`: one row per file of rows
the folder's looks have seen, removed with its source.

**Which folders.** Adding a folder turns its files into postings shown in
the dashboard, so the form is a way to read files for whoever can reach the
dashboard. `datasets/folder-path.ts` bounds it, on real paths:

- Under the launcher (`npm start`: one user, loopback) a folder inside the
  home directory, except a hidden one, the system's own (`Library`,
  `AppData`), and the install's data folder or anything that holds it.
- Anywhere else only a folder inside a root named in `APPLYPACK_INBOX_ROOTS`,
  which whoever runs the machine sets in the environment, never in the
  browser. In Docker that is one read-only mount into both services.
- The rules are asked again on every look, not only when the row is added.
- The path is typed. A browser cannot hand a server a folder, and the form
  does not pretend it can.

**A look** (`datasets/folder-scan.ts`, pure; `fetchers/folder.ts`):

- Files of rows are known by their names (`.json`, `.jsonl`, `.ndjson`,
  `.csv`, `.tsv`), three folders deep; dotfiles and links are passed over.
- A file is read once. One whose size or time changed is read again. One
  changed in the last ten seconds, or that moves while it is read, waits for
  the next look: it is still being written.
- A copy or a rename of a file already read (the same SHA-256) brings
  nothing and is set aside by name.
- Ceilings: 20 files and 5 000 rows a look, 5 MB a file, and a folder of
  more than 20 000 entries is refused whole.
- A file where fewer than half the rows read as a job no longer fits the
  mapping: none of it is handed over, and it is not read again until it
  changes or the mapping is saved again. When every file a look reads
  misfits, the look fails as `bad_payload`, which is how a tool that changed
  its output shows on the source's row.

**The ledger advances only after the jobs are stored.** The fetcher never
touches the database. It stages what the look learned
(`fetchers/folder-ledger.ts`), and `runFetchJob` writes it
(`jobs/source-file-store.ts`) under the rule `conditional.ts` keeps for
validators: only when `tickStoredEverything()` agrees. A tick that was
paused mid-run, or lost a classification, drops the staged look; the next
one reads the same files again, and rows already stored are duplicates that
cost nothing.

**ApplyPack never writes into the folder.** No "processed" subfolder, no
rename, no delete. `datasets/folder-io.ts` is the one module that touches
such a folder, it opens files for reading only and without following a
link, a file's real path must lie beneath the folder's, and a test holds
the module to that call by call. The one folder ApplyPack creates is an
empty `~/ApplyPack/inbox`, on a local install, when the user presses the
button for it.

**What the user sees.** Check reads the folder and shows what a first look
would do, with no AI spent and nothing stored; Add stores the row switched
off. The row says "214 files · 3 new at the last check" and opens a list
that says, file by file, what became of it. A read the system refuses is
explained in words: on macOS it is usually the privacy guard over Desktop,
Documents and Downloads, which is why the offered default is a folder
directly in the home directory.

Consequences added:

- **A folder with nothing new is not a quiet source.** It never ages into
  "silent": no new file is the user not having put one there. A folder that
  is gone, refused, or whose files stopped fitting shows as failing, in a
  folder's words.
- **One folder, one mapping.** Two tools that name their columns
  differently want two folders, or a name filter and two sources.
- **The hourly check is the pace.** A file that lands a minute after the
  tick waits for the next one, or for "Check now" on its row. Watching the
  folder for changes as they happen is not built.
- **Still not built:** postings saved one a file (`.html`, `.pdf`, `.txt`,
  `.md`, `.docx`), the instant watch, and the "from your folder" line on an
  alert.

## Addendum (2026-10-06): postings the user saves (v2.50.0)

The third way in: a folder the user saves postings into by hand — "Save
page as…", a page printed to PDF, a `.docx`, a text or Markdown file. It
closes the three items the addendum above left out. The folder rules, the
ledger, the read-only module and the "stored first, ledger second" rule all
hold unchanged.

**What a folder holds.** `sourceConfig` gains `holds` — `rows` (a tool's
files, as above) or `postings` — and `alerts`. A folder of postings has no
mapping. A config stored before this reads as `rows` that alert, so no
stored row changes. Check guesses from the files' names (more saved
postings than files of rows, or nothing yet, reads as postings) and the page
lets the user switch it.

**One file, one posting, read by code first** (`datasets/saved-page.ts`,
`datasets/posting-file.ts`, pure):

- `.html` / `.htm`: the page's markup only ever becomes text, it is never
  rendered. The `JobPosting` block many job pages carry gives the title, the
  company, the place and the date; its description is the text when it is
  long enough, else the page's `<main>`, else the whole page. The page's own
  address comes from the block's `url` or the "saved from url" comment a
  browser writes — they name this posting — else its canonical link or
  `og:url`, which a careers page that embeds a board may share across every
  posting on it; http(s) only. It becomes the job's link, and it is never
  followed.
- What a browser's "Webpage, Complete" save puts beside a page (`Job_files/`,
  or a localized name) is passed over: a framed document in there is not a
  posting of its own.
- `.txt` / `.md` as they are; `.pdf` and `.docx` through the resume
  module's readers ([0008](./0008-resume-module-in-web.md) addendum), the
  PDF reader loaded on the first PDF.
- Fewer than 200 characters is a note, not a posting, and is set aside.
- Ceilings by kind: 2 MB a page or a text file, 5 MB a PDF or a `.docx`
  (parsed on the event loop, in the worker and in the Check page),
  5 MB a file of rows as before.

**A model reads only what the file did not say.** When the page states its
title and its company, nothing is asked. Otherwise one small call
(`jobs/posting-extract.ts`, the paste path's own, fenced, ledger feature
`posting-extract`) reads them, and the file's name stands in for a title it
could not find. While fetching is paused no model is asked: a page that
states both is stored unscored, the others wait in the ledger.

**A saved posting is a paste, through the one pipeline.** It becomes a job
of the folder's own source row, with its employer as an aggregator's row has
one, and `NormalizedJob.handPicked` set. `processNormalizedJobs` then skips
the search's base filter and the employer gate for it — the user chose it;
a junk first line must not be what gets it filtered out in silence — and
scores, alerts, holds and queues packs as for every job. One difference: a
saved posting every search turns down — or the two-stage prefilter sets
aside — is stored **Saved**, with its verdicts, never Dismissed, which the
cleanup deletes after a month. Its id is never something a model said: the
page's own address when it names this posting alone, so the same posting
saved twice is one job, else its text.

**A model is not paid twice for one file.** A look whose jobs were not all
stored is dropped, and the next look reads the same files again (the rule
above). What the model read off a file is remembered by the file's hash for
the process's life, so that second read asks nothing. And while no running
search can score — every one is blank — no model is asked at all: the
posting waits as it does while paused.

**Where it came from.** `Job.sourceFile` (a hand-written migration) names
the file, for a tool's rows as well. The job page shows "From <folder> /
<file>" linked to the folder's file list, the list links each file to the
job it became, and a match's alert says "From your folder: <folder> /
<file>" where other sources put their attribution line.

**Alerts.** A match is a match: at or above a search's threshold it goes
out through the normal path, under the alert window, the digest, "Alerts
off" and the held matches. Below it: silence, and the job on Jobs. A folder
may set `alerts: off`: its matches are stored and shown, never sent or held
(`alertSourceOff` on the run), and no application pack is prepared for them
on its own — the user asked that folder to stay quiet.

**Read within a minute on a local install** (`jobs/folder-watch.ts`, the
plan `folder-watch-plan.ts` pure). Under the launcher the worker watches
the switched-on folders of saved postings (`fs.watch`, recursive where the
system allows), lets a burst of changes settle for twelve seconds, then runs
the fetch scoped to that one source under the fetch lock, recorded as a
`folder-watch` run. Only a change a look would read counts: not a hidden
file, not a download still in progress (its rename into place does), not
deeper than a look goes. Changes that arrive while a look waits add
nothing. It runs outside the search hours — the user has just saved it — and
never while fetching is paused. A look that meets another fetch tries again
a minute later, and the hourly tick that meets a folder look does the same,
so a saved posting never costs the hour its search. A folder deleted, or
deleted and made again, is watched again at the next minute's refresh. A server stays on the hourly tick: a
change seen through a Docker bind mount is not reliable. The watcher only
notices; it reads nothing and writes nothing.

Consequences added:

- **The worker asks a model outside the classifier** for a saved posting
  that does not state its title and company: at most one call a file, at
  most 20 files a look, none while paused. It is the call a paste already
  makes.
- **A saved posting is never set aside by a filter or a mute.** A posting
  from a company the user muted, saved by hand, is stored and scored: the
  save is the newer word. Jobs still hides it while the company stays
  muted, as it hides every row of a muted company; unmuting shows it.
- **Not built, and not planned yet:** mail with job alerts, links saved as
  `.url` / `.webloc`, a screenshot. Each is skipped as another file, and
  counted.
