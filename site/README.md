# applypack.dev

Static landing for the project. Zero build step, zero dependencies —
`public/` is served as-is. The screenshots are copies of
`docs/screenshots/` (kept in sync by hand when those regenerate), and
`img/og.png` is a copy of `docs/brand/social-card.png`.

`demo/` is the live-scoring demo: `demo/score.mjs` and `demo/target.mjs`
are byte copies of `src/web/public/` (enforced by
`src/web/site-vendor.test.ts` — re-copy when they change), and
`demo/fixture.json` is the synthetic Fernway / Dana Ruiz comparison
exported from a real match run.

## Local preview

```bash
python3 -m http.server 8901 --bind 127.0.0.1 --directory site/public
```

## Deploy (Cloudflare Worker with static assets)

The site is NOT a Cloudflare Pages project. It runs as a Cloudflare
**Worker** that serves `site/public` as static assets:

- Worker URL: https://applypack.boyko-nazar.workers.dev
- Custom domains on the Worker: `applypack.dev` and `www.applypack.dev`

The Worker's configuration lives in the Cloudflare dashboard
(Workers & Pages → the applypack worker) — there is deliberately no
`wrangler.toml` in this repo. Build settings there:

- **Root directory**: `site`
- **Build command**: *(empty — nothing to build)*
- **Assets directory**: `public`

Deploys ship from the Worker's git connection (Workers Builds) on
pushes to `main`; check Deployments in the dashboard if a push doesn't
show up on the domain within a couple of minutes.
