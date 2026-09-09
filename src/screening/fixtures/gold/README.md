# Gold sets for `npm run bench:screen`

One folder per posting. The bench reads each resume, redacts it, asks the
resume model once per run, anchors and scores exactly as the screening
does, and holds the table's order against the human's (hr-screening-plan.md
stage 0; screening-criteria-plan.md §6 stage E). Nothing is written to the
database.

```
<set>/
  posting.txt      the posting text
  rubric.json      the criteria (screening/rubric.ts RubricSchema, version 2)
  ranking.txt      the human's order, best first, one resume file per line
  resumes/         .pdf / .docx / .md / .txt, one applicant each
  expected.json    optional: { "<file>": { "<gate id>": "pass|unknown|fail" } }
```

`qa-automation` is a starter: six synthetic resumes and a ranking written by
the author of the fixtures, so its τ says nothing yet. A set counts when a
recruiter ranked it: three postings × ~30 resumes is the target.

Run `npm run bench:screen -- --set qa-automation --runs 2`. Two runs of the
same texts give the stability line (the score movement between runs); a
resume named `<name>.tailored.<ext>` is paired with `<name>.<ext>` for the
tailoring test (the same facts reworded must score the same).
