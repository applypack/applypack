# applypack.dev

Static landing for the project. Zero build step, zero dependencies —
`public/` is served as-is. The screenshots are copies of
`docs/screenshots/` (kept in sync by hand when those regenerate), and
`img/og.png` is a copy of `docs/brand/social-card.png`.

## Local preview

```bash
python3 -m http.server 8901 --bind 127.0.0.1 --directory site/public
```

## Deploy (Cloudflare Pages, one-time hookup)

1. Cloudflare dashboard → Workers & Pages → Create → Pages →
   Connect to Git → pick `nazboyko/applypack`.
2. Build settings:
   - **Root directory**: `site`
   - **Build command**: *(leave empty)*
   - **Build output directory**: `public`
3. After the first deploy: Custom domains → add `applypack.dev`
   (the domain is already on Cloudflare, so this is one click).
4. Optional: Settings → Builds → **Build watch paths** → include
   `site/*` so app-only commits don't trigger site deploys.

Every push to `main` that touches `site/` then redeploys automatically.
