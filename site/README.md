# applypack.dev

Static landing for the project. Zero build step, zero dependencies —
`public/` is served as-is.

- `index.html` is the landing; `demo/` is the live-scoring demo, and the
  landing embeds the same demo in its hero (both pages load
  `demo/demo.mjs`).
- `demo/score.mjs` and `demo/target.mjs` are byte copies of
  `src/web/public/` (enforced by `src/web/site-vendor.test.ts` — re-copy
  when they change); `demo/fixture.json` is the synthetic Fernway /
  Dana Ruiz comparison exported from a real match run.
- `fonts/inter-latin.woff2` is the Inter variable font, latin subset, as
  served by Google Fonts (SIL OFL, `fonts/LICENSE-Inter.txt`). Self-hosted
  so the page does not block on a third-party stylesheet.
- `img/*.webp` are crops of `docs/screenshots/` (`cwebp -q 82`, plus a
  `-720` copy of each; re-make them when those regenerate): `jobs.webp`
  from `jobs-list.png`, `resume-score.webp` from `tailor-resume.png`, and
  each `screening-*.webp` from the `.png` of the same name. `jobs.webp`
  and `resume-score.webp` were cut before those two files were retaken
  and renamed (they were `jobs.png` and `target.png`), so they still show
  the older screens. `img/og.png` is a copy of
  `docs/brand/social-card.png`, and `img/apple-touch-icon.png` is
  `favicon.svg` rendered at 180 px.

The plan behind the current page is [docs/site-refresh-plan.md](../docs/site-refresh-plan.md).

## Local preview

```bash
python3 -m http.server 8901 --bind 127.0.0.1 --directory site/public
```

## Deploy (Cloudflare Worker with static assets)

The site is NOT a Cloudflare Pages project. It runs as a Cloudflare
**Worker** that serves `site/public` as static assets:

- Worker URL: https://applypack.boyko-nazar.workers.dev
- Custom domains on the Worker: `applypack.dev` and `www.applypack.dev`

The Worker itself is configured by [`wrangler.jsonc`](../wrangler.jsonc)
at the repo root (assets-only: `site/public`, no script). The Cloudflare
dashboard (Workers & Pages → applypack) keeps the rest: the git
connection (Workers Builds) and the custom domains.

Deploys ship from that git connection: a push to `main` deploys; a push
to any other branch only uploads a preview version (`npx wrangler
versions upload`, visible as a "Workers Builds" check on PRs). Check
Deployments in the dashboard if a push doesn't show up on the domain
within a couple of minutes.
