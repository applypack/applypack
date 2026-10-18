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

*Amended 2026-10-11 (v2.55.23, #394).* A file that is damaged, or not
UTF-8, was read wrong with nothing said. Four rules now hold for every
reader of rows, and the first for saved postings too:

- **Bytes that are not UTF-8** (`datasets/decode.ts`). A file that is
  neither UTF-8 nor marked UTF-16 is in the one-byte encoding of its
  language. A saved page says which in its head, and is believed; a table
  says nothing, so it is read as Windows-1251 when most of its letters past
  ASCII stand in runs of three or more (words), else as Windows-1252, and
  the preview says the encoding was assumed. UTF-8 with a few bytes damaged
  stays UTF-8, and the characters that could not be read are counted.
- **A quote that never closes** (`delimited.ts`) used to run to the end of
  the file as one cell, so every row after it became part of one row and the
  file was counted as read. The rows before that quote's row are read, the
  line is named, and the caller is told (`FoundRows.cutAt`).
- **JSON that stops short** is refused as that. It was handed to the table
  reader, which made columns out of its first line.
- **An object that holds its rows by key** (`{ "a1": {…}, "a2": {…} }`) is
  those rows when they are alike; a tab that opens the first line of a table
  is an empty first header, not a blank to trim.

What was lost is said where the file is judged: on the import's preview, on
a folder's Check page, and in the folder's ledger (addendum below).

*Amended 2026-10-11 (v2.55.25, #395).* "The only list of objects inside"
was taken for the rows even when the object around it was itself a posting:
a schema.org `JobPosting` saved as `.json`, with two places in
`jobLocation`, read as two rows of `@type, address`, and a folder of one
posting a file failed as "files do not fit the mapping". The mapper now
says how much of a posting an object names (`map.ts:postingFields`: its
title, link, text, company, place, date), and a list inside an object is
that object's own — its places, its skills, its company's offices — when
the object names a posting and the list's entries do not, or name much less
of one. A key that says "rows" (`data`, `items`, `results`, `records`,
`jobs`) is still believed outright, and an object that names little more
than its entries is still their wrapper: a feed with its title and text, a
company with its openings. In a folder, a file holding one object that names
no posting — a tool's stats, a manifest — is set aside, not counted as a
misfit: counted as one, it failed every look that read nothing newer.

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
  *Amended 2026-10-12 (v2.55.42, #404):* the guard held only through a
  hint — Import posted the selects as they stood, so a column changed and
  never previewed was stored unseen. The import route now compares the
  posted mapping with the one the preview was drawn from
  (`map.ts:sameMapping`); when they differ it keeps the new one, stores
  nothing and answers with the preview. The rows of an upload also wait a
  fresh half hour when an import ends with anything but a full store
  (`import-stash.ts:keepImport`): its warning names the preview, and an
  import can outlast the half hour its upload had.
- **An id column is believed.** A column named like an id tells the rows
  apart; the link is the fallback.
  *Amended 2026-10-12 (v2.55.55, #403):* an `ID` that only counts the rows
  names another posting once the sheet is sorted again, ids that repeat fold
  two postings into one, and a number past 2^53 arrives from `JSON.parse`
  without its last digits. `map.ts:weakId` reads the sample for those three,
  and `detectMapping` passes such a column over when a link can tell the
  rows apart; the select says why (`idNote`). `mapRow` is unchanged on
  purpose: a source keeps the mapping its rows were stored under, so a
  newer export into it still recognises what it holds — changing how its
  ids are read would store every row again, and score it again.
- **Pay and dates are read as written, or not at all.** An amount is a
  number; a date is ISO, a month's name with a year, or an epoch.
  *Amended 2026-10-12 (v2.55.56, #403):* "as written" left out how pay is
  written. `"$90,000"`, `"90k"`, `"€65.000"` and `"65000 EUR"` in the from
  and to columns read as nothing, so no `Salary:` line was written and the
  low-pay dismissal never saw the pay. `map.ts:money` reads a sign or a
  currency code around the digits and a `k` or `m` after them; a sign only
  one currency uses is that currency, and `$` stays `$` — it names several.
  A date with a space before its zone (`2026-10-05 10:00:00 +02:00`, as a
  database prints it) is read; and a month's name with a year is a date
  only when nothing else is in the cell: "You may apply 2026" was 1 May.
- **Markup is stripped once, from the description.** A body that carries
  tags goes through `stripHtml`; every other field is kept as written.
  *Amended 2026-10-12 (v2.55.57, #403):* "as written" stored a title
  `<img src=x onerror=…>Staff Engineer` and a company `Evil <b>Corp</b>`
  with their tags — escaped on every page, so never run, and shown as tags
  on Jobs, the job page and in each message. A title, a company and a place
  now go through `http.ts:stripInlineTags`: entities decoded, then every tag
  the text itself closes, and the ones nothing closes. A "<" that is not
  markup stays ("C++ <-> Rust", "A < B Ltd", and `a<b and c>d`, which has a
  tag's shape and closes nothing). The description has three readings
  instead of two: markup that makes the lines (`<p>`, `<li>`, `<br>`…) is
  rebuilt by `stripHtml` as before; markup that only dresses words — a link,
  a bold phrase, written out or escaped — is taken out and the text's own
  newlines stay, where `stripHtml` flattened every paragraph of a plain-text
  posting that held one `<a>`; anything else is text.
- **An import is a burst of postings.** Every row takes the path a fetched
  posting takes, alert included.
  *Amended 2026-10-12 (v2.55.54, #402):* so a file of 2,000 rows, 300 of
  them matches, sent 300 messages in one run, and the preview said nothing
  of it. A file is one event: its matches are held as they are scored
  (`ProcessOptions.groupAlerts`) and leave as one message a chat when the
  import ends, the best twenty listed and the rest counted
  (`alert-delivery.ts:deliverHeldAlerts` narrowed to the source); what the
  schedule or the Alerts switch keeps back leaves with the next heartbeat.
  The preview has the folder's **Alerts** choice — with "No alerts" nothing
  is sent or held and no pack is queued — offered with no alerts above
  `preview.ts:QUIET_ABOVE` (20) new rows, and it says how many rows could
  match and how many packs at most (`packsUpTo`).
- **The people filter knows names and two shapes of value, not meaning.** A
  person's name in a column called `Field7` cannot be told from a company's.
  The preview shows what each field took, and the user decides.
  *Amended 2026-10-12 (v2.55.58, #403):* it also hid facts about the job
  whose names hold one of its words: `workAuthorization` ("author"),
  `isRecruiter`. `map.ts:JOB_FACT_RE` cuts those fragments out of a name
  before it is asked about people — a permit to work, a yes/no about who
  posted, working in person, ownership, a membership — so `authorEmail` and
  `personalEmail` are still left out for what remains.
- **A column is known by its English name.** The alias table held English
  only.
  *Amended 2026-10-12 (v2.55.58, #403):* a sheet with Ukrainian headers
  found neither its title nor its company. `MORE_ALIASES` adds the usual
  header words of the interface's other languages (Ukrainian, Spanish,
  French) and German, tried after the English ones.
- **Reading a file's shape.** Three more readings changed in v2.55.58
  (#403). A table wider than 200 columns was refused whole; it now keeps
  200 — the columns named like a job's fields, then the first of the rest
  (`rows.ts:keptColumns`, the same for objects with more keys than are
  offered) — and only a header past 5,000 cells is refused. The delimiter
  was read off the first line alone, a tie going to the comma; it is now
  the one that cuts each of the first ten lines into the same number of
  cells, so a TSV whose header holds a comma is a TSV. And a posting's
  place is read from a schema.org `Place` (its parts are in `address`) and
  from a list of them, joined: "Lisbon, Portugal; Porto, Portugal".
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
- *Amended 2026-10-12 (v2.55.48, #398).* "Under the launcher" was asked of
  the process's IPC channel alone, so a fetch run on a local install from
  anything but the launcher — `node dist/scripts/fetch-once.js`, a dev
  watcher — took the machine for a server, refused a folder under the home
  directory and added to its failure streak. A process that found its
  database through the install's own data folder (`db.json`) is that
  install too (`local/install.ts:localInstall`), and the same rule applies
  to it. A server is given its database in the environment and is not. And
  the refusal for the system's own folders now names the way out: a cloud
  drive lives under `~/Library` on a Mac, and a synced folder named in
  `APPLYPACK_INBOX_ROOTS` is read like any other root.
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
- *Amended 2026-10-12 (v2.55.46, #432).* Twenty files a look, whatever
  their size, made a tool that writes one small file a posting bring twenty
  jobs an hour: a run of 455 files took 23 hourly checks. What a look of
  rows costs is rows and bytes, so those are its ceilings now: 5 000 rows
  as before, 25 MB read (`MAX_ROW_BYTES_PER_LOOK`: five files of the
  largest size), and 400 files (`MAX_ROW_FILES_PER_LOOK`) to bound a folder
  of tiny ones. The same 455 files take three checks. A folder of saved
  postings keeps twenty a look: a posting can be a model call, and that is
  its spending limit. And a file a look did not reach — past a ceiling, or
  behind the rows the look used up — is noted in the ledger as waiting
  (`folder-scan.ts:unreachedChanges`), once, when the ledger has no row for
  it: before, the per-file list did not show it and the folder's row did
  not count it.
- *Amended 2026-10-10 (v2.55.11, #393).* The import's 2 000 rows a body
  first applied to a folder's file too: it was read to its 2 000th row and
  marked done, and a tool that appends to one file stopped yielding there.
  The ledger now keeps how many rows of a file were read
  (`source_file.rowsRead`). A file with more rows than the look has left
  waits and is read on at the next look; a file that only grew — its first
  bytes still hash to what was read — is read from its old end; any other
  change is a file written anew, read from its start, where the rows
  already stored are duplicates. The count is kept only with the hash of
  the bytes it was read from, so a look that could not read the file starts
  it over. A file rewritten whole more often than its rows can be paged
  through is read at its head each time and keeps saying so.
- A file where fewer than half the rows read as a job no longer fits the
  mapping: none of it is handed over, and it is not read again until it
  changes or the mapping is saved again. When every file a look reads
  misfits, the look fails as `bad_payload`, which is how a tool that changed
  its output shows on the source's row.
- *Amended 2026-10-12 (v2.55.43, #405).* A folder that holds more entries
  than a look lists (`MAX_ENTRIES`) was filed under the same `bad_payload`,
  so its row read "Files do not fit the mapping" and the flash pointed at
  the mapping. It is a status of its own, `too_many`, worded "Too many
  entries in the folder". A status the last check failed with also shows
  in the folder's own card (`folder-words.ts:folderTrouble`), whose line is
  built from the ledger and said only what earlier checks had read; and the
  card carries the switch for a folder added switched off.
- *Amended 2026-10-11 (v2.55.23, #394).* A file read to the end of what
  can be read, with a part lost — a quote never closed, characters that
  could not be read — is `done` and its ledger row says what was lost: the
  per-file list calls it "Read in part" and the folder's row counts it
  ("1 read in part"). It is settled like any file that was read: read again
  when it changes, from its old end when it only grew, which is how a file
  caught half-written is completed. JSON that stops short is set aside with
  those words rather than as "no rows in it". Files read before this version
  keep the row they have; nothing is read again on the upgrade, because a
  second reading would also score rows an older search turned away.

**The ledger advances only after the jobs are stored.** The fetcher never
touches the database. It stages what the look learned
(`fetchers/folder-ledger.ts`), and `runFetchJob` writes it
(`jobs/source-file-store.ts`) under the rule `conditional.ts` keeps for
validators: only when `tickStoredEverything()` agrees. A tick that was
paused mid-run, or lost a classification, drops the staged look; the next
one reads the same files again, and rows already stored are duplicates that
cost nothing.

*Amended 2026-10-11 (v2.55.24, #396).* The folder's ledger decided once,
from the moment of a look, and four of those decisions were wrong or never
revisited:

- **The look's own clock.** A look measured a file's age against the time
  the walk started, so a file written minutes into a long walk was dated
  ahead, counted as settled and read half-written. A look now takes its own
  time; a file dated up to five minutes ahead of it waits like one just
  written, and one dated further ahead (a clock set wrong) is read, since
  waiting for it would never end.
- **A table's last row with no line end** is left for a later look until
  the file has been still for two minutes (`OPEN_ROW_SETTLE_MS`). A tool
  that writes through a buffer leaves half a row at a file's end long after
  the ten seconds above; read at once it was stored with half a title and
  no link, and the whole row never, because the next look read on after it.
  A whole file that simply ends without a line break has its last row read
  one look later. JSON Lines needs no such rule: a cut line is not a row.
- **"Everything stored" is asked a folder at a time**
  (`folder-ledger.ts:looksToKeep`). One posting no model would score, on any
  source, failed every tick and so dropped every folder's look every tick:
  each folder read its first twenty files again each hour and never reached
  the twenty-first. A tick that ran to its end keeps the look of every
  folder none of whose postings went without a verdict; a tick that stopped
  early still keeps none. Validators keep the stricter rule: a full read is
  all it costs them.
- **"Read every file again"** on the Files page of a folder of rows. A file
  is read once, so a row a search or a mute turned away was never looked at
  again when the search changed or the company was unmuted, which
  [ADR 0056](./0056-mute-an-employer-and-a-reapply-window.md) promises ("the next tick meets
  the posting as new"). The button puts the files the last look listed back
  to waiting; the next looks read them from their first row, twenty a look,
  behind any new file. Rows already stored are duplicates; rows admitted now
  are scored. Doing this by itself when a search or a mute changes is not
  built (#448).
  *Amended 2026-10-12 (v2.55.59, #448):* the person at least learns of it
  where the change is made. Saving a search whose filter fields changed
  (`filter.ts:filterChanged`), or one that starts to run, and unmuting a
  company add a sentence when switched-on folders of rows hold files already
  read (`source-file-store.ts:foldersReadOnce`): how many, and where the
  button is. Nothing is read again by that.
- **A row's date.** A stated date was held against the *file's* time, so a
  file stamped 1980 (out of an archive) turned every later date away as "in
  the future" and gave all its rows 1980. It is held against the clock. A
  row that states none takes the file's time only when that can be a date:
  not ahead of the clock, not before 2000 — else now, as an uploaded row
  does. A saved posting's file follows the same rule. Saying "Saved" rather
  than "Posted" for such a date needs the row to know whose date it is
  (#379).

*Amended 2026-10-11 (v2.55.28, #397).* **A folder's disk is given 30
seconds to answer** (`datasets/folder-deadline.ts`, `FOLDER_ANSWER_MS`). A
folder on a sleeping NAS or a hard NFS mount never settled a file call, and
the fetch that asked held the fetch lock for ever: every source stopped
until the worker was restarted. Every call the reader makes now has a time
to answer in; a look whose folder does not answer fails as unreachable
(`network`, counted in the failure streak) and the lock is given back. The
call that was left behind cannot be cancelled and holds a thread, so while
it is out the folder is asked nothing more: the next looks fail at once,
and the folder is read again when the disk comes back.

**ApplyPack never writes into the folder.** No "processed" subfolder, no
rename, no delete. `datasets/folder-io.ts` is the one module that touches
such a folder, it opens files for reading only and without following a
link, a file's real path must lie beneath the folder's, and a test holds
the module to that call by call. The one folder ApplyPack creates is an
empty `~/ApplyPack/inbox`, on a local install, when the user presses the
button for it.
*Amended 2026-10-12 (v2.55.49, #398).* Two more conditions on a file
before its bytes are read: its path is resolved again once the file is
held open and must still be what it was, and a file with a second name on
the disk (a hard link) is passed over as a link is, with the same line on
the per-file list.

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

*Amended 2026-10-10 (v2.55.12, #390).* Both halves of that id misfired. One
opening in two cities shares a description and merged into one job, as did
two postings whose block names the careers page as its `url`; the same
address with another campaign parameter, or a note appended to a `.md`,
split one posting into two. The rule now (`posting-file.ts`):

- The id is the role and the place the page's block states, with the
  page's own address reduced by `normalizeUrlKey`, else with its text. A
  file that states nothing and has no address keeps the id it always had.
- Of several postings on one page, the page is about the one whose `url`
  is the page's own address (the browser's note, the canonical link,
  `og:url`). With none named so the page is a list: no facts are read off
  it and its address names no posting (`saved-page.ts:ownPosting`).
- Changing the rule re-keys what is stored, so a file is first asked
  whether the folder holds it already (`identifyPosting`): under the new
  id; under the id the earlier rule gave it, when the stored job has the
  title the page states — the earlier id was the one different postings
  shared; or as the job this very file became, when it is still that
  posting: the same stated title and company, or for a file that states
  none the text it had with up to 4,000 characters of notes under or over
  it (exact, by the hash that was its id, so a few lines about a job
  qualify), or a fingerprint within 12 bits (measured on 437 stored
  descriptions: a note appended moves it 11 at most, two different
  postings stand 32 apart at the median). Stored rows are never rewritten.
- That question comes before the model call, so a posting the folder
  holds costs nothing, and its file says "The same posting as <file>".
- Likeness is asked of the same file only. Across files it would join the
  two cities again, so one posting printed to PDF twice under two names is
  still two jobs. Replayed over 605 stored descriptions: a note of one or
  of five lines kept the job in 605 of 605, and another posting saved over
  the same name was taken for the old one in 3 of 6,593 pairs, each a twin
  of it (one role, two teams).
- A migration puts files that were counted as read and have no job that
  names them back to waiting (read in the last 30 days only: past that a
  dismissed job is deleted, and its file would bring it back).

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
so a saved posting never costs the hour its search. *(Amended 2026-10-11,
v2.55.28, #397: the tick waits for whoever holds the lock, up to 50 minutes,
and a look that only met another fetch leaves no row on /runs —
[ADR 0003](./0003-no-queue-just-node-cron.md).)* A folder deleted, or
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

*Amended 2026-10-11 (v2.55.26, #399).* Four ways a saved posting was
skipped or misread, with nothing said:

- **A page saved as one file.** Chrome and Edge offer "Webpage, Single
  File" (`.mhtml`) and Safari saves a Web Archive by default; both were
  "other files". `.mhtml` (and `.mht`) is read (`datasets/mhtml.ts`): a MIME
  message whose first `text/html` part is the page, with where it was saved
  from in its head, which is taken as the browser's own "saved from" note.
  Measured on a file Chrome 154 wrote: the browser leaves every `<script>`
  out, the `JobPosting` block with them, so such a file gives the text and
  the address and always asks a model for the title and the company.
  `.webarchive` is listed and set aside with the way to save it instead;
  reading it is #451. Up to 10 MB, since the page's images ride inside.
  *Amended 2026-10-12 (v2.55.60, #451):* `.webarchive` is read
  (`datasets/webarchive.ts`). It is a binary property list; the page is
  `WebMainResource.WebResourceData`, as Safari received it, with its charset
  and its address beside it. Three keys are looked up and nothing else in
  the archive is walked; every offset is checked against the file first.
  Safari keeps the page's scripts, so unlike an `.mhtml` the `JobPosting`
  block is there and such a page usually states its own title and company.
  An archive that cannot be read — damaged, or of something that is no page
  — is still set aside with the way to save the page instead.
- **A subfolder beside a page.** Any folder whose name began with a page's
  name was taken for that page's saved files, so `Acme interviews/` next to
  `Acme.html` was never listed. Only the names a browser gives such a
  folder count now: `_files` and its forms in other languages.
- **`<main` matched `<mainnav>`**, and a page's navigation was stored as
  the posting. The tag's name is matched whole, opening and closing.
- **Three shapes of the structured block fell to a model** though the page
  states its title: a string broken across lines (mended and read again;
  nothing else about a block is guessed), `hiringOrganization` as a list,
  and `@type` as an IRI.

What is shown to the model, and a page that is no posting at all, need a
real engine to judge and are #451.

*Amended 2026-10-11 (v2.55.39, #361).* **A page's `<main>` is not all
posting.** A board that puts the application form in the same `<main>` as
the posting, and carries no `JobPosting` block, had the form stored as the
end of the description — on two real pages 3,705 and 2,584 characters of
8,211 and 10,496: every question, each "Select…", "Submit application" —
and read by the classifier and every comparison after. Inside the page's
`<main>` or `<article>` two things are now left out
(`saved-page.ts:postingOnly`):

- an **application form**: a `<form>` with three or more fields to fill in
  (`APPLICATION_FIELDS`; a hidden input and a button are not fields). A
  search box has one, and a site whose every page is one form, the posting
  inside it, has none;
- **navigation**: a `<nav>`.

When what is left would be too short to be a posting (under 200
characters: the page of the form alone, or a posting written inside the
form with its fields) the text stays whole. A page with no `<main>` and
no `<article>` is read as it stands: with no container to say where the
posting is, a form may be all of it. `<aside>` and `<footer>` stay — a
page may state the place and the pay there — and nothing is cut by its
words ("Apply for this job" is also the button at the head of a page), so
a heading the board writes outside its form is still there.

A page with neither a block nor an address of its own is keyed by its
text, so this re-keys it. `identifyPosting` asks one more question before
the last: the id over the text as it was read before, form and all
(`SavedPage.former`), under both earlier rules. A page saved again is the
job it was, and no model is asked. Stored rows are never rewritten: a job
read before keeps the text it has.

*Amended 2026-10-18 (#451).* **The call that reads a saved posting is shown
the page's own `<title>`** (`SavedPage.pageTitle`), fenced as a block of its
own beside the text. It is the best line on a single-file save, which never
carries the structured block, and on a page whose block names no company.
Measured with the scoring task's engine (the Claude Code CLI's Haiku) on
twelve pages built from stored public postings — six `.mhtml`, six `.html`
whose block names no company: the company was found on 5 before and 9
after; the four it gained are named in the title alone. None answered a
company the page does not name. One answered the job board in its title
("… – Remote | Himalayas") on a page that names no company anywhere: the
model did not know the name for a board's, and a sentence more in the
prompt did not change that. One title names a recruiter whose text says
"our client", and that page stays without a company, as the rule asks.
