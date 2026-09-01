# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security → Report a
vulnerability** on this repository
([direct link](https://github.com/nazboyko/applypack/security/advisories/new)).
Please don't open a public issue for anything you believe is exploitable.

Expect an acknowledgement within a few days. There is no bug bounty — this
is a solo open-source project — but reports are read, credited in the fix
release, and prioritised over feature work.

## What's most valuable to report

ApplyPack is self-hosted: the dashboard binds to `127.0.0.1` and there is
no hosted instance, so the interesting surface is what the app does with
untrusted input on your machine:

- prompt-injection paths from fetched postings or pasted text into AI calls
  that escape the fence (`src/prompt-fence.ts`, ADR 0022)
- SSRF or blocklist bypasses in user-supplied URL fetching
  (`src/jobs/posting-url.ts`, ADR 0005)
- anything that lets stored resume text, profile data or API keys leave the
  machine
- XSS in the dashboard (server-rendered JSX in `src/web/`)

## Supported versions

Only the latest release is supported; there are no backports.
