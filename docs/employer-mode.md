# Employer mode: screening a folder of resumes

> The full description of the mode. The [README](../README.md#employer-mode-screening-a-folder-of-resumes)
> has the summary; the decisions behind it are ADR
> [0047](./adr/0047-screening-scores-evidence-not-keywords.md) to
> [0052](./adr/0052-calibration-reports-agreement-and-never-tunes-the-rubric.md).


ApplyPack is a candidate's tool, and this is the one feature that sits on
the other side of the table. It is off by default; Settings → Screening
turns it on and adds "Screening" to the menu, and nothing else changes.

**One position, the criteria in your words.** A screening is one position
— one of your stored jobs, or a pasted or uploaded posting, kept as the
screening's own editable snapshot — and its applicants. The posting is
read once into a draft list of criteria you edit before anyone is scored:
a gate (pass / unknown / fail, never points), a scored criterion with one
to five stars, or a note that is shown and not counted. Each row is a kind
and a line of text — "Playwright / Cypress !", "0–2 years", "fintech,
payments: 3+", "has led a team of three or more" — and the last row takes
anything in your own words, answered yes/no or on the evidence ladder.
Five presets bend the draft (Standard, Junior hire, Senior / lead,
Regulated, Agency work); a criterion naming age, gender, family, origin or
health is refused with the lawful criterion offered instead.

<img src="./screenshots/screening-criteria.png" alt="A screening: the position card, and the criteria card showing every criterion as a chip — gates, skills with stars, level, sector, impact — with a button that opens the editor" width="900">

**Blind by construction.** Resumes go in as files, a zip or a whole folder
with its subfolders; a second document of someone already in the list is
scored and labelled, the same file twice is skipped, a scanned PDF stays
in the list unscored so you can see it. Before any model reads a file the
name, contacts, links, date of birth, age, family, gender, citizenship,
street address and graduation years are removed; you see the name, the
model sees "Applicant №7", and that cannot be switched off. Scoring
starts the moment the files are in, one independent call per applicant,
and every row says where it is.

**Every answer with its quote; the score in code.** The model answers
each criterion in the shape its kind asks — a rung on the evidence ladder
for a skill (absent · skills list · project · in a role · production), a
pass / partial / unknown / fail for a gate, a level, an impact grade, the
overall read with reasons and concerns — each with the verbatim line that
earns it. A checker holds every quote against the text: an unquoted mark
falls to what the text shows, a list of terms supports at most "listed"
or, on a job's own stack line, "role" (production is a work bullet with an
outcome), a term the text never spells is absent whatever line was quoted.
Application code then sums stars × answer over the criteria the text could
answer, with caps a rubric cannot express — none of the core stack
anywhere → 30 at most — and years, sectors and company types read off the
dated roles. The table orders by gate bucket, then score, then confidence;
beside the score sit the facts the criteria did not ask for ("stands out",
each with its line), the career read off the dates, and your own ±30
adjustment with its reason, which the export carries.

<img src="./screenshots/screening-scorecard.png" alt="A scorecard: who / did / verdict, the stands-out facts with their quotes, and one row per criterion with the answer, the line from the resume and the points" width="900">

**The shortlist, argued on one page.** Tick two to five applicants →
Compare: one column each, one row per criterion with the quotes, no new
call. Compare with AI reads the same shortlist head to head, twice with
the order reversed, and says who is stronger on each criterion and why,
whom to talk to first, the one question that would decide between the
first two — and where the two readings disagree, which is information,
not a bug. Never a score; the table keeps its order. Copy as Markdown for
the meeting.

<img src="./screenshots/screening-compare.png" alt="Compare with AI: three applicants read head to head, the order to talk to from two readings, where they agree and differ per criterion" width="900">

**Does it rank the way you do?** The decision column is yours alone; the
tool never writes it. Once three decisions with a To interview and a
Declined among them exist, a calibration card reads them against the
order: how many of your k picks sit in the table's top k, what share of
the pairs you decided differently the table orders the same way (with the
counts), the surprises with the criteria behind each, and which criteria
tell your picks from the rest. It never re-weights a criterion by itself —
that is the editor, and yours. `npm run bench:screen` does the same over a
ranked gold folder, writing nothing.

<img src="./screenshots/screening-calibration.png" alt="Calibration: one of two interview picks in the table's top two, three quarters of the decided pairs ordered the way you did, the one surprise with the gates behind it, and the per-criterion gaps between the interviewed and the declined" width="900">

CSV and Markdown carry the whole table; the screening is deleted with its
files on its retention date (90 days by default) or at once from its page,
and your files on disk are never touched.

**Read this before turning it on.** Screening other people's resumes with
an AI tool is regulated in a way the rest of ApplyPack is not. Under the
EU AI Act (Annex III, 4(a)) a system that filters job applications is
high-risk, and the open-source exemption does not cover high-risk use;
under GDPR art. 22 nobody may be subject to a hiring decision made solely
by automated means, art. 13–14 require applicants to be told, and art. 35
wants an impact assessment; NYC Local Law 144, Colorado SB 24-205 and
Illinois HB 3773 add audit and notice duties in the US. The mode is built
to be the tool and not the decision, but two things are yours: tell
applicants (the settings tab has a copy-ready notice), and run it on an
engine you have a data-processing agreement with or on a local model — a
personal-subscription CLI is not that, and the screening page says so.
This is not legal advice. The decisions behind the mode are ADR
[0047](./adr/0047-screening-scores-evidence-not-keywords.md)
(evidence, not keywords), [0048](./adr/0048-applicant-data-is-redacted-and-expires.md)
(redaction and retention), [0049](./adr/0049-employer-mode-is-a-mode-not-a-product.md)
(a mode, not a product), [0050](./adr/0050-the-rubric-is-a-list-of-criteria-the-person-chooses.md)
(the criteria are the person's), [0051](./adr/0051-a-shortlist-is-compared-head-to-head-twice.md)
(the comparison is never a score) and [0052](./adr/0052-calibration-reports-agreement-and-never-tunes-the-rubric.md)
(calibration measures, never tunes).

