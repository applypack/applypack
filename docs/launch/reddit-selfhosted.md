# r/selfhosted — draft for manual posting

> Draft only, posted by hand from Nazar's account; the text discloses
> authorship. Re-check the subreddit's current self-promotion rules on
> posting day.

## Title

```
ApplyPack: self-hosted job-hunt console – watches the boards, scores your resume without flattery, pings Telegram (MIT)
```

## Body

I was looking for a job and got tired of being the cron job myself:
refresh the boards, read every posting, realize it's the wrong stack or
quietly country-locked. So I built the console I wanted, ran my own
search through it every day, and that is how I found the job I have
now. It watches the boards, and my Telegram only rings when a posting
clears my fit threshold. Resume, profile and every AI report stay in my Postgres. The
scoring part runs live in your browser, no signup:
https://applypack.dev/demo/

What it does:

* Checks 22 sources hourly: ten ATS vendors (Greenhouse, Lever, Ashby,
  Workable, SmartRecruiters, Recruitee, Breezy, BambooHR, Pinpoint,
  Rippling) on company boards you pick, eleven aggregators, and the
  monthly HN "Who is hiring" thread
* An AI classifier reads each full description against your profile.
  "Remote · Germany" is not a US-remote match, and "full-stack" in a
  title is not a stack match; both rules exist because both burned me
* Resume-vs-posting scoring where the model marks facts and
  deterministic code computes the number, so a Laravel resume can't
  sweet-talk its way to 85 against a Node.js posting
* Ghost-job verification: a web-search checklist returns
  legit / suspicious / fake with evidence URLs
* Cover letters behind a fact gate (a claim must exist in your resume or
  your confirmed facts to reach the letter), exported to PDF / DOCX
* A small application tracker with a "gone quiet for two weeks" nudge

Self-hosting details, since that's why we're here:

* `docker compose up -d` brings up Postgres 16, a cron worker and a
  dashboard. The dashboard binds to 127.0.0.1; put your own proxy in
  front if you want it off-box
* No accounts, no telemetry, no phone-home. Outbound traffic goes to
  the job boards and to whichever AI backend you configure
* AI is the one running cost, and you pick the meter: Claude Code /
  Gemini / Codex CLIs ride subscriptions you already pay ($0 extra),
  the Anthropic API costs about $0.001 per classified job ($2–10/month
  at 5–10 matching jobs a day; prompt caching covers ~90% of the system
  prompt), or point the OpenAI-compatible engine at Ollama / LM Studio
  and pay nothing. Engines chain with automatic failover
* Official public APIs and RSS only. No LinkedIn / Indeed / Glassdoor /
  Workday scraping; an ADR in the repo draws that line. For anything
  uncovered you paste the posting by hand, and the HN parser harvests
  company boards into a review queue

Single-user by design, MIT. Repo:
https://github.com/applypack/applypack. Setup for every AI engine, local
and Docker, is in docs/ai-engines.md.
