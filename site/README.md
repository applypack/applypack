# applypack.dev

Static landing for the project. Zero build step, zero dependencies —
`public/` is served as-is.

- `index.html` is the landing; `demo/` is the live-scoring demo, and the
  landing embeds the same demo in its hero (both pages load
  `demo/demo.mjs`). `employers/` is employer mode's own page; the landing
  keeps a short section that links to it. `sitemap.xml` lists the three.
- `tour.webm` (VP9) and `tour.mp4` (H.264, for Safari) are the README's
  tour as a 25-second video, shown in the landing's Tour section with
  `img/tour-poster.webp` as its poster, and linked from the launch posts
  (the recipe is in `docs/screenshots/README.md`).
- `demo/score.mjs`, `demo/target.mjs`, `demo/evidence.mjs`, `demo/i18n.mjs` and
  `demo/i18n-en.mjs` are byte copies of `src/web/public/` (enforced by
  `src/web/site-vendor.test.ts` — re-copy when they change; `target.mjs` words
  its lines through `i18n.mjs`); `demo/fixture.json` is the synthetic Fernway /
  Dana Ruiz comparison exported from a real match run.
- `fonts/inter-latin.woff2` is the Inter variable font, latin subset, as
  served by Google Fonts (SIL OFL, `fonts/LICENSE-Inter.txt`). Self-hosted
  so the page does not block on a third-party stylesheet.
- `img/*.webp` are crops of `docs/screenshots/` (`cwebp -q 82`, plus a
  `-720` copy of each; re-make them when those regenerate): `jobs.webp`
  is `jobs-ranked.png` whole, `resume-score.webp` is the score card of
  `tailor-score.png` (`cwebp -q 82 -crop 256 16 1168 610`), and each
  `screening-<name>.webp` is `employer-<name>.png`; `img/og-employers.png` is the
  top of `employer-scorecard.png` (its content column, x 240–1440, y 0–600) at 1280×640 (a PNG, which every preview
  reads). `img/og.png` is a copy of
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
