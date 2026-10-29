# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [2.63.29] — 2026-10-29

### Fixed
- A folder source says what it does not read: the Check page and the
  folder's Files list name the folders that lie more than three levels down,
  how many and the first of them, with the way out (move the files up, or
  add that folder as a source of its own). A tool that writes
  `exports/2026/10/28/jobs.json` used to leave an empty source and no word
  about why.

## [2.63.28] — 2026-10-29

### Fixed
- A day the dashboard stores or shows is the day in its own time zone
  (the schedule's), not the UTC day: the day a job entered its stage
  ("In this stage since" in the applications export, the board's tooltip),
  the "Applied on" field, and a screening's date in its title and its
  Markdown. Saving the tracking form without touching "Applied on" keeps the
  date on record; it used to move it back a day east of UTC after midnight.

## [2.63.27] — 2026-10-29

### Fixed
- The watchlist preview says what the first check on "Every posting" would
  score for the companies in the list in front of you — "301 postings on 3
  companies in this list" — instead of a fixed example ("on five companies
  that was 217 postings").

## [2.63.26] — 2026-10-29

### Fixed
- A cover letter started on a job's Cover letter tab leads back to that tab
  when it fails, and its progress page sits under Jobs in the menu. It used
  to offer "Back to Tailor resume", a page the letter never came from.

## [2.63.25] — 2026-10-29

### Fixed
- A suggestion that says there is no change ("No further change —
  JavaScript already implied…") and has nothing to apply is no longer shown
  as an edit or counted among them. Such a card came from the second,
  cheaper call a full report sometimes makes.

## [2.63.24] — 2026-10-29

### Security
- A screening finds the applicant's name below a "CV" heading or a job
  title, with a lower-case particle ("Jan van der Berg"), under a letter's
  signature, or on the line the email address spells, and takes it out
  before a model reads the resume. The name used to be looked for on the
  first line only, so in each of those shapes the model read it. A resume
  in which no name is found at all is held for a look, as one with a leak
  is: "Score it anyway" sends it once someone has read the redacted text.

## [2.63.23] — 2026-10-28

### Fixed
- A screening criterion that names age, sex or children in Ukrainian or
  Russian ("вік до 35", "стать", "діти", "дети") is refused, as it is in
  English. Those words were meant to be refused and never matched, because
  JavaScript reads a word's end only in Latin letters. "Younger than" and
  "older than" a number are refused too.

## [2.63.22] — 2026-10-28

### Security
- A folder source never reads ApplyPack's own data folder, even inside a
  folder named in `APPLYPACK_INBOX_ROOTS`. A named root used to be checked
  first, so a root around the data folder (the home directory, `~/Library`)
  let a folder source reach the database's files.

## [2.63.21] — 2026-10-28

### Fixed
- Tailor resume and Cover letter start again with "A file or pasted text
  here is my own resume" unticked. Since 2.63.13 an unticked box, which the
  browser leaves out of the form, made every start answer "Pick a job source
  and a resume." whatever was picked. A screening reply that names no company
  type for a role is kept for the same reason.

## [2.63.20] — 2026-10-28

### Security
- The check that keeps a fetched posting link on the public internet reads
  two more spellings of an address as private, and Workday's
  `myworkday.com` joins the hosts ApplyPack never requests (ADR 0005).

## [2.63.19] — 2026-10-28

### Fixed
- A posting read from its own page keeps the posting, not the site around
  it. "Refresh the description from it" on Is it real? and a cover letter for
  a pasted link read the whole page, so a company's listing came back with
  its menus first (Vercel's: 17 137 characters, 4 212 of them the job), and
  replacing the description would have stored them. The page is now read as
  a saved posting is: its JobPosting block, else its main content, with the
  role and the employer in front when the block's description leaves them out.

## [2.63.18] — 2026-10-28

### Fixed
- A cover letter is written for a posting that asks for more than the
  resume has. When the model listed eleven requirements the letter leaves
  out, the reply was refused for that one extra item, twice, and no letter
  came back. Every list in a model's reply (the posting brief, the
  comparison, the strength review, the company check, the screening) now
  keeps its first items up to its limit instead of throwing the reply away.

## [2.63.17] — 2026-10-28

### Changed
- Updated dependencies: @anthropic-ai/sdk 1.2.0, docx 9.14.0, dotenv
  18.0.9, unpdf 1.9.1 and @types/pdfkit 0.17.7. The SDK's major version
  sends API version 2026-10-21; ApplyPack sends none of the request fields
  that version refuses (sampling parameters, a document block in an
  assistant message, citations in a user message).

## [2.63.16] — 2026-10-25

### Fixed
- Every on/off switch now says which state it asks for, and the setting is
  set to it. A switch used to flip whatever was stored, so a double click, a
  resubmitted form or "Pause" pressed on a tab opened an hour ago did the
  opposite of its label: fetching resumed, or alerts and employer mode came
  on. Pressing the same switch twice now changes nothing, and a request that
  does not say on or off is refused with a line asking to reload the page
  (#635).

## [2.63.15] — 2026-10-25

### Security
- The dashboard answers only to names it knows: `localhost`, an IP
  address, the name in `WEB_HOST`, and the names listed in the new
  `WEB_ALLOWED_HOSTS`. A page on another site whose name its owner points
  at 127.0.0.1 (DNS rebinding) could read every page of the dashboard and,
  through a folder source, files under the home directory.
- A folder under the home directory is read only while the dashboard
  listens on loopback. With `WEB_HOST=0.0.0.0` under `npm start`, anyone on
  the network could add one; such an install now reads only the folders in
  `APPLYPACK_INBOX_ROOTS`, as a server does.
- The posting guard refuses an IPv6 address that carries a private IPv4
  one: 6to4 (`2002:7f00:1::` is 127.0.0.1), IPv4-compatible and local NAT64
  addresses, and Teredo, with the documentation, discard, site-local and
  multicast ranges.
- RemoteOK descriptions no longer carry this machine's public IP address.
  RemoteOK ends every posting with a "mention the word … and tag R…" line
  whose tag is the base64 of the address that asked for the feed; it was
  stored, sent to the AI engine with the description and shown on the job
  page. New rows are stored without it, and a migration takes it out of
  the rows already stored.
- The sites ApplyPack never requests (ADR 0005) are refused under a
  country's domain too (`indeed.co.uk`, `glassdoor.de`, `linkedin.cn`) and
  under their other names (`lnkd.in`, `angel.co`, `myworkdaysite.com`).

### Changed
- Behind a reverse proxy that passes `Host` through, or when you open the
  dashboard by a machine name (`laptop.lan`, a Tailscale name), list that
  name in `WEB_ALLOWED_HOSTS` (`.example.com` covers every name under it).
  Until then the dashboard answers 403 and says so.

## [2.63.14] — 2026-10-24

### Fixed
- Saving a tailored `.docx` keeps the look of every line it rewrites. A
  line rewritten from scratch (a new title, a new summary) took the look of
  the paragraph above it, so the summary came out bold with the heading's
  rule under it and the title as large as the name. It now keeps its own
  look in the saved version, the Document view, the download and an
  application pack (#631).
- The save's message counts such a line as changed, not as one removed and
  one added.
- A save whose very first line was rewritten from scratch is no longer
  refused.

## [2.63.13] — 2026-10-24

### Security
- Updated zod from 3.25 to 4.6. zod 3 has no fix for GHSA-mrhx-c7xc-m3w5
  (memory exhausted while validating an oversized collection); 4.6.6 and
  later do.

### Changed
- A form refused for a field it needs now says "pick one of the options
  offered" for a missing choice, where it said "Required": zod 4 reports a
  missing option as an invalid one. Every other refusal reads as before.

## [2.63.12] — 2026-10-19

### Fixed
- A PDF resume keeps the title line under the name. When the title had no
  full stop and the contact line opened with an address, the PDF reader
  joined the two, and the clean version kept the address and dropped the
  title. New uploads keep the lines apart, and a resume stored with the
  joined line gets its title back in the clean version.
- The clean version of a file already set in Liberation Sans says so,
  instead of comparing Liberation Sans with itself.
- On a phone, the Tailor page's bar under the editor stays short when there
  is no score: the reason is one sentence and takes the place of the line
  about where edits are kept.
- The live demo on applypack.dev tells a screen reader "Not scored" instead
  of reading out a dash.

## [2.63.11] — 2026-10-19

### Changed
- Updated dependencies: @anthropic-ai/sdk 0.135.0, @hono/node-server
  2.1.5, docx 9.11.0, dotenv 18.0.8 and unpdf 1.9.0.

### Fixed
- A PDF resume's look is still read with unpdf 1.9. Its newer pdf.js only
  gives a font's name when asked for it, so without this the typeface and
  the bold lines of a PDF would have been lost in the clean version and the
  Document view.

## [2.63.10] — 2026-10-19

### Fixed
- On the Tailor resume page, the score ring no longer shows a number for a
  text the last analysis never read. An emptied editor, or another resume
  pasted over it, still scored about 63, because the title, summary and
  latest-role points are the analysis's own reading. Once less than 60 % of
  the analysed text's words are left, the ring shows "—", "Ready to apply"
  and the ceiling line step aside, and the bar under the editor points at
  "Analyse my resume again".
- The live demo on applypack.dev does the same. It also shows the score as
  its two parts (keywords, read as you type; title, summary and latest role,
  graded once by the AI), counts the keywords that appear only in a list of
  terms, and opens at 84, the same number as the AI run beside it.

## [2.63.9] — 2026-10-18

### Fixed
- A cover letter's header names your city and the ways to reach you, in your
  resume's order, and no longer puts your job title among them, even a title
  with a comma ("Software Engineer, Backend").
- AI usage counts the cost and timing of older calls on the
  OpenAI-compatible engine that were saved without a model name: they read
  as gpt-5-mini, the model they asked for, instead of "not priced".
- On a phone, the "Which engine answers each task" table and the
  starter-pack tables fit the screen with no sideways scroll; a pack's board
  shows under the company's name.
- In employer mode, words the AI wrote inside the interface's sentences
  (criteria in the calibration card, sectors in the career line, the Remove
  checkbox's name) are marked as English, so a screen reader reads them with
  English rules.

## [2.63.8] — 2026-10-18

### Fixed
- When a failed hard requirement says a skill is missing in other words ("no
  React anywhere in your resume", "without React") while your resume names
  it, the line under it now says where the skill is, as it already did for
  "absent".

## [2.63.7] — 2026-10-18

### Changed
- The Runs page describes every count in your language: what a discovery run
  checked, held matches sent, careers-page changes reported and the France
  Travail re-check.
- The ATS list under Add one company shows the vendors' names instead of
  codes.
- With no model chosen, Settings, AI usage and the run page name the model
  an OpenAI-compatible engine actually uses, not "CLI default".
- The starter pack preview names each board's vendor instead of a code.
- Check now's progress page talks about the one source you checked, and its
  button after a failure goes back to where you started.
- Opening a Settings tab other than Job search no longer counts your jobs
  for the re-score question.

### Fixed
- A salary whose two ends round to the same figure reads "$92k", not
  "$92k-92k".
- "Cities you would commute to" keeps "Austin, TX" as one city, and that
  city also matches postings that write "Austin, Texas".
- A refused Discord webhook keeps the name you typed.
- Testing a saved Telegram chat now says whether Telegram refused the bot
  token or the chat.
- An OpenAI-compatible engine on this computer (LM Studio, Ollama) with no
  model chosen now uses, on every call, the model its Test used: the first
  chat model the server offers. Before, the Test passed but every call asked
  for gpt-5-mini, which a local server does not have. On a server on the
  internet, the Test now tries the same model the calls use.

## [2.63.6] — 2026-10-18

### Changed
- Tailor resume reuses a posting the dashboard already has when you paste
  it, instead of storing a second copy and reading it twice. On both Tailor
  resume and Cover letter, this also works when you paste only the posting's
  body without its title.
- On a job page, when the posting is remote across a region that includes
  where your search looks, a short line under the classifier's summary says
  so, even when the summary claims otherwise.

### Fixed
- Two different roles from the same agency are no longer marked as copies of
  each other because they share the agency's standard text. Copies marked
  that way before are unmarked when ApplyPack starts.
- A saved job page that states its title, company and description in its
  page data is kept even when the page is short.
- The AI call that reads a saved posting is now counted in that job's "AI
  spent", and AI usage shows it as "Reading a saved posting".
- The AI call that reads a posting pasted into Tailor resume or Cover letter
  is now counted in that job's "AI spent".

## [2.63.5] — 2026-10-18

### Fixed
- The Jobs, Runs, Discovery and AI usage tables fit the page on tablets and
  laptops (768 to 1279 px) instead of scrolling sideways; the title, the fit
  and the status stay in view.
- On a phone, Runs shows each run's status under its name, and Discovery no
  longer scrolls sideways.
- A long word in a narrow column header is hyphenated instead of running
  into the next header.

## [2.63.4] — 2026-10-18

### Changed
- While a saved version's scan is still running, the resume page says so and
  links to its progress, instead of saying "Not scanned yet".

### Fixed
- Saving a version from the Tailor page with a posting no longer leads to
  paying for a second scan: pressing Scan while the first one runs joins it.
- Saving a version, or downloading the Document view, from a comparison of
  an edited draft now writes your changes into your own .docx instead of
  switching to the clean version.
- Fix document properties no longer writes "# " before your name when your
  .docx sets the name in Word's Title style.

## [2.63.3] — 2026-10-18

### Fixed
- The Test button on an AI engine now says how long the model took to
  answer, without the time it spent waiting behind another call to the same
  model on your computer. The number now matches the AI usage page.
- On Node 25 and newer, the scripts you run by hand, and ApplyPack started
  without `npm start`, no longer print a "localStorage is not available"
  warning.
- The last step of `npm install`, which prepares the database client, no
  longer reports to the database tool's maker.

## [2.63.2] — 2026-10-18

### Changed
- A strength review that still lists changes to make no longer scores 100.
- Resume match counts now say what they count: the requirements you have,
  the terms already written in your resume, and the hard requirements.
- A job's Resume match tab and its Tailor page open on the latest comparison
  of your saved resume. One-off files, drafts and a pack's tailored text are
  listed beside it.

### Fixed
- "Add missing keywords to your skills" puts each keyword on the skills line
  it belongs to (Kubernetes under Cloud & DevOps, NoSQL under Data), or on a
  line of its own, never under an unrelated one.
- Suggestions that change nothing ("keep this bullet as is", "nothing to
  remove here") are no longer listed or counted, and suggestion reasons no
  longer use the analysis's internal field names.
- The suggested headline replaces your current one instead of adding a
  second headline under your name.
- A red flag that says a skill appears nowhere is no longer shown when your
  resume names it; flags that cost nothing are shown as cautions.
- When a failed hard requirement says a skill is missing but your resume
  names it, a line under it now says where: only on a skills line, or in
  your resume.
- A suggested rewrite of your contact line can no longer drop or change your
  email, phone or profile links, and Apply refuses such a rewrite from an
  older comparison too.
- Comparing again after saving no longer rewrites the wording you just
  applied.
- The resume scan no longer lists "none detected" under Issues to fix, and
  the strength review no longer shows advice that your own bullets
  contradict.
- The Document view no longer says a draft comparison read "an earlier
  version of your resume". Opened from an application pack, the Tailor page
  explains why its score differs from the pack's.
- A resume whose name is set as a title (a .md file, or a Word Title style)
  has its name, headline and contacts read correctly again.

## [2.63.1] — 2026-10-18

### Changed
- In employer mode, the step that turns a posting into criteria speaks to
  the person hiring, not to a job seeker.
- The screening CSV gives your score adjustment and its reason two columns,
  so a spreadsheet reads the adjustment as a number.
- The engine try says when the scores it compared with came from the same
  model.
- The Board columns setting names the fixed columns: Applied, Rejected and
  Ghosted.

### Fixed
- A screening no longer fails, and spends a second call, when a resume has a
  freelance or self-employed role.
- "Keep 90 more days" on a screening adds 90 days to the date it is kept
  until, and the message writes that date the way the page does.
- The scorecard shows "in use now" in your language instead of the resume's
  own word, keeps a year as a year, and no longer gives a "last used" date
  for a skill the resume does not show.
- The screening table fits a 1024-pixel screen: names, file names and the
  Decision column are readable, and the steering-text badge no longer covers
  the gate marks.
- A scorecard's verdict no longer says "Priority to talk to" next to "Ask
  first".
- Switching alerts on with no chat set up says that nothing will arrive
  until one is added.
- Typing "rust, elixir" and Enter in a list field makes two entries.
- A Go posting no longer shows "Go · Go".

## [2.63.0] — 2026-10-18

### Added
- Cover letter files open with your name, your contact line and the date, on
  A4 paper — or Letter for a job in the US or Canada.
- Rebuild keywords now asks once more before it spends, and says what it
  costs.

### Changed
- The reminder about applications with no answer is a message of its own:
  how many, each job with the day you applied and a link to it.
- A new search made from a second resume is named after that resume when its
  title is already taken.
- Application pack files are named after the company, and "Left for you"
  says the one reason each suggestion was left.
- On narrow screens the Document view on Tailor resume fits the page's text
  instead of the whole sheet.

### Fixed
- A cover letter for a link the dashboard already has no longer stores a
  second copy of the posting.
- Both cover-letter forms keep the resume, the tone and the whole name of
  the person the last letter was written to.
- The fact-check badge on a cover letter updates as soon as an edit is
  saved.
- Progress pages say where the result will appear, name the model that will
  answer instead of "Opus", and a failed comparison goes back to where you
  started it.
- AI usage books "Is it real?" on the Claude CLI under the model that
  answered, with its web searches and the cost of the search helper.
- A queued application pack no longer fills the worker's log with a warning
  every minute.

## [2.62.0] — 2026-10-18

### Added
- After you save a new version of a resume, its page offers both the new
  version and the file you uploaded.

### Changed
- Saving the clean version as a new resume now shows its progress, then
  opens the new resume already read.

### Fixed
- A Markdown resume is read properly: its name, contact details and roles
  are found, and no asterisks or hash marks show anywhere.
- The clean version of a Markdown resume, in the Tailor document view, in
  its downloads and in a saved version, opens with your name and contacts
  and keeps every job under Experience.
- The section-order field takes the section names it lists, such as
  "experience", and says so when it does not know a name instead of quietly
  moving that section to the end.
- A web address or e-mail in the clean PDF is never split across two lines.
- "Download original" returns the file you uploaded, even after you saved a
  newer version.
- A role title no longer keeps empty brackets after its dates are read.

## [2.61.10] — 2026-10-18

### Changed
- On a phone the Overview shows its four counts two to a row and the latest
  matches right under them, before the chart.
- On a screen narrower than 1280 px a job page shows Mark applied and the
  status buttons first, then the tab you opened (the posting's own text on
  the Posting tab), then the details and tracking.
- The watchlist shows how often a company is checked and what it alerts
  about in one column; the Companies list shows each source's kind under its
  name.

### Fixed
- The watchlist no longer draws its selects over each other on a phone or a
  tablet.
- The Companies list fits its box at 1024 px: Active and Delete no longer
  need a sideways scroll.
- "Last fetch" shows when a source was last read, also when nothing it
  brought was kept.
- A folder's Files page has Check now, and a folder can be switched off from
  its card.
- A folder path that Check turns away stays in the form, and the message
  says how to allow a folder outside your home folder.
- A moved folder is logged as one short warning instead of an error with a
  stack trace.
- A failing source's health no longer reads "Folder not found , 1 tick in a
  row" when copied or read aloud.

## [2.61.9] — 2026-10-18

### Changed
- "Fill from a resume" no longer adds an uploaded file to your resumes, and
  the page it lands on can be reloaded safely.
- Adzuna and France Travail keys are saved with one Save, and the card stays
  open to show whether the source is ready.
- Save & re-classify says how many jobs it reads again and what scoring
  costs on your engine; Delete search asks in the page, without a browser
  dialog.
- `npm run db:import` works on a new install that has never started: it
  creates the tables first.

### Fixed
- A search profile, a dashboard address, a score adjustment or a Telegram
  connection that is refused keeps what you typed, and the field to fix is
  marked and focused.
- The country field refuses an unknown country as you type it, as the save
  does.
- A dashboard address typed without `http://` is saved with it instead of
  being refused.
- The Telegram form says where to get the bot token and the chat id, and a
  refused token is no longer blamed on the chat id or shown as raw JSON.
- Role types drafted from a resume as "qa/test automation" become words a
  job title can contain.

## [2.61.8] — 2026-10-18

### Changed
- When a model on your computer cannot fit a prompt into its context window,
  the error now says how much room the call needed and which window size to
  pick. A failed run links straight to the Context window setting.
- "Use it" on a model on your computer says plainly that it answers every
  task when no other engine is set up.
- The settings page now says "default" for a server address you never set,
  instead of "from .env".

### Fixed
- Unticking resume tasks on an engine one at a time no longer leaves
  applicant screening on that engine.
- Skip setup now keeps the AI engine that setup found, as Continue already
  did.
- A local model's recorded call time no longer includes the time it waited
  for the calls before it, so AI usage shows its real speed.
- Pressing Enter in a model field saves in place and shows "Saved", instead
  of reloading the page.
- The local engine's settings no longer mention a "CLI default" or a key it
  does not have. Gemini's Test now says to sign in with `gemini`, and a
  stray "?." and a missing space are gone.
- AI usage no longer warns that local calls which timed out may be on a
  vendor's bill.

## [2.61.7] — 2026-10-18

### Changed
- Settings: the time zone field takes a city or a zone name and suggests
  today's names (Kyiv, Kolkata).
- Settings: when your browser is in another zone, a button offers it beside
  the schedule. Nothing changes until you press it, and the confirmation
  says that every date now reads in the new zone.
- AI usage: token counts are shortened the way your language writes numbers.

### Fixed
- A posting date given without a time (an imported file, a saved page)
  showed as the day before west of UTC. It now reads as that day everywhere,
  for postings already stored too.
- Saving the search hours or the alert timing switched the dashboard to the
  browser's time zone without saying so.
- Two installs on one computer (for example Docker and `npm start`) showed
  each other's confirmation messages.
- In employer mode, the interview questions, the reasons and the criteria
  the AI wrote are marked as English, so a screen reader reads them
  correctly in any interface language.

## [2.61.6] — 2026-10-18

### Fixed
- Title keywords match however a title spells them: "back-end", "back end"
  and "backend" are one word, as are "full-stack" / "full stack" /
  "fullstack" and "node.js" / "nodejs" / "node js". This applies to the
  words you want and the words you exclude.
- A remote job open to all of Europe (or the EU, EMEA and similar regions)
  is no longer set aside as a location mismatch when your search hunts in a
  country inside that region.
- "Score them" and setup's first scoring no longer spend several calls on
  one job carried by several job boards. The copies wait until every other
  job is scored.
- Jobs that "Save & re-classify" scores for the first time now show in the
  Overview chart and the search funnel.

## [2.61.5] — 2026-10-18

### Changed
- Add one company takes a board's link as well as its slug, and reads the
  vendor from the link.

### Fixed
- The hourly check after a "Fetch now" reads your sources again, instead of
  skipping an hour.
- A check that reads no source says why on the Runs page.
- Editing a search, starting one or unmuting a company makes the next check
  read every board in full, so postings the old rules set aside are looked
  at again.
- A Rippling link with a language in it is read as the right company.
- A Hacker News comment that starts with a link is no longer stored with the
  link as its title.
- Discovery's counts now match: a run counts each new board once, and its
  row shows what is left for review.
- "Check now" on a careers page you watch for changes says whether the page
  changed, instead of blaming the network.
- "Unwatch" on such a page stops reading it, and says so.
- A refused "Add one company" keeps what you typed.

## [2.61.4] — 2026-10-18

### Changed
- Messages about jobs stored without a score (paused Fetch now, file import,
  folder check) point at **Score them** on the Overview or Jobs, which
  scores only those jobs.
- Runs and the Overview name each job in your language ("Hourly search",
  "Fetch now", "Score everything again" …) instead of its internal code.
- A run's count of rows written says "stored", and Runs → By source calls
  its column "Stored".
- The pause banner says what a pause does and how to resume.
- The salary hint in dollars converts the whole range ("≈ $62k-69k/yr"), or
  says "up to" when only the top is known.

### Fixed
- A filter summary names the rest of its reasons as "and N more", and no
  longer repeats one number twice.
- A Jobs link to a page past the end opens the last page instead of saying
  nothing matches.
- The "postings from muted companies are hidden" line counts only what your
  current filters would show.
- Re-classify always says the score it came back with, including "as
  before".
- A board link no longer suggests the board vendor (like "Ashbyhq") as the
  company's name.
- Help text no longer mentions source files, decision-record numbers or
  release numbers; a folder that moved shows its problem in words on Runs.

## [2.61.3] — 2026-10-18

### Changed
- Pages, styles and scripts of the dashboard are sent compressed: a page is
  about a fifth of its size, which matters on a server install reached over
  a network or a phone on Wi-Fi.
- `npm install` no longer warns about install scripts on npm 11, and no
  longer reports advisories in the tools that build the stylesheet, which
  ApplyPack never runs.
- The cron scripts you run by hand (`cleanup`, `digest` and the rest) end
  with one line saying what the run did.

### Fixed
- Starting ApplyPack no longer lets the database tool report to its maker's
  server: nothing leaves your computer but the calls to the AI you chose and
  your own chats.
- While a model server on your computer is not running, the terminal shows
  one line per call instead of a stack trace and two warnings, and nothing
  while ApplyPack rests that engine.

## [2.61.2] — 2026-10-18

### Fixed
- After setup finds the AI on your computer (the Claude Code CLI, for one)
  and you press Continue, Settings → AI & costs lists that engine as the one
  in use, instead of an Anthropic API without a key marked "#1, not
  available" beside a "last resort" doing the work.

## [2.61.1] — 2026-10-18

### Changed
- When a saved job page doesn't state its company, ApplyPack also reads it
  from the page's title, so more saved postings show who is hiring ("Senior
  Backend Engineer at Fennel Works | Careers").

### Fixed
- A page saved into a postings folder by mistake (a sign-in page, a cookie
  notice, a list of search results) is no longer scored as a job: it stays
  under Saved with a note that it may not be a job posting, and Re-classify
  scores it if it is one.

## [2.61.0] — 2026-10-18

### Added
- **Try it on my postings** on each engine's card in Settings → AI & costs:
  scores up to 20 of your scored postings again on that engine alone and
  shows how often it agrees with the scores on record, the false and missed
  matches, how far apart the scores are and how long each takes. Free on a
  local model. The last result stays on the card.
- An engine card says when a task you gave it did not fit its context window
  in the last 30 days, and whether the engine behind it answered instead or
  the call failed.

### Changed
- The AI usage hints quote an engine's last try on your postings instead of
  saying its quality is not measured, and point to **Try it on my postings**
  when there is none yet.

## [2.60.0] — 2026-10-18

### Added
- Settings → Notifications → "Dashboard address for links in messages": with
  it, match alerts and the application packs message link to the job in
  ApplyPack.
- AI usage shows what application packs cost in the period, and the line
  under **Prepare the pack** gives the typical cost of one pack once three
  have been prepared.

### Changed
- "Go on in the Tailor page" from a pack opens the pack's edits as applied
  cards, each with its own Undo, and Undo all returns your resume as it was.
- A long "packs ready" message is sent in parts instead of failing or being
  cut off.

## [2.59.4] — 2026-10-18

### Changed
- A skill your resume names, even only on its skills line, counts as in your
  resume in a comparison; how thinly it is shown goes in the keyword's note
  ("listed only, no role shows it") instead of a contradictory "can't
  claim". Each posting's next comparison is analysed afresh once after this
  update.

### Fixed
- When a new comparison of the same posting moves the score by no more than
  re-running the same text would (up to 10 points), the comparison and the
  Tailor page say so, so a small drop after applying the suggestions no
  longer looks like your mistake.

## [2.59.3] — 2026-10-18

### Fixed
- A job posted as just "Remote" no longer passes or fails your search's
  location at random: it counts as open to your search unless the
  description limits where you may live.
- With two-stage ("lower AI cost") scoring on, a job that names your stack
  is no longer turned away by the quick first check before the full check
  reads it.

## [2.59.2] — 2026-10-18

### Changed
- Screening: a skill counts as used "in production" only when the quoted
  line carries a number (a percentage, money, a scale); without one it
  counts as "used in a role". The same bullet no longer scores differently
  from one run to the next. Existing screenings pick this up when you score
  them again.

### Fixed
- A list of technologies after the job title in a resume's headline ("Senior
  QA Engineer — Playwright, TypeScript") counts as a skills list, not as
  work done: a reworded copy of a resume no longer outscores the original by
  ten points, in screenings and in resume comparisons.

## [2.59.1] — 2026-10-18

### Fixed
- Marking a job Applied no longer counts as an alert sent on the Overview,
  and no longer overwrites the time a real alert went out.

## [2.59.0] — 2026-10-18

### Added
- A folder you moved or renamed can be pointed at its new place from its
  Files page; the source keeps its jobs and its list of files, and nothing
  is read twice.
- The folder's card says how many files the last check set aside, with a
  link to why.

### Changed
- When you edit a search, unmute a company, or a company you applied to
  stops being skipped, the next check reads again the folder files where
  rows were turned away, and stores what your searches now admit — no need
  to press "Read every file again".
- Files that left a folder are marked gone and forgotten a month later,
  unless a job came from them.

### Fixed
- The Files page of a folder whose file brought thousands of jobs opens at
  once instead of taking about a second.
- A chat message about a quiet folder says "folder not found" instead of
  "slug not found".

## [2.58.0] — 2026-10-18

### Added
- Jobs → Filters → Posted has a **Date unknown** choice: the jobs whose
  source gave no date (pasted, saved without a date, imported without a date
  column, or from a board that publishes none).

### Changed
- A job whose source gave no date shows **First seen** instead of Posted,
  and the Last 24h / 7 days / 30 days filters and "Recently posted" sorting
  no longer treat that date as a publishing date.
- Application packs: a new role on a company's own job board that publishes
  no dates (BambooHR, Pinpoint, often Rippling) can now be prepared on its
  own. It counts from the board's previous check.
- A dismissed job's text is still deleted after 30 days, but ApplyPack now
  remembers for 180 days that it saw it.

### Fixed
- A dismissed posting no longer comes back as new, and is no longer scored
  again, a month later while its board, file or folder still lists it.
- An imported file of old postings with no date column no longer shows up as
  "posted in the last 24 hours".

## [2.57.3] — 2026-10-18

### Changed
- Companies has an **Add sources** button at the top that takes you to the
  ways of adding a company, a starter pack or a folder, which sit under the
  list.

## [2.57.2] — 2026-10-18

### Fixed
- Connecting your first Telegram chat or Discord channel turns alerts on:
  before, the test message arrived and then no match was ever sent until you
  also found the Alerts switch.

## [2.57.1] — 2026-10-18

### Fixed
- `npm start` on Node 25 or newer no longer prints a "localStorage is not
  available" warning.

### Changed
- `npm start` keeps its terminal to what you need: one line while the
  database is created instead of one per migration, and warnings and errors
  only while you use the dashboard (set `LOG_LEVEL=info` in `.env` for the
  full log).

## [2.57.0] — 2026-10-18

### Added
- The progress page of a comparison states how long each step takes on your
  own engine and model once ten calls have answered there, including a model
  on this computer.

### Changed
- AI usage and the engine card say "try another model" when an engine's
  replies keep coming back unreadable, and note that Test will not show it.

### Fixed
- A reply that could not be read was recorded as a success, so a model that
  never wrote usable JSON never showed as failing.
- A job's **AI spent** left out what scoring it cost, at intake and on
  re-classify.

## [2.56.2] — 2026-10-18

### Changed
- **Rebuild keywords** now reads the posting again before it compares, so a
  keyword list written by a weaker model is replaced, not reused. It takes
  about one call longer.

### Fixed
- A red flag about a skill your resume names in another spelling ("PHP" for
  "PHP 8") no longer costs ten points: the keyword row already asks you to
  use the posting's spelling.
- The "another sector" note on the Tailor page no longer appears when your
  resume names the posting's sector another way (healthcare and healthtech,
  banking and fintech, retail and e-commerce). A posting whose brief gives
  its sector only in the product description is now read too.

## [2.56.1] — 2026-10-18

### Fixed
- On a window narrower than 1280 px, a job's Resume match, Cover letter, Is
  it real? and Application pack tabs open on their content instead of a
  screen of status buttons and tracking fields; the Posting tab still leads
  with them.
- Place chips put a space between the flag and the country.
- A run's progress page highlights the menu entry it returns to (Jobs for a
  comparison started on a job), not Tailor resume.

## [2.56.0] — 2026-10-18

### Changed
- Jobs opens on **Active**: every posting but the dismissed ones, which keep
  their own tab.
- The Overview's list is **Recent matches**: what your searches kept,
  alerted or not, instead of every new row.

### Added
- When jobs are stored without a score (while fetching was paused, by
  setup's test search, or when the AI did not answer), Jobs and the Overview
  say how many and offer **Score them**: up to 50 a press, the closest to
  your searches first, the off-topic ones set aside for free.

### Fixed
- Pipeline health no longer says the fetch never ran right after a Fetch
  now.

## [2.55.66] — 2026-10-18

### Changed
- "Use it" on a model found on this computer now gives it Scoring postings
  only; resume analysis, letters and screening stay with the engines behind
  it. Tick them on the model's card in Settings → AI & costs to hand them
  over too.

### Fixed
- A local model that can think (such as gemma4) no longer thinks before
  every answer: scoring a posting takes about 1.5 s instead of 8 s, and a
  long think can no longer use up the reply and leave a posting unscored.

## [2.55.65] — 2026-10-18

### Changed
- Setup's test search shows which arrangements your search keeps (Remote,
  Hybrid, On-site), Remote ticked, and saves your choice. Its progress page
  and result no longer talk about a paused pipeline or send you to Settings
  to score: setup scores the best of them at its last step.
- A scoring run on Runs says what it found ("10 scored · 3 matches · 7 moved
  to Dismissed …") instead of its internal counters.

### Fixed
- After setup, the Overview's chart and the search funnel no longer say 0
  matches while the matches are listed below: the first scoring of the jobs
  setup stored is counted.

## [2.55.64] — 2026-10-18

### Fixed
- We Work Remotely postings no longer show their company twice ("Vercel:
  Software Engineer, Backend" at Vercel): the title is the role, and the
  postings already stored are tidied the same way on upgrade.

## [2.55.63] — 2026-10-18

### Fixed
- Calls through the Claude Code CLI no longer carry the MCP servers you set
  up for your own Claude Code: a scoring call read about 100,000 tokens of
  their tool lists before and reads about 3,000 now, so it is faster and
  uses far less of your plan.

## [2.55.62] — 2026-10-18

### Fixed
- After switching the language — or following any link to a section of a
  page, such as Settings → General → Updates — the whole window no longer
  slides up, hiding the top of the menu and leaving an empty band at the
  bottom. Only the page's content scrolls to the section.

### Changed
- Dependencies moved to their latest minor and patch releases: the Anthropic
  SDK, Hono and its Node server, docx, dotenv, pino and pino-pretty (#500).

## [2.55.61] — 2026-10-12

### Changed
- **A keyword's stale note says it is stale.** When the resume's own text
  shows a word the analysis had marked as not there, the row reads "in your
  resume" — and beside it stood the model's reason for the opposite ("no WP
  evidence to support it"). The note is kept and now opens with "The
  analysis's note, written before this word was found in your resume:". A
  note on a word you confirmed is shown as before. Comparisons stored before
  this version read as they did (#203).

## [2.55.60] — 2026-10-12

### Added
- **A page saved from Safari is read.** Safari saves a page as a Web Archive
  (`.webarchive`) by default; in a folder of saved postings such a file was
  listed and set aside with advice to save it another way. It is read now:
  the page inside the archive, with the address it was saved from. Safari
  keeps what Chrome's single-file save drops, so such a page usually states
  its own title and company and needs no AI to be stored. An archive that
  cannot be read is still set aside with the way to save the page instead
  (#451, the part that needs no engine).

## [2.55.59] — 2026-10-12

### Changed
- **A changed search or an unmute says which folders it does not reach.** A
  file of rows in a folder is read once, so a row the search or a muted
  company turned away is not met again when the search is widened or the
  company unmuted — and the flash said "the next search reads its postings
  again". When switched-on folders of rows hold files already read, saving a
  search whose filter changed, or unmuting a company, now adds where to
  press: Companies → Folders on this computer → Files → Read every file
  again. Reading them again by itself is still open (#448).

## [2.55.58] — 2026-10-12

### Fixed
- **Headers in Ukrainian, Spanish, French and German are recognised in an
  imported file.** A sheet headed Посада, Компанія, Посилання, Опис found
  neither its title nor its company, and nothing could be imported until
  every column was chosen by hand (#403, last of four).
- **Columns about the job are no longer hidden as columns about a person.**
  `workAuthorization` holds the word "author" and `isRecruiter` the word
  "recruiter", so neither was offered. A permit to work, a yes/no about who
  posted, working in person, ownership and membership are offered now; an
  author's, recruiter's or manager's name and contact details still are not
  (#403).
- **A wide table is read instead of refused.** More than 200 columns used to
  stop the import. The columns named like a job's fields are kept first,
  then the first of the others, 200 in all; only a header past 5,000 columns
  is refused (#403).
- **A tab-separated file whose header contains a comma is read as tabs.** The
  delimiter was taken from the first line alone, and a tie went to the
  comma (#403).
- **A posting in two cities has a location.** A schema.org `JobPosting`
  saved as `.json` keeps its places in a list, and each place's parts in an
  `address`: neither was read. It is now "Lisbon, Portugal; Porto,
  Portugal" (#403).

## [2.55.57] — 2026-10-12

### Fixed
- **Markup in an imported title, company or place is not stored as text.** A
  title `<img src=x onerror=…>Staff Node.js Engineer` and a company
  `Evil <b>Corp</b>` were kept with their tags — never run, but shown as
  tags on Jobs, the job page and in messages. They are stored as words now,
  and `&amp;` as `&`. A "<" that is not markup stays: "C++ <-> Rust",
  "A < B Ltd" (#403, third of four).
- **A plain-text description with one link keeps its paragraphs.** Text with
  line breaks of its own and a single `<a>` or `<b>` went through the HTML
  reader, which treats line breaks as spaces: every paragraph ran into one.
  Markup that only dresses words is now taken out and the lines stay; inline
  markup that arrives escaped (`&lt;span&gt;`) is read the same way instead
  of being stored literally; and prose such as "we compare a<b and c>d" is
  no longer mistaken for a tag (#403).

## [2.55.56] — 2026-10-12

### Fixed
- **Pay written the way people write it is read from an imported row.**
  `$90,000`, `90k`, `€65.000`, `£45 000` and `65000 EUR` in the "pay from"
  and "pay to" columns were read as nothing, so the row carried no pay and a
  search's minimum never saw it. They are amounts now; `€`, `£`, `₴`, `₹`,
  `₪`, `zł` and a currency code name the currency, and `$` stays `$` (#403,
  second of four).
- **Two dates an imported row can state.** `2026-10-05 10:00:00 +02:00` — a
  zone after a space, as a database prints it — was not read, and the row
  took the import's time. And "You may apply 2026" was read as 1 May 2026: a
  month's name with a year is a date only when the cell holds nothing else
  (#403).

## [2.55.55] — 2026-10-12

### Fixed
- **A row-number column is no longer taken for the id of an imported row.**
  An `ID` column always beat the link. When it only counted the rows (1, 2,
  3…), a re-sorted export reported new postings as already stored and added
  old ones again; ids that repeat folded two postings into one; and a numeric
  id past 2^53 in a JSON file lost its last digits, so two postings arrived
  with one id. With a link column in the file, such a column is now passed
  over when a file is first read, and the **Id of the row** select says why.
  A source you already imported keeps the column it was stored under, so what
  it holds is still recognised; its select says the id is weak and how to
  switch (#403, first of four).

## [2.55.54] — 2026-10-12

### Changed
- **An import sends one message, not one per match.** A file of 2,000 rows
  with 300 matches sent 300 Telegram or Discord messages in one run. The
  matches of an import now arrive as one message per chat when it ends — the
  best twenty listed, the rest counted and left New on Jobs. Outside your
  alert hours, or with Alerts off, they wait and leave with the next check
  as before (#402).
- **An import can be stored with no alerts.** The preview has the folder's
  **Alerts** choice. "No alerts" keeps the matches on Jobs with their scores,
  sends nothing and prepares no application pack; a file that brings more
  than twenty new rows is offered that way (#402).
- **The preview says what an import would send**: how many rows could match,
  that they come as one message, and how many application packs the rows
  could get at most (#402).
- On Runs, "not alerted: its folder's alerts are off" now reads "alerts are
  off for its source": an import can be stored that way too.

## [2.55.53] — 2026-10-12

### Fixed
- **One application pack for a role, however many sources list it.** The same
  posting reaching ApplyPack from two sources got two packs: two comparisons,
  two company checks with web search, and the role twice in the morning
  message. Another source's copy of a stored posting now gets no pack of its
  own when a posting of that role already has one, and its **Application
  pack** tab points at the one that does (#380).
- **A copy is no door into the backlog.** A copy of a posting stored before
  packs were switched on queued a pack, though the settings say such a
  posting is never prepared on its own. Packs now keep the moment they were
  switched on; a copy whose original predates it is left to **Prepare the
  pack**. On an install that already has packs on, that moment is the
  upgrade (#380).
- **A pack reuses the company check its copy already has.** A check under
  fourteen days old on another source's copy of the same posting, at the same
  hiring company, is used instead of running a new one (#380).

## [2.55.52] — 2026-10-12

### Changed
- **Only named skills are written onto a skills line unasked.** "Add missing
  keywords" ticked, and Apply all and an application pack wrote, phrases such
  as "code deployments", "open-source contributions" and "AI tooling" onto a
  tools line, where they read as filler. A methodology or domain keyword
  (the posting's priority 3 and 4) is now listed unticked and marked "backed,
  better said in a bullet"; Apply all and a pack leave it out. It still
  counts in the score, keeps its chip, and can be ticked or added with
  **+ add**; a keyword you added yourself is treated as a skill at any
  level (#351).

## [2.55.51] — 2026-10-12

### Changed
- **A posting that names no company says so, and its source stands apart.**
  A row from an aggregator, an imported file or a folder that names no
  employer showed its source where the company goes ("RemoteOK Feed",
  "September export"). It now reads **Company not named** with "via
  <source>" on the line under it, the same shape a named row has: on the
  Jobs list, the job page, the Overview's lists, the applications board, the
  pickers and the Tailor page.
- **The applications export has a Source column.** `Company` holds who hires
  and is empty when the posting names nobody; `Source` holds the aggregator,
  file or folder it came through.
- **The cross-listing banner says who hires and where the copy is listed:**
  "Backend Engineer at Fennel Works — via RemoteOK Feed". It read "Backend
  Engineer at RemoteOK Feed", as if the source were the employer (#444).

## [2.55.50] — 2026-10-12

### Added
- **A pack waiting in the queue can be cancelled.** While a pack is queued
  its tab has **Cancel**: the pack is taken out, and nothing is prepared or
  spent. Once the worker has started it, Cancel says so and changes nothing.
- **What a pack costs is said before the press.** Under **Prepare the pack**:
  how many AI calls a pack is, and whether they are billed, covered by your
  plan or run on this computer (#387).

## [2.55.49] — 2026-10-12

### Changed
- **A folder's file is checked twice before it is read.** Its path is
  resolved again once the file is open and must still be what it was, and a
  file that has a second name on the disk (a hard link) is passed over like
  a link: the Files page lists it as "A link, or a file outside the folder.
  Not read." (#398).

## [2.55.48] — 2026-10-12

### Fixed
- **A folder is read by a script run beside a local install.** On an install
  started with `npm start`, a fetch run from anything but the launcher (`node
  dist/scripts/fetch-once.js`, the dev watchers) took the machine for a
  server: it refused every folder under your home folder ("On a server
  ApplyPack reads only the folders named in APPLYPACK_INBOX_ROOTS") and
  marked the source failing. A process that finds its database in the
  install's own data folder now follows the local rules.
- **The refusal for a cloud drive says the way out.** iCloud Drive, Dropbox,
  Google Drive and OneDrive live under `~/Library` on a Mac, and a folder
  there was refused with "The system's own folders (Library, AppData) are not
  read" and nothing more. The message and `docs/install.md` now say to name
  the synced folder in `APPLYPACK_INBOX_ROOTS` (#398).

## [2.55.47] — 2026-10-12

### Changed
- **AI usage: four small improvements.**
  - "9 in 10 under …" is shown from ten answered calls up. From two calls it
    was the slower one, interpolated.
  - On a phone the By model table no longer scrolls sideways with the time
    and the money behind the scroll: each task's line carries its calls, its
    typical time and its cost.
  - A screen reader hears which engine each "Used for" group of task boxes
    belongs to.
  - The hint about scoring's volume on a plan names the steps for the model
    on this computer from where it stands: enable it, leave only Scoring
    postings ticked, put it above (#415).

## [2.55.46] — 2026-10-12

### Changed
- **A folder of rows is read much faster.** A check read twenty files
  whatever their size, so a tool that writes one small file per posting
  brought twenty jobs an hour: 455 files took 23 hourly checks. A check now
  reads up to 5,000 rows, 25 MB and 400 files, and the same 455 files take
  three. A folder of saved postings still reads twenty a check, because a
  posting can cost an AI call.
- **A file a check did not reach is listed as waiting.** It was noted
  nowhere: the Files page did not show it and the folder's line did not
  count it, so a folder looked read when most of it was not (#432).

## [2.55.45] — 2026-10-12

### Fixed
- **Application packs: seven small defects.**
  - A pack you ask for is prepared before the ones the worker queued on its
    own. Behind five of those it waited a quarter of an hour under "the worker
    starts it within a minute".
  - Pressing **Prepare** again on a pack still in the queue answers "This
    pack is already in the queue", not "already being prepared".
  - An edit that could not be made says its own reason: the quoted text is
    not in the resume, the line carries your email or phone, or there was no
    wording to paste. One sentence used to say the first for all three.
  - The Overview's **Ready to send (N)** counts every ready pack, not the
    eight it lists, and leaves out a posting found closed since.
  - After a pack, the job's Resume match tab no longer headlines the pack's
    own tailored draft ("Resume match · 100" for a resume that scores 70).
    The draft is still in the list and opens from the pack.
  - With **Skills** unticked under "What an automatic edit may touch",
    keywords are no longer written onto skills lines; the keywords box says
    it needs Skills ticked (#384).

## [2.55.44] — 2026-10-12

### Fixed
- **Folder pages: five small things.**
  - A refused **Check** no longer opens with "Nothing was added": Check never
    adds anything. It says "Not checked."
  - A saved text file, PDF or document with no title reads "No title in the
    file"; only a saved page reads "No title on the page".
  - On a phone the **Alerts** choices were cut ("A match sends an alert, like
    every sour…"). They are "Alert on a match" and "No alerts", and the line
    under them says the rest, including that a match with no alerts gets no
    application pack.
  - A file's name no longer breaks in the middle of a word ("page.h / tml"):
    it breaks at a slash, a hyphen or a space first.
  - Runs: a match from a folder whose alerts are off reads "1 not alerted:
    its folder's alerts are off" instead of "1 alert source off".
  - The three lines that still sent you to "the Companies table" to switch a
    folder on name its card, where the switch is since 2.55.43 (#365).

## [2.55.43] — 2026-10-12

### Fixed
- **A failing folder says so in its own card.** With a folder renamed away,
  the Companies table read "Folder not found" while the folder's card under
  **Folders on this computer** read "1 file · 1 new at the last check". The
  card now carries the same status, in the folder's words, with how many
  checks in a row failed.
- **The switch is in the card.** A folder is added switched off, and the
  message sent you to find its row among every other source. The card has
  **Enable**, and the message names the card.
- **A folder with too many entries is called that.** A folder holding more
  entries than a check lists was reported as "Files do not fit the mapping",
  and its message pointed at the mapping. It now reads "Too many entries in
  the folder".
- **The job page names the source as the rest of the dashboard does.**
  "Source: FOLDER" is now "Folder on this computer", and every other source
  reads by its name ("Greenhouse", "We Work Remotely", "Imported file")
  instead of its internal code (#405).

## [2.55.42] — 2026-10-12

### Fixed
- **An import stores rows only with the columns you were shown.** Changing a
  column on the import's preview and pressing Import without "Update the
  preview" stored the rows with a mapping no preview had shown. That press
  now keeps the new columns, draws the preview with them and stores nothing
  until Import is pressed again.
- **A long import's warning is no longer replaced by "That preview is
  gone".** An import that outlasted the half hour its upload is kept for, and
  ended with a warning (rows that could not be scored, a pause mid-run, a
  fetch that was running), sent you to a preview that had expired. The rows
  now wait a fresh half hour from the end of such an import.
- **An empty file is called empty**, instead of "Choose a .json, .jsonl, .csv
  or .tsv file first".
- **Runs: an import's count says what it counts.** "5 rows read from the
  file" was the number of rows that are jobs, after the rows with no title
  and the repeats were left out; it now reads "5 jobs in the file" (#404).

## [2.55.41] — 2026-10-12

### Fixed
- **A click on a missing-keyword chip always does something.** On the Tailor
  page most chips above the editor did nothing when pressed: no scroll, no
  focus, no message (48 of 50 solid chips on one set of stored comparisons).
  Now the chip of the posting's own title leads to the line under your name;
  a term the model asks about opens its own question in the confirm card, as
  a term with no evidence does; a term the resume backs leads to the section
  its hint names, or to the skills line **+ add** would write it on; and when
  there is no line to go to, a sentence under the chips says so (#349).

## [2.55.40] — 2026-10-12

### Fixed
- **A long "Fetch now" keeps its result for the tab that started it.** The
  dashboard remembered a "Fetch now" or "Check now" run for half an hour
  counted from its start. A run that took longer was forgotten as soon as
  another one was started, and a tab still on its page was told "That fetch
  run is gone" instead of what the run found. A finished run is now kept for
  half an hour from the moment it finished. A run whose work never returned
  made every later press of Fetch now join it until the dashboard restarted;
  after six hours it no longer counts as running (#407).

## [2.55.39] — 2026-10-11

### Fixed
- **A saved posting no longer carries the application form in its text.**
  A job board that puts the form on the same page as the posting had its
  questions, every "Select…" and "Submit application" stored as the end of
  the description — a quarter and nearly half of the text on two real pages —
  and read by the scoring and by every comparison. A form to fill in and
  the page's navigation are now left out of a saved page's text. A site
  whose whole page is one form, and a page of the form alone, are read as
  before; so is a page that states its posting in a `JobPosting` block.
  Postings saved before keep the text they have, and a page saved again is
  still the job it was (#361).

## [2.55.38] — 2026-10-11

### Fixed
- **An import's numbers are all written the same way.** After a large file
  the summary read "2,000 rows, 1480 new stored … The filter set aside 2000:
  2,000 without a title keyword", and the preview "12,000 rows read from the
  file … left out: 1034 without a title". Every count in the import's summary
  and in the preview's "left out" list now takes the language's own grouping,
  in all four languages (#367).

## [2.55.37] — 2026-10-11

### Fixed
- **`npm run stop` no longer says "ApplyPack is not running" while it is.**
  The stop command recognises a running ApplyPack by asking the system what
  the process in its lock file is — PowerShell on Windows, `ps` elsewhere —
  and took "no answer within 15 seconds" for "no such process". On a busy
  Windows machine that happens: stop then reported nothing to stop and left
  ApplyPack running. It now asks twice, and when the process is there and
  still cannot be named it asks it to stop anyway and waits.
- **A start never takes over from a process it could not identify.** The
  same wrong answer could let a second `npm start` remove a running
  ApplyPack's lock, or delete the pid file of a database that was still
  running; `npm run db:import` could go ahead beside a worker. Each now
  stops and says which file to remove if nothing is in fact running (#470).

## [2.55.36] — 2026-10-11

### Fixed
- **The confirm card no longer asks whether you "have" the job's title.**
  "Confirm your experience — the posting wants these" listed the posting's
  own title among the skills, with **I have it**, and the line under the
  score could read "Sr. Software Engineer, Marine is a must here and nothing
  backs it yet — confirm it where it is true". A title is not something you
  have or lack; and a stored "I have it" would have let a suggested rewrite
  put the title into a work bullet, where it reads as having held the role.
  The title is left out of the card and of that line, and its chip leads to
  the title line instead of the card. It still counts in the score (#348).

## [2.55.35] — 2026-10-11

### Fixed
- **A posting's title, shortened, is no longer offered as a skill.** The
  title is kept off your skills lines, but only when the keyword spelled it
  in full. When the analysis shortened it — "Product Lead" for "Product Lead
  (Strategy + Full Stack)", "Backend PHP Developer" for "Backend PHP
  Developer – AWS / Serverless" — it stood first under **Add missing
  keywords to your skills**, went in with **Apply all**, and an application
  pack prepared on its own would write it onto a skills line with nobody
  reading. The shortened title is recognised now, on the Tailor page and in
  packs alike. It still counts in the score and is still offered for the
  title line, where it belongs (#347).

## [2.55.34] — 2026-10-11

### Fixed
- **A search that scored nothing no longer shows as OK.** When the AI engine
  gave no verdict for any posting of a run — every one "failed to classify"
  — the run still finished with a green OK on Runs and a green dot under
  Pipeline health on the Overview, because nothing had crashed. A night of
  such runs looked like a healthy night with no matches. Such a run now
  reads **nothing scored**, in the warning colour on both pages, with a line
  that points at the engine's card on Settings → AI & costs. A run where
  some postings were scored keeps its OK and its count of the ones that
  failed (#366).

## [2.55.33] — 2026-10-11

### Fixed
- **An AI engine that refuses every call no longer looks healthy.** With a
  sign-in turned away, or a local server that had stopped, the engine's
  card on Settings → AI & costs went on saying "available" and AI usage
  showed its green "nothing was billed": the card reads what is installed,
  and the usage page weighed twenty refusals against a week of answers.
  Scoring was dead and nothing said so. An engine whose last calls all
  failed now carries a **calls failing** badge and a line on its card, and
  the same line stands first under **Worth a look** on AI usage: one refused
  sign-in is enough, anything else from three failures in a row.
- **The advice follows the cause.** A closed port and a prompt too large for
  the local model's context window were both recorded as a plain error and
  both answered with "try another model". They are told apart now: check
  that the server is running; raise the context window or untick the task;
  sign in again or paste a new key (#413).
- Left for later: a reply that does not parse is still recorded as
  answered, and an engine with a task unticked is never that task's last
  resort (#463).

## [2.55.32] — 2026-10-11

### Fixed
- **A saved PDF with only a little text is no longer called a scanned
  image.** A PDF posting of under 200 characters — a short note, a page that
  is mostly a picture — was listed on the folder's Files page as "No text
  could be read from this PDF: a scanned image, a password, or a damaged
  file", with the advice to save it another way, which would not have
  helped. It now says what a text file of that length says: less than 200
  characters, a note or an empty page, not a posting. A PDF with no text at
  all, a locked one and a damaged one keep their note. PDFs already set
  aside are looked at once more after the upgrade, so the ones with some
  text get the right sentence; no AI is asked for that (#362).

## [2.55.31] — 2026-10-11

### Fixed
- **Application packs are no longer prepared for postings that only look
  new.** "Published within N days" read the posting's date, and a source
  that gives none had it set to the moment the posting was read. A row
  imported with no date column, a row of a folder's file, and every role of
  a board that publishes no dates (BambooHR, Pinpoint, often Rippling) all
  counted as published today: a file of last month's postings queued packs
  up to the day's limit, and with no limit set, every one of them. A posting
  whose source gives no date is now never prepared on its own; you can still
  prepare any job by hand on its Application pack tab. A posting you saved
  yourself counts from when you saved it, as before. The settings say so
  (#379).
- Left for later: such a date is still shown and filtered as "Posted"
  (#458), and a board that never publishes dates gets no automatic pack even
  for a role that appeared since it was last read (#459).

## [2.55.30] — 2026-10-11

### Fixed
- **Application pack settings no longer swap a value you typed for the
  default.** A number outside what a field takes — a fit of 40, 60 packs a
  day, 0 days, 10 bullets, 91.5 — or an emptied field was stored as the
  default, and the message said the settings were saved: a fit of 40 came
  back as 90, the opposite of what was asked. Such a press now saves
  nothing, the on/off box included; the message says which field and what it
  takes, and the field is marked on the page. A browser stops most of these
  before they are sent; a pasted value or a script got the silent swap
  (#383).

## [2.55.29] — 2026-10-11

### Fixed
- **Prepare again on a pack ApplyPack prepared by itself is now your own
  run.** Pressing **Prepare again** (or **Try again**) on such a pack
  started another automatic one: it took one of today's packs, so a strong
  match later in the day could go without; it came back in the next "packs
  ready" message although you had its page open; and pressed with packs
  switched off, or for a job you had dismissed since, the pack was taken out
  of the queue and deleted instead of prepared. A pack you start over is now
  yours, whoever started the first one: it counts toward no limit, no
  message announces it, and it is prepared whatever the settings say (#382).

## [2.55.28] — 2026-10-11

### Fixed
- **A folder on a disk that stops answering no longer stops every source.**
  A folder on a sleeping network drive, or a hard NFS mount in Docker, never
  answered the read, and the check that asked kept the one fetch lock for
  ever: every hourly search and every "Fetch now" after it said another
  fetch was running, until the worker was restarted. A folder's disk now has
  30 seconds to answer; the check then fails as "Unreachable" on the
  folder's row, the lock is given back, and the folder is read again when
  the disk comes back.
- **The hourly search is no longer lost to something that held the lock for
  a moment.** The tick asked for the lock once, so an import scoring its
  rows, or a look at a folder of saved postings, at that minute cost the
  hour its search, its held alerts and its licence re-check. It now waits
  for whoever holds the lock, asking every minute for up to 50 minutes, and
  runs when they are done.
- **A folder check that meets a running fetch leaves no row on Runs.** It
  asked again every minute and wrote "skipped: another fetch was running"
  each time: a twenty-minute fetch left twenty rows.
- The import's preview says that the hourly search waits while its rows are
  scored (#397). What a long import should let run beside it is #454.

## [2.55.27] — 2026-10-11

### Fixed
- **Comparing, rewriting and screening no longer tell the model a folder or
  a feed is the company.** For a posting that names no company — a row of an
  imported file, a saved posting, an aggregator's posting with no employer —
  the prompts started from the dashboard still read `Company: September
  export` or `Company: RemoteOK Feed`: the posting brief, Compare (on the
  job page, from Tailor resume, with a new file, and Save as vN with a
  posting), Rewrite all, Rewrite on one suggestion, and a screening's rubric
  and scoring. They now say the posting does not name one, as the worker's
  prompts have since 2.55.21. A posting that names its employer, a pasted
  posting and a company's own board read as before. Pages still show the
  source in the company's place; what they should say instead is laid out
  in #444.

## [2.55.26] — 2026-10-11

### Fixed
- **A page saved as a single file is read.** Chrome's and Edge's "Webpage,
  Single File" (`.mhtml`) sat in a folder of saved postings and was counted
  among the "other files left alone", with nothing said. It is now read: its
  text, and the address the browser noted. A browser leaves the page's
  structured data out of such a file, so the title and the company are read
  by the AI engine, as for a PDF. Safari's Web Archive (`.webarchive`) is
  listed on the Files page with the way to save the page instead.
- **A folder beside a saved page is no longer hidden.** `Acme interviews/`
  next to `Acme.html` was taken for that page's own saved files, and the
  postings in it were never listed. Only the folder a browser makes for a
  page (`Acme_files`, and its names in other languages) is passed over.
- **A page's navigation is no longer stored as the posting.** A page with a
  `<mainnav>` element had its menu read as the posting's text.
- **Fewer pages ask the AI engine for a title they state.** A structured
  block with a line break inside a string, with its company as a list, or
  with its type written as a web address was not read, so the engine was
  asked for the title and the company; while fetching was paused such a
  page waited instead of being stored (#399).

## [2.55.25] — 2026-10-11

### Fixed
- **One posting saved as a JSON file is read as that posting.** A file
  holding a single posting with a list inside it — a schema.org
  `JobPosting` with two places in `jobLocation`, a scraper's posting with
  its skills — was read as that list: the import said "2 rows read from the
  file, 0 of them jobs; left out: 2 without a title", and a folder of one
  posting a file ended up failing as "Files do not fit the mapping". A list
  inside an object that is itself a posting is now the posting's own. A
  feed with its items, or a company with its openings, reads as before.
- **A tool's stats file no longer makes its folder fail between runs.** A
  JSON file holding one object that names no posting (a `stats.json`, a
  manifest) was judged a file that does not fit the mapping. Written after
  the rows, it was the newest file, so every check that found nothing new
  reported the folder as failing until the tool ran again. It is now set
  aside with a note on the Files page (#395).

  On the upgrade, JSON files a folder had recorded as not fitting are judged
  once more at the next check: a posting among them is read and scored like
  any new file, a stats file is set aside, and a file that truly does not
  fit says so again.

## [2.55.24] — 2026-10-11

### Fixed
- **A folder's file is no longer read while it is still being written.** A
  check measured a file's age against the time the whole fetch started, so a
  file a tool wrote minutes into a long fetch counted as settled and was
  read half-written: the last row was stored with half a title and no link,
  and the finished row was never read, because the next check read on after
  it. A check now takes its own time. The last row of a CSV or TSV that has
  no line end is left until the file has been still for two minutes (the
  Files page says so); a whole file that simply ends without a line break
  has that row read one check later.
- **One posting that no engine will score no longer stalls every folder.**
  A check's notes on a folder's files were kept only when the whole fetch
  stored everything, so a single posting on any source that failed to score
  every hour made every folder read its first twenty files again every hour
  and never reach the rest. A folder now keeps its notes unless one of its
  own postings went without a score.
- **A row's date no longer comes out as 1980, or in the future.** A date a
  row states was compared with the file's time instead of the clock, so a
  file extracted from an archive (stamped 1980) gave every row 1980,
  whatever it said. A row with no date takes the file's time only when that
  can be a date; a file dated ahead of the clock gives today.

### Added
- **Read every file again**, on the Files page of a folder of rows. A file
  is read once, so a row a search or a muted company turned away was never
  looked at again after you changed the search or unmuted the company. The
  button puts the folder's files back to waiting: the next checks read them
  from their first row, skip what is already stored at no cost, and score
  what your searches admit now (#396). Doing this by itself when a search
  changes is #448.

## [2.55.23] — 2026-10-11

### Fixed
- **A damaged or non-UTF-8 file no longer loses rows or letters in
  silence.** The import and both kinds of folder share their readers, and
  four things went wrong without a word:
  - A CSV row that opens a quote and never closes it swallowed every row
    after it into one cell, and the file was counted as read: an 8-row file
    gave 3 "rows", the third holding the rest of the file as its title. The
    rows above that line are now read, and the preview, the folder's Check
    page and its Files page name the line ("Read in part"; the folder's row
    on Companies counts such files).
  - A file that is not UTF-8 — a Windows spreadsheet's plain "CSV", a page
    saved off an older board — came out as `Z�rich` and `Node.js ���������`.
    It is now read in the encoding of its language: a saved page's own
    `<meta charset>`, else Windows-1251 or Windows-1252, told apart by the
    letters. Where the encoding had to be assumed, the preview says so.
  - A JSON file cut short was read as a CSV with columns named
    `[{"title":"a"`. It is now refused as cut off or not valid JSON.
  - A TSV whose header starts with an empty cell (pandas with its index)
    lost that cell, so every column shifted one to the left and no select
    could put it right. An object that holds its rows by key
    (`{"a1": {…}, "a2": {…}}`) was one row; it is now its rows.

  Files a folder read before this version keep the row they have: nothing
  is read again on the upgrade (#394).

## [2.55.22] — 2026-10-11

### Fixed
- **An import that stores nothing no longer leaves an empty source.** The
  preview disables Import when nothing in the file is both new and wanted
  by a running search, but the server ran the same form when it was posted
  anyway (an old tab, a double press): nothing was stored, and an empty
  source appeared under "Sources you imported". The import now refuses for
  the reason the page gives, before it writes anything. A source made by a
  press that could store nothing — a fetch was running at that moment — is
  taken back too, and comes with the second press (#364).

## [2.55.21] — 2026-10-11

### Fixed
- **A folder or a feed is no longer named as the company.** When an imported
  row, a saved posting or an aggregator's posting named no company, ApplyPack
  took the source's own name for it: the classifier's prompt read
  `Company: Saved postings`, the alert and the daily recap said "@ Export A",
  the company check researched the folder's name on the web, and a cover
  letter or an application pack was written to it. A posting that names no
  company now has none: the model is told the posting does not name one, and
  a message says "company not named". A posting that names its employer, and
  a company's own board, read as before. Pages still show the source in the
  company column (#401).

## [2.55.20] — 2026-10-11

### Fixed
- **The Application pack tab no longer wipes what you type.** While a pack
  was queued or being prepared the page reloaded itself every 8 seconds, and
  the rail beside the card holds the application's forms: a note typed into
  Notes was gone with the next reload, for as long as the company check ran
  (up to ten minutes). The tab now asks for the pack's state and rewrites
  its one line of progress in place. The page is loaded again only when the
  pack has finished, and never over an unsaved edit: then the card says the
  pack has finished and to save first. A browser with scripts off still gets
  the reload (#378).

## [2.55.19] — 2026-10-10

### Fixed
- **A posting pasted without a title is no longer named after its first
  heading.** When neither you nor the model named the role, the first line
  of the paste became the title, and a paste from a job board opens with a
  heading: the job was listed as "Full job description", and the comparison
  read that as the role, so the title line was never measured. A first line
  that is a section heading ("Full job description", "About the job",
  "About Acme", "Who we are", "The role") is not taken: the job is
  "Untitled role" until you name it (#352).

## [2.55.18] — 2026-10-10

### Fixed
- **Re-classify says what happened when no verdict comes back.** The button
  on a job came back to the same page with no word in three cases: every
  engine failed (a refused sign-in, a server down), no running search had a
  stack or role types, or two-stage scoring turned the posting away at its
  first pass. Each now says what failed, that the verdict is as it was, and
  where to look — with the engine's own reason when it gave one. A posting
  the first pass turns away is also handled as "Save & re-classify" handles
  it, instead of staying Alerted under a verdict the prefilter had just
  reversed: it is dismissed, unless you saved, applied to or pasted it
  yourself (#414).

## [2.55.17] — 2026-10-10

### Fixed
- **A pack no longer fails for want of a linked resume, and a failed one is
  said.** "Resume for this search" is optional, and with it empty every
  automatic pack failed ("No resume is linked to the search…"), took a slot
  of the day's limit, and was mentioned nowhere: a person with one resume
  who switched packs on got failed rows and no word. A pack now reads the
  resume the job page would preselect — the search's own, else the one whose
  skills the posting asks for most — and fails only when no resume is stored
  at all. The "packs" message ends with the ones that could not be prepared
  (an engine down overnight), by name, and a pack that failed before it
  compared anything no longer uses the day's limit (#381).

## [2.55.16] — 2026-10-10

### Fixed
- **An alert for a job with no link no longer ends in an empty "Apply →".**
  A posting saved as text, Markdown, a PDF or a .docx has no page address,
  and a row from a file may carry a link that is no web address. Their
  alerts, and the daily recap, still wrote the Apply line: `[Apply →]()` on
  Telegram, `Apply → <>` on Discord — a dead link, and one Telegram may
  refuse the whole message for. The line is now written only for an http(s)
  link; the "From your folder" line above it says where the posting is
  (#360).

## [2.55.15] — 2026-10-10

### Fixed
- **A queued pack is not prepared once you no longer want it.** The runner
  spent on every row the search had queued without asking again: with packs
  switched off, 30 queued ones were still prepared (comparisons, company
  checks with web search) while the page said "none is prepared on its
  own"; a job dismissed, applied to another way or from a company muted
  since was prepared too, and a dismissed job's pack came in the morning
  message. A pack the search queued is now asked once more when its turn
  comes, and taken out of the queue instead; switching packs off cancels the
  ones that wait and says how many. A pack you asked for by hand is prepared
  whatever became of the job (#376).

## [2.55.14] — 2026-10-10

### Fixed
- **A pack interrupted by a restart is not announced as ready.** When the
  worker stopped (a Docker restart, `npm run stop`, an upgrade) while a pack
  was on the company check — its longest step — the killed check read as
  "the company was not checked", the rest ran inside the shutdown window,
  and the pack ended ready and went into the next message with the check
  missing. A pack the shutdown cut into now goes back in the queue whatever
  it had got to, and the next run takes it up: the comparison and a check
  that did finish are stored and not paid for again. Nothing more is asked
  of a model once the stop is asked for, so no cover letter is written into
  a shutdown either (#375).

## [2.55.13] — 2026-10-10

### Fixed
- **The file you sent is kept, however you mark the job applied.** Only "I
  sent this file" on the pack tab kept a pack's file. The rail's **Mark
  applied** recorded the untailored resume as what went out and left the
  pack free to be prepared again, and **Prepare again** then deleted the
  file that had been sent; a card moved to Applied on the board did the
  same. Now **The application pack's file** is an answer of "Applied with",
  chosen already on the rail while a pack is ready, and it records the
  pack's text and keeps its file for good. A ready pack of a job you applied
  to is not prepared again, whichever way you applied. A pack prepared again
  in another tab is no longer frozen from an older page: the page says so
  and records nothing, and it no longer clears the resume already recorded.
  Saving notes on an application no longer replaces the recorded text with
  the resume's newest version (#377).

## [2.55.12] — 2026-10-10

### Fixed
- **Saved postings no longer merge into one job, or split into two.** A
  saved posting's id was its page's address, else its text, and both halves
  misfired. One opening in two cities shares a description, and two postings
  may name the same careers page as their address: the second was counted as
  read and never became a job. The same address with another campaign
  parameter, or a note added to a `.md`, made a second job, a second alert
  and possibly a second pack. The id now holds the role and the place the
  page states beside its address (without campaign parameters) or its text,
  and a file is first matched to a job the folder already holds: by the id
  earlier versions gave it, or as the same file with a note under it. A page
  that carries several postings is read as the one its own address names
  (not the first "similar job" on it), and a page of search results is no
  longer taken for the first posting on its list. A posting the folder holds
  costs no model call, and its file says "The same posting as <file>" on the
  Files page. Files that were counted as read and never became a job are
  read again at the next check; jobs already stored keep their ids (#390).

## [2.55.11] — 2026-10-10

### Fixed
- **A file in a folder is read to its end.** A folder's file of rows was
  read to its 2,000th row and marked done: the rest never became jobs, and a
  tool that appends to one file stopped yielding there, every change
  re-reading the same first 2,000 rows. A file is now read 5,000 rows a
  check until its end, and the Files page says how far it is ("5,000 of
  12,000 rows read so far"); a file that only grew is read from its old end,
  so an appended row is one new job and not a second reading of the file. A
  check also stops at 5,000 rows exactly, where it could hand over 6,999.
  Files already cut at 2,000 rows are picked up again at the next check
  (#393).

## [2.55.10] — 2026-10-10

### Fixed
- **A small .docx can no longer exhaust the worker's memory.** A .docx is a
  zip, and one of 111 KB can unpack to 32 MB of document; reading that took
  3.4 seconds and 2.2 GB, and the limit of 64 MB a part was above what the
  process survives. A file saved into a folder of postings is read with
  nobody watching, and a worker that died on it read it again on the next
  check. A saved posting's .docx may now unpack to 2 MB (a posting is tens
  of kilobytes) and is otherwise set aside with "Too large once unpacked" on
  the folder's Files page; a resume or an applicant's .docx to 8 MB, four
  times the largest real one. Both are refused at the unpacker, in a
  millisecond (#400).

## [2.55.9] — 2026-10-10

### Fixed
- **Apply all no longer deletes the skills line that shows a must-have.** A
  report advised cutting a whole line of eleven AI tools ("dense and
  duplicative") while the same report named that line as the evidence for
  "AI tooling", a must-have. The line spells no such term, so the check that
  keeps wanted keywords let the cut through: one press deleted the line and
  wrote "AI tooling" onto an unrelated line with nothing behind it. A
  removal that takes a whole line is now also held when the comparison's own
  note says that line is what shows a must-have: the advice stays on the
  card, without the one-press delete, and the card says why. A lighter term
  gets a note instead. Comparisons made before this keep the cut until the
  resume is analysed again (#350).

## [2.55.8] — 2026-10-10

### Security
- **A `back` value can no longer send a form's redirect off the site.** The
  guard for every "go back where you were" field refused `//host` and
  `https://…`, but read the value as a string: `/\host` and `/.//host` both
  start with one slash, and a browser reads both as another host. It now
  reads the value the way a browser reads a Location and keeps it only when
  it stays on this site. Every POST already passes the same-origin check, so
  another page could not submit one; no released page takes `back` from a
  link (#354).

### Fixed
- A `back` value with characters outside ASCII (a search in Cyrillic) made
  the redirect a header the server refuses, and the request answered 500. It
  comes back percent-encoded.

## [2.55.7] — 2026-10-10

### Fixed
- **A pack run on the Runs page is worded in your language.** Its counts were
  bare words ("1 failed", "2 ready") in English whatever the interface
  language, a tick's "1 packs queued" did not agree in number, and a pack run
  that stood down for another said "Another fetch was running". They now
  read "1 pack failed", "2 packs ready", "1 pack put back in the queue",
  "1 pack queued" and "Another run was preparing packs", in all four
  languages (part of #384).

## [2.55.6] — 2026-10-10

### Fixed
- **The daily recap no longer lists unscored jobs as matches.** Rows stored
  while fetching is paused (a "Fetch now", an import, a folder read) have no
  score yet; the recap counted each as a match and printed it as "fit
  0/100", so forty paused rows opened the morning message as "40 matches".
  Only scored jobs are matches now. The unscored ones are one line at the
  end ("40 new jobs are stored without a score and are not listed as a
  match"), and the run's row on Runs says the same (#392).

## [2.55.5] — 2026-10-10

### Fixed
- **A folder set to "No alerts" no longer reaches the chat through the daily
  recap.** Its matches were never sent and never held, as promised, which
  made them exactly the rows the recap lists: the morning message named them
  with their fit. The recap now leaves such a folder out; its matches stay
  on Jobs (#391).
- **The daily recap and the "While you were away" message say "From your
  folder" too.** Only the alert sent on the spot carried the folder and the
  file a posting came from; the same posting in the recap, or held for the
  alert window, had lost the line.

## [2.55.4] — 2026-10-10

### Fixed
- **"Read the shape with AI" no longer keeps a reading that left jobs out.**
  A model that copied two of a resume's six roles, every word of them
  faithfully, passed the check that each string is the resume's own, and the
  clean version was drawn four jobs short; **Save as a new resume** would
  have written that file. A reading is now also held against the whole text:
  every role, and every line under one, that the built-in reader finds is
  looked up in it. With a role missing, or more than a tenth of those lines,
  the reading is not stored and the page keeps the built-in one, which loses
  no line; the run says what was missing ("the model read 2 of the 6 roles
  in your resume"). A reading stored before this is checked the same way
  each time the page opens. With a line or two missing the reading is still
  drawn, and the page says how many lines are not in it (#408).

## [2.55.3] — 2026-10-10

### Fixed
- **A re-score no longer dismisses a job you saved, and the cleanup no longer
  deletes it.** A posting saved into a folder, a pasted one, or any job you
  marked Saved turned **Dismissed** as soon as it was scored again and no
  search wanted it: the job page's **Re-classify**, **Save & re-classify**
  and the wizard's scoring all did it, and the weekly cleanup then deleted
  the row a month after it was found. Saved now stays Saved through any
  re-score, as Applied always did; only the scores change. A posting you
  pasted or saved as a file is never dismissed by a score: when no search
  wants it any more it is kept Saved, and it is scored whatever the filter
  says, as it was when it came in. A row dismissed this way before the fix
  cannot be told from one you dismissed yourself, so it is not brought back
  (#389).

## [2.55.2] — 2026-10-10

### Fixed
- **An application pack no longer writes wording the fact check only warned
  about.** A suggestion the check let through with a note ("says
  "Kubernetes" — confirm you have it first", a term the line loses) is a card
  you read before pressing Apply on the Tailor page; a pack applied it to a
  file nobody had read yet. Measured on 98 stored suggestions: 15 carried
  such a note, and a pack would have written every one. They now wait under
  **Left for you**, with the reason (#374).
- **A note to the writer is no longer offered as resume text.** The model
  sometimes put its own instruction into the wording: "(ask the candidate to
  confirm which role used JIRA)", "[add your real number]", "XX%", a
  question. One press of Apply pasted that into the resume, and a pack would
  have sent it. Such a wording is refused when a comparison is made (the card
  says why, and Copy and Edit & apply still work), and a pack leaves it out
  on comparisons stored before this (#208).

## [2.55.1] — 2026-10-10

### Fixed
- **An application pack no longer says "Preparing" for ever after the worker
  stopped mid-pack.** A pack the worker was preparing when it was killed, or
  when the computer shut down, stayed `running`: its tab kept refreshing,
  **Prepare again** was hidden, and nothing took it up until some other pack
  happened to be queued. The minute beat now counts such a pack as work, so
  it goes back in the queue and is prepared again within a minute (#373).

## [2.55.0] — 2026-10-06

### Changed
- **Settings, second readability pass.** Every on/off setting is a switch
  with its state in words beside it, instead of a state pill next to an
  Enable / Disable button; a press on the label flips it too, and it works
  without JavaScript.
- Every message is switched under **Notifications**: the follow-up reminders
  moved there beside source problems, and Applications says whether they are
  on. The daily summary's hours are up to four time pickers with "+ Add
  another time", instead of 24 hour pills.
- Each search profile on **Job search** carries one line of what it hunts —
  target roles, core skills, where and the minimum fit — and the editor's
  Save buttons stay at the bottom of the window while it scrolls.
- **AI & costs** opens with one sentence: which engine answers every task,
  on whose money, who stands behind it, and what was billed this month.
- The interface language is one picker; a screening's retention is a choice
  of 30 / 60 / 90 (recommended) / 180 / 365 days; **Employer tools** opens
  with a short checklist of what is in place before applicants are read.
- A kind of your own source with nothing in it yet (a feed, a careers page, a
  folder) shows where to add one instead of a switch that would switch
  nothing.
- Long explanations under Sources, AI & costs, Automation and Employer tools
  fold behind "How this works"; costs, limits and privacy warnings stay in
  sight.

## [2.54.0] — 2026-10-06

### Changed
- **Settings are grouped by what you came to change.** The catch-all General
  tab is split up: the automatic search and when it runs sit with the search
  profiles on **Job search**; tracking, follow-up reminders, duplicate
  applications and the board columns on **Applications**; application packs
  on **Automation**; when job matches arrive and the daily summary on
  **Notifications**; the time zone stays under **General** with the language,
  the resumes and updates. The AI tab is **AI & costs** and the screening tab
  **Employer tools**. `/settings` opens on Job search, and every tab says in
  one line what it holds.
- Plainer words: core skills, target roles and preferred skills instead of
  "tech stack — required / nice to have" and "role types", score adjustments
  instead of priority rules, a monthly spending alert instead of a budget, and
  best accuracy / lower AI cost instead of single / two-stage classifier.
- Minimum fit, minimum salary and the title words to skip are in sight in the
  search editor, no longer inside its Advanced block.
- What most people never need folds away: an engine's models and tasks, the
  key and server rows of an engine that is not switched on, the keys of the
  sources that need an account, the per-company career platforms, the
  applicant notice and the legal note. Telegram and Discord each open their
  own Connect form, one at a time.

## [2.53.0] — 2026-10-06

### Added
- **Spanish and French, in beta.** Español and Français are in the language
  switcher beside English and Українська, marked beta: every page, the lines
  a page writes while you edit or wait, employer mode and the Telegram and
  Discord messages are translated by machine from the glossary and held to
  one set of terms, and no native speaker has read them yet. A wording is
  corrected in `src/i18n/catalog/es.json` or `fr.json`. Dates, numbers and
  country names follow the language.
- A search's countries can be typed in any language the interface speaks:
  "Polonia", « Pologne », «Польща» or "Poland" all name Poland.

### Changed
- A page's title, a card's title, a status card's label and the setup
  wizard's steps wrap onto a second line instead of losing their end — a
  translation runs longer than the English. A job's or a resume's own name is
  still cut, and shown whole on hover.

## [2.52.0] — 2026-10-06

### Added
- **The whole interface in Ukrainian.** Ukrainian is now in the language
  switcher at the bottom of the menu, beside English. What was still English
  in 2.51 is translated: Import a file, folders and their Files page,
  application packs, employer mode (screening) from the rubric to the
  scorecard and the comparison, the lines a page writes live while you edit
  or wait, and the Telegram and Discord messages — alerts, the held matches,
  the daily recap, the stale-application reminder, page changes, the budget
  warning — which now follow the language you chose. What the AI writes,
  your resumes and letters, and the CSV and Markdown exports stay as they
  are.
- A new install opens in the browser's language when it is offered, with the
  choice on every step of the setup wizard. An install that never chose is
  invited once, above the page on a phone or a tablet and in the menu on a
  wide screen.

### Changed
- The test build fails when a page holds English that is not in the catalog
  (#356), so a new page ships translated.
- A form's error reads in plain words: "Expected a number", "At least 3
  characters", "Not an email address".
- A count of one reads as one in a few more places: "Keep 1 more day",
  "Compare 1 applicant", "published in the last 1 day", "1 year".

### Fixed
- Finishing or skipping setup in English no longer stores English as a
  choice, so the invitation can still reach that install (#355). An install
  set up on 2.49–2.51 already holds English as its choice and is not
  invited: pick Українська in the menu or on Settings → General.
- A message about a pack that could not be prepared, and the "request too
  large" answer, read in your language.
- After switching the language, its confirmation shows on Jobs and on AI
  usage too, and no message comes back on the next page (#343).
- The language switcher names the language in use to a screen reader on the
  icon rail, and keeps the page's #section when it returns there (#358).

## [2.51.0] — 2026-10-06

### Added
- **The job seeker's pages in Ukrainian.** Overview, Jobs and the job page
  with all its tabs, the comparison and Tailor resume, Resumes and the clean
  version, Cover letter, Companies with the watchlist and Discovery, Runs,
  Applications, AI usage, Settings and the first-run wizard now read in
  Ukrainian when it is chosen, the sentences the code writes included: why
  a score is what it is, the next move, the search funnel, why a posting was
  turned away. Dates, numbers, countries and places follow the language.
  Still in English: employer mode, the words a page fills in live while you
  edit, the Telegram and Discord messages, and the pages added in 2.46–2.50
  (Import a file, folders, application packs). Until those are done,
  Ukrainian stays under Settings → General → Language → Unfinished
  languages. The English pages read as before, except that a count of one
  is singular and a large number carries a thousands separator ("1,200
  sources").

### Fixed
- Since 2.49.0 the message after muting or unmuting a company, and the
  watchlist's messages, did not show on Companies (#353).
- A count of one reads as one: "1 match" under the Overview's chart and
  "from 1 source" in the wizard, not "1 matches" and "1 sources".
- A browser that asks for `uk_UA`, or writes its preference as `Q=0.8`, is
  offered its language; a catalog line with a capitalised tag is refused
  when it loads instead of rendering wrong (#368).
- A Jobs link whose "posted" value names a built-in property
  (`?posted=constructor`) no longer fails the page.

## [2.50.0] — 2026-10-06

### Added
- **A folder of postings you save.** Companies → Add sources → **A folder
  on this computer** now takes a folder you save postings into: "Save page
  as…" in the browser, a page printed to PDF, a `.docx`, a text or Markdown
  file. Each file becomes one job, taken as a posting you pasted: scored,
  never set aside by a search's filter, and kept as Saved when no search
  wants it. A match alerts like any other and says which folder and file it
  came from; the folder's **Alerts** can be set to "No alerts", which also
  prepares no application pack for it.
- Code reads what it can first: a page's own posting block (title, company,
  place, date), its address, its main text. The AI engine is asked for the
  title and company only when the file does not state them, never twice for
  the same file, and never while fetching is paused. What a browser saves
  beside a page (its `_files` folder) is passed over.
- **Read within a minute with `npm start`.** The worker watches these
  folders and reads a saved file a few seconds after it lands, outside your
  search hours too. In Docker they are read at the hourly check.
- The job page says which folder and file a job came from, and a folder's
  **Files** page links each file to its job.

## [2.49.0] — 2026-10-06

### Added
- **The groundwork for an interface in your language.** ApplyPack's
  interface is being translated: Ukrainian first, then German, Spanish,
  French and Hindi. This release carries the machinery and the first words:
  the menu and the controls every page shares read in English and
  Ukrainian, and dates and numbers follow the language. The pages
  themselves come in the next releases, so Ukrainian is not in the switcher
  yet. To try it: Settings → General → **Language** → Unfinished languages.
  What the AI writes, your resumes and your letters stay in the language
  they are written in ([ADR 0061](docs/adr/0061-the-interface-speaks-several-languages.md)).
- **The language never changes by itself.** An install that exists today
  stays English. Once a language is offered, a browser that prefers it sees
  one line at the bottom of the menu proposing the switch, and either answer
  ends the question. A new install's setup opens in the browser's language,
  with the choice on its first step.
- Cyrillic is drawn in Inter, as Latin is, and Devanagari in Noto Sans
  Devanagari. Both files are served from your own install and fetched only
  by a page that holds those letters.
- For translators: [docs/translating.md](docs/translating.md) has the rules,
  the voice per language and the glossary. One JSON file per language, and
  `npm test` checks it against the English one.

### Changed
- `npm run smoke:routes` ends with a pass over every page in a
  pseudo-language and prints how much English is still written into the
  code: 2 708 runs of text on 34 pages today. Each translation release
  brings it down.

## [2.48.0] — 2026-10-06

### Added
- **Application packs.** For a strong new match the worker can do the
  evening's work by itself: check that the posting is still open, compare it
  with your resume, research the company on the web, tailor the resume
  lightly and keep the file. In the morning one message says which packs are
  ready and which postings are not worth your time; the job's new
  **Application pack** tab shows the company in a few sentences, what was
  changed line by line, what was left for you, and **Download .docx / .pdf**.
  **Off by default**: Settings → General → Application packs.
- You decide when a pack is prepared: the fit a posting needs (90), how many
  a day the worker starts on its own (5; 0 = no limit) and how recently the
  posting must have been published (7 days). Only postings found after you
  switch it on are prepared — the jobs already stored are never walked, and
  a re-classify prepares nothing. Any single job can be prepared by hand on
  its tab, whatever the settings say.
- A pack stops early and says why: the posting is closed, it requires
  something your resume does not show, no edit could bring the resume close
  enough, or the company check says fake or not worth applying. Measured on
  44 real postings with fit 90 or more: 17 reached the end, 17 failed a
  requirement, 7 could not get close, 2 were closed, 1 was not worth it.
- You decide what an automatic edit may touch: the title line, the summary,
  the skills, how many experience bullets (2), whether anything may be
  removed (no). Whatever you choose, only wording the fact check let through
  is applied, a keyword nothing in your resume backs is never written, a
  rewrite that would lose a number the line had is left for you, and your
  contact details are never touched. Your stored resume is not changed.
- **The file you sent stays.** "I sent this file — mark applied" marks the
  job applied and keeps the pack's file exactly as it was; it can be
  downloaded from the job for as long as the job is there.
- A cover letter with the pack when you ask for one: never (the default),
  when the posting's own text mentions one, or always.
- Overview → **Ready to send**: the packs prepared and not yet sent.
- `npm run pack:dry` measures what packs would do to the postings you
  already have, on a copy of the database; `pack-once.js` runs the queue now.

### Changed
- The worker now calls the resume module for packs (ADR 0063 amends ADR 0008)
  and has a seventh schedule, `pack`, that beats every minute and does
  nothing while no pack is queued.

## [2.47.1] — 2026-10-06

### Fixed
- **Tailor resume wrote the posting's job title onto a skills line.** The
  posting's own title is a keyword, so that your title line can take it.
  **Add missing keywords to your skills**, **Apply all** and the chip's
  **+ add** offered it as a skill as well, and a resume came out with
  "Frameworks/Libraries: …, Senior Software Engineer, Backend". Measured on
  17 real comparisons: three of the seven keywords Apply all would write
  were the title. It is no longer offered as a skill. It still counts in the
  score, stays among the missing chips, and goes on the title line through
  its own suggestion or by hand.

## [2.47.0] — 2026-10-05

### Added
- **A folder of job files as a source.** Companies → Add sources → **A
  folder on this computer**: name a folder a tool of yours writes exports
  into, and each hourly check reads the new `.json`, `.jsonl`, `.csv` and
  `.tsv` files in it. **Check** shows what is in the folder, which column
  was read as what, the first rows as they would be stored and what the next
  check would cost, with no AI spent; **Add (off)** stores it, and you switch
  it on in the table. A file is read once and again only when it changes; a
  file still being written waits for the next check; a copy of one already
  read is set aside.
- **Folders on this computer** on Companies shows each folder's line
  ("214 files · 3 new at the last check") with **Files** — what became of
  every file, in words — **Mapping** and **Check now**.
- ApplyPack never writes, moves, renames or deletes anything in the folder.
  With `npm start` a folder inside your home folder works (the page can
  create `~/ApplyPack/inbox`); in Docker, mount the folder read-only into
  both services and name it in `APPLYPACK_INBOX_ROOTS`
  ([ADR 0062](docs/adr/0062-rows-the-user-brings-are-read-never-fetched.md),
  addendum; [docs/install.md](docs/install.md#a-folder-of-job-files)).

## [2.46.0] — 2026-10-05

### Added
- **Import a file of jobs.** Jobs → **Import a file** takes rows you already
  have — an export, a spreadsheet you keep, the output of a tool you run — as
  JSON, JSON Lines, CSV or TSV (up to 5 MB, the first 2 000 rows). Before
  anything is stored a preview shows which column was read as the title, the
  link, the company and the text, with a select to correct each; the first
  three rows as they would be kept; how many are new and pass your searches'
  filter; and what scoring them costs. **Import** then runs them through the
  same filter, scoring and alerts as every other job, with a row on Runs.
  While fetching is paused they are stored unscored and no AI is spent. A
  newer export into the same source adds only what is new, and each company
  in the file is named on its own rows, so a mute works on it — for the rows
  that name one: with no company column mapped there is nobody to mute.
- ApplyPack reads the file and requests nothing. Columns about people (who
  posted, who recruits, an email, a phone) are never read, a link is kept
  only when it is http(s), and the file itself is never stored
  ([ADR 0062](docs/adr/0062-rows-the-user-brings-are-read-never-fetched.md)).

### Fixed
- A posting whose markup is never closed no longer stalls the reader. Three
  hundred kilobytes of unclosed tags took nine to twenty-five seconds to
  turn into text; it takes milliseconds now, and the text of every other
  posting comes out the same.
- A posting carrying `&#0;` is stored like any other. The decoded NUL made
  the database refuse the row, and the fetch that brought it failed.
- A link written with a trailing dot after its host (`host.com.`) is
  recognised as that host by the list of sites ApplyPack never requests.
- The progress page of a long run keeps its answer for half an hour after
  the run finishes, not after it started.

## [2.44.0] — 2026-10-05

### Added
- **Each AI engine takes the tasks you give it.** Every engine card on
  Settings → AI engine has a row of boxes, **Tasks it takes**: scoring
  postings, reading a resume, resume analysis, cover letters, the web check
  and (in employer mode) screening. All are ticked at first, so nothing
  changes until you untick one. An engine that does not take a task is not
  asked for it, and is not its fallback when the engine above fails. A small
  model on your computer can score the hourly postings while your
  subscription writes the letters: put the local engine first and leave
  only **Scoring postings** ticked on it (ADR 0060).
- **Who does what, in one table.** The AI tab opens with a row per task:
  the engine and model that answer it, whose money that spends, and the
  engines behind it. It redraws when a card saves. A task that no usable
  engine takes is still answered by the whole list, and the tab names it.
- **AI usage, a page of its own.** In the menu under System: which model did
  what, how long it took and what it cost. The calls are grouped by the model
  that answered, each task with its number of calls, the typical time (the
  middle call, and the one nine in ten were faster than), the tokens and the
  money. The three totals stay apart as before: billed, covered by your
  plans, local. Last 7 days, this month, last month or this year.
- **Worth a look: what the ledger suggests changing.** Above the table, in
  plain sentences with your own numbers: the task most of the bill went to
  while an engine your plan covers (or a model on this computer) stands
  ready, with the step that is missing — enable it, tick the task, move it
  up; calls that fell over to a billed engine and what they cost; an engine
  that keeps failing or hitting its rate limit; scoring billed on a model
  several times the price of the cheapest one its engine offers; a month
  whose pace runs past your budget. Every hint is arithmetic on your calls,
  your engines and the published prices. None says a model is good enough
  for a task, a model on this computer is suggested for scoring only, and
  applicants' resumes are never steered onto a personal plan.

### Changed
- Settings → AI engine no longer carries the Usage & cost table: it moved to
  the AI usage page, which also shows who answers each task now. The
  **Monthly budget** stays on the tab, with a link.
- The engine named on a comparison's progress page, on the Screening tab
  and under a cost estimate is the one that answers that task, which is no
  longer always engine #1. Reading a resume and analysing it may be two
  engines, and the progress page times each step on its own.
- The warning about a billed engine standing ahead of one your plan covers
  is read per task, and redraws with the table.
- In the usage ledger, "served by a fallback" is read against the engine the
  table names for the task. A web check answered by the first engine that
  can search is no longer recorded as a fallback.
- While employer mode is off the page has no Screening box. An engine's
  first narrowed list sends Screening where Resume analysis goes, and a
  choice made with the box in sight is kept.

## [2.43.0] — 2026-10-04

### Added
- **Antigravity CLI as an AI engine.** A seventh engine: headless `agy -p`
  on your Google Antigravity account, with its own card on Settings → AI
  engine and in the first-run wizard, and its calls in Usage & cost as
  plan-covered. Gemini 3.8 Flash scores the postings and Gemini 3.1 Pro
  takes the resume calls and the letters unless you pick another model
  (Claude Sonnet 4.6 is in the list). Install `agy`, sign in once, then
  Enable and Test. Local installs only: the CLI keeps its login in the
  system keyring and the Docker image does not carry it. Contributed by
  [@amir-darwish](https://github.com/amir-darwish) in
  [#329](https://github.com/applypack/applypack/pull/329).
- The engine never searches the web and runs in an empty folder of its own.
  Headless `agy` may read and write files inside its workspace, and the only
  way to let it fetch a page is a flag that also lets it run shell commands,
  so "Is it real?" goes to the next engine in your chain that can search.

### Changed
- The price table was read on 2026-10-03 and has rows for Gemini 3.8 Flash
  and Gemini 3.1 Pro.

## [2.42.0] — 2026-10-01

### Added
- **What this reader looks for in a summary.** The summary section of every
  comparison (the job's Resume match tab and Tailor resume) opens with a
  checklist, read off the text with no AI: the role in the posting's words,
  your years, the core stack you have, two of its must-haves, one result
  with a number, 2–4 sentences under 80 words, no "I" and no filler, and the
  terms your resume cannot back. Above it, who reads the resume first and
  what they scan for. The same checks run on the suggested summary, so the
  card says "yours: 5 of 8 · the suggestion below: 8 of 8".

### Changed
- **Suggested summaries follow the rules recruiters write.** Three
  sentences (who you are for this role, one proven result, what you bring),
  at most about 75 words, the posting's own words, your years exactly as the
  resume states them. A resume with no summary is offered one under the
  headline. Where a posting says "PHP and/or Java", the summary names only
  the one you have. The research and its sources are in
  `docs/resume-summary.md`.
- **A refused title or summary is written again.** When the fact check
  refused the suggested wording (the live case claimed Java for a PHP
  resume), the card used to say "Rewrite summary to lead with PHP/Symfony"
  with nothing to apply. The comparison now asks once more with the reason
  in sight, and **Rewrite** on such a card does the same.
- Comparisons stored before this release are re-run instead of reused
  (prompt v16).

## [2.41.2] — 2026-10-01

### Fixed
- **The Claude Code CLI read the project's instructions into every call.**
  Under `npm start` it ran in the ApplyPack folder and loaded its
  `CLAUDE.md` and memory: about 53 000 extra tokens on every classification,
  scan and comparison, taken from your plan, and a resume scan that reported
  those instructions as an injection in the resume. It now runs in the
  temporary folder, as the Gemini and Codex CLIs already did, with its
  CLAUDE.md and memory reading switched off. Docker was not affected.
- **No cover letter could be written** when your own Claude Code settings
  ask for `xhigh` or `max` effort: with thinking off, Opus 5 refuses an
  effort above `high`, and every letter failed. Calls without thinking now
  ask for `high`.
- **A keyword added from Tailor resume could land inside a job.** A bullet
  or a title with "stack" in it ("Built full-stack checkout features",
  "Senior Full-Stack Engineer") was read as the skills heading, so **+ add**,
  **Apply all** and **Add missing keywords** wrote the term into a role's
  "Technology Stack" line, its dates line, or an "Also:" line between its
  bullets. Only a real heading opens a skills section now.
- Two last lines removed in a row and undone out of order came back swapped.
- Removing the first item after a label left "Skills: , PHP".
- In the Document view, a missing keyword's chip and **Locate** did nothing
  when the document could not outline the line: they open Plain text there.
- **"NestJS is a must here and nothing backs it yet"** beside Express and
  Fastify: a must in an either/or group the resume already answers asks for
  nothing more, as the score already counted it.
- A plain-text or PDF resume whose headings are not in capitals
  ("Experience", "Skills") was read as one header block: the clean version,
  What the ATS sees and the years-at-work line came out empty. A title that
  opens the contact line is the title, and a role keeps no comma where its
  dates were.
- The Text / Document switch showed no pressed state (its classes were
  missing from the stylesheet); CI now fails a stylesheet that is out of
  date.
- The Overview counted "node", "nodejs" and "node.js" as three bars, and
  compared a new install's week with a week it never lived through.
- A resume whose name ran past 80 characters with an emoji at the cut could
  not be downloaded.

## [2.41.1] — 2026-09-30

### Added
- **Add every missing keyword in one press.** On Tailor resume, **Add missing
  keywords to your skills** lists every keyword the text does not spell,
  ticked where your resume already backs it; an unticked one has nothing
  behind it yet — tick it only if it is true. Each goes on the skills line it
  belongs to, and what no line can take gets a line of its own. **Apply all**
  now adds every keyword your resume backs, not only the ones a skills line
  could take.

### Changed
- **Suggestions carry the posting's missing keywords.** Every bullet or
  summary rewrite names a keyword the resume does not yet show in a sentence
  (prompt v15), and a must-have one that no rewrite carries is asked for
  again. The next comparison of each posting reads its keywords afresh.
- A keyword with no hint of its own goes on the last skills line (usually
  "Others"), not among the programming languages of the first.

### Fixed
- **A title printed twice.** A headline with its own "|" was also read as an
  extra header line, so the Document view — and a file downloaded from it —
  showed it twice after Apply all.
- A suggestion whose wording brought its own "- " left "• -" in the resume.
- **Every paragraph of the Document view can be edited:** a company and its
  place, a title and its dates (the two columns stay), a skills-table cell,
  and a paragraph the text broke over lines. Only a formula still goes to
  Plain text.

## [2.41.0] — 2026-09-30

### Added
- **Apply all suggestions in one press.** On Tailor resume, **Apply all
  suggestions (N)** under the score writes every wording the check let
  through, the removals and the missing keywords a skills line can take into
  your resume at once, and says what landed. **Undo all** takes them back;
  every card keeps its own Undo. No AI call, nothing saved.
- **Your resume as the document it is, beside the suggestions.** The resume
  card opens on **Document**: your own `.docx` with the edits written into it,
  or — for a PDF — the same text re-set in the look read off its page. Changed
  paragraphs are marked, and a dashed line shows where a page would end.
  **Plain text** is the editor as before.
- **Edit a paragraph in the document.** Click it, change the words, Enter
  keeps it, Escape puts it back; emptying it removes the line. The score and
  the suggestions follow, as they do for typing.
- **Download .docx / .pdf** of the document as it stands, without saving a
  version. The PDF of your own `.docx` opens the print dialog at the file's
  own page size — choose Save as PDF.

### Changed
- **A PDF's clean version looks like the PDF.** Its skills table stays a
  table, places and links keep their colour, titles and dates their grey and
  weight, the header its rule and the body its justified edge — read off the
  page itself, with no AI. The clean-version page (`/resumes/:id/render`)
  prefills the accent colour from a PDF too.
- **A save is always a document.** When your `.docx` cannot take an edit, or
  the resume is a PDF, Save keeps the clean `.docx` the Document view showed —
  no more Markdown versions; the next save edits that file in place.
- The clean version never drops a line: it keeps your own section headings,
  a second contact line and the "Technology Stack" line after the bullets, and
  a skills line in capitals is no longer mistaken for a heading.
- Save writes into a skills table cell by cell, so adding a keyword to a
  table row no longer turns the save into another file.
- Removing a bullet's words takes the whole bullet, and a cut from a list
  takes one separator with it.

## [2.40.0] — 2026-09-30

### Added
- **The Overview is a dashboard.** Four status cards — New, Alerted, Applied,
  Saved — each with what moved in the last 24 hours and the last fortnight as
  bars. Under them, **Jobs matching your searches**: matches per day over 7,
  30, 90 or 180 days, the total, and the change against the range before;
  point at the chart for a day's number. **All stack** narrows it to one
  technology (7 and 30 days), and so does a bar of **Jobs by stack** — what
  the last 30 days' matches ask for. The search funnel for the same range
  stands under the chart; beside it, pipeline health and what the search did
  in the last 24 hours. None of it spends an AI call.
- **Recent alerts read like an inbox:** who hires, where ("Remote · USA,
  Canada +3"), the technologies, the fit and how long ago.

### Changed
- **A crisper look on every page.** Darker text and clearer card edges
  (helper text now holds 5:1 contrast on every surface), a larger page title
  with one sentence under it, rounder cards, a white menu with a clearer "you
  are here", and one height for a field and the button beside it.
- **Fit is a number in a coloured tile** instead of a number beside a small
  meter, and a status pill no longer repeats itself with a dot.
- **Places read as words, technologies by their names.** Jobs shows "Remote ·
  USA, UK +1" instead of a row of flags — the places your searches name come
  first, every country is in the tooltip — and TypeScript, Node.js, AWS
  instead of lowercase tags.
- **Settings → Schedule says which hours belong to what.** The alert window
  (its hours and days) shows only under "Only during these hours".
  **Scheduled messages** is its own block: the hours of the daily recap and,
  once a day at the first of them, the stale-application reminder.
- **"+1 in the last 24h" counts what happened today.** On Applied it is an
  application sent in the last 24 hours, on Alerted an alert sent — before,
  both counted jobs that happened to be found today.
- A Delete button is quiet until you point at it: the word is red, the
  outline is any button's.
- DESIGN.md describes the new system: the colours and their tested contrast,
  the type ladder, the cards, and the rules a chart follows.

## [2.39.0] — 2026-09-28

### Changed
- **Less to read before you act.** The resume page, the Tailor resume
  editor, the screening page and the clean-version page keep one sentence of
  help in sight; the rest folds under "How this works". Costs, what a failed
  gate means and what a save changes stay visible.
- **One type scale.** Headings, notes and small print use the same few sizes
  on every page, and the ApplyPack name in the sidebar is one step larger.

### Fixed
- **A browser no longer runs last release's scripts after an upgrade.** The
  dashboard's scripts and stylesheet are checked on every load (#318).

## [2.38.0] — 2026-09-28

### Changed
- **Deleting asks once more, and no longer needs JavaScript.** Delete,
  Remove and Forget open a small box in the middle of the screen: it says
  what will happen, with Cancel and the real button. It works with scripts
  off, and a table can no longer hide it. Forgetting a confirmed fact now
  asks too.
- **A refused field says so itself.** When a form is refused, the field it
  is about gets a red outline and the focus, and a screen reader reads the
  message with it.
- **Jobs, Companies and Runs fit a phone.** Each table keeps the columns
  that name a row and say its state; the rest appear as the screen widens.
- **Nothing cuts its own words at 1024 px:** the screening criteria editor,
  the AI engine's model pickers and the add-company form.

## [2.37.0] — 2026-09-28

### Changed
- **One name for each thing.**
  - The menu's "Compare" is now **Tailor resume**, the name the editor
    already had. "Compare" is the button that runs one comparison.
  - The Settings tab that holds your searches is now **Searches** (links
    with `?tab=profile` still work).
  - The match card's ceiling line reads "editing can reach a match of 92",
    because "fit" is the search's number, not the resume's.
  - DESIGN.md has the list of words.

## [2.36.0] — 2026-09-28

### Changed
- **A failed run on the Runs page reads as a sentence.** It says what failed
  and why in one line, and what is safe and what comes next. The raw error
  folds under Details.
- **Empty lists say what to do.** An empty jobs list offers Fetch now (or
  Clear all filters), a resume without comparisons points at your jobs, and
  an empty applications board says how a card gets onto it.
- **Dates like "3 hours ago" show the exact date and time on hover.**
- **The schedule's time zone starts at your browser's** until you save one.
- **Saving your edits into your own .docx offers the file** right in the
  message: "Download .docx".
- **Smaller things:**
  - The name of the resume on a comparison links to its strength review.
  - A resume's page links to filling your current search from it.
  - The targeted view's three tabs work with the arrow keys.
  - Stars and gate marks in a screening are read out by a screen reader.
  - A wide table can be scrolled from the keyboard.

### Added
- **Screening bench (for maintainers):** the gold set has a tailoring pair
  and the gates a person read, so `npm run bench:screen` prints both lines;
  `--compare` reads the top three head to head twice and says how far the
  two readings agree. Every real comparison logs the same agreement line.

## [2.35.0] — 2026-09-28

### Changed
- **Screening: a cover letter is attached to its applicant, not scored as a
  second resume.**
  - A letter in an upload goes to its writer's row: the resume in the same
    folder, the one with the same email or phone, or the file with the same
    name ("Ann_Lee_CV.pdf" and "Ann_Lee_Cover_Letter.pdf").
  - The scorecard shows it, and the table row says "+ cover letter". No AI
    reads it.
  - A letter whose writer's resume did not come with it is left out, and
    the upload says so.
- **Screening: sectors are read the same way every time.** "Banking" counts
  for a "payments / fintech" criterion, and "e-commerce/fitness" and
  "fitness/e-commerce" are one career. Scores already stored pick this up
  when scored again, or all at once with
  `node dist/scripts/rescore-screenings.js --write` (no AI).

## [2.34.0] — 2026-09-28

### Changed
- **Screening: an applicant whose redaction may have missed something is
  held.** When the check after redaction still finds an email, a phone or
  a part of the name, no AI reads that applicant. The table shows them as
  "Held for a look", and their scorecard says what kind of thing was found.
  **Score it anyway** sends them on once you have read the redacted text.
- **Screening: religion and health are removed too** when a resume states
  them as personal details ("Konfession: …", "Stan zdrowia: …",
  "Disability: …"). A job about health tech keeps its words.
- **Screening: adding a folder of resumes writes them in one go** rather
  than one database transaction per file.

## [2.33.0] — 2026-09-28

### Changed
- **A skill your resume only lists counts a little less than one it shows
  at work.** A keyword the posting wants that appears only on your skills
  line now earns 85% of its credit; mention it in a bullet about the work and
  it earns the rest. Most scores move by a couple of points. The core-stack
  limit and "what editing can reach" are not affected, and the live score in
  the editor moves as you write the bullet. Comparisons made before keep
  their number until they are scored again.

### Added
- **How long and how lately your roles show each keyword.** In the keyword
  table, a matched term says how many years your dated roles mention it and
  whether you use it now ("3.8 yrs at work · 6 yrs ago"). It turns amber when
  the last role that names it ended more than three years ago. It is shown,
  not scored.

## [2.32.0] — 2026-09-28

### Added
- **The same resume in two formats, side by side.** On a resume's page,
  "What the ATS sees" takes the other file (say the PDF of your .docx) and
  shows what a plain parser reads from each — contacts, roles with their
  dates, sections, warnings — which one to send, and the lines where the two
  texts differ. No AI, and the file is not kept.
- **"What the ATS sees" shows what the parser found:** your name and
  headline, each contact detail (or "not found"), the sections, and every
  role with its dates — a role without dates is flagged.
- **A keyword your resume has only under another spelling says so** ("as
  Postgres"): many ATS filters search the posting's own word.

### Changed
- **An example in the strength review never invents a fact.** A suggested
  bullet with a figure or a tool your resume does not show is replaced by a
  question about it.

### Fixed
- **Windows (`npm start`): Compare, the keyword table and Save as vN work.**
  The dashboard loaded two of its own modules by a Windows path, which Node
  refuses; they now load by file URL (#309).

## [2.31.0] — 2026-09-28

### Changed
- **A file or pasted text on the Compare and Cover letter pages is judged on
  its own text.** It may be a friend's resume or an old one, so your
  confirmed facts and your other resumes no longer lift its score or back its
  letter. Tick **A file or pasted text here is my own resume** to use them —
  or upload a file that matches one of your saved resumes, which counts as
  yours.
- **A skill that only another of your resumes shows counts half and does not
  lift the core-stack limit.** The screener reads this resume. Write the word
  in and it counts in full.

### Added
- **A posting that is not in English says so** on the Resume match and Cover
  letter tabs: the comparison and the letter are written for English.
- **The same resume uploaded twice is not added twice,** and a "new version"
  that reads exactly like the current one is not made. Neither pays for a
  scan.

## [2.30.0] — 2026-09-28

### Added
- **Start with this computer.** On an `npm start` install, Settings →
  General has one button that makes ApplyPack start when you log in (a
  launchd agent on macOS, a user service on Linux, a Startup script on
  Windows). The same button takes it away again.
- **A daily copy of your data.** The first start of each day copies the
  database to `snapshots/<date>` in the data folder, and the last three are
  kept (`APPLYPACK_SNAPSHOTS` changes how many, 0 turns it off). Restoring
  is copying it back.
- **`npm run db:import` moves a Docker install in:** dump the rows on the
  Docker side, import them here — everything replaced in one go, or nothing
  if the dump fails part-way. docs/install.md has both commands.

### Fixed
- **The command-line engines could not start on Windows,** where npm
  installs them as `.cmd` files Node will not run without a shell. ApplyPack
  now runs the script inside the file directly — never through `cmd.exe`,
  which would read a posting's text as commands.

## [2.29.0] — 2026-09-28

### Added
- **Local model (Ollama): an engine of its own.** It talks to Ollama through
  its own API, so ApplyPack sets the context window on every call — 8k to
  64k tokens, 16k by default, on Settings → AI engine — instead of whatever
  the server defaults to. It asks for JSON where it reads JSON, and runs one
  call at a time so a single GPU is not split three ways. No key, no bill,
  and the text never leaves your machine.
- **A prompt too long for a local model is refused, not cut.** A local
  server cuts an over-long prompt from its start — the rules — and answers
  anyway. The local engine now refuses such a call with the size it needed,
  and the next engine in your list takes it.
- Setup's "A model on this computer" uses Ollama through the new engine and
  LM Studio through the OpenAI-compatible one, which now can sit beside it
  in the list.

## [2.28.1] — 2026-09-28

### Fixed
- **A refused API key was tried first on every call.** A key or a sign-in
  the vendor turns away now moves the call to the next engine at once, and
  that engine is left alone for ten minutes or until you paste a new key.
  The message says "the key was refused" and where to fix it.
- **Retries followed the vendor's rules only partly.** A rate limit or an
  overloaded server gets one more try after the wait the server asks for,
  when that is ten seconds or less. A used-up plan or quota is not retried,
  and the Anthropic library no longer waits on its own for as long as a
  server says, on top of that.
- **A rate-limited Claude CLI call was never retried,** because the CLI
  exits with an error code. It is now judged by what it printed.
- **Stopping ApplyPack left a CLI call running** on your plan until its
  timeout. The worker and the dashboard now end it as they stop.
- **The Gemini and Codex CLIs could wait on an open input** until the call
  timed out; their input is closed as they start. A prompt that opened with
  a dash would have been read as an option by either CLI.

## [2.28.0] — 2026-09-28

### Added
- **A model on your own computer, without editing a file.** Setup's first
  step finds Ollama or LM Studio running at their usual addresses and
  offers **Use it** with the models they have. On Settings → AI engine the
  OpenAI-compatible engine has a **Server address** of its own, so
  OpenRouter, Groq or a local server no longer needs `.env`.
- **A server on your machine needs no key.** It is free in the usage
  table, and **Test** lists the models it runs, suggests them in the model
  fields, and says why a call failed: nothing listening, an address without
  its `/v1`, a model the server does not have.
- **A search that runs only on a local model is not held to OpenAI's or
  Anthropic's robots.txt rules** when you add a company's careers page. It
  still honours the site's rules for ApplyPack and for everyone.

### Fixed
- **A call on a model the price table does not know read "$0"** in Usage &
  cost. It reads "not priced" now, as the note under the table says.

### Changed
- `docker-compose.yml` maps `host.docker.internal` on Linux too, so the
  containers can reach a model server on the machine they run on.

## [2.27.0] — 2026-09-28

### Added
- **A posting taken down from its company's board reads "Closed".** When
  ApplyPack can tell it read a board's whole list (Greenhouse, Lever, Ashby,
  Workable, SmartRecruiters), a stored posting missing from it is marked
  closed on the job page and in the list. It is marked open again if it
  returns. A list that might be cut short never closes anything.
- **"Check now" on a watched company checks it now,** with the same progress
  page as Fetch now, and says what it found.
- **The starter packs that fit your searches** now appear on Companies →
  Sources for your searches as well as in the setup wizard, with one Preview.

### Changed
- **A restart no longer re-downloads every board.** The "has this feed
  changed?" answers are kept with each source, so an `npm start` install that
  restarts with the laptop asks politely from its first check.

## [2.26.0] — 2026-09-28

### Fixed
- **Workable boards past their first page were cut short, silently.** Every
  page is read now, up to five.
- **Hacker News salary ranges landed in job titles.** "$120–160k" was split
  on its dash, so half a salary could become the location.
- **An Adzuna snippet could show its markup.**
- **A relative link in a job feed you added could not be opened.** It is
  read against the feed's own address now.
- **A 4 Day Week search with an unrecognised country code got nothing
  back.** The unknown code is left out instead.
- **A link from a feed or from "Is it real?" is shown only when it is an
  http(s) address.** A `javascript:` link would have run in the dashboard.

### Changed
- A search that names a group beside its countries ("Poland, Germany and
  the EU") also reads Himalayas' latest postings, so an EU role open to
  Spain only is no longer missed.
- A board that answers "too many requests" with a short wait is waited out
  and asked once more.
- A site you add to the watchlist can ask for its own pacing
  (`Crawl-delay`), and ApplyPack keeps to it.

## [2.25.0] — 2026-09-28

### Added
- **Careers pages that draw their jobs in the browser can be watched.**
  Such a page used to end the company watch with "it probably needs
  JavaScript" and nothing added. It now goes on your watchlist as *Needs a
  browser*. Open the page, select all, copy, and paste it into the row's box
  under **Pages drawn in the browser**: ApplyPack says what is new since
  your last paste and which lines look like roles your searches want. No
  AI, and nothing is stored as a job. The Overview counts these pages as
  "to paste by hand".

## [2.24.0] — 2026-09-28

### Added
- **The applications board as a file.** `/applications` → CSV or Markdown:
  every application with its column, company, dates, fit, the resume it
  went out with, the recruiter, your notes and the link. It is the
  spreadsheet you would otherwise keep by hand.
- **"Next: three things" on the Overview.** After setup, until your first
  comparison: open your best match, compare it with your resume, tailor
  the resume for it. Each step links to the page that does it.
- **What a button will cost, before you press it.** The resume step and the
  scoring step of the setup wizard now say whether the call is billed per
  token, covered by your plan or free on a local model. Once calls are on
  record, they show the usual cost instead.

### Fixed
- **A new version's styles could be missing until the browser let go of
  the old stylesheet.** The stylesheet's address now carries the version.

## [2.23.0] — 2026-09-28

### Added
- **Mute a company.** From a posting's page (with a reason if you like), or
  by name under Companies → Muted companies. Its new postings are skipped
  before any AI reads them, from every source, and are never scored again
  by "Save & re-classify". The job list and the Overview hide the ones
  already stored. It says how many and lets you show them. Nothing
  changes status, and Unmute undoes both. Two spellings of one company,
  "Acme, Inc." and "ACME", are one mute.
- **A re-apply window.** Settings → General → Application tracking can rest
  a company you applied to for 30, 60, 90 or 180 days: its new postings are
  skipped before any AI. It is off by default.
- **Who hires, on every aggregator posting.** Remotive, RemoteOK,
  Arbeitnow, Adzuna, HN and the rest carry many employers. The list, the
  job page, the alerts and the digest now name the employer, "Acme · via
  Remotive", instead of the feed. Postings stored before this version get
  their employer at the next start, except those from the three feeds that
  never recorded it (RemoteOK, Remotive, Arbeitnow).

### Fixed
- **The AI was told the feed's name as the company.** For aggregator
  postings, the classifier, the "Is it real?" web search and the cover
  letter's greeting all read "Remotive" or "RemoteOK" where the employer
  belonged. Three feeds never passed the employer on at all. They get the
  real name now, at no extra token.

## [2.22.0] — 2026-09-28

### Fixed
- **The two-stage classifier paid for the same "no" every hour.** A posting
  its short prefilter turned away was never stored, so the next tick met it
  as new and asked again, for as long as it stayed on its feed. It is now
  stored as dismissed, unscored, with the prefilter's reason, and counted as
  a duplicate from then on. "Save & re-classify" still reads it. (#290)
- **"I don't" on a term the AI found no evidence for did nothing.** The
  answer was saved, but the question stayed on the card and came back on
  every visit. It is recorded on the term now. The flash also says "the
  score stays 37" instead of "score 37 → 37".

### Added
- **"Not sure"** beside "I have it" and "I don't" on a comparison's
  questions. The question stops coming back, nothing is claimed in the
  resume, and the AI is never told "no". Confirmed facts on /resumes lists
  it, with "I do have it" for later.
- **The version you run** is in the sidebar. Settings → General → Updates
  can also check for a newer release: off by default, one request a week to
  GitHub, and it never updates anything. When one is out, the sidebar says
  so and the settings give the commands.

## [2.21.0] — 2026-09-28

### Added
- **What the AI spent, and on whose money.** Settings → AI engine → Usage &
  cost lists every AI call: what it was for, which model answered, the
  tokens the vendor reported, and the money. There are three totals, never
  added together:
  - billed per token (API keys);
  - covered by your plans (the Claude Code, Codex and Gemini CLIs), shown at
    API prices as an estimate, not a bill;
  - local models, which are free.
  Periods are the last 7 days, this month, last month and this year. Calls
  that failed are counted too: a cut-off reply is billed.
- **A monthly budget for billed calls.** One line to your alert chats at
  80 % and at 100 %, once each a month. Nothing is ever stopped.
- **Before the click.** Compare, Verify and Generate letter say what such a
  call usually costs you. A posting's Details show what the AI has spent on
  it so far.
- **Each engine card says whose money it spends**, and warns when an engine
  billed per token stands ahead of one your plan covers.
- `npm run spend:report` prints the ledger per UTC day, engine and model,
  for a comparison with the vendor's own usage page (docs/ai-engines.md).

### Changed
- The seven-day run counter on the AI engine tab is replaced by the ledger.
- dotenv 18, loading `.env` quietly: dotenv 17 and later print a line on
  every start, which would break the JSON logs in Docker.

## [2.20.0] — 2026-09-28

### Added
- **Search funnel.** `/runs` opens on what the last 7 and 30 days made of
  your sources: read, past the filter, new to you, scored by the AI,
  matches, alerted. Below it, why the filter set postings aside (no title
  keyword, an excluded word, an arrangement you did not pick, outside your
  places) and why scored ones were dismissed (fit, location, salary), and,
  folded, what each source brought. The Overview carries one line of it.
  The days are kept in a small rollup that outlives the 90-day run history;
  the runs already stored were summed into it on upgrade. No AI is spent.
- **Why nothing came through.** A "Fetch now" verdict names the two filter
  gates that took the most, and the wizard's first scoring pass says why
  the rest were not a match.
- **Missing across postings.** From five compared postings on, a resume's
  page lists the keywords the postings keep asking for and the resume does
  not say, read against the text as it is now: a word to write, a question
  to answer under Confirmed facts, or a real gap. No AI.

### Changed
- TypeScript 7 builds the project (the native compiler: a type check in
  half a second). pino-pretty 13 for the `npm start` log lines.

## [2.19.1] — 2026-09-28

### Fixed
- **One fetch at a time.** The worker's hourly tick and "Fetch now" in the
  dashboard could run at once, reading the same sources and paying the AI
  twice for the same postings, and they could deliver held alerts twice. A
  Postgres advisory lock now guards the tick, "Fetch now", `fetch-once.js`
  and the monthly HN pull. The one that cannot take it records `overlap` and
  does nothing. node-cron 4 skips a beat whose previous run is still going.
- The Docker image installs from the lockfile (`npm ci`), prunes the dev
  dependencies and pins the three CLI engines, so two builds a month apart
  run the same code.

### Added
- **Container healthchecks.** `docker compose ps` says `healthy`: the
  dashboard's `/health` (it signs in when `WEB_BASIC_AUTH` is set), and a
  heartbeat file the worker touches every minute.
- **CI gates** for a high advisory in the shipped dependencies, a schema
  committed without its migration, an unused export, a setting missing from
  `.env.example`, and a Docker build. Dependabot proposes weekly updates.

### Changed
- In Docker the logs are JSON, one object per line. `npm start` keeps
  readable lines.
- node-cron 4, pino 10, @hono/node-server 2 (the same API, faster), the
  Anthropic SDK 0.128, and patch updates of hono, docx, jszip and tsx.
  deepmerge-ts is pinned to 8 under prisma 6 for GHSA-ggr8-5vv4-36mx until
  prisma ships the fix. `npm audit` reports no vulnerabilities.
- `tsconfig` resolves modules as `nodenext`, ready for TypeScript 7.

## [2.19.0] — 2026-09-25

### Fixed
- **Alerts wait instead of being marked sent.** With Alerts switched off, or
  when every chat refused the message, a match was marked Alerted anyway and
  a careers-page change was taken as reported. Now it waits and arrives in
  one message per chat once it can go out; a long wait lists the best 20 and
  counts the rest, which stay New. With no chat set up nothing waits: matches
  stay New on the dashboard. Overview and the Schedule section say what
  holds them.
- **Careers-page changes reach digest mode.** The change watch sent nothing
  when alerts arrive as a digest, and a change seen outside the alert hours
  could be lost to a 304 or a weekly check. A change now waits on the
  company row and goes out at the first hour the schedule allows;
  `/companies` says "notice waiting". One migration adds the column
  (`company.pendingContentHash`); it is applied on start.
- **The daily recap and the stale nudge say when they went nowhere** (Alerts
  off, or no chat) on `/runs`, and a recap every chat refused fails, so the
  next one covers the gap.
- **Dashboard dates are in your time zone** — the schedule's, `TZ` until you
  pick one — instead of Chicago's for everyone; `/runs` names the zone in
  its header.
- **The HN thread stops when either switch says so**, the parser on
  `/discovery` or its pill on Settings → Sources, for the hourly read and the
  monthly pull alike.
- **`fetch-once.js` runs like Fetch now.** On a paused install, or outside
  the schedule, it used to fetch nothing.
- **Screening rubrics.** A skill's text takes a recency window ("React / Vue
  within 36 months"), off unless typed. An untouched save no longer changes
  the rubric: it staled every verdict, and the location row grew on each
  save. A number past the schema ("70+" years) no longer answers 500, and
  "certification" gates draft as certification.

### Changed
- **The dashboard follows DESIGN.md's surface, violet and pill rules.** A
  settings tab is one surface with hairlines between sections; violet marks
  only AI spend and Saved; full pills are badges and meters, and the chosen
  comparison or letter chip shows a check.
- The fence registry test follows a renamed AI call (`askForJson as ask`),
  and CODEOWNERS no longer claims the owner's review is required.

## [2.18.5] — 2026-09-25

### Fixed
- **Three places in the dashboard read wrong.** The Messages API card on
  `/settings` → AI engine no longer promises prompt caching: the classifier's
  prompt is under Haiku 4.5's 4096-token floor, so the per-posting calls are
  never cached. The empty jobs list says "No jobs yet" when no filter is set
  and links the Sources tab it names. `/companies` → How coverage works named
  6 of the 20 aggregators from a hand-kept list, one of them under an
  identifier the enum does not have; the list is now read off the code, says
  which two need your own key, and links the Sources tab.
- **The landing page header fits a tablet screen.** The GitHub button keeps
  its icon only up to 900 px, and below 744 px only the Open source pill
  stays in the nav; before, the header ran up to 133 px past the screen
  between 641 and 774 px.
- **Public copy says most sources run every hour**, not all 33 kinds:
  Adzuna is polled four times a day and a watched company keeps its own
  interval. The README pipeline names Discord beside Telegram.

### Changed
- **SPEC.md and ARCHITECTURE.md describe the code as it is:** the
  routes that exist, crons in `TZ` (UTC by default) with the hourly digest
  and nudge beats, Telegram and Discord, the five AI engines and their
  defaults, a per-tick diagram with the held-alert path, an ER diagram of all
  20 models, and a file map that lists every non-test source file.
- **The docs test reads more:** code names inside fenced blocks and
  diagrams, the ER diagram against the Prisma schema, and every
  `GET|POST /route` the docs name against the routes the dashboard
  registers. An applied migration no longer counts as "the code".
- TASKS notes about labelled first issues, ADR 0037's link to 0042 and the
  register's forward notes, and three code comments (cron time zones, where
  the resume shape comes from, the cover-letter slot) were brought up to date.

## [2.18.4] — 2026-09-24

No runtime change: documentation, public copy and tests.

### Changed
- **The docs say what the code does.** CLAUDE.md, SPEC.md, ARCHITECTURE.md,
  DESIGN.md, TASKS.md and the operator docs were read against the code and
  corrected. Every ADR the code has moved past links to the ADR that changed
  it or carries a dated addendum, and ADR 0005's undecided sources are now
  "not used". Each dated plan opens with one status line.
- **The public copy says what the product does.** On the landing page, the
  demo and the launch drafts: a typed word counts in full (ADR 0045), alerts
  go to Telegram or Discord, `npm start` is the default install, Save writes
  into your own .docx, the five first-run steps, the source, vendor and
  aggregator counts, the cost per posting. README no longer says fake
  postings are dropped (a posting is checked when you ask) or that the clean
  PDF is set in your own font, and no copy promises labelled first issues.
- `docs/operations.md` warns that a backup holds AI keys, bot tokens,
  webhooks, resumes and applicants in clear text, and names DOU's terms for a
  hosted install. The bug report form asks for steps, expected, actual and
  severity.

### Added
- `src/docs-paths.test.ts`: every path, `file:symbol` and code name the docs
  cite must still exist in the code. `source-count.test.ts` also reads
  SPEC.md and counts written as words.

### Removed
- `hash-probe.ts`, the tracked `.scratch/` and an outside plan's source file.

## [2.18.3] — 2026-09-21

### Fixed
- **A comparison survives a brief the database refuses.** The reading of a
  posting is kept as a memo. On an install whose worker had not been rebuilt,
  the unique key v2.18.1 adds did not exist yet, the store refused the memo,
  and every comparison of a new posting failed after the model had already
  answered. The answer is now used for that run and a warning is logged; only
  the memo is lost.
- **Making a search primary takes the lock that deleting one takes.** A delete
  landing in between made the foreign key refuse the write, and the flash
  showed Prisma's own error text. A stale search — deleted in another tab, or
  a second press on Delete — now says the search no longer exists, on Run,
  Pause, Make primary and Delete alike.
- **The last two "AI match" sentences** — after checking a new resume version
  against a job, and on the targeted view before any comparison — say "match"
  and "comparison", like the rest.
- **"Engineering Manager" passes an "engineer" keyword again.** v2.18.0 made
  title keywords match whole words, with five measured suffixes; "ing" was
  missing, and "engineer" dropped 33 of 941 stored titles. The same suffix
  lets "market" reach "Marketing" and "account" reach "Accounting". On the
  default search no verdict moves.

## [2.18.2] — 2026-09-20

### Fixed
- **The applicant notice says what actually happens.** It promised that an
  application is "deleted after the hiring round closes", and nothing in the
  tool closes a round — deletion follows the retention on the Screening tab.
  It now names that number, taken from your own settings.
- **Run history is pruned.** `cron_run` grew forever while the docs said 30
  days. Runs older than 90 days are deleted with the rest of the nightly
  cleanup; a run still going is never touched.
- Five messages said something that was not so: a new search told you to
  "press Activate" (the button is Run), the alerts toggle reported itself as
  Telegram-only when it covers Discord too, a comparison called its score an
  "AI match" when the number is computed in code, "Re-classify started" was
  shown while one was already running, and deleting a resume that was not
  there said it had been deleted.
- **The clean render says what it removed.** It silently dropped characters
  the bundled typeface cannot draw — CJK, emoji, subscripts. The page now
  names them. The four buttons on that page also work without JavaScript,
  where all of them used to just refresh the preview.

### Security
- No `.env` file of any name reaches the Docker build context.
- An archive is capped at 2 000 entries before anything is inflated, so a zip
  built to be counted rather than read cannot occupy the upload.
- The logger redacts key, token, webhook and resume-text fields wherever they
  appear in a log line — a safety net under the scrubbing that already exists.
- Two more credential shapes are masked in a failed AI call's reason: a key
  with an underscore (`gsk_…`, `sk_live_…`) and an echoed `Bearer` token.
  Both arrive through the OpenAI-compatible engine, which talks to any server.

## [2.18.1] — 2026-09-20

### Fixed
- **A duplicate is said, not thrown.** Pasting the same posting from two tabs
  at once answered one of them with a 500: the retry read from a transaction
  Postgres had already aborted. A second Telegram target, Discord webhook or
  company row did the same. Each now says what happened.
- **A removed board column no longer swallows its cards.** A job left in a
  column that was deleted was invisible on the board with nothing to drag it
  out of; those jobs now appear under **Unfiled**, beside the closed columns,
  with one line saying what to do.
- **An alert cannot overwrite your answer.** Dismissing or saving a job in the
  seconds between the message going out and the row being stamped used to be
  overwritten with "Alerted". Your status stands; the message was sent either
  way.
- Two resume uploads, two first comparisons or two tabs editing searches at
  the same instant could leave two default resumes, two hidden scratch rows,
  or delete the search the other tab had just made primary. They queue on the
  same lock the eight-search limit already used.
- Two comparisons of one posting started together both paid for the model to
  read it. The stored reading has a real key now, so the second one is free.
- A malformed upload answers 400 instead of 500, a redirect field carrying a
  newline is refused, and the progress endpoints the pages poll say
  `Cache-Control: no-store`.

## [2.18.0] — 2026-09-20

### Fixed
- **A keyword no longer matches inside a longer word.** Excluding "java" also
  dropped every JavaScript role — 7 of the 13 titles holding "java" in the
  941 stored here — and "intern" read "International" the same way. A
  required "go" matched Chicago, Google and Government in 35 of its 50 hits.
  Keywords now match whole words, with "c++", "c#", ".net" and "node.js"
  still matchable and five measured suffixes allowed, so "go" keeps finding
  Golang and "team lead" keeps finding Team Leader.
- **A pasted feed or careers page is checked against robots.txt.** The
  watchlist ladder read it before fetching a company's own site and the
  "Add one company" form did not, so the same URL could be refused in one
  door and saved in the other.
- **A posting that mentions Cloudflare is a posting.** Reading a posting from
  a URL treated the bare vendor name as a bot check and refused the page. Both
  readers now share one detector, which reads what an interstitial says to a
  reader and never a vendor's name.

## [2.17.1] — 2026-09-20

### Fixed
- **Every source is read every hour again.** A company set to "every hour"
  was in fact read every *other* hour, and one set to "once a day" every 25
  hours: the next check was stamped an interval after the attempt finished,
  so the row came due seconds after the next heartbeat had already asked for
  it. Measured on a live install over four days — consecutive ticks reported
  nine sources, then none, then nine. The interval is now counted from the
  moment the tick started, and due-ness allows five minutes of slack.
- An Adzuna market could lose its 0/6/12/18 UTC slots for days as a result,
  and which ten markets stayed under the monthly limit was decided from the
  rows that happened to be due this tick. The ten are chosen from the full
  active list again, as ADR 0034 requires.

## [2.17.0] — 2026-09-17

### Changed
- **An empty page says what to do.** Every empty list, table and card now
  names what is missing, says in one sentence why that matters, and offers one
  way forward: "No alerts yet · A job lands here when a running search scores
  it at or above its threshold · See all jobs" where it said "No alerted jobs
  yet."
- **An error says what is safe.** The messages that only reported a failure
  ("Invalid form values.", "Probe failed", "Test failed", "Generation failed —
  see the web logs") now name what failed, what stayed as it was and what to
  do next; a refused form names the field.
- The Applications board is quieter: a column is one subtle surface with no
  outline, and an empty column says "No applications" in one line instead of
  a dashed well. Drag-and-drop and the per-card Move are unchanged.
- On the resume editor the suggestion cards' **Apply** is outlined, so the one
  solid button in sight is the page's own; "About this posting" is set like
  every other label.

### Fixed
- A status pill or tag carried an 80-byte class for its background. Pages with
  many tags shrank: a resume with a hundred skills by 7 KB.

## [2.16.0] — 2026-09-17

### Changed
- **Companies shows its companies.** The table stood last on a 2 800 px page,
  after seven other blocks; it is now the first thing under the header (and
  under your watchlist and any quiet sources). The four ways to add to it —
  *Watch specific companies*, *Add a starter pack*, *Add one company*,
  *Sources for your searches* — are buttons under **Add sources** that open on
  demand, and stand open while the list is still empty.
- The setup wizard says less per step — a third to two thirds fewer words of
  helper text — and what each starter pack holds is one press away. What a
  step costs, what is saved and when, and that boards arrive switched off are
  still in sight.
- Discovery's two switches carry one sentence each, the rest behind "How this
  works".

### Fixed
- A long feed query (`primary_keyword=PHP&employment=remote&region=UKR`)
  pushed **Active** and **Delete** out of a 1440 px window, behind a sideways
  scroll inside the table's card; tokens truncate now, with the full value on
  hover.
- A company's on/off badge was a button named "Toggle"; it now says "Disable
  Himalayas".
- A panel that opens under a row of buttons takes the full row in browsers
  that wrap a `<details>` body in `::details-content`.

## [2.15.0] — 2026-09-17

### Changed
- **A job opens on what decides it.** The job page was eight cards of equal
  weight; it is now four tabs — **Posting** (the classifier's reading and the
  description, on one surface), **Resume match**, **Cover letter**, **Is it
  real?** — and a tab's label says what is already behind it ("Resume match ·
  72", "Is it real? · legit"). Status actions, details and application
  tracking stay beside every tab, and a status change returns you to the tab
  you were on. Every link written before — `?match=…#resume-match`,
  `?letter=…#cover-letter` — still lands on its card.
- The header says the fit in a word beside the number ("72 Good"; Strong /
  Good / Partial / Weak on the same floors as the colours), and the page keeps
  one solid button a tab.

## [2.14.0] — 2026-09-17

### Changed
- **Overview: four numbers read as one line.** New, Alerted, Applied and Saved
  sit in one strip instead of four cards, each number opens its jobs, and the
  "tracked all-time · seen in 24 h · dismissed" line is the strip's footer.
  What the numbers cannot say — matches held for the alert window, watched
  companies, a paused pipeline — sits together under it.
- "Cron health" is **Pipeline health**: a badge in the heading says Healthy or
  how many jobs are failing, and each job is one line.
- **A run reads as a sentence.** `/runs` (now titled Runs, as the menu says)
  showed the stats JSON of a hundred runs — 7 700 px of it. A run now reads
  "594 fetched · 3 new · 55 duplicates · 3 classified · 0 alerted", a skipped
  one says why ("Discovery is switched off"), and an error stays in full. The
  JSON and the per-source timings are one press away under **Details**; runs
  past the latest fifty fold behind a button that names — and opens on — any
  failure among them.

## [2.13.0] — 2026-09-17

### Changed
- **One sentence under a label.** Settings showed 120–580 words of helper
  prose per tab; each tab now shows at least 40 % fewer (Screening 18 % — its
  legal text stays). What explains a cost, a cap, a secret or a deletion is
  still in sight; the rest sits behind a quiet **How this works** under the
  control it belongs to, and on the Sources tab each extra source folds "when
  it is worth it, and what the vendor asks" the same way.
- Settings puts its tabs in a column on the left on a wide screen (the row
  stays on a narrow one), and a section's title and one sentence sit above its
  controls instead of beside them.
- **Compare, Cover letter and New screening show one input mode at a time.**
  Picking "A new posting" or "Paste resume text" opens that box and folds the
  others; nothing about what the form sends changes. Compare went from 18
  controls and 1 191 px to 10 and one screen.
- Resumes leads with its table: **Upload a resume** and **Add a fact** open on
  demand (upload stands open while there is no resume yet). Confirmed facts
  read as what you know about yourself — the term first, "I have this" or "I
  don't" as a drawn mark with words, the note under it, what you have listed
  first.

### Fixed
- The on/off badge of a notification target was a button named "Toggle"; a
  screen reader now hears "Disable Work chat".
- A long explanation under a field no longer becomes the field's accessible
  name: the label wraps the label, one sentence and the control, nothing else.

## [2.12.0] — 2026-09-17

### Changed
- **The dashboard has a visible hierarchy.** A type ladder the eye reads
  before the words — page title 26 px, section 18, card heading 15, body 14,
  label 13, helper text 12 — replaces a page where title, heading and label
  sat within two pixels of each other. Three surfaces do the rest: the
  canvas, white where work happens, and a subtle third one for the sidebar,
  table headers and wells, with one tint for what is selected.
- The menu is grouped — Work, Tools, Research, System — with Overview above
  and Settings below; the current page carries the tint, emerald text and a
  bar on the left, not a grey fill alone.
- Table rows hover in the selected tint; a focused field turns its border
  emerald (a 3:1 indicator) under a soft ring.

### Fixed
- **Contrast.** The *Alerted* pill read 4.39:1 and the danger pill 4.15:1 on
  their own tints, and faint text fell under 4.5:1 on tinted surfaces. The
  amber, the red and the faint ink are darker now, a pill carries its own
  white ground so it reads the same on the canvas as in a table, and a test
  holds every text colour to WCAG AA on every surface it can sit on.
- `/screen/new` scrolled sideways on a phone: a file input kept its intrinsic
  width inside the grid.

## [2.11.0] — 2026-09-17

### Changed
- **The Jobs page leads with its table.** The three rows of place, workplace
  and posted chips, the search chips and Verified / ★ Watched / Open to me
  moved into one **Filters** panel beside the search form; the button says how
  many are set. Thirty controls stood above the table before, twelve now —
  sixteen with three filters in force. Nothing filters differently: the same
  URLs return the same rows.
- Status is a row of tabs with counts — All, New, Alerted, Applied, Saved,
  Dismissed — and a tab's number is what it would show under the filters in
  force.
- Every filter in force sits above the table as a chip with a ✕ that lifts
  it, and **Clear all** lifts them together; the search text, the fit floor,
  the sort and the status stay.
- The panel is a native `<details>`: it works without JavaScript, toggles on
  Enter and Space, and stays open while you pick inside it (`panel=1` rides on
  its own links only).

## [2.10.0] — 2026-09-16

### Added
- **`npm start` runs ApplyPack without Docker.** Node.js 22 or newer is the
  only thing to install: `npm install && npm start` creates a built-in
  PostgreSQL 16 on the first run, starts it, the worker and the dashboard,
  and opens the setup wizard. Ctrl+C, or `npm run stop` from another
  terminal, stops them in reverse order. The data lives outside the
  repository — `~/Library/Application Support/ApplyPack` on macOS,
  `%APPDATA%\ApplyPack` on Windows, `~/.local/share/applypack` on Linux — so
  an update or a fresh download keeps it; `APPLYPACK_DATA_DIR` moves it. A
  second `npm start` says it is already running, a crashed process starts
  again, and a database a killed run left behind is stopped before the next
  start. `DATABASE_URL` still points ApplyPack at a Postgres of your own, and
  Docker is unchanged ([ADR 0054](./docs/adr/0054-npm-start-runs-a-built-in-database.md)).
- [docs/install.md](./docs/install.md): what to install on macOS, Windows
  and Linux, the everyday commands, and what the common errors mean.
- `npm run db` runs the built-in database alone for `npm run dev` and
  `npm run dev:web`; they and the once-scripts find it with no `DATABASE_URL`.
- CI runs `npm start`, the route smoke against its database and
  `npm run stop` on Linux (Node 22 and 24), macOS and Windows.

### Fixed
- The clean PDF (`/resumes/:id/render`) failed with `ENOENT` in every run
  outside Docker: `npm run build` now copies the fonts beside `dist/`, and
  the route smoke renders one PDF.

### Changed
- `npm start` starts everything; the worker alone is `npm run start:worker`.
- `.env.example` no longer sets `DATABASE_URL`. README and the site lead
  with the local install; Docker is the option for a server. A `.env` whose
  `DATABASE_URL` answers nowhere — every one copied from the old example
  points at `localhost:5432` — stops `npm start` with a sentence saying to
  delete the line, instead of a worker that fails to start.

## [2.9.4] — 2026-09-16

### Fixed
- **A careers page that bans Claude's crawler is refused while Claude Code
  CLI answers in your engines' place.** When nothing in your AI engine list
  can run and the `AI_PROVIDER` engine cannot either (Gemini CLI with no
  login, an API with no key), Claude Code CLI answers every call. Resolving a
  pasted careers URL still read robots.txt for the configured engines alone,
  so a site that bans `ClaudeBot` or `anthropic-ai` could still be added, and
  Claude then read its postings. The engine that answers binds you now too;
  an install whose own engines run is bound exactly as before.
- **A ban on `Claude-User` or `Claude-SearchBot` binds an install that runs
  Claude.** Anthropic publishes three crawler names, `ClaudeBot`,
  `Claude-User` and `Claude-SearchBot`, but robots.txt was checked only
  against `ClaudeBot` and the two older names, `Claude-Web` and
  `anthropic-ai`. All five count now, the way OpenAI's three already did.

## [2.9.3] — 2026-09-16

### Fixed
- **Enable and Disable on an AI engine card do what they say.** Before
  anything was saved on the AI engine tab, the cards showed the engines
  answering calls while the buttons edited the list `AI_PROVIDER` seeds. On
  an install whose `.env` names Anthropic API without a key, Claude Code CLI
  answers in its place: its card read #1 with a Disable button that enabled
  it as priority #2, and enabling any other engine turned it to "Enable"
  while it kept answering. The cards now show the list the buttons edit. An
  engine that answers only because nothing in that list can run is marked
  "last resort", and its Enable adds it to the list. The `.env` engine alone
  in the list has no Disable, since an empty list brings it straight back.

## [2.9.2] — 2026-09-16

### Fixed
- **Replacing a description with the company's own listing no longer fails
  on about half of all postings.** **Replace the description and
  re-classify** and **Restore the original** (1.69.0) answered 500 and
  changed nothing whenever the text's fingerprint had its top bit set: the
  fingerprint went to the database unsigned, and Postgres `BIGINT` is
  signed. It is stored the way every other write stores it now, and a test
  names any file that writes a fingerprint without that conversion.

## [2.9.1] — 2026-09-13

### Fixed
- **A launcher no longer throws away half a form.** Choosing "One of your
  jobs" without picking a row, "Upload a file" without a file, or "Paste
  resume text" with an empty box used to submit, come back as an error
  flash, and lose the file picked in the other card. The chosen card's
  field is now required in the browser, on Compare, Cover letter and New
  screening alike; a card that is not chosen asks for nothing.
- A re-run of a one-off comparison carries the right "draft" mark: the
  file judged again unchanged is not a draft, an edited text or an earlier
  draft is — and a fresh file uploaded from the tailoring page is no longer
  marked a draft of the file before it.

### Changed
- `public/letter-start.mjs` is `public/launcher.mjs`: it has served the
  three launchers since 2.9.0.

## [2.9.0] — 2026-09-13

### Added
- **Compare a found job with any resume, not only the ones in Resumes.**
  The Compare page takes "One of your jobs" beside "A new posting" — the
  same searchable picker the cover-letter page has — so a job the fetchers
  found can be compared with a file you pick there, or with pasted text.
  The job page's Resume match card links to it with the job already picked
  ("Compare a file or pasted text →"). A stored job goes through the job
  page's own comparison: the same memo, the same progress page, the same
  tailoring view, and nothing is added to Resumes.

### Changed
- A resume in a dropdown says what it is: `name · PDF v1 · used by search
  "Senior Software Engineer" · default`. "· your search hunts with this"
  read like the name of a search rather than a note on a file.
- A one-off file or paste no longer wipes what an earlier one-off left.
  Its comparisons were already kept; its letters now go only when the text
  changes, and a letter distils the comparison of its own text, so writing
  a letter from an uploaded file no longer deletes the comparisons other
  uploaded files made.
- A pasted posting on the Compare page runs through the same comparison
  code as every other page (`comparison-run.ts:runComparison`): one memo,
  one suggestions branch, one done step. Its flash now reads like the
  others ("… compared — AI match N/100."), and a finished run keeps the
  posting's reading line.

### Fixed
- **A one-off comparison keeps the name of its file.** Every file compared
  from the Compare page lives on one hidden row that each upload renames, so
  every older one-off comparison — the chips under a job, the tailoring
  page's header and history — showed the latest file's name. The name is
  now stored with the comparison (`resume_match.resumeName`, migration
  `20260913170000_match_resume_name`); rows from before it whose file has
  since been replaced read "An earlier one-off file". Real resumes still
  show their live name, so renaming one on Resumes renames its comparisons.
- **Rebuilding an older one-off's keywords judges that file.** "Rebuild
  keywords" on the job page sent only the resume id, and on the hidden row
  that meant the text of whatever was uploaded last — a rebuild could
  re-read another person's resume against the posting. It now names the
  comparison, and its own text is judged; so does the editor's re-run when
  it arrives without the editor's text.
- A one-off's "vs v3" measured it against the previous upload, usually a
  different resume. The delta now pairs only with an earlier check of the
  same file and says "vs the last check of this file".
- The Compare page said an uploaded or pasted resume "lands in Resumes".
  It never did; the hints now say it is a one-off check.

## [2.8.0] — 2026-09-13

### Added
- **What the posting is, before how well your words answer it.** The
  tailoring page opens with three lines the posting's own reading already
  carried and no page ever showed: the sector, what the employer sells, and
  who reads the resume first. The same stack is wanted by a radio network, a
  clinic and an online casino, and each wants different evidence of it.
  Every line is a stored field, so a posting that named none renders no
  block — nothing here is inferred, and nothing is scored
  (`resume/posting-orientation.ts`).
- **One sentence saying what to do next**, under the score on the job page's
  match card and on the tailoring page. A ladder in code, from what no
  wording fixes down to what editing reaches: a failed gate, the core stack
  and the cap it sets, an unanswered gate, a must-have the resume evidences
  but never writes, a must-have named only on a skills line, a weak first
  glance, then the report's own first high-priority edit. It names one
  thing, and says nothing at all when the report is clean — "Ready to apply"
  already speaks there (`web/score-lines.ts`).

Both read the row and the brief already stored: no AI call, no new column,
and a comparison costs exactly what it cost before.

### Changed
- `clipWords` (`text-utils.ts`) shortens on a word boundary and drops the
  article a cut leaves dangling, so a shortened line reads as shortened
  rather than broken.

## [2.7.2] — 2026-09-10

### Changed
- **Less water on the six busiest pages.** Twenty-five sentences that
  repeated a heading, explained a control the eye already reads, or
  described the implementation are gone or shorter — on Settings, the
  tailoring page, the screening page, the wizard, the job page and the
  resume page. Every sentence about a cap, an AI call, privacy, a
  destructive action or the employer legal note stays. The screening
  upload hint, one 120-word paragraph carrying six unrelated facts, is now
  four lines.
- Four things DESIGN.md forbade and the pages did: Re-classify on the job
  page is violet like every other AI spend; "Watch the scoring" in the
  wizard is a plain link, not violet; "By search" is no longer
  uppercase-tracked; the 0–100 number on the tailoring page's history is
  "match", the word the rest of the resume side uses.
- The score's tone cut-offs (85 / 70 / 50) are named once in `format.ts`;
  the tailoring page's "ready to apply" reads the same floor, and a test
  holds the browser's ring to the same steps on every score.

## [2.7.1] — 2026-09-10

### Changed
- **Pages read the columns they show.** The jobs list carried fifty full
  postings per page — descriptions, originals, summaries, the applied-resume
  snapshots, 219 KB of text on the 09-04 data — for fifteen scalars; the
  resume page's history carried every stored snapshot and five Json columns
  per run; the screening table carried two full texts per applicant; the
  digest, the held-alert pass and the two job pickers the same. Each now
  selects what it renders. Measured on 1 083 jobs: no page was slow before
  (9–33 ms), so this is bytes moved, not milliseconds — the reason no index
  was added: every query the audit named ran under a millisecond there.
- **One read per tick instead of one per posting.** The tick asked "is this
  stored?" once for each fetched posting — 1 600 to 5 500 round trips on a
  cold tick; it asks once for the batch. Re-classify writes its demotions
  once per batch instead of one row at a time; a screening run compares
  the rubric version instead of re-reading the whole screening twice per
  applicant; the sources due this tick are a where clause on the index
  that exists for it.
- Also in this release, untagged since 2.7.0: `src/web/app.ts` split from
  the listener with the route smoke in CI (#235), ten dead exports gone and
  the `export` dropped from 88 (#233), the docs brought in line (#234).

## [2.7.0] — 2026-09-10

### Changed
- **Nothing on a dashboard page is fetched from a third party.** Every page
  loaded Tailwind's Play CDN — a script with full access to the page that
  renders your resumes and, in employer mode, applicants' — and Inter from
  Google Fonts, so two companies saw every page view, and an install with
  no internet rendered unstyled. The Tailwind build is now generated once
  (`npm run css`) and committed as `src/web/public/tailwind.css`, Inter is
  served from `/static/fonts/`, and the content-security policy names no
  outside host. A test fails if either comes back. README's "everything
  runs on your machine" is now true of the browser too.

## [2.6.4] — 2026-09-10

### Fixed
- The resume editor on the tailoring page shows a focus ring; its own
  style suppressed the one every other control has, so the page's main
  control had no visible focus but its caret.
- What changes on its own is announced: the live match score (when the
  number moves, not on every keystroke), "Unsaved changes" when the bar
  appears, and the screening's scoring progress line. The one on the
  dirty bar was a live region whose text never changed.
- Tables have names and headers a screen reader can use: a hidden caption
  on the jobs, applicants, screenings, resumes, companies, runs and
  discovery tables; `scope` on the hand-written headers of the rubric,
  calibration and comparison tables; the comparison matrix's row labels
  are row headers.
- Under "reduce motion" a spinner stops instead of looping at 0.01 ms;
  the re-upload file field has a name; one link used the accent that
  DESIGN.md reserves for fills.

## [2.6.3] — 2026-09-10

### Fixed
- The Anthropic API path now carries the same per-call ceiling every other
  backend gets; the engine chain's deadline could not bind on it.
- A CLI child past its budget is killed outright; `execFile` never
  escalates past SIGTERM, and a CLI that trapped it could hold a tick past
  every deadline.
- An OpenAI-compatible reply that was cut off at the token limit, or
  filtered, is a failure with that reason — as the Anthropic path has read
  `stop_reason` since 1.60 — instead of "no JSON object in reply". An
  empty reply on any backend fails over instead of spending a parse retry.
- The AI engine probe says what actually went wrong with a CLI binary
  (permission, a hang, a non-zero exit) instead of "not found on PATH" for
  everything.
- A forged fence marker that does not start its line was left in the
  payload; it is removed wherever it stands. The fence registry test now
  reads the prompt modules off the source tree and matches a call by the
  call, so a new module or a renamed import cannot slip past it.

## [2.6.2] — 2026-09-10

### Fixed
- **A posting date that does not parse no longer poisons the tick.** Seven
  feed fetchers (LaraJobs, We Work Remotely, Golang Projects, Jobicy, DOU,
  Djinni, HN jobs) built `postedAt` with no check, and Lever accepted any
  number; one unreadable `pubDate` made the classifier throw on that row,
  the row was never stored (so it came back every tick), and the tick
  discarded its whole ETag cache. Every fetcher reads dates through one
  `safeDate`, and the ingest checks once more for the fetcher that forgets.
- An empty `<guid></guid>` in a feed item counted as an id and dropped the
  item (Teamtailor) or gave every such item the same id (four RSS
  fetchers); an empty guid is now no guid.
- Nine single-request sources send the validator they were owed —
  RemoteOK, Working Nomads, Recruitee, BambooHR, Landing.jobs, DOU, Djinni
  and Rippling's list — and LaraJobs and Jobicy fetch through the
  project's client (its User-Agent, the retry ladder, an error the health
  rules can read) instead of the parser's own.
- A SmartRecruiters board whose list answers in the wrong shape is a
  failure from the first tick, not an empty board that surfaces two weeks
  later.

## [2.6.1] — 2026-09-10

### Fixed
- **Ids are read one way.** Every path, form and query id goes through one
  reader that takes a plain integer and nothing else; `/jobs/1.5`, a form
  without its `resumeId`, `?minFit=1.5` answered 500 from the database
  driver and answer 400 now. A candidate that is already gone on
  `/discovery` says so instead of failing; `/screen/:id/run` checks the
  screening exists like every other screening route.
- **A double press is refused, not doubled.** Re-classify, Rewrite, Fill
  from a resume, a resume upload or replacement, the wizard's upload, a new
  screening and a new alert target each refuse a second press while the
  first is still running — two rows, two AI calls or two test messages
  used to be the result.
- **Every free text has a ceiling** — a pasted or replaced posting
  (60 000 characters), a screening's posting, a resume draft (200 000), a
  letter edit (20 000), application notes (10 000), a recruiter contact
  (300), a search's notes (4 000) — and every POST that is not an upload
  carries a 2 MB body limit; the upload routes keep their own larger ones.
  A body past its limit answers 413 — the error handler used to flatten
  the status into a 500 — and a status change on a job that is not there
  answers 404.
- With the database unreachable every route answered 500, `/health` and
  `/static/*` included: static files are served before anything that reads
  the database, and the sidebar's employer-mode read no longer takes the
  request down with it — `/health` answers its 503, without the driver's
  message (host, port, user) in the body.
- A `WEB_BASIC_AUTH` that is not `user:password` stops the dashboard from
  starting instead of serving open with a warning in the log.
- A Discord webhook is checked to point at Discord when a message is sent,
  not only when the row was added.
- Opening the clean-render page no longer starts an AI reading of the
  resume's shape by itself — the button on the page does. A GET that spends
  a model call is one any page in the browser can fire with an image tag.

## [2.6.0] — 2026-09-10

### Fixed
- **A held match is stamped with its row.** Outside the alert window a
  match was stored NEW and then stamped `alertHeldAt` in a second
  statement; a crash between the two left a match nothing would ever send,
  and the unique key kept it from being fetched again. The stamp is written
  in the same insert as the verdicts (ADR 0053).
- **One row per alert destination.** The same Telegram bot and chat, or the
  same Discord webhook, added twice was two active rows and every alert
  twice, forever. The database refuses the second now, the form says which
  row already has it before it sends a test message, and the migration
  collapses existing duplicates onto the oldest row — a search routed to a
  later copy follows it.
- **The same document twice in one screening is one row.** The intake read
  its list of known files once, so two uploads at once both added the
  file; a unique on the screening and the text's hash settles it, and a
  file no text came out of is known by its bytes rather than by name and
  size. Existing duplicates go with the migration, their verdicts with them.
- A pasted posting is one transaction: the company row and the job row
  appear together, and the same paste from two tabs is settled by the
  unique key instead of a read the other tab can outrun.

### Changed
- Indexes on the referencing side of four foreign keys
  (`job.crossListedOfJobId`, `job.appliedResumeId`, `screening.jobId`,
  `cover_letter.resumeId`): a job delete no longer scans the job table for
  cross-listings, and a resume delete no longer scans it for applications.

## [2.5.4] — 2026-09-10

### Security
- `hono` 4.12.15 → 4.13.7 and `@hono/node-server` 1.19.14 → 1.19.17: ten
  advisories on the old version, one of them on a path this dashboard uses
  (unbounded dot-notation nesting in `parseBody()`, GHSA-g6gw-c38x-mqfc).
  The `package.json` floors now name the fixed versions, so a fresh install
  cannot resolve below them. What is left in `npm audit` is `uuid` behind
  `node-cron` 3, on a code path this project never calls; the 4.x major is
  a separate decision (TASKS §20.4).

### Fixed
- Two sentences that were not true: the wizard's "only one search runs at
  a time" (up to eight have run at once since v1.10.0) and the resume
  page's "press Activate" (the button is Run).
- The package description said 24 sources and the launch drafts 22, against
  the 33 kinds the code has; `source-count.test.ts` now reads those copies
  too, so the number cannot drift there again. The description also leads
  with "runs locally with Docker" rather than "self-hosted".

## [2.5.3] — 2026-09-10

### Security
- **One SSRF guard, three layers.** The private-address check for a
  user-supplied URL was a name check, and `localhost.`,
  `[::ffff:169.254.169.254]` and `127.0.0.1.nip.io` all passed it. Now the
  name is checked in every spelling, every address it resolves to must be
  public before a connection is made, and redirects are walked one hop at a
  time with the same two checks — a refused hop is never requested. Pasted
  posting URLs, watched feeds and careers pages, Teamtailor custom domains
  and the liveness ladder all go through it; the ladder's own second guard
  is gone.
- **The zip reader caps what an entry inflates to.** It compared against the
  archive's own size field and inflated without a ceiling; a small archive
  claiming small entries could take the web process down. The ceiling is on
  the inflater now, with a total for an archive of resumes and a per-part
  one for a .docx.
- A quote inside a keyword term could break out of the highlight's `title`
  attribute on the tailoring page and the demo; both quotes are escaped.
- The screening CSV text-marks a cell that opens like a formula (`= + - @`),
  so an applicant's file name or a quoted line cannot run in Excel.
- A failed CLI call no longer logs the command line — which is the prompt,
  and so the resume or the applicant's text — only stderr, the exit code and
  the signal; the flash reads the same.

## [2.5.2] — 2026-09-10

### Changed
- **Choosing is adding.** On the screening page, picking files, a zip or a
  folder uploads them at once and starts the scoring — the "Add and score"
  press after the pick is gone (the button stays for a browser without
  JavaScript). A folder pick still meets the browser's own "upload N files
  to this site?" question, which no page can remove; the hint says so.

## [2.5.1] — 2026-09-10

### Fixed
- While a screening run is in flight, the number beside a row's "queued" /
  "scoring…" / "scored — refresh" badge is that row's previous verdict,
  and it now reads as one — muted, prefixed "was" — instead of looking like
  the new score. The first real re-score showed "59" beside "scoring…" and
  "61" after the refresh, which read as a score that changed by itself.

## [2.5.0] — 2026-09-09

### Added
- **Calibration — your decisions against the order** (stage E of
  docs/screening-criteria-plan.md §9, ADR 0052). A fifth card on the
  screening page, once three decisions with a To interview and a Declined
  among them exist: how many of your k interview picks sit in the table's
  top k; what share of the pairs you decided differently the table orders
  the same way, with the counts, and how many only after your adjustments;
  the surprises — an interview pick the table put low, a declined
  applicant it put high — each with the criteria behind the placing; and
  per scored criterion the mean credit among the interviewed against the
  declined, the widest gap first, flat ones greyed. The Markdown export
  carries the same section. The tool never re-weights from it.
- **`npm run bench:screen`**: a gold folder (posting, `rubric.json`,
  resumes, `ranking.txt`) through the exact redact → prompt → anchor →
  score path with nothing written — Kendall τ and precision@5 against the
  human's order, score movement between runs, the redaction leak check,
  tailoring pairs, gate confusion from an `expected.json`.
  `src/screening/fixtures/gold/qa-automation` is a synthetic starter set.

## [2.4.0] — 2026-09-09

### Added
- **Compare — side by side** (stage D of docs/screening-criteria-plan.md
  §5): tick two to five scored applicants → Compare. One column per
  applicant, one row per criterion with the stored answers and their
  quotes, plus years, level, career, the stand-out facts and the verdict
  line — the stored scorecards, no new call. The bulk bar's Compare button
  wants at least two rows.
- **Compare with AI** (ADR 0051): on that page, one call carrying the
  shortlist's redacted resumes, the posting and the criteria, run twice
  at once — the second time with the resumes in the reverse order. It says
  who is stronger on each criterion and why (each applicant's own line,
  checked against that resume), whom to talk to first with a reason each,
  and the one question that would decide between the first two. The page
  marks where the two readings disagree; "Copy as Markdown" takes it to
  the shortlist meeting. Stored as a `ScreeningComparison`, shown again
  for the same applicants, never folded into any score — the table keeps
  its order. Ceiling: five; above that, narrow the shortlist first.

### Fixed
- **The same resume as .docx and .pdf scored 78 and 69.** Not the PDF
  reading badly — the .docx over-credited: a skills TABLE comes out of the
  .docx reader as one line, which read as prose, so every term on it
  counted as work done; and the model called the same "Technology Stack:"
  lines "production" in one run and "role" in the other. Three rules in
  the anchor now (`screening/anchor.ts`, `resume/evidence.ts`): a
  flattened table row is judged cell by cell; a quote that is a list of
  terms supports at most "listed", or exactly "role" on a job's own
  "Technology Stack:" line (its label found through a PDF's wrapped run) —
  "production" needs a work bullet with an outcome; a quote that never
  names the term supports nothing above the text's own line (the PostgreSQL
  bullet offered for MySQL); and a term the text never spells is "absent"
  whatever line the model quoted (Datadog is not Sentry). Prompt v4 says
  the same. A PDF's page-width wraps are joined at extraction
  (`resume/pdf-text.ts:normalizePdfText`), so a wrapped bullet or stack
  line reads as it does in the .docx. `node dist/scripts/rescore-screenings.js`
  re-anchors and re-scores stored verdicts without a call (`--write` to
  apply); "Score again" is the other way. Re-scored live after the rules:
  the .docx / .pdf pairs moved from 78 / 69 and 80 / 72 to within
  run-to-run variance of each other.
- **The screening page reads top to bottom.** Four numbered cards; the
  criteria card shows every criterion as a chip while closed and opens the
  editor with a button instead of a bare disclosure marker; "Read the
  posting" and "Edit the posting" are buttons too.

### Schema
- `screening_comparison` — the two anchored readings of a shortlist with
  the order each was shown in (migration `20260909180000_screening_comparison`).

## [2.3.0] — 2026-09-09

### Added
- **Stands out** (stage C of docs/screening-criteria-plan.md §5): up to
  three facts per applicant that no criterion asked for — a technology
  beyond the rubric, a number the person quotes, a talk, a publication, a
  language — each with the line that carries it, checked against the text
  like every other quote (a fact without its line is dropped). Shown on the
  scorecard, as the row's expandable line on the screening page, in the
  CSV ("Stands out") and the Markdown. Never scored.
- **The career, read off the dates** (`screening/trajectory.ts`, pure):
  years in total across how many employers, the average stay, whether the
  person is in a role now, the sectors in order. Under the roles on the
  scorecard, in the Years cell's tooltip and the expandable line, exported
  as "Career". A fact to ask about, never points (ADR 0047).

### Changed
- Screening prompt v3 (`SCREEN_PROMPT_VERSION`), answer budget 7 500
  tokens. A verdict written by v2 stays valid; its scorecard says the
  stand-out facts arrive with the next Score.

## [2.2.0] — 2026-09-09

### Added
- **Criteria in your own words** (ADR 0050, stages B1 + B2 of
  docs/screening-criteria-plan.md). The screening rubric is now a list of
  criteria: a kind (skill, years, level, industry, company type, language,
  location, work permit, availability, education, certification, scale,
  impact, the overall read, or *in my own words*), a mode (a gate that
  buckets, stars that score, a note that only shows) and one text field
  per row — "Playwright / Cypress !", "0–2 years", "fintech, payments: 3+",
  "has led a team of three or more". The posting drafts the first list;
  five presets (Standard, Junior hire, Senior / lead, Regulated, Agency
  work) bend it; your own rows survive a redraft, and a row you removed
  stays removed. A criterion naming age, gender, family, origin or health
  is refused with the lawful criterion offered instead.
- **One answer per criterion, with its quote.** The model answers each
  criterion in the shape its kind asks — a rung on the evidence ladder, a
  pass / partial / unknown / fail, a level, an impact grade, the overall
  five-step read with reasons and concerns — and the anchor guard checks
  every quote. Years, years in a sector and company type are read off the
  dated roles in code; a skill's `last_used` beyond the row's window earns
  half. The scorecard is one row per criterion: what was asked, how the
  text answered, the quote, the points.
- The score is Σ stars × answer over the criteria the text could answer;
  the caps stay (no core skill → 30, two levels under → 50, duties only →
  60). Measured before this: the model's own 0–100 fit was 92 / 93 / 92
  against a computed 82 / 82 / 82 — stable, ten points more generous —
  which is why the overall read is one weighted row and not the number.

### Changed
- A v1 rubric (2.0.0 / 2.1.0) is converted to criteria on read; verdicts
  from before read as stale and are scored again on the next run.

## [2.1.0] — 2026-09-09

### Added
- **The posting belongs to the screening.** `Screening.postingText` is a
  snapshot of the job's description taken when the screening is created;
  the screening page shows it under "Read the posting", edits it under
  "Edit the posting for this screening" (never on the Job — the candidate
  side keeps its own text), and every rubric draft and scoring call reads
  the snapshot. After an edit the page says how many current scores
  predate it and offers **Re-read the rubric** (a new yardstick) or
  **Score everyone again** (the rubric as it is, against the new text).
  Plan §4 of docs/screening-criteria-plan.md, stage A.

### Changed
- "Delete with files" is **Delete screening**, and the confirmation says
  what goes (the screening, the uploaded copies, every verdict — from the
  database) and what stays (your files on disk).

## [2.0.0] — 2026-09-09

The other side of the table: a major because the product now has two users
— the candidate it was built for, and, behind one switch, the employer.

### Added
- **Employer mode — screening a folder of resumes against one position**
  (TASKS §19, ADR 0047–0049). Off by default; `/settings` → Screening turns
  it on and adds "Screening" to the menu. A screening is a position (one of
  your jobs, or a pasted / uploaded posting) whose brief (ADR 0044) is read
  into a rubric — gates, must-have and nice-to-have terms, core stack,
  level, years, sector, weights — that you edit before anything is scored;
  a changed rubric makes every stored score stale. Applicants go in as
  files or a zip (up to 100 a time, 300 a screening); the name, contacts,
  links, date of birth, age, family, gender, citizenship, street address
  and graduation years are removed before any model reads a word, the
  leak check runs on every file, and copies of the same person (text hash,
  email or SimHash) stay in the list unscored. Scoring is one independent
  call per applicant, `AI_CONCURRENCY` at a time, verdicts written as they
  arrive so a restart resumes; every quote is checked against the redacted
  text and an unproven rung is lowered before `screening/score.ts`
  computes the number (must-have 35, years and recency 15, level 15,
  impact 15, domain 10, nice 5, education 5; caps 30 / 50 / 60; unknown
  parts leave the denominator and lower the confidence shown beside the
  score). The table orders gate bucket → score → confidence; a scorecard
  per applicant shows every gate and term with its quote, the score table,
  the questions, the facts to discuss, and what the model did not see;
  CSV and Markdown export; a Decision column the tool never writes; a
  retention date (90 days by default) the weekly cleanup enforces; a
  warning when the first engine is a personal-subscription CLI; a
  copy-ready applicant notice and the legal note on the settings tab.
- **Screening, after the first real batch.** A folder can be dropped whole,
  subfolders and all (each file keeps its folder path in the table; photos
  and spreadsheets are left out, not listed as unreadable). Scoring starts
  the moment files are in and the run drains, so files added while it works
  join it. The same person's second document is scored and labelled "also
  №N" instead of parked as a duplicate — only a byte-for-byte repeat of a
  file is skipped. A header checkbox ticks every row; the bar above the
  table sets a decision, scores again or deletes the ticked ones. On the
  scorecard, **Your adjustment** moves an applicant by up to ±30 points with
  a reason: the computed score stays visible beside it and both go into the
  export (ADR 0047 addendum). While a run works, every row says where it is
  — queued, scoring…, scored — and the results line names who is being read
  right now; a "Score again" during a run queues behind it instead of being
  refused. The must-have cell says how many terms are shown in a role or in
  production, which is where two documents of one person differ. The engine
  warning is one line under Results with a link to the settings tab.

### Changed
- `resume/zip.ts` can list every file in an archive (`readZipEntries`),
  which is what a zip of resumes needs; `readZipEntry` is unchanged.

## [1.76.0] — 2026-09-08

### Added
- **A posting from another sector says so.** The scan now reads the sectors
  a resume's roles were in (`Resume.industries`; existing resumes are filled
  by `node dist/scripts/rescan-resumes.js`), and `domain.ts` compares them
  with the posting brief's industry (ADR 0046). When they share no sector
  word — and the employer is not an agency, a consultancy or a software
  house, which serve every sector — the targeted view says it in one
  sentence beside the thin-posting notice, and the full analysis and the
  suggestions call are handed the candidate's domains with the instruction
  to reframe transferable work and never claim the sector (prompt v14).
  Either side unknown: nothing is said. `/resumes/:id` lists the domains.
- `variance:compare` prints how many high-priority actions are written in
  the employer's domain, and `--discard` deletes the rows it wrote.

### Measured, not changed
- A sentence asking for the domain lean in the audience rule moved that
  share from 15 of 43 to 14 of 47 over three pairs, three runs each; the
  model already writes in the sector where the resume's facts allow and
  nothing sector-shaped where they do not. The sentence was withdrawn.

## [1.75.0] — 2026-09-08

### Changed
- **A re-run no longer rewrites the bullet you just took from it.** Measured
  on one live pair over seven consecutive analyses: eleven of the later runs'
  quotes were the previous run's own proposed wording, and the current role's
  first bullet was rewritten in every run, at 90 and at 100. The prompt had
  PREVIOUS KEYWORDS but no memory of its own advice. Now the wording the text
  carries from the last report goes in as a fenced APPLIED FROM THE LAST RUN
  block (prompt v13, `applied.ts:appliedWording`) with the rule that it is
  done, the "must open with its strongest accomplishment" clause leaves a
  bullet alone when it already does — and, because the prompt rule alone took
  rewrites of applied lines only from 11 of 18 actions to 6 of 12
  (`npm run churn:compare`, two pairs, two rounds each), `freshActions` is
  the rule as code: a rework of an applied line reaches the user only when it
  names a keyword the text does not carry. `applied` / `rewritesOfApplied` /
  `reworksDropped` ride on the `resume: matched` log line.

### Added
- `npm run churn:compare -- <resumeId>:<jobId> [--rounds N] [--keep]` runs the
  loop a user runs — analyse, apply every suggestion the way the editor does,
  analyse again — and prints, per round, how many of the last report's lines
  the text carries and how many new actions rewrite them. Spends AI; deletes
  its draft rows.

## [1.74.0] — 2026-09-08

### Changed
- **A word in your resume counts, whatever the last analysis called it.**
  Typing `WordPress` or `BEM` into the editor moved nothing while `Ajax`
  moved +3: the live count gave a term the AI had marked `cannot_claim` zero
  credit however often it appeared, and the persist-time anchoring pass never
  revisited that verdict — so a WordPress on the resume's own title line held
  one comparison at 41, capped at 70 as a missing primary. Both sides now read
  presence off the text (ADR 0045): a written term is `present`, an unwritten
  `present` or `add` is `add` (half credit, and it still covers the primary
  cap), an unwritten `ask_user` or `cannot_claim` earns nothing until it is
  written or confirmed. The ring is the score the next analysis stores for the
  same text, and a test holds the two equal edit by edit. The thin-evidence
  signal stays where it was: the "skills line only" badge, not the number.
- The gap chips, the pane marks and the plain coverage percentage follow: a
  typed word is green and no longer a chip, every weighted term is in the
  denominator, and the confirm tier says it is the other way in, not the only.

### Added
- `node dist/scripts/reanchor-matches.js [--dry-run]` lifts a stored
  `cannot_claim` the comparison's own text snapshot spells — 29 keywords on 27
  comparisons of the live corpus — through the write path a keyword edit
  already uses. Only that flip: rows from before the 0044 addendum keep the
  statuses they were scored under.

## [1.73.0] — 2026-09-08

### Changed
- **The ring is the live number.** The score in the targeted view now
  recounts on every keystroke — the number, the arc and its colour — with the
  same formula the server runs (`score.mjs` mirrors `score.ts`): keywords and
  the primary-stack cap live, alignment and the red-flag penalty held at what
  the last analysis judged. The sticky bar's own "Estimate" is gone; it had
  become the second copy of the same number. A parity test pins the ring's four
  colour steps to `fitTone`.
- **The gap chips show every gap.** The row above the editor filtered on the
  matcher's `excluded` flag, which is set for a term the resume cannot back —
  so it hid exactly the hardest gaps. On one live pair it showed one chip for
  the only addable keyword and left out WordPress, the primary must capping
  that score at 70, along with SASS and BEM. Those now appear, dashed, hardest
  first, with no "+ add" — typing the word is what does not help.

### Added
- **"Confirm your experience" offers the terms the AI could not back.** A
  `cannot_claim` verdict was a dead end: `applyFacts` already flipped a
  confirmed one to `add`, but neither page ever offered it, and the prompt
  tells the model to choose the lower status when unsure. The card now has a
  second tier behind a summary ("N more the AI found no evidence for"), on both
  the targeted view and the `/jobs/:id` match card; a dashed chip opens it and
  moves focus to it. Measured on the live pair: "I have it" on WordPress took
  the score 56 → 58 and the ceiling 70 → 84 with no AI call, and typing the
  word then took it to 61 and turned it green in the posting. A term the user
  answered "I don't" to stays a chip but is not re-asked.

### Fixed
- A gap chip's tooltip said "not in your resume" about a word the user had just
  typed; it now says the word is there and nothing backs it.

### Verification
- `npm run lint:types` + 2108 tests green (three new: ring colour parity, the
  gap rule, the two confirm tiers); browser console clean on both pages.
- The confirm loop run end to end against a snapshot of a real row, then the
  row and the fact restored. 1440 px and 375 px: no horizontal scroll, the new
  card wraps.

## [1.72.0] — 2026-09-07

### Changed
- **The targeted view leads with one ring.** The score used to be a small dial
  beside its own number, with a second live score — number, bar and delta —
  in the right rail. That rail is gone: a keyword edit re-scores the stored row
  server-side, so the ring itself moves, and while the text is dirty the sticky
  bar already carries the estimate and its difference from the last analysis.
  One number on the card instead of two, neither of which was labelled in a way
  a reader could act on.
- **The ring says what it is on hover.** The number now sits inside a larger
  ring, and hovering or focusing it opens a two-sentence explanation: what the
  0–100 measures, and which edits move it. Keyboard and touch open the same
  panel — nothing on the card depends on hover.

### Removed
- **The labels around the score.** "AI match · moderate" restated the number,
  and the draft marker and the run's age are already on that run's own chip
  above. "edited — analyse again" is what the sticky bar says in full, with the
  button next to it. `/100` moved into the hover text and the button's screen
  reader label.
- **"What made the number" / "what it does not count" on the targeted view.**
  The five lines added in 1.71.0 stay on the `/jobs/:id` match card; the editor
  page keeps the model's own sentence, the ceiling and the edit counts. The
  component is unchanged — the targeted view simply no longer renders it.

### Verification
- `npm run lint:types` + 2105 tests green; browser console clean.
- Checked at 1440 px and 375 px: no horizontal scroll, and the ring column
  measures 112 px whether or not the editor is dirty (the old stale marker
  widened it under the first keystroke and squeezed the summary).
- Rings drawn at 27, 56 and 100; hover and keyboard focus both open the panel,
  and the focus ring is a circle, not a rounded box.

## [1.71.0] — 2026-09-07

### Added
- **The score says what it was made of, in sentences.** The row of formula
  parts under the number — "Keywords 60/60 · Alignment 40/40" — said how the
  arithmetic was done, which is the size of a weighted pool nobody outside the
  code knows about. Five lines replace it, split into the three that made the
  number (**Requirements**, **Core stack**, **First glance**) and the two it
  does not count (**Shown at work**, **To confirm**). Fractions and words, not
  percentages: the variance fixture measured a ±5 spread on a stable pair, so
  "Requirements 76%" would claim a precision the system does not have. Core
  stack is now visible always rather than only when it caps — a candidate one
  keyword away from a 30-point cap could not see it coming. No AI call, no
  schema; everything is already in the stored row (docs/score-lines-plan.md).

### Changed
- **The posting is highlighted by what each word means for you, not by what
  the model called it.** One axis and four colours: green is a word already in
  the resume, red is a `must` the resume has not got, amber a `preferred`,
  slate a `nice`/context mention. The old scheme coloured by AI status and
  then graded the same hue by weight on top, so "add the word" and "missing"
  were the same news to a reader, and a term the resume showed no evidence for
  was greyed out and struck through — on a WordPress posting compared against
  a Laravel resume, the word *WordPress* came out crossed off, which reads as
  "ignore this" for the one requirement the job is built on. A strikethrough
  now appears only where text is being cut; a term nothing in the resume backs
  keeps its level colour and takes a dashed underline. The keyword table says
  `no evidence in your resume` where it used to say `missing`.
- **The live estimate is always on.** It used to appear only once the editor
  text differed from the analysed snapshot, so re-levelling, ignoring or
  adding a keyword moved a number that was not on screen and the page looked
  frozen. It now renders from the first paint — "same as AI" until something
  changes it — and moves on every keystroke and on every keyword edit.

### Fixed
- **"Ready to apply — stop polishing, send it" waited for nothing.** It fired
  on `matchScore >= 85` alone, so on a live 100/100 it sat directly above
  "3 suggested edits · 5 removals", one hard requirement the resume was silent
  on, and the model's own verdict that the resume undersold itself. It now
  reads the things the score never counted: open edits, unmet or unconfirmed
  gates, and any must-have named only on a skills line.
- **A keyword edit no longer drags the score down.** `rescoreMatchKeywords` —
  the free, instant path behind a keyword override and an answered `ask_user`
  question — recomputed the penalty from the raw `redFlags.length` instead of
  the flags `countableFlags` lets through, so it charged ten points the
  analysis itself never charged. Every override lost them, and a `reset` never
  came back to where it started: on the live WordPress row, ignoring one
  keyword read 33 → 26 and restoring it 26 → 23. Both routes now score with
  exactly the pair `match.ts` uses, and the same round trip reads 33 → 36 → 33.

## [1.70.0] — 2026-09-06

### Added
- **The posting is read once, on its own, and the reading is kept.** Before
  any resume is judged, one call with no resume in the prompt writes a brief
  of the posting: the discipline and seniority band, the minimum years, the
  industry, the product and its audience, who reads the resume first, what
  that reader scans for in six seconds, and what a bullet that would impress
  them looks like — plus the keyword frame, the either/or requirement groups
  and the gates. It is stored against a hash of the title and description, so
  editing a resume and comparing again reuses it (3 ms on the live row
  instead of 22 s) and a description refreshed from the company's own listing
  asks for a new one. The comparison copies the frame and judges only what
  the resume shows; the suggestions aim at the screening block. The progress
  page shows it as its own step and says when it was reused (ADR 0044).
- **Either/or requirements count once.** "Frameworks like React, Next.js, or
  Vue.js" is one requirement, not three. Keywords carry the group the brief
  put them in and `foldGroups` collapses them to the best member before the
  formula runs — a satisfy-*all* list ("HTML, CSS and JavaScript") stays three
  demands. On the live row this moved the keyword half from 35.5 to 40.7 of
  60: the resume had been charged a must-weight for Python, WordPress, Drupal
  and Shopify on requirements it either met outright or failed once.
  `SCORING.version` is 4, mirrored in `score.mjs`; scores from before it are
  not comparable.

### Changed
- **The compare page compares; it no longer makes resumes.** *Save as a
  tailored copy* and *Save as a new resume* are gone: every comparison used to
  be able to mint one more row on Resumes, named after the company, and a user
  with four applications ended up with eight resumes and no idea which was
  theirs. What is left is one save, **Save as v{n+1}**, offered only for a
  resume the user already has; a one-off check from the Compare page saves
  nothing and says so. `POST /resumes/:id/draft` refuses a hidden resume.
- **One AI action on the compare page, and a new file is a comparison.**
  *Re-check with AI* and *Full analysis with suggestions* were two buttons
  whose difference lived in their tooltips; there is now one, and it writes the
  full report. Uploading a file used to open it as a draft over the OLD
  analysis while a quick check ran in the background and reported itself as a
  chip the user had to notice and click — measured on a real session, nobody
  did. **Compare this file** now runs the same comparison as everything else,
  on the progress page, and lands on the analysis it wrote. The instant-check
  machinery (`draft-check.ts`, `draft-stash.ts`, `instant-check.ts`,
  `run-chip.mjs`) is deleted, and older comparisons of a one-off resume are
  kept instead of thrown away, so "did the number move?" has an answer.
- **The advice has a floor, not only a ceiling.** An alignment grade below
  *strong* on the title, the summary or the most recent role must now produce
  a high-priority action *with the wording to paste*, and a must-level keyword
  living only in a skills list must produce an action that puts it in a
  bullet. The anti-padding rule survives: on the gold fixtures the
  well-tailored resume still gets one action, while the live row went from 2
  hedged suggestions to 8 concrete ones. Budgets rose to 12 000 / 10 000
  answer tokens and the suggestions timeout to 180 s.
- **The posted job title may be written on the headline and in the summary.**
  It is the role being applied for, not a claim of having held it; blocking it
  as unevidenced experience made the highest-leverage edit on any resume
  unreachable. In a bullet it is still a claim, and still blocked.
- **A rewrite that drops a keyword the resume carries elsewhere now warns
  instead of blocking** — the rule as written killed a good bullet rewrite
  whose only "SQL" was the phrase "SQL injection".
- **Exceeding a posting's minimum is not a red flag.** "At least 2 years"
  satisfied by ten is met, whatever the model calls the worry; over-levelling
  is a caution, and it was costing 10 points.

- **The keyword statuses say what to do about them.** *no evidence* read as a
  verdict on the person, and `add` was labelled *missing*, which hid the easiest
  win on the page. They are now *in your resume · add the word · do you have
  it? · missing*, with the requirement level in the column beside them. The
  editor's AI action is called **Analyse my resume again**, and the live
  estimate says in as many words that the big number stays on the last analysis
  until another one runs.
- **Another wording, on request.** **Rewrite** on a suggestion card writes that
  one suggestion again — same section, same line, same requirement, a different
  sentence — and the new wording goes through the same gate as the first, so a
  rewrite cannot claim what the original was refused for. **Rewrite all**
  re-runs the suggestions call over the same verdicts; the score never moves.

- **How strongly the resume shows a keyword, measured rather than guessed.**
  A term named on a skills line and a term shown inside a bullet with a number
  in it are read completely differently by a recruiter, and the product could
  not tell them apart — `present` covered both. `evidence.ts` reads the line
  each term actually sits on and marks it *listed*, *described* or *measured*.
  The table shows "skills line only" and "with a number", and the suggestions
  call is handed the fact instead of being asked to infer it.
- **A thin posting says it is thin.** Six signals off the stored brief —
  requirement count, seniority or years, industry, gates, screening lines —
  classify a posting `high`, `medium` or `low`. When it is not `high`, the
  target page says so and names where the rest of the advice came from, so
  "what this kind of role usually asks for" is never mistaken for what this
  employer demanded.

- **A variance fixture, and what it measured.** `npm run variance:compare` runs
  one pair N times and says which part of the formula the spread came from, by
  holding each part at its modal value and reporting what survives. `--rebuild`
  withholds the keyword frame (raw judgment), `--stored` re-reads the last N
  rows and spends nothing. On five runs of one pair it found the answer
  immediately: **80% of a ten-point spread was one red flag** the model wrote in
  three runs of five.
- **A matrix harness for the comparison itself.** `npm run matrix:compare` runs
  a spread of real resumes against real postings — PHP backend, front-end,
  product manager, senior full-stack against backend, full-stack, web, mobile,
  paid-media, lead-generation and clinical-trial roles — and checks every
  invariant against the row it wrote: keyword shape, both status anchors,
  measured evidence, group labels, the cap arithmetic, every quote the editor
  has to locate, the removal gate and the suggestion floor. It found four of
  the fixes below.

### Fixed
- **One fact is no longer billed twice.** Reading those flags explained the
  spread: every run wrote "the primary language group is not evidenced", some
  added "React appears nowhere either", and the keyword pool had already charged
  for both — a term the resume cannot claim earns zero out of its weight, and
  ten more points for saying so depended on the model's mood. `countableFlags`
  drops a flag that names a keyword the resume does not have, or one it shows
  only on a skills line (which the rules already said is never a red flag, and
  which `evidence` now measures). It replaces scoring v3's narrower rule — one
  mechanism instead of two. Same pair, before and after: spread **10 → 5**,
  sd **4.3 → 1.6**, penalty perfectly stable at 0 across five runs. What still
  costs ten points is what no edit can fix: location, work authorization, a
  minimum missed, an excluded seniority, an injection attempt.
- **A red flag that restates an unwritten primary is free again.** The cap and
  the red-flag exemption were reading one number for two different questions:
  the cap asks whether the candidate HAS the core stack (`present` or `add`),
  the exemption asks whether the resume SPELLS it (`present` only). With one
  count, a model that marked the primary `add` and then flagged it as "not
  demonstrated" was charged ten points for saying the same thing twice — which
  is most of what separated two runs of one live pair.
- **One word-choice no longer moves the score 49 points.** After either/or
  groups fold, a posting whose primary stack is "TypeScript, Rust or Java" has
  one primary slot — and `primaryCap(0, 1)` is 30, so the whole score rode on
  whether the model called that one keyword `present` or `add`. A live pair
  scored 79 and then 30 on the same resume, and a second independent judgment
  reproduced the flip. `add` now counts as coverage for the cap: it means the
  resume's own facts evidence the term and only the word is missing, and
  sibling technology is forbidden from `add`. Half the keyword credit stays the
  penalty for the unwritten word. The gold bench's stack-mismatch and
  sibling-tech guards both still pass.
- **A keyword is a thing a recruiter would search for.** 12 of 42 distinct
  keywords on the live corpus were not terms: `5+ years of experience` and
  `Bachelor's Degree` were scored as must-level skills and offered as something
  to add to the skills line, and `0 to 1`, `troubleshoot`, `landing pages` and
  `product sense` were fragments cut out of responsibility sentences — the old
  rule asked for exactly that. The rule now states the test and its exclusions,
  and `keyword-shape.ts` drops what slips through: gate shapes, bare
  quantities, anything over five words. The same posting went from 15 keywords
  to 11, with the years-and-ownership signals moved to the brief's screening
  block where they belong.
- **`present` vs `add` is decided by the text, not by the model's mood.** The
  two statuses differ on one question — is the word written? — and the model's
  answer drifted between runs on identical input. The matcher settles it both
  ways now: a `present` it cannot find becomes `add` (a paraphrase, like
  "automated testing" against "Unit, integration & E2E testing"), an `add` it
  can find becomes `present`. `ask_user` and `cannot_claim` are untouched —
  typing a word does not make a claim true. Six runs of one live pair, before
  and after all of today's fixes: the spread went from **49 points to 4**.
- **An `ask_user` on a word the resume already spells cost 49 points.** The
  same cliff as `add`, through a different door: one live pair scored 53 with
  TypeScript called `present` and 30 with it called `ask_user`, on a resume
  whose skills line says TypeScript. The matcher settles that too now; only a
  `cannot_claim` is left alone, because it is what a user's own denial produces.
- **The same requirement counted twice.** A live Drupal posting returned both
  "301 redirects" and "301 redirect"; every keyword carries weight, so one
  requirement moved the denominator twice and the user was offered the same
  chip twice. Terms now fold by every spelling the alias table knows.
- **A pinned version read as a different technology.** "PHP 8" against a resume
  that says "PHP" was scored `cannot_claim` — on a primary term, which caps the
  whole comparison at 30. A curated list of the technologies postings pin
  versions of derives the version-less alias; "SOC 2" and "ISO 27001" keep
  their numbers.
- **A report with nothing in it, on a resume there was plenty to do for.**
  REQUIRED COVERAGE survived three rewordings and still lost the whole list on
  a front-end resume with React and TypeScript present, judged against a
  full-stack React posting with a ceiling of 70. `suggestion-floor.ts` checks
  the rule in code and spends one suggestions call — verdicts frozen, score
  untouched — naming what was owed. A resume for a different profession, or one
  whose honest ceiling nobody would apply on, is still owed nothing and says so.
- **A removal can no longer strike through what the posting asks for.** The
  model quoted `Symfony, React, Vue, Laravel, Lumen, Phalcon` whole to advise
  dropping three of the six, with React (must, primary) and Vue.js (must)
  inside the span the editor deletes in one press. `gateRemovals` mirrors
  `gateActions` at persist time: a quote covering contact details or a wanted
  keyword loses its quote and keeps its advice. Gotcha 11's rule had been
  prompt-only since it was first paid for; it is a unit-tested code path now.

### Schema
- `posting_brief` — one reading per posting text, keyed by
  `jobId + postingHash + promptVersion` (migration
  `20260906120000_posting_brief`).

## [1.69.0] — 2026-09-05

### Added
- **Refresh a truncated posting from the company's own listing.** "Is this
  job real?" now records the company's own page for the role when its
  careers-page check finds one; the verification card shows it with
  **Refresh the description from it**. That reads the page (the same
  blocklist and private-host guard as the letter page's URL field), shows
  the stored text against it line by line with the sizes, warns when the
  page does not even mention the posting's title, and only on **Replace the
  description and re-classify** writes it — keeping the original (**Restore
  the original** on the job page swaps back), re-classifying the posting
  against the running searches, and making the next comparison read its
  keywords afresh, which the match card says in place of the version delta
  (#162 stage 3, ADR 0043). An Ashby listing — a page drawn in the browser,
  which a plain fetch cannot read — is taken from Ashby's board API instead,
  by id or, for a board root, by the posting's title; the letter page's URL
  field gains the same. Five Jobicy teasers of 219–263 characters became
  their 4 170–10 772-character listings on a copy of the live database, and
  the quick check's 2–3 keywords became 11–19.

### Schema
- `job_verification.postingUrl`, `job.descriptionOriginal`,
  `job.descriptionRefreshedAt` — nullable, no backfill (migration
  `20260905210000_posting_refresh`).

## [1.68.0] — 2026-09-05

### Added
- **Full analysis and Get suggestions read what the verifier learned about
  the company.** "Is this job real?" stores a company snapshot (stack, size,
  stage, practices); until now only the cover letter read it. The full
  analysis and the suggestions call now take it as a fenced COMPANY CONTEXT
  block — for emphasis, strengths and each action's *why* ("the team calls
  itself AI-forward — lead with the Cursor bullet"), never as evidence: no
  keyword, status, gate or paste-ready wording may rest on it, and the quick
  check never sees it, so the score is unchanged by design (ADR 0042; the
  bench's new `--company` flag checks 0 status flips and 0 score changes).
  A Full analysis re-runs once after a new verification; the quick check and
  a repeat Full analysis stay memo hits (#162 stage 2).

### Changed
- **A full analysis behind a newer quick check on the same text is shown
  again, not suggested again.** The memo looked at the latest row only, so
  Full analysis → a re-check in the editor → Full analysis paid a second
  suggestions call for text it had already analysed in full. It now looks
  through the rows on that exact text and prefers a full one.

## [1.67.0] — 2026-09-05

### Added
- **The cover letter greets the person the verifier found.** "Is this job
  real?" records a named recruiter or hiring manager under `named_humans`;
  the Cover letter card's new **Addressed to** field is prefilled with that
  name (read out of the finding by shape, the finding shown beside it, the
  field editable) and the letter opens "Hi Ben Davies," instead of "Hi
  Hospitable team," (#162 stage 4). The name is a greeting, never a claim:
  the fact gate skips it as it skips the company's name. Regenerate keeps
  the name the letter greeted. Cover prompt v4.

## [1.66.0] — 2026-09-05

### Changed
- **The resume scan is short again; the shape is read on demand.** The scan
  used to copy the whole resume into the JSON Resume shape (ADR 0039) —
  most of its output, 12 000 tokens of budget, and one page reads the
  result — so the wizard's resume step and every "Save as vN" carried it
  (#184, #168). The shape is its own call now (`resume/structure.ts`),
  started by the clean-version page on its first visit for a resume that
  has none, with a progress page and the engine's reason on failure; a
  failed reading lands on the built-in reader's shape with **Read the shape
  with AI** to try again. A resume already read keeps its shape; a new
  version clears it as before. The scan's budget is 4 000 tokens.

## [1.65.0] — 2026-09-05

### Changed
- **Default models per engine, from a measurement.** With the CLI's
  thinking capped (v1.59.1) Sonnet 5 answers a quick check there in 19 s
  and never broke its JSON, while Haiku 4.5 took 21–26 s and returned JSON
  that could not be parsed in two of three calls; on the API Haiku is the
  fast one at 18 s while Sonnet 5 and Opus 5 think for a minute. So an empty
  Resume model slot now means Sonnet 5 on the Claude CLI and Haiku 4.5 on
  the API, and an empty Cover letter slot means Opus 5, the writer, instead
  of following the resume slot; `CLAUDE_MODEL_RESUME` and the new
  `CLAUDE_MODEL_COVER` in `.env` still override (#184). The whole table —
  scan, quick check, full analysis, suggestions, review on six lanes — is
  in docs/target-plan.md §2.3.
- **A resume call fails with a reason instead of waiting five minutes.**
  Each tool-free call has a budget about twice its slowest measured lane —
  quick check 90 s, scan / suggestions / review 120 s, full analysis
  180 s — and the run page says what the engine answered (*"Comparison
  failed: claude timed out after 90 s"*) instead of "see the web logs".
- **The progress page states this install's lane.** *"Quick AI check —
  about 20 s on Sonnet 5 through the Claude CLI"* instead of "half a minute
  to a minute" for everyone; the AI engine tab warns when the resume slot
  resolves to Haiku on the CLI.

## [1.64.0] — 2026-09-05

### Changed
- **One upload button, and the AI check runs behind it.** The editor's
  re-upload popover had two buttons — *Upload & check (seconds)*, which
  opened the file as a draft and moved the number by a point or two, and
  *Upload as vN & check with AI*, which took minutes on a progress page —
  and read as "nothing happened" or "too slow" (#184). One **Upload & check**
  now: the text opens in the editor within a second with the live estimate,
  the quick AI check of that text starts in the background, and a chip
  beside the score follows it — *AI check running · 22 s*, then *AI check
  ready: AI match 91/100 — Use it*. Nothing is saved until Save as vN or
  Save as a tailored copy on the bar; the check lands as a draft analysis.
  **Re-check with AI** and **Full analysis** from the editor behave the
  same way — the editor stays open, the chip follows the run, and text
  typed meanwhile travels along as the next page's draft. The Compare page
  does the same when a known resume's text changed.

## [1.63.0] — 2026-09-05

### Added
- **Discord as a second alert channel.** Settings → Notifications takes a
  Discord incoming webhook next to a Telegram bot + chat: paste the URL,
  a test message is posted before the row is saved, and every alert,
  digest, held delivery, stale-application nudge and careers-page notice
  reaches it in Discord's own markdown, packed under Discord's 2000
  characters, with mentions disabled so a posting's text cannot page
  @everyone (#24, ADR 0041). A search profile can route its alerts to
  either kind; `DISCORD_WEBHOOK_URL` in `.env` bootstraps one on first
  boot like the Telegram pair. The webhook URL is a secret and is treated
  like a bot token: masked on the page, never logged.

### Changed
- **One table for every notification channel.** `telegram_target` is
  `notification_target` with a `kind`; `Profile.telegramTargetId` is
  `notificationTargetId`. The migration renames in place — rows, ids and
  the links from searches survive, and the Telegram row shows under
  *Channel · Telegram*. The master switch reads "Alerts" and covers every
  channel.

## [1.62.1] — 2026-09-05

### Changed
- **A column that leaves the table on a phone is declared once.** `Table`
  takes `hideBelow` per column and hides the header and every cell from that
  one declaration — the cells through the table's own selector — where the
  header carried `thClasses` and each row repeated the class by hand, with
  nothing checking that column *i* agreed on both sides (#77). Resumes and
  the watchlist use it; checked at 375, 700, 1000 and 1440 px: header and
  cells hide the same columns at every width.

## [1.62.0] — 2026-09-05

### Changed
- **A fresh install starts with the aggregators only; the employer boards
  are starter packs.** The seed shipped 23 employer boards switched on —
  every one a US or US-adjacent company — and every regional feed off
  (#149). Now the nine aggregators are on, the regional feeds stay off, and
  no employer board is on by default: the 22 live boards moved into the pack
  catalog as *US product companies* (17), *European product companies*
  (Spotify, Pleo, Channable, Digital Science) and Buffer under *Remote-first,
  worldwide*; Niantic's empty board was dropped. The wizard's boards step
  offers the packs that fit the running searches — a country named or a
  group it belongs to, a required technology, remote work — next to the
  board feeds, and the pack's preview → add → enable flow returns to setup.
  An install that already has the boards keeps them exactly as they are
  (ADR 0040).

### Fixed
- **Two seeded boards were dead slugs.** `GREENHOUSE:pleo` and `LEVER:plaid`
  failed on every tick since the companies moved to Ashby; the seed removes
  them on the next boot — with any jobs they once fetched, as every obsolete
  row goes — and their Ashby boards (31 and 103 open jobs) are in the packs.

## [1.61.0] — 2026-09-05

### Changed
- **The wizard's test search asks the aggregators alone, and asks where you
  work.** Step 2 walked all 32 default sources — 2 618 postings in 83 s on a
  fresh install, 23 of them US company boards nobody had asked for, one of
  them alone 32 s (#154). It now walks the nine boards that publish every
  posting they have: 591 postings in 17 s, measured on the same fresh
  install. An optional "Where do you work?" chip field lands on the primary
  search before the walk, so the boards that narrow by place do and the
  profile step starts from it. The company boards join the hourly watch once
  the profile exists; "Fetch now" on the Overview and /runs still asks every
  due source.
- **Every fetch run records what each source cost.** The `fetch` /
  `fetch-now` row on /runs folds a per-source list under its stats — slowest
  first: time, status, count — the progress page's activity line says how
  long the last board took, and the worker's log line carries the same
  number. Which boards took the minute and which failed was recorded nowhere
  before.
- **Said out loud: built for software engineers.** The README, the wizard's
  resume step and "Fill from a resume" say so, and a resume whose title or
  role words read as a product / project / delivery manager, recruiter,
  marketing, sales, designer, HR or business-analyst role keeps the required
  stack and says why — a product manager's resume once became a required
  stack of `sql`, and every posting without the word scored 35 at most.

### Fixed
- **"Fetch now" within the hour after a tick asked nothing.** Every attempt
  stamps a source's next check an interval ahead (ADR 0036), and the manual
  run honoured that pacing — so the button that promises the hourly tick
  answered "no jobs from 0 sources" until the hour was up, and the wizard's
  "Search again" with it. A manual run asks every selected source now; the
  polite delay and the conditional requests still apply.
- The README's setup walk described four steps; the wizard has had five
  since v1.57.0.

## [1.60.0] — 2026-09-05

### Added
- **The comparison reads the verification.** The Resume match card and the
  resume editor's header carry one line from the latest "Is this job real?"
  verdict — *"Verification says apply with caution (72 %): the posting cannot
  be found on any public board. A quick check is enough here."* — with a link
  to the evidence; `skip` warns that a comparison may be wasted effort and
  Compare still works; a job never verified says so on the card and points at
  Verify. The verifier's red flags and a ghost / scam reading of the posting's
  own text appear under "Worth knowing — not scored", labelled *From
  verification* (#162, stages 0 and 1). Nothing is stored on the match row, no
  AI is spent, and the score does not move — a finding about the posting is
  not a finding about the resume.

## [1.59.2] — 2026-09-05

### Fixed
- **Verify works on the API path with Haiku 4.5.** The web-search and
  web-fetch tools of 2026-02-09 filter their results through code execution,
  which needs programmatic tool calling — Opus 4.6+ and Sonnet 4.6+ have it,
  Haiku 4.5 does not and answered 400 to every verify request (#161). On
  models without it the same tools are declared with direct calls only, the
  API's own escape hatch.
- **A failed verify says why.** The provider's one-line reason (keys masked)
  reaches the run page — *"Verification failed: 'claude-haiku-4-5-20251001'
  does not support programmatic tool calling …"* — instead of "see the web
  logs".

### Changed
- **Verify runs on a progress page.** The free rungs (the company's board
  API, the posting page) are a step whose answer appears under it within
  seconds — *"the posting page renders normally (rung 2, no AI spent)"* —
  and the research step names the seven checks it runs as it runs them;
  closing the tab loses nothing, a second click joins the run, and the job
  page's card says "Checking… — open the progress page" while it is in
  flight instead of offering a second button (#161). A pasted posting with
  no URL says so up front (`no_url`) instead of "the stored URL is not
  safely fetchable", and its Verify goes straight to the research.

## [1.59.1] — 2026-09-05

### Fixed
- **Save & re-check no longer waits six minutes on the Claude Code CLI.**
  Three causes, all measured (#168). `claude -p` turns extended thinking on,
  and on "copy this resume into JSON" Haiku 4.5 spent 18 924 thinking tokens
  for a 3 500-token answer — 227 s where the same call takes 34 s with the
  budget at zero, same structure quality: every tool-free call on the CLI
  now runs with `MAX_THINKING_TOKENS=0` (the verify call keeps the default;
  it reasons over search results). The Save route waited for a scan the
  comparison never reads — it runs in the background now, as the re-upload
  route's has since 1.14.0, and the flash says the headline and skills
  refresh behind it. And every reply logs one line with the model, the API
  time, the output tokens and the thinking tokens on both the CLI and the API
  path, so a slow call, a throttled call and a thinking call stop looking
  alike. The run page's step copy states bands instead of "about half a
  minute" for every engine.

### Notes
- `docs/ai-engines.md`'s 2026-08-31 table blamed prompt size for Haiku's
  146 s on the CLI; it was this thinking budget running into the 180 s
  timeout. Corrected.

## [1.59.0] — 2026-09-05

### Changed
- **The file control on every upload form reads as the first action.** It
  was a 12 px grey chip beside a solid "Upload" button that does nothing
  until a file is chosen — the eye went to the wrong control (#155). The
  native file button now carries the accent and a Button's size on all five
  upload forms; on the wizard's resume step the submit waits, disabled,
  until a file is chosen (a few lines of inline JS — without scripting it is
  simply enabled, as before), and the card says one sentence instead of two.
  No drop zone: it would be a browser module plus the keyboard work, and the
  plain form has to keep working — worth its own measurement first.

## [1.58.0] — 2026-09-05

### Changed
- **The way into the resume editor is a button called "Tailor resume →".**
  It was a text link at the far end of the score row's meta ("Open targeted
  view →"), and the page it opened was titled "Resume match" — the owner's
  own walk took ten seconds to find it (#164). Now the comparison's primary
  action is that button (emerald: it spends no AI), full-width under the
  score on a phone; the flash after a comparison offers it at the moment of
  highest intent; the page's title, breadcrumb and heading all say **Tailor
  resume**; the three-line hint under Compare / Full analysis shows only
  while no comparison exists. "Targeted" is gone from user-facing copy — the
  route `/jobs/:id/target` stays for deep links.

## [1.57.3] — 2026-09-05

### Fixed
- **One keyword override lands on one row.** A stored re-level or ignore
  followed the concept through its aliases, so when a rebuilt keyword frame
  split "Grafana" into *Grafana*, *observability tools* and *performance
  monitoring*, one decision moved the score three times and two rows wore a
  *yours* badge the user never set (#85). Now the row that spells the term
  exactly takes it, and an alias match only when no row does — and only the
  first one.

## [1.57.2] — 2026-09-05

### Fixed
- **A failed scoring pass says why.** "10 could not be scored" now carries the
  engine's own last reason — *"the AI did not answer: HTTP 401: API key is
  invalid"*, *"no API key — paste one on /settings"* — in the wizard's flash,
  the re-classify flash and the run's stats on /runs (`lastError`), and the
  hourly tick keeps it as `classifyError`; before, the count was honest and
  the reason lived only in the container logs (#97).

## [1.57.1] — 2026-09-05

### Fixed
- **A self-saving select no longer saves every option a keyboard user passes
  through.** The keyword "Wants it" level, the watchlist row's interval and
  policy, and the model pickers on Settings all saved on `change` — and in
  Chrome on Windows and in Firefox, ArrowDown on a closed select fires
  `change` per option, so arrowing from *must* to *nice* wrote three levels
  and three flashes (#90). One shared browser module now commits a pointer
  pick at once and a keyboard pick when the select loses focus or on Enter;
  the keyword select posts through `requestSubmit`, so nothing else changes.

## [1.57.0] — 2026-09-05

### Added
- **The boards for your countries, one press, on the way in.** The first-run
  wizard has a fourth step between the profile and the first matches: the
  job boards that fit where the searches hunt (DOU and Djinni for Ukraine,
  solid.jobs for Poland, Arbeitnow for Germany …), listed with their state
  here and an **Enable all N** button — "Skip for now" moves on, and a user
  who scores matches without it is never nagged about it (#148). The same
  button sits on the Companies page's "Sources for your searches" card, so
  five feeds no longer cost two clicks each; the profile-save flash names
  it. The three readers of that list — the card, the wizard, the flash —
  share one loader now.

## [1.56.0] — 2026-09-04

### Changed
- **The Job sources grid shows your install, not the enum.** Three groups —
  ATS vendors, aggregators, your own sources (the feeds you pasted and the
  careers pages you watch, with a caption saying that unticking them switches
  your watchlist off) — sorted by name inside each, and every pill says what
  runs here: `14 companies · 14 active`, `1 feed · 0 active`, `no companies
  yet`. Adzuna and France Travail say `needs a key` and link to the card that
  takes it, instead of a plain tick identical to Greenhouse's (#147). Same
  form, same toggles, no schema change.

## [1.55.5] — 2026-09-04

### Changed
- **The strength review says what it read.** It grades the extracted text —
  wording, structure, evidence — and a photo, columns or a table are
  invisible to it; the card now says so and points at "What the ATS sees"
  for that half of the answer (#92).
- **The cover letter card says when it would distil a quick check.** A quick
  check carries verdicts and keywords but no strengths (ADR 0029), so a
  letter built from one has less to draw on; the card names the comparison
  it will use and offers "Get suggestions first", which lands back on the
  card when the second call is done (#89).

## [1.55.4] — 2026-09-04

### Fixed
- **The dashboard renders in standards mode.** No page ever sent a doctype, so
  every browser rendered ApplyPack in quirks mode — and in quirks mode a
  `<form>` grows a 1em bottom margin, which is what put a form-wrapped button
  7 px below the bare button next to it (#153, and the batch of alignment
  fixes in 1.23.2). The layout emits `<!DOCTYPE html>`; `ActionForm` is a
  flex container so it never grows a line box of its own. Eight pages
  compared at 1280 and 375 px: nothing else moved.
- **Re-classify sits beside the verdict it replaces.** The Classifier card on
  the job page now always renders — "Not scored yet" for a posting the AI
  never saw, which is when the button matters most — and the Actions card
  keeps the three status buttons that fit its rail (#100).
- **The job page asks "Applied with" once.** Before an application exists the
  Actions card asks it next to Mark applied; afterwards the Application
  tracking card holds the recorded answer. Two selects with two different
  preselections were on screen at the same time, and the last form submitted
  silently won (#101).

## [1.55.3] — 2026-09-04

### Fixed
- **The AI no longer tells you to remove formatting you never wrote.** The
  text every resume prompt reads is a rendering made by the app — `## ` for
  a heading, `- ` for a list item, `a | b` for a table row — and the scan
  was advising candidates to "drop the '##' markers" from a `.docx` that
  contains none (#156). All five prompts that read a resume (scan, match,
  suggestions, strength review, cover letter) now say the markers are ours:
  judge the words, the heading names and the order, and treat a ` | ` line
  as the layout fact it is (a table, which ATS parsers split badly).

## [1.55.2] — 2026-09-04

### Fixed
- **The wizard's search now hunts with the resume it was built from.** Step 3
  filled the primary search from the uploaded resume and left
  `Profile.resumeId` empty, so every Compare afterwards guessed the resume
  by skill overlap — right by luck with one resume, a coin toss with three
  (#158). The apply step links it, as filling from a resume on Settings
  already did.
- **"Fill from a resume" no longer drafts an 86-chip nice-to-have list.**
  Every skill the scan found went into the list the classifier is told to
  raise the score for — `git`, `jira`, `agile`, `scrum` included — and cost
  717 characters of prompt per search on every classification (#157). The
  draft keeps the first 20 skills after the required stack, drops universal
  tooling, and says so above the chips. Measured on the four stored resumes:
  86 → 20, 19 → 19, 15 → 14, 19 → 18.

## [1.55.1] — 2026-09-04

### Fixed
- **Comparisons no longer fail on the default resume model.** `max_tokens`
  on the Messages API counts the model's thinking, and Claude Opus 5 thinks
  by default: one full comparison measured 6 078 thinking tokens inside the
  8 000-token budget, the JSON was cut off mid-string, and with three or more
  resumes stored every comparison failed in both modes (#159). The Anthropic
  path now adds 8 000 tokens of headroom to every answer budget, the way the
  OpenAI path already did for its reasoning models.
- **A cut-off reply is reported as cut off, not as "no JSON object in
  reply".** The provider reads `stop_reason` and refuses an incomplete or
  declined reply with the reason, and a reply that stopped inside the JSON
  is not retried — the identical call stops in the identical place, which
  cost two full-price calls per attempt.
- **The "other resumes mention" hints are filtered to the posting.** With
  four resumes stored the list ran to 122 fenced lines on every comparison;
  a skill the posting never names cannot become one of its keywords, so only
  the ones it names (aliases included) go into the prompt.

### Notes
- The five resume calls and the ghost-job check share one parse-and-retry
  wrapper (`src/ai-json.ts`) instead of five copies of the same loop.
- Every reply's `stop_reason` and `usage` are logged at debug level.

## [1.55.0] — 2026-09-04

### Added
- **A clean version of any resume, in your own typeface.** A PDF has no
  paragraphs to edit — only glyphs at coordinates — and a `.docx` that keeps
  its skills in a table has lines a Save cannot rewrite. Both now get **Clean
  version in your typeface** on the resume page: a single-column `.docx` and
  `.pdf` of the same words, set in the font, sizes, accent colour, page and
  margins your own file uses, with every one of those adjustable. **Save as a
  new resume** lands the `.docx` beside the original — and the template check
  calls it *Editable in place*, so everything the targeted editor does works
  on it from then on (ADR 0039). The label is exactly that: it is not your
  original design, and the page says so.
- **The scan now reads your resume as a shape, not just a wall of text** —
  headings, roles, dates, bullets and, crucially, the label→values pairing of
  a skills table, which comes out of a PDF as eight labels stacked above eight
  value lines and out of a `.docx` as one run-on line. Every string is checked
  against your own words before it is stored and dropped if it is not a
  verbatim copy, so nothing the model rewrote can reach the page.
- **"What the ATS sees" on the render page** is the rendered `.docx` read back
  through the same reader an upload goes through, with the parse checks run on
  it — not a guess at what it would say.

### Notes
- Two dependencies, both pure JavaScript, pinned: `docx` 9.7.1 and `pdfkit`
  0.20.2. Plus **Liberation Sans 2.1.5** (OFL 1.1, licence beside the fonts,
  825 KB) in the image.
- Why that font, measured with fontkit rather than assumed: its advance widths
  are **identical to Arial's on all 95 printable ASCII codepoints** (max delta
  0 of 2048 units/em) and it covers Ukrainian Cyrillic. The `.docx` names your
  own family and lets Word supply it; the `.pdf` embeds this one; because the
  metrics match, the two files break their lines in the same places.
- **Typst was measured and refused.** It typesets better out of the box, but it
  stamps `Typst 0.14.2` into the PDF's `/Info` *and* its XMP metadata with no
  way to set either from the compile call, it writes no `.docx`, and it is a
  native binary in a project that has none. pdfkit's `Producer` and `Creator`
  are the empty string — checked after the change, not assumed. Neither writer
  leaves a tool name in a file: 0 occurrences of the libraries' own names in
  any part of the output.
- **The guide this stage followed was wrong twice, and the corpus said so.**
  Reading typography from `styles.xml` would have dressed this resume as Times
  New Roman 12 pt when its own runs are Arial 11 pt with a blue accent; and
  pdf.js reports a font family of `sans-serif` for every item until
  `getOperatorList()` has run. Both are now read from the document itself.
- The first live render came back with a row of ☐: Word formula objects leave
  MATHEMATICAL ITALIC letters in the text, which no bundled face has. They now
  fold to the letters they are, and the set of characters kept is checked
  codepoint by codepoint against both font files rather than hand-listed.
- First live walk, resume 5 (a PDF): scan read 161 strings with **0 dropped**,
  6 roles and 24 bullets — the same split the deterministic reader finds;
  saved as a new resume it reports *Editable in place, 61 of 61 lines*; a
  comparison scored 87/100 and its Save patched that `.docx` in place.
- `SCAN_MAX_TOKENS` 3 000 → 12 000: the scan now copies the whole resume into
  its reply. One new nullable column, `resume.structure`, hand-written
  migration, no backfill — NULL means "read it from the text instead".
## [1.54.1] — 2026-09-04

### Fixed
- **A one-off check from the Compare page could not be saved at all.** The
  scratch resume `/target` uploads to has no versions by design, so the
  targeted view hid every Save — while the line above the editor promised a
  text version. It now offers one button, **Save as a new resume**, which
  keeps the edited text as a resume of its own on `/resumes` (named after the
  company), and the line above the editor says so. A scratch resume is never
  bumped in place, whatever the form sends.

## [1.54.0] — 2026-09-04

### Added
- **Save writes your edits into your own .docx.** On the targeted view, when
  the resume's file is a `.docx` whose layout allows it, Save patches that
  file in place — the edited lines rewritten inside their own paragraphs,
  formatting kept outside the words you changed, deleted lines gone, added
  lines shaped like the line above them (a bullet after a bullet stays in the
  list). Download hands the file back. When a line cannot be placed honestly
  (a table row, a text box, a line that shares its paragraph, an edit that
  changes a line's tab layout) the save is a text version and the flash says
  why (ADR 0038).
- **Save as a tailored copy** is now the primary action: a new resume beside
  the master, named after the company, the master untouched. **Save as vN**
  stays.
- **Template check** on `/resumes/:id`: *Editable in place*, *Partly
  editable* or *Text only*, how many lines a save can rewrite, and the parts
  it cannot touch — tables, text boxes, columns, header text, formula
  objects, hidden or white or 4-pt runs — each as a sentence. The line above
  the editor says the same for the file at hand; a PDF is told to upload the
  `.docx` it was printed from.
- **Fix document properties**: a downloaded template keeps its author's name
  and title in the file — the one `.docx` in the corpus says it was written by
  "Joshua" and is titled with a street address in Lagos. The card shows the
  current values and one press writes the candidate's name instead, bytes
  only: no new version, no re-scan.

### Notes
- Two dependencies, both pure JavaScript, pinned: `jszip` 3.10.1 and
  `@xmldom/xmldom` 0.9.12. No Dockerfile change, no migration.
- Measured before it was built, on the real file: xmldom reproduces
  `word/document.xml` to one byte (the CRLF after the XML declaration, put
  back), jszip returns the other 30 parts byte for byte, and 235 of 432 text
  nodes lack `xml:space="preserve"` — so every node the patcher writes gets it.
- The `.docx` reader is now a DOM walk (`walkDocument`) that hands the patcher
  the paragraph behind every line; the regex reader stays as the fallback for
  XML the parser refuses, and a parity test pins the two to the same text,
  quirks included — a soft break inside a table cell still splits the row,
  because every stored resume text was rendered that way.
- Three fixtures: a structural twin of resume 1 (every text node replaced by
  neutral prose of the same length, properties and links scrubbed; 89
  paragraphs, 527 runs, the 1 × 2 table, both formula objects, all 100 tabs
  intact), a paragraphs-only file, and a table layout with a text box and a
  header.
- The first live save found what no fixture had: resume 1 keeps a bullet's
  full stop in a run of its own, so appending a clause makes an empty change
  window exactly on a run boundary, and the file read back with a doubled
  stop. The window now belongs to the run before it.

## [1.53.0] — 2026-09-04

### Added
- **Every suggestion now arrives with the wording ready to paste.** The model
  writes the complete new text into a field of its own (`replacement`), and
  for an addition names the resume line it follows (`insert_after`). On the
  first live analysis 9 of 10 suggestions came with wording, against about
  half before — and Apply now works on additions too, inserting after the
  anchored line.
- **A gate in code decides what Apply may paste** (ADR 0037). At analysis
  time every wording is checked against the resume, the posting and your
  confirmed facts: an invented figure, a technology the resume has no evidence
  for, or a rewrite that drops a must-have keyword is refused. A refused card
  keeps its advice and says why on its *why* line — *"not applied — claims
  "Node.js", which this resume has no evidence for"* — with Copy and Edit &
  apply still there. A lost nice-to-have or an unconfirmed term is a note,
  not a refusal.
- The resume strength review's "example" lines follow the same bullet rules as
  the match suggestions: one house style for every sentence this product
  proposes.

### Notes
- Prompt versions: match **v7**, review **v3**. A comparison stored under v6
  is re-run rather than reused, and its keyword frame is rebuilt.
- Measured before it was built, on the 108 wordings the model had already
  written: resume + facts alone blocked 4, all by the employer heuristic and
  none by a metric — "B2B SaaS" and "East Coast hours" are posting vocabulary,
  so the posting is a source (0 metrics laundered); "Node.js and TypeScript"
  in a PHP resume was a real fabrication the fact check cannot see, hence the
  `cannot_claim` rule. KEEP WANTED KEYWORDS as specified would have dropped 21
  of 108, and 11 of those were paraphrased phrases — so it refuses on
  must/primary only.
- Bench, five fixtures, claude-opus-5: reply **+4 %** (4 710 → 4 910 chars),
  p50 20 → 22 s, 10 of 10 actions paste-ready, 0 checks failed.
- `bench:resume --table` shows two new columns, Replacements and Anchored; an
  older run prints an em dash there rather than a misleading 0.

## [1.52.0] — 2026-09-04

### Added
- **Apply a suggestion instead of retyping it.** On the targeted view each
  suggestion that quotes your text and proposes new wording gets **Apply**, and
  **Edit & apply** opens the wording in a box first so you can make it yours.
  Removals get **Remove**. Every card also has **Skip**, and everything you do
  is one **Undo** away.
- **Add a missing keyword to your skills line in one press.** The `+ add`
  control appears beside a missing chip only when the term is one you can
  honestly claim *and* your resume has a skills line shaped like a list to put
  it on. A `no evidence` keyword never gets one.
- Applied and skipped cards step back and keep only Copy, Locate and Undo, so
  the list shows what is left to deal with. The marks survive a reload.

### Notes
- **Undo stores the inverse edit, not a copy of your resume** — three applied
  cards cost 598 bytes instead of three 6 KB copies, and Undo still works after
  a reload. It refuses if you have typed over the edit rather than overwriting
  your later work.
- **Apply reaches about half of today's suggestions.** Of 209 stored actions,
  108 carry both a quote and a wording; 59 propose an addition with nothing to
  replace, 16 quote without proposing, 26 are instructions. That ceiling is the
  data, not the code — the `insert_after` field in the next stage is what lifts
  it. `locateQuote` itself found **237 of 237** quotes, so nothing fails at
  finding your text.
- **Removing text on the line with your email or phone is refused**, with the
  reason. Three of the stored removals ask for exactly that.
- There is no "move this bullet to the top". 24 actions use move/lead wording,
  but reading them shows the model means *make the first bullet say this* — it
  quotes the leading bullet and proposes new words, which is a replacement. A
  real move applied to 4 of the 24, so no button was built for it.

## [1.51.0] — 2026-09-04

### Added
- **Every suggestion now shows what your resume says now and what to make it
  say.** A comparison used to bury the proposed wording inside a sentence
  (*Reword as: "…"*) and hide the removal quotes entirely — it told you to
  delete something it would not show you. Each card is now a **Now** block and
  a **Proposed** block with the wording on its own, and removals show the text
  to cut, struck through.
- **Copy** on every card puts just the proposed wording on the clipboard — on
  `/jobs/:id` as well as the targeted view — so the manual path is one press
  instead of a careful drag through a sentence.
- **Locate** outlines the target text in the editor and scrolls **the editor**
  to it. The page does not move, so the card you were reading is still in front
  of you. It also prints the line number, and says *"Couldn't find this text in
  the editor, it may already be edited"* when the text has already changed.
- **Copy all suggestions** and **Copy my changes** hand over the whole list as
  Markdown — the first from the AI's suggestions, the second as a diff of your
  own edits. This is the universal path: it needs no Apply button, and it
  pastes into whatever your resume actually lives in.

### Fixed
- **The targeted view no longer scrolls sideways on a phone.** At 375 px the
  suggestions pane was 499 px wide and dragged the page with it: the keyword
  table's `overflow-x-auto` wrapper had nothing bounding it, because a grid
  item defaults to `min-width: auto` and is sized by its widest content.
- On a narrow screen the editor now comes first in the Suggestions view and
  starts at 40 vh (**expand editor** makes it tall), and the keyword table
  starts folded — it is by far the longest block on the page.

### Notes
- The proposal extractor was written against the **209 stored actions**, not
  against the plan's assumption. Straight single quotes outnumber double ones
  **131 to 45** and curly quotes never occur, so the double-quote-only rule the
  guide specified would have found a wording in 22 % of them; reading both, with
  an apostrophe guard, finds one in **80 %**. The 42 it declines were read by
  hand: 33 are instructions with no wording in them, 8 quote a term rather than
  a sentence, 1 quotes the current text.
- Cover-letter Copy now shares one clipboard module with the new buttons
  instead of its own copy of the same fallback.

## [1.50.0] — 2026-09-04

### Added
- **A company whose careers page publishes nothing can still be watched.**
  Paste it like any other: if the page has no board and no feed but does have
  readable text, the preview offers a **change watch**. It hashes the page and
  tells you *"this careers page changed, have a look"*, with the link, at most
  once a day. It never claims to know the jobs, never stores a posting and
  never spends an AI call — which is exactly what it is worth, and saying more
  would train you to ignore it.
- On `/companies` those rows say **Page changes** and **watching** instead of
  an alert policy and a posting count, because a posting count would be a lie.

### Fixed
- `stripHtml` no longer leaves `<!DOCTYPE html>` at the head of the text. It
  stripped comments but not markup declarations, so every description taken
  from a whole page began with it.

### Notes
- **The normalisation is `stripHtml` plus collapsed whitespace, and nothing
  else** — the §17 plan's digit masking was measured and dropped. Ten careers
  pages, each fetched three times ninety seconds apart so any difference was
  noise: raw HTML changed on **4 of 10** (nonces, build ids), `stripHtml` on
  **none**. And none of the ten carried a date, a relative timestamp or a
  countdown — the only digits in their prose were Datadog's "92 positions",
  PostHog's "0 Job" and Doist's "2024 Open roles". Masking digits would have
  erased the one signal these pages actually publish.
- **The hash advances only once the alert is sent.** A change that lands
  inside the daily window, or outside your alert hours, or that Telegram
  refused, stays pending — the row still holds the text you were last told
  about, so the next allowed check reports it rather than swallowing it.
- The first read of a page never alerts: there is nothing to differ from yet.

## [1.49.0] — 2026-09-04

### Changed
- **A site's robots.txt now binds you through the AI engine you actually
  run.** v1.48.0 read a fixed list of fifteen AI-adjacent crawler tokens and
  refused a careers page if any of them was told to stay away. Measured
  against sixteen European companies, that refused three of them for somebody
  else's reasons: swmansion.com blocks ByteDance's `Bytespider` alone while
  publishing `Allow: /` and `Content-Signal: ai-input=yes`; stxnext.com blocks
  `bytespider` and `ccbot`; brainly.com blocks `GPTBot` and allows everyone
  else. None of them was talking about us.
  The rule the ADR always meant is that the vendor whose model reads the
  description is the one whose ban counts — so an install on Claude is bound
  by `ClaudeBot`, one on Gemini by `Google-Extended`, one on Codex or an
  OpenAI-compatible endpoint by `GPTBot`, and an install running several by
  all of theirs. Blocking a scraper or a dataset crawler is no longer read as
  blocking you.
- **`Content-Signal` is read too.** It speaks about the act rather than about
  a crawler's name: `ai-input=no` refuses us whatever the groups say, and
  `ai-input=yes` outranks a group aimed at another vendor's bot.

### Notes
- **Stage B of the company watchlist (sitemap + JSON-LD) was measured and not
  built.** It rests on career sites publishing `JobPosting` structured data;
  across 21 sites on two continents, **zero** do. The redesigned version —
  "a new URL under the careers path is a new posting" — needs the sitemap to
  list one URL per posting, which is true for 2 of 21 and for none of the
  eight European sites. The numbers, and the two traps that make a naive
  check look positive, are in
  [docs/company-watchlist.md](./docs/company-watchlist.md).

## [1.48.0] — 2026-09-04

### Added
- **A watchlist of companies you name.** `/companies` → *Watch specific
  companies*: paste career-page or board URLs, one per line (optionally
  `Name — URL`). Each is resolved to the job board or feed behind it on a
  progress page, then a preview shows what every URL actually turned into —
  and what it did not, with the reason, so nothing is half-added. Watched
  companies get a ★ on `/jobs`, on the job page and in Telegram, and a
  `★ Watched` chip filters the list.
- **Per-company check intervals** — every hour, once a day, once a week. They
  ride on the existing tick rather than a cron of their own, so a watched
  company follows your search schedule and is not checked during hours you
  told the search to sleep. "Check now" makes a row due on the next tick.
- **"Alert me about every posting"** for a watched company: the base filter
  and the fit threshold are bypassed, and the alert reads *★ New posting*
  rather than claiming a match. The posting is still scored, so it carries a
  fit number — the message just does not pretend the number is why you are
  hearing about it.
- **`src/robots.ts`** — the RFC 9309 reader the resolver calls before it
  fetches anything: user-agent groups, longest-match Allow/Disallow, a missing
  file means allowed. Two rules are stricter than the protocol on purpose. A
  group naming any AI agent binds us, because every description this project
  fetches is read by an AI classifier, and a 5xx on robots.txt means "not
  allowed" — a failing server has told us nothing.
- **A generic `FEED` source**: an RSS or Atom job feed, where the token is the
  feed URL. It is the rung below the vendor types, never a replacement for
  one, and the URL goes through the same SSRF and ADR 0005 guards on every
  tick.

### Notes
- **No headless browser, ever** — the decision behind the whole feature, now
  written down as [ADR 0036](./docs/adr/0036-watchlist-reads-published-data-only.md).
  A watch check reads only data a site publishes for machines.
- Measured on twenty JavaScript-heavy companies that hire often: 5 resolved to
  a board, 13 publish nothing machine-readable at the URL you would paste, 2
  answered an HTTP error, 0 had a job feed. The table is in
  [docs/company-watchlist.md](./docs/company-watchlist.md), and the thirteen
  are what stage B (sitemap + JSON-LD) is for.
- Three findings from that run changed the code: a board URL is not a board
  (Deno's Ashby board answers 200 while its public API 404s, so every match is
  confirmed with the vendor first); a guessed feed path finds blogs and
  item-less WordPress feeds, so a feed must name jobs in its path *and* carry
  entries; and a vendor's name is not evidence of its bot check —
  `.grecaptcha-badge` in a stylesheet is not a challenge.
- The first check after adding a watchlist with "every posting" classifies
  everything those companies have up, which on five companies was 217
  postings. The interval is the lever if that is more AI than you want.

## [1.47.2] — 2026-09-04

### Fixed
- **Two digest times no longer mean the same recap twice.** v1.47.0 let you
  pick up to four digest times, but the daily recap still looked back a fixed
  24 hours — so a 19:00 message repeated the 09:00 one in full. It now covers
  what arrived since the last recap. A failed run does not move that mark, so
  nothing is skipped either, and with a single digest time nothing changes.
- **The stale-application nudge goes out once a day again**, at the first
  digest time. It reports a standing state — "these six applications are 14
  days old with no reply" — so four digest times were four identical
  reminders.
- **A match you dismissed while it waited is no longer alerted anyway.** Held
  matches sit on /jobs as normal rows, so you can dismiss, save or apply to
  one before the alert window opens. Delivery used to send it regardless and
  overwrite your status with "alerted". It now delivers only matches you have
  not answered, and drops the hold on the ones you have. The counts on the
  Overview and the Schedule card follow the same rule.

## [1.47.1] — 2026-09-04

### Fixed
- **/target no longer names a step it never runs.** When a full analysis is
  asked of a posting whose quick check is already stored, only the suggestions
  call is needed — but the progress page still advertised the comparison step
  and then flipped straight to done. It now writes the suggestions itself, on
  one progress page instead of two chained ones, and says so
  (thanks [@harshvardhan60792](https://github.com/harshvardhan60792), [#138](https://github.com/applypack/applypack/pull/138)).
- Pressing "Get suggestions" on that comparison while /target is already
  writing them joins the run in flight instead of calling the model a second
  time — the guarantee [#76](https://github.com/applypack/applypack/issues/76)
  exists for. A run can now answer to more than one name.
- The flash that follows a suggestions call has one wording again, in one
  place, and the /target path says why the score did not move.

## [1.47.0] — 2026-09-04

### Added
- **A Schedule card on Settings → General: when the search runs, and when
  alerts arrive.** Pick a time zone once and it rules every hour on the page.
  The search gets a cadence (every hour, 2 h, 4 h, once a day), a window of
  whole hours and a set of weekdays — "every 4 hours, 07:00–23:59, Mon–Fri".
  Alerts get three choices: **Right away** (what it has always done),
  **Only during these hours** (a match found at 03:00 waits and arrives in one
  message when the window opens), or **As one digest** at times you pick.
- The Overview status pill gained a third state, **"Sleeping until Mon 07:05"**,
  and a line saying how many matches are waiting for the alert window.
- The run row on /runs says `outside-schedule` when a heartbeat did not search,
  the way it already said `fetching-paused`.

### Changed
- **The daily recap and the stale-application nudge now go out at the digest
  times you set**, instead of at 09:00 and 08:00 in the server's zone. With no
  schedule saved that is 09:00 in `TZ` for both — the recap does not move, the
  nudge moves by an hour.
- The cron is untouched: it still beats hourly at this install's own minute
  ([ADR 0035](docs/adr/0035-many-installs-one-set-of-boards.md)) and a tested
  pure gate decides whether that beat does anything. No cron expressions to
  write, nothing to restart.
- **"Fetch now" ignores the schedule entirely**, exactly as it ignores the
  pause — you are at the screen and you just asked.

### Notes
- An empty schedule means today's behaviour in every respect, so nothing
  changes until you open the card. Both new columns are NULL on upgrade.

## [1.46.0] — 2026-09-04

### Fixed
- **Pausing job fetching no longer breaks France Travail's licence.** That
  licence asks for every stored offer to be re-checked at least once a day,
  and an offer the board withdrew to disappear here too. The check used to
  live inside the hourly fetch *after* the pause switch, so two days on pause
  put the install in breach — and nothing but a warning sentence stood in the
  way. It now runs at the top of the tick, above the pause, above the "no
  search configured" abort and above anything added later: it fetches no new
  postings, spends no AI and adds no rows, so there is nothing about it to
  pause ([ADR 0034](docs/adr/0034-keyed-sources.md) rule 5).
- Switching the France Travail rows off on Companies used to freeze their
  stored offers in place, unchecked forever — the very thing the old
  documentation recommended as the remedy. Turning a row off stops new
  offers; the ones already stored are still re-checked.

### Added
- **A backstop for when the re-check cannot run at all** — the credential was
  removed, the API was down, the machine was off over the weekend. An offer
  whose last successful check is more than two days old is withdrawn here by
  the same rules as one the board withdrew: deleted, or kept anonymised when
  it is your own application record. Two days is one day of grace past the
  licence's window, about twenty-four hourly attempts. The run row on /runs
  counts what happened (`ftChecked`, `ftDeleted`, `ftAnonymised`, `ftExpired`)
  even on a tick that was skipped.

## [1.45.0] — 2026-09-04

### Changed
- **Your install picks its own tick minute.** Fetching used to run at :05
  past the hour on every ApplyPack ever installed, in the same handful of
  time zones, walking the same seeded sources in the same order — a
  synchronised knock on free job boards that owe us nothing. The minute now
  comes from your install's own id (stable across restarts, printed at boot),
  the source order is shuffled each tick, and the jobs that only touch your
  Telegram and your database still run at the hour they always did
  ([ADR 0035](docs/adr/0035-many-installs-one-set-of-boards.md)).
- **A feed is only downloaded when it changed.** 42 of the 62 seeded sources
  answer "unchanged" to a conditional request — measured over two live ticks,
  not assumed ([docs/scale-plan.md](docs/scale-plan.md)) — including every
  Greenhouse, Lever and Ashby board. Those ticks now cost one small request
  instead of a full feed, with no parsing, deduping or storing behind it.
  Companies shows such a source as **Unchanged**, and "Fetch now" says "42 of
  62 sources unchanged since the last tick" instead of warning you about the
  network.
- **And the tick stops waiting for feeds it never downloaded.** The pause
  between sources used to be a flat second whether the board sent a megabyte
  of RSS or a 304; now an unchanged board is followed by a quarter-second.
  On a real install an unchanged tick finishes in 1m53s instead of 2m44s.
  A board that publishes its own pacing keeps it — Lever's robots.txt asks
  for a second between requests, so Lever still gets one.
- An unchanged board still has to prove it is alive: a source whose last full
  read was empty keeps ageing towards "silent" no matter how many times it
  answers 304, and a tick that was paused part-way throws its validators away
  rather than risk skipping postings it never stored.
- Golang Projects and We Work Remotely are fetched through the shared HTTP
  layer now, so they carry ApplyPack's User-Agent, timeout and retries like
  every other source.

### Added
- **README: "Hosting this for other people"** — what changes when ApplyPack
  is not just yours: whose vendor terms apply, the daily obligation that does
  not pause when fetching does, and why each instance wants its own database.

## [1.44.0] — 2026-09-04

### Changed
- **A source that needs your own account stays out of sight until you have
  one.** Adzuna and France Travail are no longer suggested on Companies,
  no longer listed in its add-company form, and never fetched until the
  credential is in place — nothing points a user at a source they cannot
  use. They are opt-in extras, and the place to opt in is Settings →
  Sources.
- That section is now **"Extra sources — a free account of your own"** and
  says, per vendor, what it adds, when it is worth it (and when it is
  not — most people need neither), what the vendor asks in return, and
  where to register. Each row shows whether it is ready or not set up.

## [1.43.0] — 2026-09-04

### Added
- **France Travail, with your own free client id** (plan §3e, ADR 0034):
  every job ad in France through the board's Offres d'emploi API. Create an
  app on francetravail.io, paste the client id and secret on Settings →
  Sources, and Companies offers the developer row (`codeROME=M1805`) to a
  search that names France; any filter the API takes works as a row.
- The board's licence as code: every offer is stored and shown whole
  ("Full offer as published"), every display names the source, the
  board's last update and the licence, and a daily mirror re-checks each
  stored offer — withdrawn ones are deleted, or kept anonymised when they
  are your own application record. `docs/france-travail-reuse.md` states
  the method. Stage 3e, and the country-aware source plan, are complete.

### Schema
- `AtsType.FRANCETRAVAIL`, `Job.sourcePayload`, `Job.sourceUpdatedAt`,
  `Job.sourceCheckedAt` (migration `20260904040000_add_france_travail`).

## [1.42.0] — 2026-09-04

### Added
- **Adzuna, with your own free key** (plan §3e, ADR 0034). Register at
  developer.adzuna.com, paste the app_id and app_key on Settings → Sources
  → "Source keys", and Companies offers one Adzuna row per country a
  running search names (nineteen markets). Rows are polled four times a
  day and capped at ten, which keeps the vendor's 2 500-calls-a-month
  limit; every listing shows the "Jobs by Adzuna" label the terms ask for,
  on the list, the job page and in Telegram; descriptions are snippets and
  say so.
- **Source keys** on the Sources tab: stored like engine keys — masked,
  never rendered in full, never logged, `.env` as the fallback — and
  scrubbed from any error a keyed source raises.
- ADR 0005 gains a fourth addendum rule: robots.txt governs crawling, a
  vendor's published licence governs keyed access.

### Schema
- `AtsType.ADZUNA` (migration `20260904030000_add_adzuna`),
  `AppSettings.sourceKeys` (migration `20260904020000_add_source_keys`).

## [1.41.0] — 2026-09-04

### Added
- **Salary in the posting's own money** (plan §5.1 / §6.7). Until now the
  classifier was asked for one USD number and converted silently, so a
  stored "60000" could be euros a year or złoty a month. It now reports
  what the posting says — the numbers, the currency, the period — and
  `src/currency.ts` does the arithmetic: jobs and Telegram show `€60k-80k`
  or `zł20k-28k/mo`, with `≈ $89k/yr` beside it, and the salary floor on a
  search compares against that converted number instead of a raw one.

### Schema
- `Job.salaryCurrency`, `Job.salaryPeriod` (migration
  `20260904010000_add_salary_currency`). Both null on existing rows, which
  reads as USD a year — what they have always meant.

## [1.40.0] — 2026-09-04

### Added
- **Where you live, and whether you would move** (plan §5, ADR 0033). A
  search now says "I live in" and picks one of three: I stay where I am,
  I would relocate, I would relocate and need visa sponsorship. The
  classifier reads both: a role open only to places you cannot work from
  matches only if the posting itself opens it — relocation, sponsorship,
  an employer of record or a contract abroad — and it flags
  `work-permit-required` or `no-visa-sponsorship` when it does not.
- **"Open to me"** on Jobs: only the roles a search of yours can actually
  take, read from the same per-search verdict the fit chips read.
- The job page says why a role is closed to you when the columns can prove
  it: "open to European Union; you live in Ukraine and this search does not
  relocate".
- Telegram alerts show the country flags and the arrangement.

### Schema
- `Profile.residence`, `Profile.relocation` (migration
  `20260904000000_add_profile_eligibility`).

## [1.39.0] — 2026-09-03

### Added
- **Teamtailor** (plan §4.2, stage 3d): the Nordic / UK / Benelux ATS as a
  per-company source — paste a `*.teamtailor.com` career URL, a slug, or
  the board's own career domain on Companies; every posting arrives with
  the board's city and country, the arrangement the posting declares
  (remote / hybrid / on-site), department and role, and the full text. Discovery recognises Teamtailor
  career URLs. Tibber seeded switched off as the reference board. Stage 3d
  is complete.

### Schema
- `AtsType.TEAMTAILOR` (migration `20260903235500_add_teamtailor`).

## [1.38.0] — 2026-09-03

### Added
- **Personio** (plan §4.2, stage 3d): the DACH mid-market ATS as a
  per-company source — paste a `*.jobs.personio.de` career URL or a slug
  on Companies, the probe checks the public XML feed, and every position
  arrives with its offices, employment type, seniority, schedule, salary
  when published, and the posting's sections. Discovery recognises Personio
  career URLs. Holidu seeded switched off as the reference board.

### Schema
- `AtsType.PERSONIO` (migration `20260903234500_add_personio`).

## [1.37.0] — 2026-09-03

### Added
- **JobTech JobSearch** (plan §4.2, stage 3c): Arbetsförmedlingen's open API
  over every job ad in Sweden as a source. The token is the search filter
  (the seeded row is the Data/IT field); each tick reads the ads published
  in the last 24 hours, newest first, with the municipality and country
  from the ad, the employer, the deadline and the plain-text description.
  Seeded switched off; "Sources for your searches" offers it to a search
  that names Sweden or the Nordics. Stage 3c is complete.

### Schema
- `AtsType.JOBTECH` (migration `20260903233000_add_jobtech`).

## [1.36.0] — 2026-09-03

### Added
- **Landing.jobs** (plan §4.2, stage 3c): the Portuguese tech board's Atom
  feed as a source — city, country and remote policy from the feed's own
  fields (Full remote → remote, Partial remote → hybrid), the company from
  the author, salary and expiry kept in the description. Seeded switched
  off; "Sources for your searches" offers it to a search that names
  Portugal.

### Schema
- `AtsType.LANDINGJOBS` (migration `20260903230000_add_landingjobs`).

## [1.35.0] — 2026-09-03

### Added
- **The DevITjobs family** (plan §4.2, stage 3c): GermanTechJobs.de,
  DevITjobs.uk and DevITjobs.nl as sources — one fetcher, one row per site
  with the host as its token. Every title carries the company and the
  salary range, the description keeps the Requirements / Responsibilities /
  Technologies lists, and the country comes from the site — the feed names
  no city and no arrangement, so those stay with the classifier. Items
  older than 90 days are skipped (the feeds keep postings for years). The
  feeds are read with ETag / Last-Modified, so an unchanged feed costs one
  304 per tick. Seeded switched off; "Sources for your searches" offers
  each site to a search that names its country.

### Fixed
- The Test button on Settings → AI engine now names the real reason a test
  failed (the HTTP status and message, key-shaped text masked, 200 chars)
  instead of pointing at the container logs — #122 by @boykoandrii.

### Schema
- `AtsType.DEVITJOBS` (migration `20260903220000_add_devitjobs`).

## [1.34.0] — 2026-09-03

### Added
- **solid.jobs** (plan §4.2, stage 3c): the Polish IT board's public offers
  API as a source — three pages of 500 per tick, Polish cities, remote /
  hybrid flags, PLN salary with the employment type and the skill list in
  the description head, the PL country hint on every row. Seeded switched
  off; "Sources for your searches" offers it to a search that names Poland
  or the CEE group.

### Schema
- `AtsType.SOLIDJOBS` (migration `20260903210000_add_solidjobs`).

## [1.33.0] — 2026-09-03

### Added
- **Sources for your searches** (plan §4.3). Companies gets a card listing
  the token-driven feeds the running searches' countries call for, built
  from each search's stack: a search that names Ukraine gets DOU and Djinni
  rows (`category=PHP&remote`, `primary_keyword=Laravel&employment=remote&region=UKR`),
  a search that names Germany or the UK gets the two Arbeitnow rows. Each
  row shows its state — Add (off), Enable, or On — and "Add" probes the feed
  first, so a category the board does not know never becomes a silent empty
  source; rows are added switched off, like a starter pack (ADR 0017).
  Saving a search that has such feeds waiting says so in the flash. The
  aggregators that already follow the searches (Jobicy, Himalayas,
  4dayweek) need no suggestion and get none.

## [1.32.0] — 2026-09-03

### Changed
- **The "UA-friendly remote" starter pack was re-probed and refreshed**
  (stage 3b, plan §4.2). Every board was hit live: Preply 104 postings,
  Solidgate 54, MacPaw 18, Gcore 13, Restream 8, Wirex 6, Skylum 4, Lemon.io
  2, Reface 1, Namecheap 0 (an empty board, kept — the board is real). Sigma
  Software's SmartRecruiters board holds one legacy posting since the company
  moved hiring to its own site, so it leaves the pack (ADR 0017: a legacy
  board is not shipped). Three Ukrainian employers join, each identified by
  the board's own name field: N-iX (Greenhouse `nix`, 121 postings, 53 in
  Ukraine), Ajax Systems (Lever `ajax`, 201, 112 in Ukraine), Genesis
  (Breezy `gen-tech`, 85, 77 in Ukraine). Thirteen entries now.

## [1.31.0] — 2026-09-03

### Added
- **Djinni as a source** (stage 3b, plan §4.2) — the Ukrainian tech job
  marketplace through its RSS. One Company row per filter string, which is
  the row's token: `primary_keyword=PHP&employment=remote&region=UKR`; the
  items carry no location and no employer, so the location is written from
  the filter ("Remote · Ukraine", "Office · Kyiv, Ukraine") and the hints
  with it. Verified live: an unknown `primary_keyword` answers the whole
  bare feed, byte-identical, not an error — so rows whose `<category>` is
  not the requested keyword are dropped and the Companies probe refuses a
  keyword that leaves nothing. Seeded off as "Djinni · PHP, remote,
  Ukraine". robots.txt allows `/jobs/rss/`; Djinni's terms cover posting
  and fees only.

## [1.30.0] — 2026-09-03

### Added
- **DOU.ua as a source** (stage 3b, plan §4.2) — the Ukrainian tech job
  board through its own RSS interface. One Company row per feed query,
  which is the row's token: `category=PHP&remote`, `search=laravel`,
  `city=Львів`, `exp=5plus`; add more on Companies, where the probe refuses
  a query DOU answers with no vacancies (an unknown category is an empty
  channel there, not an error). The title carries everything but the
  description — "Backend Engineer в BetterMe, Київ, за кордоном, віддалено"
  — so a small grammar parser splits role, employer, salary, cities and the
  two markers: the employer and salary go into the description, the cities
  and "віддалено" into the location the stage-1 parser already reads
  (Cyrillic cities included). Seeded off as "DOU · PHP, remote". DOU
  answers the default RSS User-Agent with 403, so the feed is fetched with
  the project's. Terms: fine for a self-hosted personal tool with the
  link-back kept; a hosted or commercial deployment needs DOU's consent.

## [1.29.0] — 2026-09-03

### Added
- **Arbeitnow reads three pages and has a visa-sponsorship feed.** The
  fetcher followed nothing beyond page 1 (175 rows of 650+); it now walks
  the API's own `links.next` for up to three pages, a second apart, on the
  board's host only, and keeps a posting once. A second Company row,
  "Arbeitnow · visa sponsorship" (`atsToken: visa`), reads
  `?visa_sponsorship=true` — a server-side filter the rows themselves do
  not carry, so it is a feed of its own. Both rows stay off until a search
  needs them: the board is German and British office jobs first. Plan §4.2,
  stage 3a.

## [1.28.0] — 2026-09-03

### Added
- **4dayweek follows the searches.** With searches that name places the
  three pages are scoped with `country=` — gazetteer names for countries,
  continents for groups (`Germany,Poland,Europe`) — so a European search
  reads Europe's postings instead of the newest 75 of everything. Verified
  live: the API takes names and continents, not codes, and answers an
  unknown value with its ~141 rows that have no location at all; a scoped
  fetch therefore drops rows without a location — they can never be
  evidence for a place. A search that hunts anywhere still reads the
  newest pages of everything. Plan §4.2, stage 3a.

## [1.27.0] — 2026-09-03

### Added
- **Himalayas follows the searches.** With searches that name countries the
  fetcher calls the search endpoint once per country
  (`country=PL&exclude_worldwide=true`) and once for the worldwide rows,
  merged by guid — country-locked postings for Poland or Germany instead of
  the newest 20 of everything. A search that hunts anywhere, or one that
  names only groups the API cannot express, still reads the browse feed.
  Verified live: the search endpoint answers HTTP 400 to an unknown code
  (never a silent empty feed), caps `limit` at 20, and ignores `offset`,
  so each call is the newest 20 — enough for an hourly tick. Plan §4.2,
  stage 3a.

## [1.26.0] — 2026-09-03

### Added
- **Jobicy follows the searches.** The fetcher used to read one unfiltered
  feed (~200 rows, 58 of them US-only). It now reads one `geo=` feed per
  place the running searches hunt in — a PL + DE + EU search pulls
  `poland`, `germany` and `europe` — and keeps a posting listed in several
  of them once. Jobicy's `geo` has eligibility semantics (`poland` also
  returns Europe / EMEA / Anywhere rows), so nothing a search could want is
  lost, and the US-only rows a European search never wanted stop arriving.
  A search that hunts anywhere, or a place Jobicy has no slug for, falls
  back to the whole feed. Verified live: an unknown slug returns an EMPTY
  feed, which is why only the 13 slugs the API echoed back are ever sent.
- Every fetcher now receives the searches' places (`FetchContext`, the
  union of the active non-blank profiles' countries and regions, built once
  per tick); sources without a geo filter ignore it. Plan §4.2, stage 3a.

## [1.25.0] — 2026-09-03

### Added
- **A search says where it hunts.** The profile's six region pills and two
  booleans are gone; a search now lists `countries` (ISO codes), `regions`
  (groups — 🇪🇺 European Union, Europe, DACH, Nordics, 🌍 Worldwide …, a group
  stored as a group) and the arrangements it accepts (remote / hybrid /
  on-site), next to its on-site cities. One migration maps the old pills —
  `US` and `UK` were countries wearing a region's hat and become countries —
  and drops the old columns, so no running deployment ever sees two models.
  The editor is one control: arrangement pills, a country chip input with
  gazetteer suggestions (type "Poland", "Polska", "Польща", "PL" or "Kraków",
  arrow down, Enter), region pills; without JavaScript the textarea takes any
  spelling the gazetteer knows. ADR 0032.
- **The base filter compares sets.** A posting reaches the classifier when
  its countries or regions overlap the search's, with groups expanded on both
  sides — Poland sits inside an EU search, "Europe" on a posting reaches an EU
  search, Worldwide reaches everyone. A listed on-site city still admits
  outright; an arrangement the search does not accept rejects; a posting that
  names no place goes to the model as before. Hybrid postings no longer reach
  a remote-only search (0 of 65 had ever matched).
- **The classifier prompt no longer assumes a US search.** Its location rules
  speak codes and groups, distinguish EU (law) from Europe (geography),
  require the office's city or country for hybrid and on-site roles, and never
  infer remote eligibility from an office address. The reply gains a shared
  `location` block — the posting's own place, read once like salary — which
  may only narrow what the parser found (an arrangement where the parser had
  none, a country list the description made stricter); rows it changed carry
  `locationSource = ai`, and the backfill leaves them alone.
- **The job page says why.** Next to "location mismatch" a search's verdict
  now reads "open to Poland; this search hunts in United States, Americas" or
  "hybrid role; this search accepts remote" — built from the columns, no AI
  call; nothing is added when only the summary can explain it.
- `GET /countries.json` serves the gazetteer to the browser.

### Changed
- Every profile construction site (`blankProfileInput`, the first-boot
  bootstrap, the wizard, "create a search from a resume") now starts from
  `countries: []`, `regions: []`, `workplace: [REMOTE]` — anywhere, remote.

## [1.24.0] — 2026-09-03

### Added
- **Jobs know where they are.** Every job row now carries `workplace`
  (remote / hybrid / on-site / unknown), `countries` (ISO codes) and
  `regions` (the markers a source names: EU, Europe, EMEA, Worldwide, …),
  next to the location string, which is never rewritten. A pure parser over
  a hand-written gazetteer of 86 countries fills them (`src/location.ts`,
  `src/countries.json`), and fourteen fetchers now pass what their feeds
  already said in structured fields — WWR's `<country>` allow-list and
  `<region>`, Lever's ISO `country`, Workable's `locations[]` (the full list
  of countries a remote post accepts, which nobody had read before),
  Recruitee, Breezy, Ashby, Himalayas, 4dayweek and the arrangement flags of
  the rest. The parser is a hint layer with its traps as tests: "Atlanta,
  Georgia" is the US and "Tbilisi, Georgia" is Georgia, "Portland, OR" is a
  state and "Remote · DE" a country, "US" never fires inside "Russia", "UK"
  is not the EU, and a bare "Remote" is remote with no country — never
  worldwide. Every one of the 250 distinct location strings the database
  held is pinned in `src/location-corpus.json`. ADR 0031 records the
  semantics: for remote rows the countries are where you may live, for
  hybrid and on-site rows where the office is; geography (`EUROPE`) and law
  (`EU`) are different codes.
- **Country, workplace and date facets on `/jobs`.** A "Where" row of chips
  with counts — 🇺🇸 United States 601, 🇨🇦 Canada 135, 🇬🇧 United Kingdom
  52, 🇵🇱 Poland 30 … and "Unknown" for the rows nothing places — OR'ed
  within the row, "More…" for the rest; "Work" chips (Remote / Hybrid /
  On-site / Unknown); "Posted" chips (24h / 7 days / 30 days). Each facet's
  counts respect the other filters, so a chip's number is what clicking it
  shows. The search box now matches the location string too. The job page
  shows the arrangement and one flag chip per country or region under the
  raw location, each a link into the facet.
- **`backfill-locations.js --dry-run`** fills the columns on jobs stored
  before this release from the string alone — no AI call — and prints the
  distribution to check before the real run. On the live database: 1 021 of
  1 038 rows filled in under a second; the checksums of every verdict and of
  every `location` and `description` were identical before and after.

### Changed
- The three arrangement regexes moved from `filter.ts` into `location.ts`
  and learned the non-English spellings ("Homeoffice", "praca zdalna",
  "віддалено", "home based"); the base filter reads them from there and
  keeps its behaviour.
- golangprojects: the flag emoji its titles used to carry are gone, so the
  region is read from the URL slug ("Remote · Europe") instead of a stale
  regex that returned "Remote" for everything.

## [1.23.4] — 2026-09-02

### Fixed
- **Deleting a resume said nothing about the searches hunting with it.** The
  confirm dialog counted the three Cascade children — comparisons, cover
  letters, strength reviews — and stopped there. Two `SetNull` consequences
  stayed invisible: a search linked to the resume silently lost the link and
  went back to guessing by skill overlap (`resume/pick.ts`), and applications
  recorded as sent with it kept their text snapshot but lost the name,
  degrading to "a deleted resume v4". The first is the one that bites — you
  do not find out until job pages start preselecting the wrong resume.
  Both are now counted and named. They get their own clause rather than
  joining the list of deletions, because they are the opposite of deleted:
  saying "and 1 search" would read as though the search went too. Same class
  as the v1.23.0 company fix, where "Delete Reddit and all its 73 jobs?" hid
  six applications and a cover letter; the resume half of that audit left the
  search link behind.

## [1.23.3] — 2026-09-02

### Fixed
- **The board read the whole ledger to date a handful of cards.**
  `/applications` loaded every `job_stage_event` row ever written, grouped
  them all by job, then used only the ones belonging to a card on screen.
  The ledger is append-only by ADR 0024 — it grows with every stage move
  forever — while the board is bounded by how many applications are open, so
  the read got steadily more wasteful with no ceiling. Measured on the live
  database: 26 rows loaded, 24 used, 2 discarded. Same class as the v1.11.0
  fix on this route, which pulled whole `Job` rows; that query at least had a
  `where`, this one had none. The query is now scoped to the jobs the board
  draws, and an empty board skips it entirely. The grouping moved out of the
  route into `stage-time.ts:groupEventsByJob`, where it is unit-tested.

## [1.23.2] — 2026-09-02

### Fixed
- **Three cards had a button on a line of its own.** A layout pass over every
  dashboard page, prompted by "on some pages the buttons are scattered — one
  sits higher than another".
  - `/jobs/:id` — v1.11.0 wrapped the "Applied with" select and **Mark
    applied** in one form so the select's value would post with the button,
    which pushed the primary action onto its own line above Save / Dismiss /
    Re-classify. The two want opposite layouts: a full-width labelled field
    and a button on the shared row. They are now bound by the HTML `form`
    attribute instead of by nesting, so the select still posts and the button
    sits with its peers.
  - `/discovery` — `ToggleRow`'s action column was `flex-col`, so a card with
    an `extra` action drew **Run now** underneath **Disable**. It is a row now,
    wrapping only when the card is genuinely too narrow; the fix is in the
    shared primitive, so every future `extra` inherits it.
  - `/settings` → Notifications — its two toggles were bare siblings inside the
    card, touching, so the second row's button looked like it belonged to the
    first. Same `space-y-5` wrapper and rule the General tab already used.

## [1.23.1] — 2026-09-02

### Fixed
- **The cross-origin guard reads the two headers it was given in v1.20.0.**
  Merging the two CSRF implementations (#93 and #87) taught the check to
  consult `Referer` when a browser sends no `Origin`, and `X-Forwarded-Host`
  when a reverse proxy rewrites `Host` — but the middleware went on passing
  three headers to it, so the running dashboard kept the old behaviour: a
  foreign `Referer` was not refused, and a dashboard behind a proxy refused
  its own forms. Every unit test stayed green because they call the pure
  function directly. The wiring now lives in `src/web/origin-guard.ts` with
  tests that drive a real Hono app — the shape PR #87 used, and the one that
  catches this class of bug. Caught by the live smoke run, not by the suite.

## [1.23.0] — 2026-09-02

The pre-public audit: six checks nobody had run against this project as an
outsider would (TASKS §14). Two of them found something.

### Security
- **The database is no longer published to your whole network.** `docker
  compose up` published Postgres on **every interface** with the password that
  sits in the compose file, so anyone on the same Wi-Fi could read the entire
  database — jobs, resumes, cover letters, applications, and any AI key pasted
  into the dashboard (`AppSettings.aiKeys`, stored in plaintext by design).
  Demonstrated from another address before the fix. It is now published on
  **`127.0.0.1:5433`**: loopback only, and on 5433 so it cannot be shadowed by
  a Postgres already running on 5432. The app never used this port — it reaches
  Postgres over the compose network — so only host tools are affected: use
  `localhost:5433`.

### Added
- **Backup and restore, documented and verified.** A project whose whole pitch
  is "your data in your own Postgres" had no instructions for keeping it. The
  README now carries both commands; the dump they produce was checked (8.7 MB,
  all 16 tables) and reloaded into an empty database with no errors.

### Fixed
- **The setup wizard no longer runs a scoring pass with no AI connected.** Step
  1 can be skipped, and step 4 would then spend a minute failing ten calls one
  by one before admitting nothing could be scored. It now says so before
  starting and sends you back to step 1 — the jobs already found stay put.
- **Deleting a company says what goes with it.** The confirm counted the jobs
  only; on real data "Delete "Reddit" and all its 73 jobs?" was hiding six
  tracked applications and a cover letter. It names them now, the way the
  resume delete has since v1.19.0.

## [1.22.0] — 2026-09-02

### Added
- **The review's questions can be answered, and the answer changes the next
  one** ([ADR 0030](docs/adr/0030-resume-strength-review.md) phase 3, TASKS
  §12). The strength review refuses to invent a number: where a stronger line
  needs one your resume doesn't carry, it asks instead. That was a dead end —
  nothing could be answered, so the next run asked again. Now each question
  has a box: the answer is stored on the resume and read into the next review,
  which writes the figure into the rewritten line and stops asking. Measured
  on a real resume: 4 questions, 2 answered, re-run asked **2** and both
  figures appeared verbatim in the rewrites.
- **What moved since the last review.** A second run of the same resume now
  says whether the edits worked — the score before and after, and every
  dimension whose grade changed. When the two runs used different rubric
  versions it says so instead of subtracting them, because that difference is
  not a measurement.
- **Facts can be added and flipped from `/resumes`.** The "do you have this?"
  answers fed every future comparison but could only be created by a
  comparison that happened to ask. Add a skill nothing asked about, or turn a
  wrong answer around, from the resumes page. No AI call either way.
- **Rename a resume.** The name is what every picker, flash and "applied with"
  line says, and it used to be whatever the uploaded file was called.
- **Comparisons group per job.** Re-checking one posting used to produce
  unrelated rows; they now read as one progression — *5 runs · 62 → 70 → 64 →
  66 → 68*, each score still its own link, with the change since the previous
  run beside the latest score.

### Changed
- `REVIEW_PROMPT_VERSION` 1 → 2: the rubric now receives the candidate's
  supplied metrics and is told to write them in rather than ask again — and
  told, just as explicitly, that a metric the document does not carry is a
  reason for advice, never for a better grade. The resume is graded as
  written.

### Schema
- `resume.answers` (JSONB, default `[]`) — hand-written migration
  `20260902200000_add_resume_answers`. On the resume rather than the review
  row: an answer is a fact about the document and has to outlive the run that
  asked for it.

## [1.21.0] — 2026-09-02

### Added
- **"Applied with" on the Application tracking card** (#75). Until now only
  the "Mark applied" button ever recorded which resume went out; dragging a
  card into Applied on the board, or filling in the application form, left it
  blank with no way to say afterwards. In the live database that was **eight
  applications and not one recorded resume**. The form now carries the
  question, and a job that is in the funnel with no answer says so — with the
  resume the page would have guessed, named in the hint rather than
  preselected. Moving a card cannot ask, and the app does not answer for you.
- **"The text that went out"** (#74). The resume snapshot stored with every
  application has been written since v1.11.0 and read by nothing. It is now a
  disclosure on the job page: the words as they were on the day, which is the
  point of storing them — a resume version is edited in place, so the name and
  the number stop being an answer the moment you upload a new one.

### Fixed
- **A profile saved against a deleted resume or Telegram target says so**
  (#73). Both ids come from dropdowns rendered when the page loaded; deleting
  either row in another tab used to answer the save with a raw foreign-key
  error — a 500 page with a constraint name on it, and the whole edit lost.
  The save now checks first and flashes "That resume no longer exists —
  reload the page and pick another one. Nothing was saved."

## [1.20.0] — 2026-09-02

### Fixed
- **Two tabs no longer lose an AI key** (#72). Saving a key read the whole
  `aiKeys` map, merged one engine in and wrote the map back, so two saves in
  flight kept only the later snapshot — the other engine's key was gone. The
  merge is now a single `jsonb_set` statement: the database merges, and there
  is no window to lose. Measured on a scratch database: two saves in flight,
  before → one key stored, after → both.
- **The eight-search ceiling is no longer advisory** (#70). Counting the
  running searches and then flipping the row is check-then-act: two
  activations both read seven, both passed, nine searches ran. The count and
  the write now happen under one row lock. Measured: seven running, two
  activations in flight, before → 9 running, after → 8.
- **A second submit joins the run in flight instead of starting a second one**
  (#76). `SUBMIT_ONCE` disables buttons in the browser, which cannot help a
  second tab, a re-POSTed reload or a client with scripting off. Every POST
  that starts an AI run — compare, full analysis, suggestions, cover letter,
  scan, strength review, the wizard's steps, `/target` and `/letter` — now
  names the work it is doing, and a request for work already running is
  redirected to it. Repeating a *finished* run still starts a fresh one.
- **A confirmed fact no longer drops your keyword overrides out of the score.**
  The `/facts` re-score skipped `effectiveKeywords`, so answering a question on
  a comparison you had re-levelled recomputed the number as if you never had.
  Both re-score paths now share one locked function.

### Security
- **Cross-origin writes are refused** (#69). A page open in the same browser
  could POST to the dashboard on `localhost:4747` — change a setting, delete a
  resume, overwrite an AI key — because a form POST needs no permission from
  the target site. Every state-changing request is now checked against the
  headers a browser attaches itself (`Origin`, `Sec-Fetch-Site`). No tokens, no
  session store, and `curl` still works: a request with no browser origin
  headers at all is not the attack this stops. `Sec-Fetch-Site` decides
  whenever the browser sends it — a dashboard rendered in a sandboxed frame
  posts to itself with an opaque `Origin` *and* `Sec-Fetch-Site: same-origin`
  (measured, not assumed), and no cross-site page can produce that pair.

## [1.19.0] — 2026-09-02

### Added
- **"Is this resume strong?"** ([docs/resumes-plan.md](docs/resumes-plan.md)
  §B, [ADR 0030](docs/adr/0030-resume-strength-review.md)). A new card on
  `/resumes/:id` answers the question the app could not: not "does this fit
  that job", but does this document read like a strong professional at the
  level it claims. **Six dimensions** — first impression, impact & outcomes,
  seniority signal, clarity & structure, skill evidence, wording & polish —
  each graded with quotes from your own text.
- **The model grades; the code scores.** The prompt is forbidden to output a
  number: weights (impact 30, first impression 20, seniority 20, clarity 15,
  evidence 10, polish 5) and two hard caps live in `review-score.ts`. A resume
  whose bullets list duties instead of outcomes cannot pass **55** however
  polished the rest is, and two weak dimensions cap it at **45**. Live on a
  real resume the caps turned a raw 70 into a 45 — the weights alone would
  have called it above average.
- **Advice that asks instead of inventing.** Every item points at a verbatim
  line and either rewrites it using facts already in your resume, or asks you
  for the number a stronger line would need ("which services were consolidated
  for the six-figure saving?"). Across 23 items in the first live runs, not one
  invented a fact — several rewrites *removed* unsupportable percentages.
- **Strength column on `/resumes`**, with a badge when a review has aged behind
  the resume it read, and a "Keep these" list so you don't edit away what works.
- Progress is the usual run page: the rubric is walked step by step, no spinner.

### Changed
- The review never runs on its own — not on upload, not on a version save. One
  button, one AI call, about a minute; the card explains what it checks before
  you press it.
- Once a review has read the current version, the scan's "Issues to fix" list
  folds into a disclosure behind it. One advice surface, never two.

## [1.18.0] — 2026-09-02

### Added
- **Rebuild keywords** ([docs/target-plan.md](docs/target-plan.md) §4 F7,
  TASKS §13). Every comparison of the same posting has been reusing the first
  run's keyword list on purpose, so scores stay comparable between resume
  versions — but a word the model missed on run 1 stayed missed on every run
  after it. The keyword table now carries a way out: one run with the stored
  list withheld, so the model reads the terms out of the posting again.
  Measured on a real posting: the carried list had been repeating the same 26
  terms through five analyses; the rebuild found 30, including **BullMQ** and
  **GCP PubSub** — both named in the job description, neither ever listed.
- **A prompt bump no longer inherits the old prompt's keywords.** When the
  analysis prompt changes, the stored list was written under rules the new one
  does not follow, so it is not offered to the model at all.
- **A rebuilt analysis says the score is not comparable** instead of showing a
  delta against the previous one: the two count different terms, and a −3 that
  means "different list" reads exactly like a −3 that means "worse resume".

### Changed
- A rebuild skips the reuse memo. Without that it would answer with the very
  analysis whose keyword list the user asked to replace.
- **Your keyword edits survive a rebuild.** Re-levelled, ignored and
  hand-added terms are re-applied to whatever the fresh run returns — a
  rebuild resets the model's guess, never your decision.
- `resume: matched` logs which frame the run used (`carried`, `first-run`,
  `rebuild`, `prompt-bump`) next to the keyword counts.

### Closed without building
- `match-split-frame` (a cached per-job keyword frame + a statuses-only call),
  the one block of the compare-speed plan left open. The gate was "only if the
  measurements demand it": the quick check now runs at a p50 of 15 s on the
  bench fixtures and 40-42 s on one of the longest postings we store, against
  a 30-40 s target — so the block is closed by the numbers rather than built.
  Details in TASKS §13.

## [1.17.0] — 2026-09-02

### Added
- **Your say over every keyword** ([docs/target-plan.md](docs/target-plan.md)
  §5, TASKS §13 block 5). Each row of the keyword table now carries three
  edits: **re-level** what the posting demands (must ↔ preferred ↔ nice ↔
  context), **ignore** a term as noise, or **add** a word the model missed.
  All three are arithmetic over the stored analysis — the score is recomputed
  by `score.ts` on the spot, the same free path a confirmed ask_user fact
  takes. No AI call is made, and the flash says so: *"system scalability" is
  now nice — score 66 → 67, no AI call.*
- An added term's status is **read from your resume, never guessed**: written
  in → matched; not written → a confirm question the existing ask_user flow
  answers. A term the posting does not literally contain is flagged *not in
  posting*, exactly as a paraphrase from the model would be.
- **Overrides stick to the posting.** They ride in the comparison's own
  `keywords` JSON, go into the next run's keyword frame, and are re-applied to
  the fresh reply afterwards — including a hand-added term the model did not
  repeat, whose status is re-read against the current resume text. An override
  is kept even when the model comes to agree, because the point of it is that
  the level stops depending on the next reply.
- **Visual weight in the panes.** A missing must-have no longer looks like a
  missing nice-to-have: every mark and chip is graded `kw-w0` (context) to
  `kw-w4` (a primary-stack must) from one shared function, with the legend
  showing the three tiers.
- **Frequency as a tiebreaker.** Equal-weight keywords are ordered by how
  often the posting repeats the term, the count shows in the keyword table
  (*×4*) and in every pane tooltip (*×4 in the posting*). It costs nothing:
  the panes already had every occurrence in hand.

### Changed
- The keyword table orders through the matcher — hardest requirement first,
  then frequency, then priority — instead of sorting by requirement alone, and
  gained a third group for ignored rows so they can be brought back.
- `PROMPT_VERSION` is untouched: this is post-processing, not a prompt change.

## [1.16.0] — 2026-09-02

### Added
- **A comparison is a quick check by default; the edit suggestions are a
  second call** ([docs/target-plan.md](docs/target-plan.md) §3.2 items 6-7,
  TASKS §13 block 4, [ADR 0029](docs/adr/0029-quick-check-and-lazy-suggestions.md)).
  **Compare** on `/jobs/:id`, **Re-check with AI** on the targeted view and
  the **Compare** button on `/target` now run one shorter call that returns
  exactly what the score is computed from — every keyword with its
  requirement level, primary flag and status, the alignment grades, the
  hard-requirement gates and the red flags. The number is identical to
  before, because `score.ts` never read the suggestions.
- **Get suggestions** fills a quick check in afterwards: a second call that
  reads the stored verdicts and writes only what to change, what to remove,
  what already sells you and the soft concerns. The verdicts and the score
  are not re-judged, so a filled-in analysis equals one that was full from
  the start, and asking for a full analysis of text already quick-checked
  costs the suggestions call alone.
- **Full analysis** stays one click away everywhere the quick check runs, and
  is what the cover-letter flow asks for (a letter leads with strengths).
- **The tiered keyword budget** ([docs/target-plan.md](docs/target-plan.md)
  §4 F1): every `must` and `preferred` term the posting names is always
  listed; the soft cap of ~25 keywords now applies only to `nice` and
  `context` terms, so an important word can no longer fall off the end of a
  long list.

### Changed
- `PROMPT_VERSION` 5 → 6, once, for all three prompt changes. Analyses stored
  under v5 are no longer reused for a new run, which is what a bump means.
- The two match prompts are assembled from the same rule constants, so the
  quick check carries the primary-stack gate, the verbatim rule, the
  consistency rule and the red-flag rules verbatim — the guard tests assert
  every one of them against **both** variants.
- Progress pages name what is running: *Quick AI check*, *Full AI analysis*,
  *Edit suggestions*, each with its measured duration.

### Measured (2026-09-02, `claude_code` CLI engine, 5 gold fixtures per run)
- Opus, quick check vs full report, prompt v6: **p50 15 s vs 24 s**, 77 s vs
  116 s for the whole suite, **2591 vs 4373 reply characters**; all checks
  green in both, keyword statuses agreeing 98%.
- Sonnet was measured for the resume role and **is not the faster option
  here**: p50 52 s full and 26 s quick against Opus's 24 s and 15 s, at 95%
  and 93% status agreement and 77% term overlap (a less stable keyword frame
  than Opus's 88%). The default `CLAUDE_MODEL_RESUME` stays `claude-opus-5`;
  the per-engine "Resume model" select on `/settings` remains the speed dial.
- Live on job #1393 (Docker, Opus, a 4 988-character posting): the quick
  check took **40 s and scored 66 — the same number the v5 full analysis
  gave**; "Get suggestions" then took 35 s and wrote 10 edits and 8 removals
  onto the same row. A full analysis of the same pair took 77 s.
- All four bench runs (both models × both modes) passed every gold check.

### Notes
- No schema change: the mode marker rides inside the `breakdown` JSON next to
  the prompt version, and rows written before it read as full analyses,
  which is what they are.

## [1.15.0] — 2026-09-02

### Added
- **Instant check: a re-uploaded resume is scored in the editor before the
  AI is asked** ([docs/target-plan.md](docs/target-plan.md) §3.2 item 5,
  TASKS §13 block 3). "Re-upload resume" on the targeted view now defaults
  to **Upload & check**: the file (.pdf / .docx / .md / .txt) is parsed and
  opens in the editor as an unsaved draft over the analysis the page showed
  — live estimate, missing-keyword chips and highlights, the same formula as
  the AI score. Nothing is written: no new version, no scan, no match row;
  the draft lives in the browser tab (a reload keeps it) until **Re-analyze
  with AI** makes it official or **Save as vN** keeps the text. The page
  says what the number is — *"Estimate vs the analysis from 40m ago"*: the
  text confirms what is present, while add / confirm / can't-claim keep the
  AI's verdict on the analysed version until the re-analysis. **Upload as
  vN & analyze with AI** keeps the previous behaviour (new version with the
  file, AI match, scan in the background) one click away. `/target` answers
  the same way when the pasted posting dedupes to a job this resume was
  analysed against before and its text changed since.
- Measured on the stored originals: parsing takes 0–2 ms (.docx) and
  10–15 ms (.pdf, 64 ms cold); a re-upload lands on the rendered page in
  ~30 ms server-side (POST + redirect + GET) and ~155 ms to `load` in the
  browser, against the 95 s of the full run measured in 1.13.0. The
  `resume: upload parsed` and `resume: instant check` log lines carry the
  `ms`.

### Notes
- Known cost, stated on the page: after an instant check **Save as vN**
  stores the text as a text version — the uploaded file itself does not
  become the version's original. *Upload as vN & analyze with AI* (or
  "Upload a new version" on `/resumes/:id`) is the path when the file must
  be kept.
- The draft waits between the POST and the page in web-process memory
  (`src/web/draft-stash.ts`: 10-minute TTL, taken once) and is copied into
  `localStorage` on first render. No schema change, no migration.

## [1.14.0] — 2026-09-02

### Changed
- **Keyword highlights tolerate spellings, plurals and separators**
  ([docs/target-plan.md](docs/target-plan.md) §4 F3–F6, TASKS §13 block 2).
  The matcher behind the `/target` panes and the live score now treats the
  separators inside a multi-word term as interchangeable and optional
  (`CI/CD` = `CI / CD` = `CI-CD`, `Node.js` = `NodeJS`, `front-end` =
  `front end` = `frontend`), matches the regular plural of a term and the
  singular of a plural one (`microservice(s)`, `API(s)`, `query` /
  `queries`, `patch(es)`), and unions a curated table of 170 spelling groups
  (`node.js` / `node` / `nodejs`, `go` / `golang`, `postgresql` / `postgres` /
  `pgsql`, `k8s` / `kubernetes`, `ci/cd` / `continuous integration` …) into
  every keyword — when an analysis is stored and again when one is loaded, so
  earlier analyses highlight the same way. The whole-token guards stay: `C`
  is not `C++`, `Java` is not `JavaScript`, a Capitalised name that ends in
  s (`Rails`, `Windows`, `Kubernetes`) is not a plural, and there is no
  stemming beyond plurals.
- **Every keyword is anchored to the posting when the analysis is stored.**
  A term the model paraphrased is rewritten to the longest verbatim phrase of
  itself the posting contains, spelled as the posting spells it; one the
  posting contains in no recognisable form is flagged — the keyword table
  shows *not in posting*, and the `resume: matched` log line counts
  `anchored` / `unanchored`, the regression metric for future prompt
  changes. No prompt change and no schema change (an optional field in the
  keyword JSON).
- The job-description pane says that benefits, perks and legal boilerplate
  are never keywords, so an unmarked paragraph there stops reading as a miss.

### Added
- `npm run keywords:audit` — read-only: lists every stored keyword row that
  highlights nowhere, as stored and with the alias table. Measured on the 15
  stored comparisons: rows with no highlight in the posting 54 → 53 of 305,
  `present` rows with no highlight in the resume 36 → 35 of 181 — what
  remains are paraphrases from analyses older than the verbatim rule.

## [1.13.0] — 2026-09-02

### Changed
- **A compare waits for one AI call, not three**
  ([docs/target-plan.md](docs/target-plan.md) §3.1, TASKS §13 block 1). On
  `/target` the posting's fit score is now classified in the background while
  the resume-model call runs — the comparison never read it, and that leg
  alone measured 49–55 s on the `claude_code` engine. On "Upload vN &
  re-analyze" the new version's scan runs the same way instead of ahead of
  the match (26–33 s measured). Known cost of the second one: until the
  background scan lands, the resume's headline / skills / core stack still
  describe the previous version — `scannedAt: null` marks it, and nothing but
  `/resumes` and other resumes' "elsewhere" hints read those fields.
- **Repeating a comparison is free.** A double submit, a back button, a
  re-paste or a re-upload whose text did not change no longer buys a second
  resume-model call: when the latest stored analysis for that resume and
  posting judged the identical text under the same prompt version, the page
  shows it with *"Unchanged since the last analysis (3m ago)"* and a
  **Re-run anyway** button for the rare time a fresh call is wanted. Plain
  string equality — a one-character edit is a new analysis
  (`src/resume/match-reuse.ts`, unit-tested).
- **The progress page tells the truth about time.** Every step shows the
  seconds it took once done and a live count while it runs, next to a total
  that ticks every second. Step copy now quotes measured durations instead of
  "about a minute": the match is 1½–2 minutes on Opus (83–109 s measured), a
  scan about half a minute, posting-fact detection 10–40 s on a CLI engine.
  The same numbers replaced the promises on the job page, the targeted
  editor, `/welcome` and Settings.
- Per-step timing logs: `resume: scanned`, `posting-extract: done`,
  `classify-existing: scored` and `run: step finished` all carry `ms`, so the
  next optimisation round starts from numbers, not estimates.

### Notes
- `ResumeMatch` has no prompt-version column and this release changes no
  schema, so the version rides inside the `breakdown` JSON (written by
  `createMatch` / `updateMatchScoring`). Rows from before this release carry
  no marker and are never reused. No migration.

## [1.12.0] — 2026-09-02

### Fixed
- **No resume write freezes the browser any more**
  ([docs/resumes-plan.md](docs/resumes-plan.md) Part A, TASKS §12 block 1).
  Upload, "Upload a new version", Re-scan and the targeted editor's
  "Save as vN" each awaited a ~60 s call to the resume model inline, on a form
  whose submit button stayed live — a second click created a **duplicate
  resume and a second AI call**. All four now run through the same run
  registry that `/target` and Compare already used: the POST returns at once
  and you watch a progress page you are free to close. The forms that start
  one also disable themselves on the first press.
- **The `/resumes` rows are usable on a phone.** The hub forced a 52 rem
  minimum width inside a horizontal scroller, which put Skills, Scanned and
  *both* action buttons off-screen at 375 px. Delete has left the hub for the
  detail page — a destructive action should not be one click from a list —
  and the remaining columns now drop out by width instead: Name, Matches and
  Set default survive everywhere, Scanned returns at 640 px, Core stack at
  1024, Headline at 1280.
- **The delete confirm no longer understates what it destroys.** Deleting a
  resume cascades its cover letters — including text the user wrote by hand —
  and the dialog said only "and its comparisons". It now counts both:
  *"Delete "Senior Backend" and 14 comparisons and 17 cover letters?"*

### Added
- A **Matches** column on `/resumes`: the best score a resume has ever
  reached plus how many comparisons it has been through, so the hub answers
  "is this one working?" and not just "does this one exist?".
- The Skills column became **Core stack** and reads `Resume.primarySkills`.
  The scanned `skills` list runs to ~85 entries that open the same way on
  every resume ("php, go, javascript…"); the 2-5 core technologies actually
  tell two resumes apart. A version badge joins the name.

### Changed
- `Table` accepts `thClasses` — the only place a responsive `hidden
  sm:table-cell` can live, since a class on the header label still leaves the
  cell occupying its column. Table gutters tighten below 640 px.

## [1.11.0] — 2026-09-02

### Added
- **The resume an application went out with is recorded**
  ([docs/onboarding-plan.md §4](docs/onboarding-plan.md) stage C, TASKS §11
  block 7 — the block that closes §11). "Mark applied" on `/jobs/:id` now
  carries a resume select, and the job page and the stale-applications digest
  answer "applied with Senior Backend v3" instead of leaving you to remember.
- The select starts on the resume this posting was actually compared with; with
  no comparison it falls back to the page's own preselect — since 1.10.0 that
  is the resume of the search that scored the posting **best**, not merely the
  primary (ADR 0028), so stage 5's behaviour is unchanged where it applied.
- New `Job.appliedResumeId` (FK, `SET NULL`), `appliedResumeVersion` and
  `appliedResumeText`. The text snapshot is not redundant with the id:
  "Upload a new version" replaces the bytes of the *same* `Resume` row, so an
  id alone would name v3 and hand back v5's words — the pattern
  `ResumeMatch.resumeText` has used since phase 9. Applications recorded before
  this release stay NULL and render exactly as they did.

### Changed
- `/applications` reads six columns instead of whole `Job` rows. The board
  query is unbounded in the number of applications, and every card it draws is
  an applied posting — the one place where a per-application text column would
  land on 100% of the rows.
- Documentation caught up with 1.8.0–1.10.0, three releases behind:
  - **Quick start no longer demands an API key in `.env`.** Since 1.8.0
    ([ADR 0027](docs/adr/0027-ai-keys-in-the-database.md)) the key is pasted
    into `/welcome` step 1 or Settings → AI engine and lives in Postgres;
    `.env` is documented as the fallback it became.
  - The Anthropic API row no longer claims "prompt-cached", and the cost
    section no longer bills a caching discount that never applied: Haiku 4.5
    caches nothing under a 4,096-token prefix and our classifier prompt is
    1,216 (`cache_creation_input_tokens` was 0 on every measured call). The
    per-posting figure is restated as ~$0.003 from token counts.
  - "22 sources" now says what it counts — 22 fetchable `AtsType` branches in
    `fetchOne`, i.e. kinds of board, not the 73 companies this install tracks.
    The aggregator list had been missing 4 Day Week.
  - The feature table learns parallel searches, starter packs, the first-run
    wizard and the prompt fence; the page table gains `/welcome` and `/letter`
    and stops advertising a fixed funnel that
    [ADR 0025](docs/adr/0025-custom-work-stages.md) made configurable.
  - `docs/screenshots/overview.png` and `jobs.png` retaken: the stored pair
    predated "Fetch now" and the Target → Compare rename.
  - SPEC's pipeline diagram still described one profile and one verdict;
    ARCHITECTURE's ER diagram was missing `Profile.active`, `Profile.resumeId`,
    `AppSettings.aiKeys` and `setupCompletedAt`.

## [1.10.0] — 2026-09-02

### Added
- **Several searches run at once**
  ([docs/onboarding-plan.md §4](docs/onboarding-plan.md) stage B, TASKS §11
  block 6, [ADR 0028](docs/adr/0028-parallel-searches-one-call-per-posting.md),
  which supersedes 0004). A backend search and a QA search now hunt in
  parallel: each new posting is scored against every running search in **one**
  AI call, and each search keeps its own threshold, its own priority rules and
  its own Telegram chat. New `Profile.active` is the switch;
  `AppSettings.activeProfileId` stays as the **primary** — the search that
  supplies defaults everywhere, and the one that always runs. Up to 8 at once.
- New `JobScore` table, one row per (posting, search), holding that search's
  fit, location verdict, tech tags, flags and summary. `Job.fitScore` and its
  neighbours keep the **best-of**, so every list, badge, sort and digest reads
  exactly as before.
- **Search chips on `/jobs`** narrow the list to one search, and the Fit column
  then shows that search's own score rather than the best-of. The Fit ≥ filter
  follows the same score.
- **"By search" on `/jobs/:id`** — every search's fit, verdict and location
  call, best first. The top row is the search the page speaks for: the resume
  the Compare and Cover letter cards preselect now follows the search that
  scored the posting best, not merely the primary.
- **A "Searches" list on `/settings` → Profile** replaces the single Activate
  control: Run / Pause / Make primary / Delete per row, with the primary
  protected from being paused or deleted.
- Alerts name the winning search in the header and carry a `🎯` line with every
  search's score ("Backend 87 · QA 41"); they are delivered to the winning
  search's `Profile.telegramTargetId`, which already existed and was unused.
  The daily digest still broadcasts, with each entry naming its search.

### Changed
- A posting is admitted when **any** running search's base filter admits it,
  and dismissed only when **every** search rejects it. `passesBaseFilter` stays
  pure and single-search; `passesAnyBaseFilter` is the union wrapper.
- Issue #50's blank-search guard is now per search: an empty search is dropped
  from the roster for the tick instead of silencing the ones beside it, and its
  fit ≤ 50 cap is applied to its own verdict only.
- The two-stage classifier's stage-1 gate was rewritten. Measured on 24 stored
  postings, the shipped wording admitted 2 and kept only **1 of the 8** the full
  classifier had scored 75-90: the gate sees just the first 800 characters and
  read "the stack is not mentioned" as "the stack mismatches". Saying that
  explicitly, plus "unambiguous mismatch for every search", takes the same
  single search to 17 of 24 and 5 of 8. The mode has never been on in
  production (`classifierMode` defaults to `single`), so nothing was lost —
  but it was unusable and is now usable.
- `CLASSIFIER_PROMPT_VERSION` → 3; `max_tokens` scales with the number of
  searches (400 + 180·N), measured with headroom through 12.

### Fixed
- CLAUDE.md gotcha 3 claimed the two-stage classifier's economics rest on the
  prompt cache. They do not, and never did: `cache_creation_input_tokens` is
  **0 on every call**, because Haiku 4.5 needs a 4096-token prefix and the
  classifier prompt is 1216. The saving is the short prompt and tiny
  `max_tokens`. The note now says so, with the per-model floor.

### Migration
- `20260902140000_add_job_score_and_active_profiles` adds the column, the table
  and its indexes, marks the primary as running, and **backfills every already
  scored posting into `JobScore`** against the profile those scores came from.
  Verified on the live database: 986 rows moved, 0 orphans, 0 mismatches.

## [1.9.0] — 2026-09-02

### Added
- **A search can name the resume it hunts with**
  ([docs/onboarding-plan.md §4](docs/onboarding-plan.md) stage A, TASKS §11
  block 5). New `Profile.resumeId`: "this search is for jobs I'd apply to
  with *this* CV". A job page found by that search preselects its resume in
  the Resume match and Cover letter cards instead of guessing from
  skill-tag overlap; profiles without a link behave exactly as before.
  Editable on `/settings` → Profile → "Resume for this search", where
  clearing it returns to the overlap pick.
- **"Create a search from this resume"** on `/resumes/:id`. The card shows
  the whole profile a click would produce — name from the resume's
  headline, primary stack → required, other skills → nice-to-have, plus
  role types and seniority — and one press saves it, linked to that resume
  ([ADR 0015](docs/adr/0015-profile-draft-from-resume-scan.md) unchanged:
  the draft is rendered, never written before the press). The card also
  names the searches already hunting with that resume.
- The same action in the wizard's step 3, once the first search exists:
  "Another resume for a different kind of role?" takes one file (or one
  already-uploaded resume), reads it on the usual progress page, and offers
  the second search as a draft.

### Changed
- New profiles created from a resume are **born inactive**, like every
  other new profile — creating a search never switches the one the pipeline
  is scoring against. The flash and the card copy say where to activate it.
- "Fill from a resume" now proposes that resume as the search's resume
  alongside the fields it fills, in the same unsaved draft.
- Deleting a resume clears the link (`ON DELETE SET NULL`) rather than
  deleting the search or refusing the delete: a profile owns regions,
  thresholds, priority rules and alert routing that no resume can speak
  for. The preselect falls back to skill overlap.
- One read of `AppSettings.aiKeys` per `/settings` render instead of two
  (the page and the engine probe now share it).
- `docs/TASKS.md` §11–§13 headers state what actually shipped; §11 had
  claimed nothing was implemented while four of its seven stages were live.

## [1.8.0] — 2026-09-02

### Added
- **Paste an AI key instead of editing `.env`** ([ADR 0027](docs/adr/0027-ai-keys-in-the-database.md),
  [docs/onboarding-plan.md §2](docs/onboarding-plan.md) Phase B, TASKS §11
  block 4). Every engine card on `/settings` → AI engine now has a key row,
  and so does each card in step 1 of `/welcome` — paste, Save, Test, done.
  The key lands in the new `AppSettings.aiKeys` column, applies to the
  dashboard immediately and to the worker on its next tick, and wins over
  the matching `.env` variable. Four engines take one: Anthropic API
  (`ANTHROPIC_API_KEY`), Claude Code CLI (`CLAUDE_CODE_OAUTH_TOKEN`),
  Gemini CLI (`GEMINI_API_KEY`) and the OpenAI-compatible API
  (`OPENAI_API_KEY`); Codex CLI stays `codex login`.
- The stored key is never handed back: the field always renders empty, the
  card shows only the last four characters and where the credential comes
  from ("saved here" / "from .env"), and **Remove** deletes it.

### Changed
- `.env` keeps working exactly as before and stays the documented choice
  for anyone who would rather keep secrets out of the database — the ADR is
  explicit that a database dump contains a pasted key.
- The `claude_code` badge is honest about a logged-out CLI. `claude
  --version` answers whether or not anyone is signed in, so the engine used
  to read "available" on `/settings` and in the wizard and then fail on its
  first real call. The probe now reads the CLI's own auth signals (token in
  the environment, `.credentials.json`, the recorded account) without
  spending a call or slowing the page down.
- Provider constructors no longer hold credentials — the key arrives per
  call on `AiRequest`, so whether an engine can run at all is decided in one
  place (`ai-engine.ts:providerUnusable`) instead of two.

## [1.7.0] — 2026-09-01

### Added
- **First-run wizard at `/welcome`** ([docs/onboarding-plan.md §2](docs/onboarding-plan.md),
  TASKS §11 block 3). A fresh install lands there from `/` until setup is
  finished or skipped; every other page keeps working. Four steps, each
  derived from data and auto-completing when its result already exists:
  1. **Connect an AI** — detected engines are listed (zero clicks for a
     `.env` key); with nothing detected, plain-language cards say which
     line to add per engine. "Send a test message" runs the same tiny live
     call as the Settings Test button.
  2. **Test the search** — "Run a test search" is Fetch now with the
     verdict routed back into setup: no AI, no profile needed, jobs stored
     unscored.
  3. **Tell us about you** — upload a resume (or pick one), the scan runs
     on a progress page and comes back as a one-paragraph summary ("Looks
     like you're a Senior Backend Engineer — main tools PHP, Laravel…");
     "Yes, that's me" applies the draft to the active profile, "Let me
     adjust" opens it in the profile editor. No file handy: three
     questions (technologies, role words, seniority) write the same fields.
  4. **See your first matches** — "Score the best matches" scores the ten
     stored jobs that mention the most of your profile (`runScoreUnscored`
     over the pure ranking in `jobs/score-pick.ts`: a title hit counts
     double a description hit, required stack outranks role words);
     everything that mentions none of your words is set aside without
     spending anything. Result: "8 of 10 look like a match" with the top
     five, "Score 10 more" while jobs are waiting, then "Start the hourly
     watch" (turns fetching on, marks setup done). Ten because a CLI
     engine needs 15-30 s per job — 100 would have meant a 24-minute wait
     on the first screen. Telegram is a quiet link.
- "Skip setup" marks setup done; the Overview shows a "Finish setup →"
  chip while any step is still open, flag or no flag.
- Progress pages carry their own heading and subtitle and can show
  data-driven progress ("12 of 100 jobs scored").

### Changed
- The engine connectivity test moved into `src/web/ai-test.ts`, shared by
  Settings and the wizard; the file-input style is one constant in `ui.tsx`.

### Schema
- `AppSettings.setupCompletedAt` (nullable) — migration
  `20260901220000_add_setup_completed_at` backfills existing deployments
  with `now()`, so nobody who already set up by hand is walked through the
  wizard.

## [1.6.0] — 2026-09-01

### Added
- **"Fetch now"** ([docs/onboarding-plan.md §2 step 2](docs/onboarding-plan.md),
  TASKS §11 block 2): a button in the Overview header and on `/runs` runs
  the hourly fetch tick immediately, in the web process, with a live
  progress page (`/runs/fetch-now/:id`) that narrates the sources as they
  answer and lands back on `/runs` with a one-line verdict ("312 jobs from
  71 sources in 40s — 118 new stored…"). One run at a time; recorded as a
  `fetch-now` row on `/runs`.
- **Unscored ingestion seam**: `processNormalizedJobs` accepts
  `{ classify: false }` and stores what passes the base filter with no fit
  score, no AI call and no alert. "Fetch now" uses it while the pipeline is
  paused — paused still means no AI spend — so a fresh install can prove the
  search works before any profile exists (the wizard's step 2 builds on it).
  Score those rows later with Re-classify; the hourly tick dedupes them and
  never revisits them.

### Changed
- Fetch stats on `/runs` carry `sources` / `sourcesFailed` per tick, and a
  run started while paused shows `classify: false`.
- A posting stored by another run meanwhile (the hourly tick and a manual
  fetch can overlap) now counts as a duplicate instead of failing the whole
  tick.

## [1.5.0] — 2026-09-01

### Changed
- **Settings → Profile now follows the user's journey**
  ([docs/onboarding-plan.md §3](docs/onboarding-plan.md)): contextual
  warnings first, then "Fill from a resume", then the editor; the profile
  management row (switch / Activate / Delete / + New) moved to the bottom
  and the "Other profiles" table is gone — the select is the one
  mechanism. The standalone "Re-classify all jobs" button was removed:
  "Save & re-classify" in the editor footer covers it, and a paid AI
  action no longer greets a fresh install at the top of the page.
- **"Fill from a resume" accepts a direct file upload** when no resumes
  exist yet — no more round trip to `/resumes` and back. The upload
  becomes a normal Resume row (first one becomes the default), is
  scanned, and the profile draft renders as before; nothing is saved
  until "Save profile".
- The three chip fields sit under one "What are we hunting for?" heading
  with a two-line legend (languages/frameworks → required; job-title
  words → role types), each with real example placeholders
  ("php, laravel, mysql…") instead of three identical "Add and press
  Enter…" prompts.
- Priority rules live in their own collapsed sub-section; the
  region-phrase warning shows only when rules exist. The Advanced block
  no longer auto-opens because of a seeded salary or a Telegram target —
  only notes, on-site cities or rules open it.
- The Settings header no longer claims everything saves on click — the
  profile editor saves on submit, and the copy now says so.
- Overview explains a paused pipeline: fresh installs start paused so a
  blank profile doesn't spend AI credit, with a link to fill the profile.
- **Moved to the `applypack` organization** — the repository now lives at
  `applypack/applypack`. Old URLs redirect, so existing clones and forks
  keep working, but the outbound `User-Agent` job boards see, the README
  badges, the `CHANGELOG` compare links and the launch drafts all point at
  the new address. `scripts/archive-traffic.sh` follows via its `REPO`
  default.
- **Database tables are snake_case now** ([ADR 0026](docs/adr/0026-snake-case-table-names.md),
  [#59](https://github.com/applypack/applypack/pull/59),
  [#61](https://github.com/applypack/applypack/pull/61)): all 13 models map
  to snake_case tables (`"Job"` → `job`, `"AppSettings"` → `app_settings`)
  and the autoincrement sequences follow in a second migration; columns and
  enum types keep their names. Both migrations run on the next boot — back
  up an existing deployment first. #61 also fixed the two raw-SQL sites (AI
  usage counters, nightly cleanup) that still named `"AppSettings"`.

## [1.4.1] — 2026-09-01

### Fixed
- **Blank-profile guardrails** ([#50](https://github.com/applypack/applypack/issues/50)).
  A freshly created "New profile" used to activate immediately; with no
  required stack and no role types the base filter's title gate turns off
  and the classifier scores generic job quality — one tick classified 118
  off-stack jobs and alerted 17 of them at scores up to 93. Four
  independent guards now close this, all deciding through the pure
  `src/profile-guards.ts` module:
  - "+ New profile" creates the profile **inactive** and opens it in the
    editor (`/settings?tab=profile&profile=<id>`); the first save that
    gives it a required stack or role types activates it. "Fill from a
    resume" flows into the same rule.
  - The worker skips classification and alerts for the whole tick when
    the active profile is blank (fetching and source health stay alive);
    `/runs` shows `skippedBlankProfile`, and "Re-classify all jobs"
    refuses to run. Banners on `/jobs` and Settings → Profile say
    "classification idle" until the profile is fixed.
  - Code-side floor: a classification made while `stackRequired` is empty
    is clamped to fit ≤ 50, tagged with a `no-profile-stack` red flag,
    and never alerts — whatever the threshold or priority boosts say.
  - Activating a blank profile is refused server-side, and its Activate
    controls are disabled with a hint.

## [1.4.0] — 2026-09-01

### Added
- **Board columns are yours now** ([ADR 0025](docs/adr/0025-custom-work-stages.md)):
  add, rename, reorder and remove the `/applications` work columns from
  Settings → General → "Board columns" (the board's "Edit columns" link
  lands there). Applied and the Closed pair stay fixed — they anchor
  appliedAt, the stale digest and the archive fold. A column holding jobs
  can't be removed (server-enforced), and renames never touch the stored
  key, so stage history stays intact.

### Changed
- The board now fills the window height exactly (the app-frame `fill`
  layout) — columns end at the viewport bottom and scroll inside, instead
  of stopping at a 70% cap with dead space below.

### Removed
- The three funnel stat cards ("Ever reached", "Days per hop", "Does fit
  predict interviews?") and their math. At a handful of applications every
  cell read `— n=0` / `— (0/5)` — noise below the board. The stage ledger
  keeps recording every move (time-in-stage on cards still uses it), so
  the analytics can return from git history once there is enough data to
  mean something.

## [1.3.0] — 2026-09-01

### Added
- **Drag-and-drop on the `/applications` board** (TASKS §10): drag a card
  into a column and the stage changes on drop — optimistic move, then the
  page re-renders from the server with a confirmation flash; on failure
  the card snaps back with an error notice. Dragging over the collapsed
  Closed panel opens it, so a card can be dropped straight onto Rejected
  or Ghosted. Dependency-free ES module (`src/web/public/board.mjs`),
  desktop pointers only — phones and no-JS keep the form path below.
- **Quick-move on every card** (the keyboard / no-JS path): a stage
  select + Move button as a plain form. With drag active it stays out of
  the way — collapsed until the card is hovered or keyboard-focused. The
  new stage-only endpoint writes the `JobStageEvent` ledger row in the
  same transaction and never touches appliedAt / recruiter / notes —
  those still belong to the tracking card on the job page.
- **Time-in-stage on cards**: "in screen 12d" from the ledger (falls back
  to "applied Nd ago" where no real event dates the stage), absolute date
  in the tooltip, and a warn-tone "· stalled" once a non-terminal stage
  sits still past 14 days. Backfilled history never dates a stage — same
  honesty rule as the funnel math.

### Changed
- Board columns cap at 70% of the viewport and scroll internally — with
  a hundred cards in one stage the page stays one screen tall instead of
  ~13,000&nbsp;px, and the funnel stats are visible without a journey.
- Rejected and Ghosted moved off the board into a collapsed **Closed**
  panel below it (with the same cards and quick-move for revivals), so
  the five work columns fit a laptop width.
- On phones the board stacks into one stage-grouped list with count
  chips that jump to each stage.
- Board detail pass: header meta reads "N active · M closed", the Onsite
  column dot no longer shares its colour with Tech, calibration cells
  shorten "— (n=0, need 5)" to "— (0/5)".

## [1.2.0] — 2026-09-01

### Fixed
- **Pausing "Job fetching" now stops an in-flight tick within seconds**
  (#51, #52). The flag used to be read once at tick start, so a running
  tick kept fetching, classifying (AI spend) and sending Telegram alerts
  until it finished. Every long phase — fetchers, discovery harvest, the
  classify/alert loop — now polls the flag through a throttled latching
  probe (`makeLatchingProbe`, one read per 5s) and aborts gracefully,
  recording `paused-mid-run` in the run stats on `/runs`.

### Added
- "Ready to apply" cue on the targeted-resume view: at a match score of
  85+ the card says so explicitly — stop polishing, send it (#48).

### Changed
- The paste-posting-vs-resume flow is named **Compare** in the nav and on
  its start page (was "Target") (#48).
- Match history lists (per job and per resume) are capped to the 50
  newest entries; re-runs no longer grow them without bound (#48).

## [1.1.0] — 2026-09-01

### Added
- **Status-transition ledger** (F5, [ADR 0024](docs/adr/0024-append-only-stage-ledger.md)):
  an append-only `JobStageEvent` row per pipeline-stage change, written in
  the same transaction at both web write sites; the current funnel is
  backfilled (3 rows, real apply dates). Notes-only resubmits write
  nothing; clearing a stage and editing the apply date land as
  `correction` events.
- Funnel, days-per-hop and fit-calibration cards on `/applications`, with
  the honesty rules as code: backfilled dates never enter medians,
  in-flight applications never enter rates, and a rate below n=5 renders
  as "need 5", never a number.
- Verification verdict badge (`legit` / `suspicious` / `fake`) on `/jobs`
  rows and a "Verified" filter pill (#21).
- Launch drafts in `docs/launch/` — Show HN, r/selfhosted and an
  awesome-selfhosted entry, all for manual posting (#44).

### Fixed
- Worker boot marks stale `RUNNING` cron runs as `FAILED — interrupted`,
  so `/runs` stops showing phantom in-flight jobs after a restart (#18).
- `cleanup-job` no longer garbage-collects jobs that have funnel history.
- Site deploys: Workers Builds ran `wrangler` with no config anywhere and
  every build failed with "Missing entry-point" — the repo root now
  carries an assets-only `wrangler.jsonc`, and `site/README.md` documents
  the real setup (a Cloudflare Worker with static assets, not Pages).

## [1.0.0] — 2026-09-01

First stable release: the whole arc — find → verify → tailor → apply →
track — is deployed, documented and demonstrated at
[applypack.dev](https://applypack.dev).

### Added
- Live scoring demo at applypack.dev/demo/ — the vendored `score.mjs` /
  `target.mjs` (byte-parity enforced by `site-vendor.test.ts`) running on the
  synthetic Fernway / Dana Ruiz fixture; edit the resume, watch the
  deterministic score, highlights and missing-keyword chips recompute with
  zero AI calls.
- Landing site for applypack.dev in `site/public` — static, zero-build,
  zero-dependency (Cloudflare Pages: root `site`, empty build command,
  output `public`). Reuses the README copy, the regenerated screenshots
  and the social card as `og:image`.

## [0.11.1] — 2026-08-31

### Changed
- **Renamed to ApplyPack.** The project outgrew "job hunter": it scores and
  tailors resumes, drafts cover letters and tracks applications, not just
  finds postings. The repository moved to `nazboyko/applypack` and old URLs
  redirect. The Postgres role, database and volume keep their `jobhunter`
  names, so an existing deployment needs no migration — but if you rename
  your local checkout directory, copy the Docker volume first: Compose
  derives the project name from the folder.
- Corrected a stale count in the README: 22 source types, not 16.
- README screenshots regenerated under the new brand; the hero shows a
  synthetic Fernway / Dana Ruiz comparison (82/100), no real personal data.
- The default `User-Agent` now derives its version from `package.json`
  (guard-tested) — it had sat on `0.1` for ten releases.
- The "What you get" table gained the cover-letter row (F8 shipped in 0.10.0
  but never made the README).

### Added
- `SECURITY.md` (private vulnerability reporting, scope, supported versions)
  and `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1); CONTRIBUTING now
  states the MIT in-bound license.

## [0.11.0] — 2026-08-31

### Added
- **Apply-link flags (ADR 0023).** Postings whose apply link cannot be applied
  through are tagged at ingest: `apply-url-missing` (a fetched row with no
  URL), `apply-url-unusable` (unparseable, or a scheme a browser cannot open a
  posting with), `apply-url-shortened` (a destination-hiding redirector) and
  `apply-url-not-an-application` (a host that cannot serve one — a YouTube
  video, a LinkedIn company page, a Telegram handle). The tags join the
  classifier's own in `Job.redFlags`, so they appear on `/jobs/:id` and in the
  Telegram alert with no new UI and no schema change.
- `backfill-apply-link-flags` annotates already-stored rows without spending
  an AI call. Additive and idempotent; `--dry-run` reads only.

### Changed
- The plan's trust *score* was dropped after measuring its four penalties on
  all 814 stored jobs. Three would have been wrong: the `http://` penalty
  marks 22.7% of the corpus and every one of those rows is Block's own
  Greenhouse-served careers domain, which redirects to https; the missing-URL
  penalty only ever hits jobs pasted by hand; and the company↔apply-domain
  mismatch produces either nothing, 26 rows that are false by construction, or
  302 (37%) depending on a string-matching detail — with a non-Latin-name
  exemption that protects zero rows. ADR 0023 records the measurements.

## [0.10.0] — 2026-08-31

### Security
- **The dashboard no longer binds to every network by default.** `WEB_HOST`
  defaulted to `0.0.0.0` in both the config schema and `.env.example`, whose
  comment justified it with a Docker-only argument. Following the README's
  "Running without Docker" steps put an unauthenticated dashboard — jobs,
  resume text, cover letters, settings, the Telegram token form — on every
  network the machine joined. It listens on loopback now; `docker-compose`
  sets `0.0.0.0` for the container, whose published port was already
  loopback-only, so Docker installs are unchanged.

### Fixed
- **A fresh install starts without an AI credential.** `cp .env.example .env`
  followed by any command died on `ANTHROPIC_API_KEY: required`, including
  the dashboard — the one place that key is configured. The engine chain
  already resolves at runtime (ADR 0013/0014) and Settings → AI engine
  already reports the missing key, so the boot-time check only got in the way.
- README's local section now says what it actually takes: `DATABASE_URL` is
  the only value you must set, and both commands run from the repository root.

## [0.9.0] — 2026-08-31

### Added
- **Untrusted-content fences (ADR 0022).** Job descriptions, resumes and
  pasted pages are wrapped in an explicit fence before any model sees them,
  with one shared directive stating the text inside is data, never
  instructions. Covers the classifier — which every fetched job passes
  through and which had no protection at all — plus the resume, match,
  cover-letter, verification and paste-extraction prompts.
- An injection attempt is recorded as a `prompt-injection-attempt` red flag
  on the job instead of being silently ignored.
- Verification, the only path with web search, refuses to fetch a URL the
  posting nominates or to treat such a page as corroboration.
- A CI guard derives its roster from the code itself, so a prompt builder or
  an AI call site added later cannot skip the fence.

### Fixed
- Posting text starting with a dash could be read as a command-line flag by
  the local Claude CLI; the liveness checker now re-verifies a URL after
  redirects.

## [0.8.0] — 2026-08-31

### Added
- **Cover letters (ADR 0021).** A card on every job page drafts a short
  letter from your resume, confirmed facts and the posting, with tone,
  remembered angle fields, in-place editing that autosaves, Regenerate and
  PDF / DOCX export.
- **A Cover letter page** (`/letter`): pick a job from a searchable list, or
  bring a new posting by URL or pasted text.
- **Fact gate (F7, ADR 0020).** Every generated letter is checked
  deterministically against your resume and confirmed facts; an invented
  number, employer, title or denied tool triggers one regeneration and a
  second failure discards the letter. Your own edits are flagged, never
  blocked.
- Per-engine "Cover letter model" on Settings → AI engine; all model pickers
  save on change.

## [0.7.0] — 2026-08-31

### Added
- **Source health monitoring (ADR 0019).** Every fetch records a per-source
  status; a "Quiet sources" card on `/companies` lists boards failing three
  ticks in a row or silent for 14 days, each with one-click Re-probe.
- Health read from each board's raw output rather than from stored jobs, so
  a strict profile filter never looks like a broken board.
- Optional Telegram digest line naming sources that went quiet.

## [0.6.0] — 2026-08-31

### Added
- **Cross-source dedup (ADR 0018).** The same job arriving from two sources
  is spotted by a SimHash fingerprint and flagged in both directions, on the
  job page and in the Telegram alert. Nothing is merged or hidden.
- `backfill-fingerprints.js` for existing jobs.

### Fixed
- Feed rows that nothing identifies are skipped instead of sharing one
  synthesised id; tracking parameters (`utm_*`, `gh_src`, `fbclid`) no longer
  change a job's id, while functional ones like `gh_jid` are kept.

## [0.5.0] — 2026-08-31

### Added
- **Company starter packs (ADR 0017).** 86 companies across 5 curated
  segments, every board re-probed live before anything is written. Preview
  before insert; companies land disabled with an "Enable all" button.

### Fixed
- ATS probe failures say what actually happened — rate limiting and vendor
  outages no longer report "token likely invalid".

## [0.4.0] — 2026-08-31

### Added
- Six new sources: Recruitee, Breezy, BambooHR, Pinpoint, Rippling and
  4 Day Week. JustJoin, NoFluffJobs and NoDesk were rejected on robots
  grounds (ADR 0005 addendum).

## [0.3.0] — 2026-08-31

### Added
- **Liveness ladder (ADR 0016).** Free ATS-API and page checks run before
  the AI verification, so dead Greenhouse / Lever / Ashby postings resolve
  as expired at no cost. Liveness chip on the job page.

## [0.2.1] — 2026-08-30

### Fixed
- **Job descriptions are readable again.** `stripHtml` used to strip tags
  before decoding entities, so feeds that ship the body HTML-escaped
  (Greenhouse — 82 % of stored jobs) kept raw `<div>…` markup as visible
  text, and the final `\s+` collapse flattened every description into a
  single-line wall. Entities now decode first (`&amp;` last, so
  double-escaped input stays literal), line structure is rebuilt from block
  tags, `<br>` and `<li>` (→ `• ` bullets), and prose like `salary > 100k`
  or `<3` survives stripping. Covered by new unit tests.
- **Stored rows repaired.** Two one-shot scripts (both support `--dry-run`):
  `backfill-descriptions` re-cleans rows that still carry markup and decodes
  entities in pasted jobs; `refetch-descriptions` re-pulls the boards and
  updated 601 stored descriptions in place. stripHtml is deliberately NOT
  re-run on clean plaintext — it is not idempotent (CLAUDE.md gotcha 12).
- Manual pastes decode literal entities (`&nbsp;`, `&amp;`) before saving.

### Changed
- **Full-width dashboard.** Every page now stretches to the screen like the
  Jobs table: the prose-width caps (`max-w-prose`, `75ch`) and per-page
  column limits are gone, so the job description, classifier summary, hints,
  Settings, the paste form and the Target editor all fill their containers.
  The /companies explainer reflows into two columns; the description card
  renders decoded paragraphs via `whitespace-pre-line`.

## [0.2.0] — 2026-08-30

### Added
- **AI engine chain (ADR 0013/0014).** Five interchangeable backends behind
  one seam — Anthropic API, Claude Code CLI, Gemini CLI, Codex CLI, and any
  OpenAI-compatible `/chat/completions` endpoint (OpenAI, OpenRouter, Groq,
  local LM Studio/Ollama via `OPENAI_BASE_URL`). Enable the ones you own on
  `/settings` → AI engine, order them with ↑ Priority, and every call is
  served by engine #1 with automatic per-call failover to the next on
  errors, rate limits or exhausted quota — control returns as soon as the
  primary recovers. Per-engine classifier/resume model slots use
  family-locked dropdowns (a wrong-family id cannot be saved); each card has
  an availability probe (binary + auth detection) and a live **Test** button
  that runs one real call and reports the response time.
- **Engine-chain hardening.** CLI child processes get an env allowlist —
  only their own auth variables, so a stray `ANTHROPIC_API_KEY` can no
  longer silently switch the Claude subscription engine to API billing, and
  no AI process ever sees the database URL or Telegram token. Failing
  engines go into a short cooldown (3 consecutive misses → 60 s skip)
  instead of stalling bulk runs, and one logical call is capped at three
  engines inside a hard deadline.
- **Honest cost surface.** Metered engines carry a "pay per token" badge and
  a warning when enabled behind subscription engines; reports produced by a
  fallback engine are marked `· fallback`; a "Last 7 days" line counts runs
  per engine (stored in `AppSettings.aiUsage`, trimmed to 60 days by the
  cleanup cron).
- **Settings tabs.** `/settings` is now five link-based tabs — General ·
  Profile · AI engine · Notifications · Sources — and every save returns to
  the tab it came from.
- **Fill profile from a resume (ADR 0015).** One click maps a scanned
  resume onto the profile fields (stack, role types, seniority) and shows a
  reviewable draft — nothing is saved until you confirm. Resume scans now
  extract primary skills to power it.
- **Cross-engine bench.** `npm run bench:resume -- --engine <id>|all` runs
  the gold fixtures through any usable engine; `--list-engines` shows who is
  ready without spending a call.
- **Setup guide.** `docs/ai-engines.md` — step-by-step setup for every
  engine, local and Docker, plus a pipeline pause/resume control on the
  Overview page.

### Changed
- Settings & discovery refactor: human source names (LARAJOBS_RSS → "Laravel
  Jobs"), a `warn` flash variant for pausing states, confirm on
  "Save & re-classify", discovery/HN toggles moved to `/discovery`, the
  resumes card deduplicated to a list + link, bot tokens masked to the last
  4 characters, and a jargon-free copy pass.
- First boot is stack-neutral: a blank starter profile, `TZ` defaults to
  UTC, no salary floor, and fetching starts paused until the profile is
  filled.
- README rewritten around the actual first-run path (engines → profile →
  resume → alerts).

### Fixed
- Saving job sources no longer re-adds the internal MANUAL type to the
  disabled list on every save.
- Personal data removed from test fixtures and UI copy.

## [0.1.1] — 2026-08-29

### Added
- **Deterministic match score (ADR 0012).** The model now returns facts only
  — per-keyword status, `must/preferred/nice/context` requirement levels,
  primary-stack flags, three alignment grades — and `src/resume/score.ts`
  computes the number (60 keywords + 40 alignment − 10/red-flag, primary cap
  last). The stored breakdown renders as "why this score" chips, and the live
  editor re-runs the *same formula* on every keystroke (`score.mjs`, parity-
  tested), so the two numbers finally share one scale.
- **"Confirm your experience" (ask_user).** A fourth keyword status for
  plausible-but-unevidenced skills: the comparison asks, your yes/no (plus
  optional where/when context) is stored as a `CandidateFact`, the score
  recomputes instantly with no AI call, and every future comparison reuses
  the answer. Denied terms are never asked again. Facts are managed on
  `/resumes`.
- **Cross-resume evidence.** A term this resume can't claim but another
  stored resume evidences gets an `in "<resume>"` badge — "you have it, but
  this resume hides it" — and the model may mark it addable, naming the source.
- **Hard-requirements panel.** Work authorization, on-site, minimum years and
  other gates now render as pass / unknown / fail outside the score; silence
  is "unknown — confirm", never a fail.
- **What the ATS sees.** `/resumes/:id` runs deterministic parse checks over
  the extracted text (unreadable characters, missing email/phone, glued
  words, scanned-file suspicion, length) above the raw-text view.
- **Explained version deltas.** "vs v4" now lists which keywords were gained
  or lost and how each score component moved, computed from stored
  breakdowns (`src/resume/diff.ts`) — not narrated by the model.
- **Prompt-injection guard + live bench.** Both resume prompts treat resume
  and posting text as untrusted data, and `npm run bench:resume` smoke-tests
  the prompt against gold fixtures (stack mismatch, stack match, injection)
  through the real provider.
- **PDF resume uploads.** `.pdf` joins `.docx` / `.md` / `.txt`, extracted via
  unpdf (ADR 0011) with clear errors for password-protected and scanned /
  outlined files; upload limit raised from 2 to 5 MB.
- **Target page (`/target`).** Paste a posting and pick, upload or paste a
  resume — one run detects, classifies and scores, then opens the side-by-side
  targeted view. The description alone is enough: empty company / title /
  location / salary are extracted inside the run as a visible "Detect posting
  facts" step that never blocks (unfound facts fall back to visible defaults,
  the run header renames live), detected salary lands on the job, and a
  Ctrl+A paste gets its page chrome trimmed in the textarea while the
  job-header block (title · company · salary) survives. Uploaded / pasted
  resumes land on one hidden scratch row (`Resume.hidden`, migration) —
  /target is a pure comparison, nothing accumulates in Resumes.
- **Live progress pages.** Long runs (/target, Compare, Re-analyze,
  Re-upload) show polled step-by-step progress — no meta-refresh — with a
  violet activity line that walks the real analysis checklist, a ticking
  elapsed counter and auto-redirect into the result.

### Changed
- **Resume-match workspace decluttered** (two external UX audits, verified
  against the code; adopted plan in docs/TASKS.md §6). Everything needed for
  a decision sits above the tabs: one primary score with a quality word, the
  hard-requirement digest, confirm-your-experience questions, suggestion
  counts. The live estimate appears only while the text is edited (with a
  ±N-vs-AI delta, mirrored in a sticky unsaved-changes bar), the Suggestions
  tab pairs the advice column with a sticky editor — clicking a suggestion
  selects its exact text in place — keyword tables list needs-attention rows
  first with matched behind a disclosure, one status vocabulary everywhere
  (matched / missing / confirm / no evidence), run chips cap at two plus an
  "older runs" disclosure, Re-upload is the one visible action (the rest in
  a light-dismiss ⋯ menu), and the page belongs to Jobs (breadcrumb, active
  nav, 1536px content cap).
- Match replies are capped tighter for speed (~25 keywords, ~10 actions, ~8
  removals, 12-word notes) — less output ≈ faster analysis. Suggested
  experience bullets follow explicit **bullet rules** (prompt v4): verb-first,
  ≤28 words, the posting's own vocabulary, each bullet aimed at a named
  requirement, business outcome stated; metrics may never be invented and
  placeholders like "[add your real number]" are banned from the wording —
  a missing figure becomes "ask the candidate for the real number" in "why".

### Fixed
- **The 65-point treadmill (scoring v3).** A fully tailored resume (keywords
  57.9/60, alignment 40/40, primary 3/3) was stuck at 65-68 because the model
  kept inventing three soft "red flags" (−30) — style and domain nitpicks that
  rotated every run — and the keyword set itself drifted between analyses.
  Now: red flags are application-blockers only (each −10, bounded at −20,
  flags restating missing primaries are free — the cap already owns those);
  soft concerns land in a new unscored **cautions** list; a "primary" mark on
  a merely-preferred technology no longer caps the score; re-analyses of the
  same posting receive the previous keyword frame so terms stay comparable
  across resume versions; and every breakdown now carries a **ceiling** — the
  honest maximum this resume can reach on this posting — shown in the UI
  ("max reachable 92" / "at its ceiling"). The same tailored resume now
  scores its actual work (78+ on the recorded real case, 90+ once the ask is
  confirmed and flags are clean).
- Keywords are now verifiable end-to-end: every extracted term must be a
  verbatim 1-4-word phrase from the posting (so it always highlights in the
  description pane), aliases must cover the resume's own spellings, and the
  live counter names the missing terms ("… · missing: Azure, troubleshoot,
  health") instead of a bare count.
- The targeted view leads with the honest number: the big ring is now the
  **AI match** with the rubric's stack verdict beside it; live keyword
  coverage is secondary, counts "can't claim" keywords by default, and the
  AI score is marked "edited — Re-analyze to refresh" once you type.
- Removal suggestions got two hard rules: the contact line (email, phone,
  links) is untouchable — only a street-level address may be trimmed — and a
  removal may never quote text containing a keyword the posting wants; mixed
  skills lines get itemised "drop X, keep Y" advice instead.
- Resume-match scoring got a **primary-stack gate**: the posting's core
  languages/frameworks cap the score (none present → ≤30), sibling tech never
  counts (Vue ≠ React, PHP ≠ Node.js), and the summary must open with the
  stack verdict. Before: Laravel/Vue vs a Node/React posting scored 82/100;
  after: 10/100 (and 92/100 against a Laravel posting).
## [0.1.0] — 2026-08-28

First tagged release. Everything below was designed and built between
2026-04-26 and 2026-08-28 by a single author (AI-assisted; every non-obvious
decision is recorded in [docs/adr/](./docs/adr/)). The phase labels match the
commit history.

### Dashboard
- Light-theme redesign of every page: shared layout, design tokens, tables,
  forms, empty states, mobile job header.
- Overview with status counters, recent alerts and cron health.
- Jobs list (filter / sort / paginate), job detail with Claude output,
  status actions and re-classify.
- `/jobs/new` — paste a posting the fetchers cannot see; it is classified like
  any other.
- Applications kanban (applied → screen → tech → onsite → offer / rejected /
  ghosted) with a stale-applications digest.
- Companies page with manual add and a live ATS probe before save; per-row
  toggle and delete.
- Discovery review page for companies harvested from HN comments.
- Runs log, settings (profiles, toggles, Telegram targets, source families),
  `/health` JSON endpoint, optional HTTP Basic Auth.

### Resume module
- Upload `.docx` / `.md` / `.txt`; pure zip + docx text extraction with tests.
- One-time AI scan per version: headline, seniority, skill tags, ATS issues.
- Resume-vs-job comparison with a fixed rubric: match score, red flags,
  prioritised to-do list, keyword coverage (`present` / `add` / `can't claim`),
  removals; version-over-version delta.
- Targeted view: posting and resume side by side, keyword highlights, in-place
  editing with a live keyword-coverage score computed in the browser, AI
  re-analysis, save as new version (ADR 0010).

### Job verification
- "Is this job real?" — ghost-job checklist run with web search through the
  AI seam; verdict `legit` / `suspicious` / `fake`, recommendation, confidence
  and evidence URLs (ADR 0009).

### Classifier and AI backend
- Profile-driven Claude classifier with explicit tech-stack vs role-type and
  country-lock rules.
- Optional two-stage mode: short cached prefilter prompt, full prompt only for
  survivors.
- Priority rules: post-classification fit-score floor per profile.
- Single AI provider seam (`src/ai-provider.ts`): Anthropic Messages API or
  Claude Code CLI on a subscription (ADR 0007).
- Concurrency limiter (`AI_CONCURRENCY`) for fetch ticks and re-classify.
- Configurable models per task (`CLAUDE_MODEL`, `CLAUDE_MODEL_RESUME`).

### Sources
- Per-company: Greenhouse, Lever, Ashby, Workable, SmartRecruiters.
- Cross-company: LaraJobs, RemoteOK, Remotive, Jobicy, Arbeitnow,
  WeWorkRemotely, Golangprojects, Working Nomads, Himalayas, HN
  "Who is hiring", HN /jobs.
- Universal ATS-URL discovery from HN text; candidates reviewed on
  `/discovery` and promoted with one click.
- Per-source-family toggles and a global "pause fetching" switch
  (deployments start paused).
- Policy: official public APIs and RSS only; no LinkedIn / Indeed / Glassdoor /
  Workday / Wellfound (ADR 0005).

### Worker and infrastructure
- Separate cron worker and dashboard processes sharing Postgres (ADR 0002);
  node-cron, no queue (ADR 0003).
- Prisma migrations baseline; `init.ts` applies migrations and seeds on boot.
- Multi-stage Dockerfile on `node:24-alpine`, docker-compose with Postgres 16.
- Telegram alerts and daily digest; targets managed from the dashboard.
- GitHub Actions CI: type check, unit tests, `prisma validate`, format check.
- Documentation set: SPEC, ARCHITECTURE (Mermaid), CLAUDE.md conventions and
  gotchas, ten ADRs.

### Milestones

| Date | Milestone |
| --- | --- |
| 2026-04-26 | Initial worker + dashboard, CI, migrations baseline |
| 2026-04-27 | Two-stage classifier, HN parser, application tracking, discovery, priority rules, docs set, ADR 0001–0006 |
| 2026-04-28 | Fetcher fixes (LaraJobs namespace, Lever re-seed) |
| 2026-04-29 | Pure fetcher mappers + tests, Jobicy, HN /jobs, universal ATS discovery |
| 2026-08-27 | Node 24, pause toggle, AI provider seam, first dashboard redesign, parallel classifier |
| 2026-08-28 | Resume module, targeted view, ghost-job verification, light-theme redesign — **v0.1.0** |
| 2026-08-29 | PDF uploads, /target auto-detect flow, deterministic score, match-workspace UX refactor — **v0.1.1** |
| 2026-08-30 | AI engine chain, settings tabs, profile fill — **v0.2.0**; readable descriptions + full-width dashboard — **v0.2.1** |
| 2026-08-31 | Liveness ladder — **v0.3.0**; fetchers wave 1 — **v0.4.0**; starter packs — **v0.5.0**; cross-source dedup — **v0.6.0**; source health — **v0.7.0**; cover letters + fact gate — **v0.8.0**; untrusted-content fences — **v0.9.0**; safe local defaults — **v0.10.0** |

[2.63.29]: https://github.com/applypack/applypack/compare/v2.63.28...v2.63.29
[2.63.28]: https://github.com/applypack/applypack/compare/v2.63.27...v2.63.28
[2.63.27]: https://github.com/applypack/applypack/compare/v2.63.26...v2.63.27
[2.63.26]: https://github.com/applypack/applypack/compare/v2.63.25...v2.63.26
[2.63.25]: https://github.com/applypack/applypack/compare/v2.63.24...v2.63.25
[2.63.24]: https://github.com/applypack/applypack/compare/v2.63.23...v2.63.24
[2.63.23]: https://github.com/applypack/applypack/compare/v2.63.22...v2.63.23
[2.63.22]: https://github.com/applypack/applypack/compare/v2.63.21...v2.63.22
[2.63.21]: https://github.com/applypack/applypack/compare/v2.63.20...v2.63.21
[2.63.20]: https://github.com/applypack/applypack/compare/v2.63.19...v2.63.20
[2.63.19]: https://github.com/applypack/applypack/compare/v2.63.18...v2.63.19
[2.63.18]: https://github.com/applypack/applypack/compare/v2.63.17...v2.63.18
[2.63.17]: https://github.com/applypack/applypack/compare/v2.63.16...v2.63.17
[2.63.16]: https://github.com/applypack/applypack/compare/v2.63.15...v2.63.16
[2.63.15]: https://github.com/applypack/applypack/compare/v2.63.14...v2.63.15
[2.63.14]: https://github.com/applypack/applypack/compare/v2.63.13...v2.63.14
[2.63.13]: https://github.com/applypack/applypack/compare/v2.63.12...v2.63.13
[2.63.12]: https://github.com/applypack/applypack/compare/v2.63.11...v2.63.12
[2.63.11]: https://github.com/applypack/applypack/compare/v2.63.10...v2.63.11
[2.63.10]: https://github.com/applypack/applypack/compare/v2.63.9...v2.63.10
[2.63.9]: https://github.com/applypack/applypack/compare/v2.63.8...v2.63.9
[2.63.8]: https://github.com/applypack/applypack/compare/v2.63.7...v2.63.8
[2.63.7]: https://github.com/applypack/applypack/compare/v2.63.6...v2.63.7
[2.63.6]: https://github.com/applypack/applypack/compare/v2.63.5...v2.63.6
[2.63.5]: https://github.com/applypack/applypack/compare/v2.63.4...v2.63.5
[2.63.4]: https://github.com/applypack/applypack/compare/v2.63.3...v2.63.4
[2.63.3]: https://github.com/applypack/applypack/compare/v2.63.2...v2.63.3
[2.63.2]: https://github.com/applypack/applypack/compare/v2.63.1...v2.63.2
[2.63.1]: https://github.com/applypack/applypack/compare/v2.63.0...v2.63.1
[2.63.0]: https://github.com/applypack/applypack/compare/v2.62.0...v2.63.0
[2.62.0]: https://github.com/applypack/applypack/compare/v2.61.10...v2.62.0
[2.61.10]: https://github.com/applypack/applypack/compare/v2.61.9...v2.61.10
[2.61.9]: https://github.com/applypack/applypack/compare/v2.61.8...v2.61.9
[2.61.8]: https://github.com/applypack/applypack/compare/v2.61.7...v2.61.8
[2.61.7]: https://github.com/applypack/applypack/compare/v2.61.6...v2.61.7
[2.61.6]: https://github.com/applypack/applypack/compare/v2.61.5...v2.61.6
[2.61.5]: https://github.com/applypack/applypack/compare/v2.61.4...v2.61.5
[2.61.4]: https://github.com/applypack/applypack/compare/v2.61.3...v2.61.4
[2.61.3]: https://github.com/applypack/applypack/compare/v2.61.2...v2.61.3
[2.61.2]: https://github.com/applypack/applypack/compare/v2.61.1...v2.61.2
[2.61.1]: https://github.com/applypack/applypack/compare/v2.61.0...v2.61.1
[2.61.0]: https://github.com/applypack/applypack/compare/v2.60.0...v2.61.0
[2.60.0]: https://github.com/applypack/applypack/compare/v2.59.4...v2.60.0
[2.59.4]: https://github.com/applypack/applypack/compare/v2.59.3...v2.59.4
[2.59.3]: https://github.com/applypack/applypack/compare/v2.59.2...v2.59.3
[2.59.2]: https://github.com/applypack/applypack/compare/v2.59.1...v2.59.2
[2.59.1]: https://github.com/applypack/applypack/compare/v2.59.0...v2.59.1
[2.59.0]: https://github.com/applypack/applypack/compare/v2.58.0...v2.59.0
[2.58.0]: https://github.com/applypack/applypack/compare/v2.57.3...v2.58.0
[2.57.3]: https://github.com/applypack/applypack/compare/v2.57.2...v2.57.3
[2.57.2]: https://github.com/applypack/applypack/compare/v2.57.1...v2.57.2
[2.57.1]: https://github.com/applypack/applypack/compare/v2.57.0...v2.57.1
[2.57.0]: https://github.com/applypack/applypack/compare/v2.56.2...v2.57.0
[2.56.2]: https://github.com/applypack/applypack/compare/v2.56.1...v2.56.2
[2.56.1]: https://github.com/applypack/applypack/compare/v2.56.0...v2.56.1
[2.56.0]: https://github.com/applypack/applypack/compare/v2.55.66...v2.56.0
[2.55.66]: https://github.com/applypack/applypack/compare/v2.55.65...v2.55.66
[2.55.65]: https://github.com/applypack/applypack/compare/v2.55.64...v2.55.65
[2.55.64]: https://github.com/applypack/applypack/compare/v2.55.63...v2.55.64
[2.55.63]: https://github.com/applypack/applypack/compare/v2.55.62...v2.55.63
[2.55.62]: https://github.com/applypack/applypack/compare/v2.55.61...v2.55.62
[2.55.61]: https://github.com/applypack/applypack/compare/v2.55.60...v2.55.61
[2.55.60]: https://github.com/applypack/applypack/compare/v2.55.59...v2.55.60
[2.55.59]: https://github.com/applypack/applypack/compare/v2.55.58...v2.55.59
[2.55.58]: https://github.com/applypack/applypack/compare/v2.55.57...v2.55.58
[2.55.57]: https://github.com/applypack/applypack/compare/v2.55.56...v2.55.57
[2.55.56]: https://github.com/applypack/applypack/compare/v2.55.55...v2.55.56
[2.55.55]: https://github.com/applypack/applypack/compare/v2.55.54...v2.55.55
[2.55.54]: https://github.com/applypack/applypack/compare/v2.55.53...v2.55.54
[2.55.53]: https://github.com/applypack/applypack/compare/v2.55.52...v2.55.53
[2.55.52]: https://github.com/applypack/applypack/compare/v2.55.51...v2.55.52
[2.55.51]: https://github.com/applypack/applypack/compare/v2.55.50...v2.55.51
[2.55.50]: https://github.com/applypack/applypack/compare/v2.55.49...v2.55.50
[2.55.49]: https://github.com/applypack/applypack/compare/v2.55.48...v2.55.49
[2.55.48]: https://github.com/applypack/applypack/compare/v2.55.47...v2.55.48
[2.55.47]: https://github.com/applypack/applypack/compare/v2.55.46...v2.55.47
[2.55.46]: https://github.com/applypack/applypack/compare/v2.55.45...v2.55.46
[2.55.45]: https://github.com/applypack/applypack/compare/v2.55.44...v2.55.45
[2.55.44]: https://github.com/applypack/applypack/compare/v2.55.43...v2.55.44
[2.55.43]: https://github.com/applypack/applypack/compare/v2.55.42...v2.55.43
[2.55.42]: https://github.com/applypack/applypack/compare/v2.55.41...v2.55.42
[2.55.41]: https://github.com/applypack/applypack/compare/v2.55.40...v2.55.41
[2.55.40]: https://github.com/applypack/applypack/compare/v2.55.39...v2.55.40
[2.55.39]: https://github.com/applypack/applypack/compare/v2.55.38...v2.55.39
[2.55.38]: https://github.com/applypack/applypack/compare/v2.55.37...v2.55.38
[2.55.37]: https://github.com/applypack/applypack/compare/v2.55.36...v2.55.37
[2.55.36]: https://github.com/applypack/applypack/compare/v2.55.35...v2.55.36
[2.55.35]: https://github.com/applypack/applypack/compare/v2.55.34...v2.55.35
[2.55.34]: https://github.com/applypack/applypack/compare/v2.55.33...v2.55.34
[2.55.33]: https://github.com/applypack/applypack/compare/v2.55.32...v2.55.33
[2.55.32]: https://github.com/applypack/applypack/compare/v2.55.31...v2.55.32
[2.55.31]: https://github.com/applypack/applypack/compare/v2.55.30...v2.55.31
[2.55.30]: https://github.com/applypack/applypack/compare/v2.55.29...v2.55.30
[2.55.29]: https://github.com/applypack/applypack/compare/v2.55.28...v2.55.29
[2.55.28]: https://github.com/applypack/applypack/compare/v2.55.27...v2.55.28
[2.55.27]: https://github.com/applypack/applypack/compare/v2.55.26...v2.55.27
[2.55.26]: https://github.com/applypack/applypack/compare/v2.55.25...v2.55.26
[2.55.25]: https://github.com/applypack/applypack/compare/v2.55.24...v2.55.25
[2.55.24]: https://github.com/applypack/applypack/compare/v2.55.23...v2.55.24
[2.55.23]: https://github.com/applypack/applypack/compare/v2.55.22...v2.55.23
[2.55.22]: https://github.com/applypack/applypack/compare/v2.55.21...v2.55.22
[2.55.21]: https://github.com/applypack/applypack/compare/v2.55.20...v2.55.21
[2.55.20]: https://github.com/applypack/applypack/compare/v2.55.19...v2.55.20
[2.55.19]: https://github.com/applypack/applypack/compare/v2.55.18...v2.55.19
[2.55.18]: https://github.com/applypack/applypack/compare/v2.55.17...v2.55.18
[2.55.17]: https://github.com/applypack/applypack/compare/v2.55.16...v2.55.17
[2.55.16]: https://github.com/applypack/applypack/compare/v2.55.15...v2.55.16
[2.55.15]: https://github.com/applypack/applypack/compare/v2.55.14...v2.55.15
[2.55.14]: https://github.com/applypack/applypack/compare/v2.55.13...v2.55.14
[2.55.13]: https://github.com/applypack/applypack/compare/v2.55.12...v2.55.13
[2.55.12]: https://github.com/applypack/applypack/compare/v2.55.11...v2.55.12
[2.55.11]: https://github.com/applypack/applypack/compare/v2.55.10...v2.55.11
[2.55.10]: https://github.com/applypack/applypack/compare/v2.55.9...v2.55.10
[2.55.9]: https://github.com/applypack/applypack/compare/v2.55.8...v2.55.9
[2.55.8]: https://github.com/applypack/applypack/compare/v2.55.7...v2.55.8
[2.55.7]: https://github.com/applypack/applypack/compare/v2.55.6...v2.55.7
[2.55.6]: https://github.com/applypack/applypack/compare/v2.55.5...v2.55.6
[2.55.5]: https://github.com/applypack/applypack/compare/v2.55.4...v2.55.5
[2.55.4]: https://github.com/applypack/applypack/compare/v2.55.3...v2.55.4
[2.55.3]: https://github.com/applypack/applypack/compare/v2.55.2...v2.55.3
[2.55.2]: https://github.com/applypack/applypack/compare/v2.55.1...v2.55.2
[2.55.1]: https://github.com/applypack/applypack/compare/v2.55.0...v2.55.1
[2.55.0]: https://github.com/applypack/applypack/compare/v2.54.0...v2.55.0
[2.54.0]: https://github.com/applypack/applypack/compare/v2.53.0...v2.54.0
[2.53.0]: https://github.com/applypack/applypack/compare/v2.52.0...v2.53.0
[2.52.0]: https://github.com/applypack/applypack/compare/v2.51.0...v2.52.0
[2.51.0]: https://github.com/applypack/applypack/compare/v2.50.0...v2.51.0
[2.50.0]: https://github.com/applypack/applypack/compare/v2.49.0...v2.50.0
[2.49.0]: https://github.com/applypack/applypack/compare/v2.48.0...v2.49.0
[2.48.0]: https://github.com/applypack/applypack/compare/v2.47.1...v2.48.0
[2.47.1]: https://github.com/applypack/applypack/compare/v2.47.0...v2.47.1
[2.47.0]: https://github.com/applypack/applypack/compare/v2.46.0...v2.47.0
[2.46.0]: https://github.com/applypack/applypack/compare/v2.44.0...v2.46.0
[2.44.0]: https://github.com/applypack/applypack/compare/v2.43.0...v2.44.0
[2.43.0]: https://github.com/applypack/applypack/compare/v2.42.0...v2.43.0
[2.42.0]: https://github.com/applypack/applypack/compare/v2.41.2...v2.42.0
[2.41.2]: https://github.com/applypack/applypack/compare/v2.41.1...v2.41.2
[2.41.1]: https://github.com/applypack/applypack/compare/v2.41.0...v2.41.1
[2.41.0]: https://github.com/applypack/applypack/compare/v2.40.0...v2.41.0
[2.40.0]: https://github.com/applypack/applypack/compare/v2.39.0...v2.40.0
[2.39.0]: https://github.com/applypack/applypack/compare/v2.38.0...v2.39.0
[2.38.0]: https://github.com/applypack/applypack/compare/v2.37.0...v2.38.0
[2.37.0]: https://github.com/applypack/applypack/compare/v2.36.0...v2.37.0
[2.36.0]: https://github.com/applypack/applypack/compare/v2.35.0...v2.36.0
[2.35.0]: https://github.com/applypack/applypack/compare/v2.34.0...v2.35.0
[2.34.0]: https://github.com/applypack/applypack/compare/v2.33.0...v2.34.0
[2.33.0]: https://github.com/applypack/applypack/compare/v2.32.0...v2.33.0
[2.32.0]: https://github.com/applypack/applypack/compare/v2.31.0...v2.32.0
[2.31.0]: https://github.com/applypack/applypack/compare/v2.30.0...v2.31.0
[2.30.0]: https://github.com/applypack/applypack/compare/v2.29.0...v2.30.0
[2.29.0]: https://github.com/applypack/applypack/compare/v2.28.1...v2.29.0
[2.28.1]: https://github.com/applypack/applypack/compare/v2.28.0...v2.28.1
[2.28.0]: https://github.com/applypack/applypack/compare/v2.27.0...v2.28.0
[2.27.0]: https://github.com/applypack/applypack/compare/v2.26.0...v2.27.0
[2.26.0]: https://github.com/applypack/applypack/compare/v2.25.0...v2.26.0
[2.25.0]: https://github.com/applypack/applypack/compare/v2.24.0...v2.25.0
[2.24.0]: https://github.com/applypack/applypack/compare/v2.23.0...v2.24.0
[2.23.0]: https://github.com/applypack/applypack/compare/v2.22.0...v2.23.0
[2.22.0]: https://github.com/applypack/applypack/compare/v2.21.0...v2.22.0
[2.21.0]: https://github.com/applypack/applypack/compare/v2.20.0...v2.21.0
[2.20.0]: https://github.com/applypack/applypack/compare/v2.19.1...v2.20.0
[2.19.1]: https://github.com/applypack/applypack/compare/v2.19.0...v2.19.1
[2.19.0]: https://github.com/applypack/applypack/compare/v2.18.5...v2.19.0
[2.18.5]: https://github.com/applypack/applypack/compare/v2.18.4...v2.18.5
[2.18.4]: https://github.com/applypack/applypack/compare/v2.18.3...v2.18.4
[2.18.3]: https://github.com/applypack/applypack/compare/v2.18.2...v2.18.3
[2.18.2]: https://github.com/applypack/applypack/compare/v2.18.1...v2.18.2
[2.18.1]: https://github.com/applypack/applypack/compare/v2.18.0...v2.18.1
[2.18.0]: https://github.com/applypack/applypack/compare/v2.17.1...v2.18.0
[2.17.1]: https://github.com/applypack/applypack/compare/v2.17.0...v2.17.1
[2.17.0]: https://github.com/applypack/applypack/compare/v2.16.0...v2.17.0
[2.16.0]: https://github.com/applypack/applypack/compare/v2.15.0...v2.16.0
[2.15.0]: https://github.com/applypack/applypack/compare/v2.14.0...v2.15.0
[2.14.0]: https://github.com/applypack/applypack/compare/v2.13.0...v2.14.0
[2.13.0]: https://github.com/applypack/applypack/compare/v2.12.0...v2.13.0
[2.12.0]: https://github.com/applypack/applypack/compare/v2.11.0...v2.12.0
[2.11.0]: https://github.com/applypack/applypack/compare/v2.10.0...v2.11.0
[2.10.0]: https://github.com/applypack/applypack/compare/v2.9.4...v2.10.0
[2.9.4]: https://github.com/applypack/applypack/compare/v2.9.3...v2.9.4
[2.9.3]: https://github.com/applypack/applypack/compare/v2.9.2...v2.9.3
[2.9.2]: https://github.com/applypack/applypack/compare/v2.9.1...v2.9.2
[2.9.1]: https://github.com/applypack/applypack/compare/v2.9.0...v2.9.1
[2.9.0]: https://github.com/applypack/applypack/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/applypack/applypack/compare/v2.7.2...v2.8.0
[2.7.2]: https://github.com/applypack/applypack/compare/v2.7.1...v2.7.2
[2.7.1]: https://github.com/applypack/applypack/compare/v2.7.0...v2.7.1
[2.7.0]: https://github.com/applypack/applypack/compare/v2.6.4...v2.7.0
[2.6.4]: https://github.com/applypack/applypack/compare/v2.6.3...v2.6.4
[2.6.3]: https://github.com/applypack/applypack/compare/v2.6.2...v2.6.3
[2.6.2]: https://github.com/applypack/applypack/compare/v2.6.1...v2.6.2
[2.6.1]: https://github.com/applypack/applypack/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/applypack/applypack/compare/v2.5.4...v2.6.0
[2.5.4]: https://github.com/applypack/applypack/compare/v2.5.3...v2.5.4
[2.5.3]: https://github.com/applypack/applypack/compare/v2.5.2...v2.5.3
[2.5.2]: https://github.com/applypack/applypack/compare/v2.5.1...v2.5.2
[2.5.1]: https://github.com/applypack/applypack/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/applypack/applypack/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/applypack/applypack/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/applypack/applypack/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/applypack/applypack/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/applypack/applypack/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/applypack/applypack/compare/v1.76.0...v2.0.0
[1.76.0]: https://github.com/applypack/applypack/compare/v1.75.0...v1.76.0
[1.75.0]: https://github.com/applypack/applypack/compare/v1.74.0...v1.75.0
[1.74.0]: https://github.com/applypack/applypack/compare/v1.73.0...v1.74.0
[1.73.0]: https://github.com/applypack/applypack/compare/v1.72.0...v1.73.0
[1.72.0]: https://github.com/applypack/applypack/compare/v1.71.0...v1.72.0
[1.71.0]: https://github.com/applypack/applypack/compare/v1.70.0...v1.71.0
[1.70.0]: https://github.com/applypack/applypack/compare/v1.69.0...v1.70.0
[1.69.0]: https://github.com/applypack/applypack/compare/v1.68.0...v1.69.0
[1.68.0]: https://github.com/applypack/applypack/compare/v1.67.0...v1.68.0
[1.67.0]: https://github.com/applypack/applypack/compare/v1.66.0...v1.67.0
[1.66.0]: https://github.com/applypack/applypack/compare/v1.65.0...v1.66.0
[1.65.0]: https://github.com/applypack/applypack/compare/v1.64.0...v1.65.0
[1.64.0]: https://github.com/applypack/applypack/compare/v1.63.0...v1.64.0
[1.63.0]: https://github.com/applypack/applypack/compare/v1.62.1...v1.63.0
[1.62.1]: https://github.com/applypack/applypack/compare/v1.62.0...v1.62.1
[1.62.0]: https://github.com/applypack/applypack/compare/v1.61.0...v1.62.0
[1.61.0]: https://github.com/applypack/applypack/compare/v1.60.0...v1.61.0
[1.60.0]: https://github.com/applypack/applypack/compare/v1.59.2...v1.60.0
[1.59.2]: https://github.com/applypack/applypack/compare/v1.59.1...v1.59.2
[1.59.1]: https://github.com/applypack/applypack/compare/v1.59.0...v1.59.1
[1.59.0]: https://github.com/applypack/applypack/compare/v1.58.0...v1.59.0
[1.58.0]: https://github.com/applypack/applypack/compare/v1.57.3...v1.58.0
[1.57.3]: https://github.com/applypack/applypack/compare/v1.57.2...v1.57.3
[1.57.2]: https://github.com/applypack/applypack/compare/v1.57.1...v1.57.2
[1.57.1]: https://github.com/applypack/applypack/compare/v1.57.0...v1.57.1
[1.57.0]: https://github.com/applypack/applypack/compare/v1.56.0...v1.57.0
[1.56.0]: https://github.com/applypack/applypack/compare/v1.55.5...v1.56.0
[1.55.5]: https://github.com/applypack/applypack/compare/v1.55.4...v1.55.5
[1.55.4]: https://github.com/applypack/applypack/compare/v1.55.3...v1.55.4
[1.55.3]: https://github.com/applypack/applypack/compare/v1.55.2...v1.55.3
[1.55.2]: https://github.com/applypack/applypack/compare/v1.55.1...v1.55.2
[1.55.1]: https://github.com/applypack/applypack/compare/v1.55.0...v1.55.1
[1.55.0]: https://github.com/applypack/applypack/compare/v1.54.1...v1.55.0
[1.54.1]: https://github.com/applypack/applypack/compare/v1.54.0...v1.54.1
[1.54.0]: https://github.com/applypack/applypack/compare/v1.53.0...v1.54.0
[1.53.0]: https://github.com/applypack/applypack/compare/v1.52.0...v1.53.0
[1.52.0]: https://github.com/applypack/applypack/compare/v1.51.0...v1.52.0
[1.51.0]: https://github.com/applypack/applypack/compare/v1.50.0...v1.51.0
[1.50.0]: https://github.com/applypack/applypack/compare/v1.49.0...v1.50.0
[1.49.0]: https://github.com/applypack/applypack/compare/v1.48.0...v1.49.0
[1.48.0]: https://github.com/applypack/applypack/compare/v1.47.2...v1.48.0
[1.47.2]: https://github.com/applypack/applypack/compare/v1.47.1...v1.47.2
[1.47.1]: https://github.com/applypack/applypack/compare/v1.47.0...v1.47.1
[1.47.0]: https://github.com/applypack/applypack/compare/v1.46.0...v1.47.0
[1.46.0]: https://github.com/applypack/applypack/compare/v1.45.0...v1.46.0
[1.45.0]: https://github.com/applypack/applypack/compare/v1.44.0...v1.45.0
[1.44.0]: https://github.com/applypack/applypack/compare/v1.43.0...v1.44.0
[1.43.0]: https://github.com/applypack/applypack/compare/v1.42.0...v1.43.0
[1.42.0]: https://github.com/applypack/applypack/compare/v1.41.0...v1.42.0
[1.41.0]: https://github.com/applypack/applypack/compare/v1.40.0...v1.41.0
[1.40.0]: https://github.com/applypack/applypack/compare/v1.39.0...v1.40.0
[1.39.0]: https://github.com/applypack/applypack/compare/v1.38.0...v1.39.0
[1.38.0]: https://github.com/applypack/applypack/compare/v1.37.0...v1.38.0
[1.37.0]: https://github.com/applypack/applypack/compare/v1.36.0...v1.37.0
[1.36.0]: https://github.com/applypack/applypack/compare/v1.35.0...v1.36.0
[1.35.0]: https://github.com/applypack/applypack/compare/v1.34.0...v1.35.0
[1.34.0]: https://github.com/applypack/applypack/compare/v1.33.0...v1.34.0
[1.33.0]: https://github.com/applypack/applypack/compare/v1.32.0...v1.33.0
[1.32.0]: https://github.com/applypack/applypack/compare/v1.31.0...v1.32.0
[1.31.0]: https://github.com/applypack/applypack/compare/v1.30.0...v1.31.0
[1.30.0]: https://github.com/applypack/applypack/compare/v1.29.0...v1.30.0
[1.29.0]: https://github.com/applypack/applypack/compare/v1.28.0...v1.29.0
[1.28.0]: https://github.com/applypack/applypack/compare/v1.27.0...v1.28.0
[1.27.0]: https://github.com/applypack/applypack/compare/v1.26.0...v1.27.0
[1.26.0]: https://github.com/applypack/applypack/compare/v1.25.0...v1.26.0
[1.25.0]: https://github.com/applypack/applypack/compare/v1.24.0...v1.25.0
[1.24.0]: https://github.com/applypack/applypack/compare/v1.23.4...v1.24.0
[1.23.4]: https://github.com/applypack/applypack/compare/v1.23.3...v1.23.4
[1.23.3]: https://github.com/applypack/applypack/compare/v1.23.2...v1.23.3
[1.23.2]: https://github.com/applypack/applypack/compare/v1.23.1...v1.23.2
[1.23.1]: https://github.com/applypack/applypack/compare/v1.23.0...v1.23.1
[1.23.0]: https://github.com/applypack/applypack/compare/v1.22.0...v1.23.0
[1.22.0]: https://github.com/applypack/applypack/compare/v1.21.0...v1.22.0
[1.21.0]: https://github.com/applypack/applypack/compare/v1.20.0...v1.21.0
[1.20.0]: https://github.com/applypack/applypack/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/applypack/applypack/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/applypack/applypack/compare/v1.17.0...v1.18.0
[1.17.0]: https://github.com/applypack/applypack/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/applypack/applypack/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/applypack/applypack/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/applypack/applypack/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/applypack/applypack/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/applypack/applypack/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/applypack/applypack/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/applypack/applypack/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/applypack/applypack/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/applypack/applypack/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/applypack/applypack/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/applypack/applypack/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/applypack/applypack/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/applypack/applypack/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/applypack/applypack/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/applypack/applypack/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/applypack/applypack/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/applypack/applypack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/applypack/applypack/compare/v0.11.1...v1.0.0
[0.11.1]: https://github.com/applypack/applypack/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/applypack/applypack/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/applypack/applypack/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/applypack/applypack/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/applypack/applypack/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/applypack/applypack/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/applypack/applypack/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/applypack/applypack/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/applypack/applypack/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/applypack/applypack/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/applypack/applypack/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/applypack/applypack/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/applypack/applypack/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/applypack/applypack/releases/tag/v0.1.0
