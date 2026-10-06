# 0061 — The interface speaks several languages; what a model writes stays English

**Status:** Accepted (2026-10-05). Nazar approved the work after an analysis
session and delegated the open choices; they are recorded here so later
stages do not reopen them.

## Context

The dashboard was English only. The interface is to read in English,
Ukrainian, German, Spanish, French and Hindi, with more languages later. An
AST scan measured the job (±10 %): about 3 500–3 800 strings and 24 000
words, 983 JSX text blocks (176 with interpolation, 87 with inline
elements), 96 inline English plural ternaries in 49 files, and 63 `Intl` /
`toLocale*` calls, most of them with `'en-US'` written out.

Four facts shaped the design:

- A quarter of the words live outside `src/web`: pure modules (the funnel,
  the schedule, the score lines, the location reasons) that word a sentence
  and take no request. Passing a language through every signature would
  touch hundreds of functions and every test that calls them.
- About 2 950 English strings are asserted in the existing tests.
- Browser modules in `src/web/public/` are dependency-free and served as
  they are; whatever formats a message on the server has to run there too.
- The worker sends Telegram and Discord messages with no request at all.

What a model writes is a different matter. The prompts are one English set,
measured and versioned; a verdict, a suggestion or a review comes back in
English, and its wording is anchored to the resume's own text by code.

## Decision

- **Interface only.** Translated: everything the code writes for a person,
  the code-written explanations included (score lines, location reasons, the
  funnel, the summary checklist), and the alert messages. Not translated:
  prompts, anything a model writes (rendered inside `lang="en"`), resume and
  cover-letter content and the clean render, logs, CLI and launcher output,
  CSV values, and the legal applicant notice (`screening/notice.ts`). A
  posting's title, company and place stay as posted.
- **The language rides in the context.** `src/i18n/locale.ts` keeps it in
  `AsyncLocalStorage`, as `web/display-zone.ts` keeps the zone:
  `withLocale(locale, fn)` and `currentLocale()`, English outside any
  context. The dashboard's request middleware sets it; the worker sets it
  per tick. No pure module changes its signature, and a test that sets
  nothing reads the English it always read.
- **One flat JSON catalog per language**, `src/i18n/catalog/<code>.json`.
  `en.json` is the source and its keys are the type of a key, so a misspelt
  key does not compile. Messages are written in a subset of ICU
  MessageFormat: `{name}`, `{n, number}`, `{n, plural, …}` with `#` and
  `=N`, `{x, select, …}`, and simple tags for inline elements. An apostrophe
  quotes only before `{`, `}`, `<` or `#`.
- **Our own formatter, no library** (`src/i18n/message.ts`, pure, over
  `Intl.PluralRules` and `Intl.NumberFormat`). It is small enough to serve to
  the browser modules as it stands, which no i18n library allows under the
  `public/` rule. `t(key, params)` gives text; `web/rich.ts:tRich` gives the
  same message with each tag rendered by the page, so a sentence with a link
  stays one message.
- **A string ships with its translations.** `catalog.test.ts` fails a
  language that lacks a key, has a key the source lacks, asks for other
  arguments or tags, or writes a plural in other forms than
  `Intl.PluralRules` reports for it (four in Ukrainian; `many` in French and
  Spanish). Reading the English message for a missing key is a safety net.
- **Dates, numbers, lists and names go through `src/i18n/format.ts`**, in
  the current language, with Latin digits in every one. `'en-US'` stays
  written out where it is a computation, a prompt or a CSV. Relative time
  and durations ("5m ago", "1.5s") are catalog messages, not
  `Intl.RelativeTimeFormat` or unit formatting: CLDR's narrow forms are
  uneven (measured on ICU 78: French "-5 min" and "+6 j", German "vor 5 m",
  Ukrainian "1200,0х" for minutes), and a message is ours to word.
- **`AppSettings.locale`**, NULL until someone chooses. The language never
  changes by itself (`web/language.ts:resolveLanguage`): a stored choice
  wins; with none, a first run opens in the browser's language and finishing
  setup stores it; an install already set up stays English and shows one
  line in the browser's language, whose two answers both store a choice.
- **A language has a stage** (`locale.ts:LOCALES`). `ready` and `beta` are in
  the switcher; `beta` means machine-translated from the glossary and not yet
  read by a native speaker, and says so with a link to the catalog files.
  `unfinished` is reachable only from a folded list on Settings → General
  while pages are still being moved to the catalog. English and Ukrainian are
  read by the owner; a language opens in the switcher only after the last
  stage.
- **The switcher** is at the bottom of the menu, on the wizard's first step
  and on Settings → General: the language's own name beside a globe, never a
  flag. It is a native popover and a POST, with no script.
- **The pseudo-language is the meter.** Stored as `en-XA` (never offered),
  it renders English with everything from the catalog and the format module
  in ⟦ ⟧. `pseudo.ts:hardcodedText` reads what is left outside the brackets
  off a page, and the route smoke adds it up over every page. Data says it
  is data with `translate="no"`; a model's text with `lang="en"`.
- **The glossary is a file** (`docs/translating.md`): the address form per
  language (uk «ви», de «du», fr «vous», es «tú» without vosotros, hi «आप»),
  what stays in Latin script (technologies, vendors, models, file formats,
  "ApplyPack"), and the product's terms in each language.

## Consequences

✅ A page is translated by replacing its strings with keys; nothing else
about it changes, and the English tests stay as they are.
✅ The worker, a script and a browser module read the same catalog through
the same formatter.
✅ The count of English left in the code is printed by CI on every run.
❌ A message is found by its key, not by its words: reading a page's source
means reading `en.json` beside it.
❌ A model's verdict stays English inside a translated page. Translating it
would be a second call per verdict, or a prompt per language with its own
measurements.
❌ `t()` called while a module loads reads English, whatever the request:
a constant that holds words has to become a function or a key.
❌ Every new string costs a line in each catalog, in the same PR.

## When to revisit

- A user asks for the model's text in their language, and a measured prompt
  set for that language exists.
- A right-to-left language is asked for: the layout has no logical
  properties yet.
- The catalog format needs something the subset lacks (ordinals, gender
  through more than `select`): take a library then, on the server only.

## Addendum (2026-10-06): stage 2, and two statements ahead of the code

- "The worker sets it per tick": not yet. In v2.51.0 no worker code calls
  `withLocale`, so alerts, the recap and the reminders are English until
  stage 4 sets the language per tick and per run.
- "Small enough to serve to the browser modules as it stands": `message.ts`
  is TypeScript and `public/` serves `.mjs` with no build step, so stage 3
  adds an `.mjs` mirror held to it by a parity test, as `score.mjs` is to
  `resume/score.ts`. The ✅ about the worker and the browser modules holds
  once stages 3 and 4 are done.
- v2.51.0 moves the job seeker's pages to the catalog. A value the code
  stores or compares keeps its English and is worded on the way out
  (`i18n/places.ts` beside `countries.ts:placeLabel` and
  `location.ts:WORKPLACE_LABEL`); a page title that is data takes
  `PageHeader`'s `titleIsData`; a code-built sentence that can be the
  model's own says so (`score-lines.ts:Advice.modelWritten`) and is rendered
  inside `lang="en"`.

## Addendum (2026-10-06): stages 3–5, and Ukrainian opens (v2.52.0)

- **The worker** reads the stored language at the start of every run —
  each cron beat, the folder-watch check and the fetch retry, every
  once-script (`src/run-locale.ts:inRunLocale`); no language or an
  unreadable database is English. A Telegram or Discord message words its
  sentences through `notify/markup.ts:tMarkup`, which escapes every text part
  of a tagged message for its channel and writes the tags as the channel's
  markup; a posting's title, company and place stay as posted.
- **The browser modules** word through `public/i18n.mjs`, the `message.ts`
  mirror (`web/i18n-mirror.test.ts` runs every message of every catalog
  through both). English comes from the generated `public/i18n-en.mjs`
  (`npm run i18n:browser`, every `browser.*` key), the page's language from
  the JSON `layout.tsx` embeds when it is not English (about 5 KB gzipped).
  The country picker searches and writes names in the page's language and
  round-trips through `places.ts:countryChip`.
- **What the code stores** keeps the rule of stage 2 where it can: an error
  shown on a page and kept as a note carries an English `message` and a
  `reason()` in the reader's language (`resume/docx-text.ts:ResumeTextError`),
  and a stored note is read back into the reader's language
  (`storedReadNote`, `screening/redact.ts:noteWords`). A reason a run stores
  verbatim — a discovery probe's error, a folder file's note, a pack's
  "why" — is written in the language that run had: one person uses an
  install, so a switch leaves earlier lines in the earlier language, and a
  check that reads such text (`/HTTP 4\d\d/`) keeps its English token.
- **The pseudo-language pass is a gate** (#356): one run of English outside
  the catalog on any page fails the route smoke. Data says it is data in the
  markup — `translate="no"`, `lang="en"` for a model's words, `Layout`'s and
  `PageHeader`'s `titleIsData`; an `<option>` that is mostly data is marked
  whole, which only keeps a browser's translator off it.
- **Ukrainian moves to `ready`.** A wizard read in English stores no
  language at setup (`locale.ts:languageKeptAtSetup`, #355), so an install
  set up before a language existed can still be invited to it; the
  invitation shows above the page below the `lg` breakpoint (#358).
