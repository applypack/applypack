# Show HN — draft for manual posting

> Draft only. Nothing in `docs/launch/` gets published by automation;
> Nazar submits by hand. Per TASKS §9: pick a Tue–Thu, US morning,
> stay in the comments for ~6 hours after submitting.

## Submission

- **URL:** https://applypack.dev/demo/ (the live scoring demo leads;
  the first comment carries the repo link)
- **Title** (77 chars, HN limit 80):

```
Show HN: ApplyPack – self-hosted job search where AI marks facts, code scores
```

Alternates if the primary reads flat on the day:

```
Show HN: ApplyPack – watch job boards, score resumes honestly, self-hosted    (74)
Show HN: A resume scorer the model can't flatter, from my self-hosted job hunt (78)
```

## First comment (post right after submitting)

I built this mid job hunt, and it is how I found the job I have now.
The boards were eating my evenings: every promising "Senior Engineer"
listing took three minutes of reading to reveal a wrong stack, a wrong
country, or a ghost posting. ApplyPack did that reading for me, on my
own machine, every day of the search.

The submission link (https://applypack.dev/demo/) is the app's actual
scoring module compiled for the browser, on a synthetic resume and
posting. My first version let the model output the score, and it graded a
Laravel/Vue resume 82/100 against a Node.js/React posting. Credit leaked
through sibling tech: Vue read as close enough to React, PHP as close
enough to Node. So I split the jobs. The model only marks facts per
keyword (present, add, cannot_claim; must-have or nice; primary stack or
not), and TypeScript computes the number, with a hard cap when the
posting's primary stack is missing. Same resume after the split: 10/100
against that Node posting, 92/100 against a Laravel one.

You can feel it in the demo. Type Redis into the skills line and the
score moves on the next keystroke. Type Terraform and nothing moves: the
model marked it cannot-claim against the original resume, and typing a
word is not evidence. Delete TypeScript to watch the primary-stack cap
bite.

Scoring is one corner of the console. A worker checks 22 sources hourly
(Greenhouse, Lever, Ashby and seven more ATS vendors on boards you pick,
eleven aggregators, the monthly HN "Who is hiring" thread), a classifier
reads each posting against your profile, and Telegram pings you above
your fit threshold. A ghost-job check runs a web-search checklist and
returns legit / suspicious / fake with evidence URLs. A cover-letter
writer sits behind a fact gate: a metric that appears in neither your
resume nor your confirmed facts never reaches the letter.

Stack: TypeScript strict, Postgres, two containers behind docker compose,
dashboard bound to 127.0.0.1. AI is bring-your-own with failover: Claude
Code / Gemini / Codex CLIs riding subscriptions you already pay for, the
Anthropic API, or any OpenAI-compatible endpoint, including a local
model. One honest caveat: consumer-subscription terms don't explicitly
cover a background service, so the README tells you to read yours before
making a subscription the primary engine. Sources are official public
APIs and RSS only; no LinkedIn, Indeed or Workday scraping, and
docs/adr/0005 says why. MIT.

Repo: https://github.com/applypack/applypack. If you want to argue with
the scoring weights, the decision record is docs/adr/0012 and it is a
two-minute read.
