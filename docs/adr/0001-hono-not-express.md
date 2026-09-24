# 0001 — Hono not Express for the dashboard

**Status:** Accepted (phase-2); see the 2026-09-24 addendum

## Context

Phase 2 added a small dashboard. The worker uses native `fetch` and pino
and zod everywhere; we wanted the same low-ceremony stack on the web
side. Default JS-ecosystem choice is Express, but it's old, has a
weight problem (sync APIs everywhere), poor TypeScript ergonomics, and
no built-in JSX.

Alternatives considered:

- **Express 4/5** — battle-tested, biggest ecosystem.
- **Fastify** — modern, schema-validation-first, OpenAPI built in.
- **Next.js / SvelteKit** — full-stack frameworks with SSR.
- **Hono** — minimal (~20kb), TypeScript-first, native `fetch` API,
  JSX SSR built in via `hono/jsx`.

## Decision

We use **Hono 4** with `hono/jsx` for server-side rendering, htmx and
Tailwind via CDN. No build pipeline. ~3 npm dependencies for the whole
dashboard.

## Consequences

✅ Stylistically consistent with the worker (native fetch, async-first,
TypeScript-friendly types).
✅ JSX SSR without React/Vite/Next gives us proper component reuse for
~10 pages without 200kb of build tooling.
✅ Tiny attack surface — Hono is 20kb gzipped, mostly routing.
✅ Easy to read end-to-end — one Hono app file, route files mirror page
files 1:1.

❌ One real bug: `tsx` (the TS runner we use for dev) doesn't propagate
`jsxImportSource` from tsconfig when the entry-point is `.ts` and it
imports `.tsx`. Workaround: `dev:web` does `tsc && node --watch dist`
instead of `tsx watch`. Documented in CLAUDE.md gotchas.
❌ Smaller community than Express. When something obscure breaks
(rare), Stack Overflow has fewer answers.
❌ No built-in OpenAPI spec generation. Acceptable since this is an
internal single-user dashboard, not a public API.

## Addendum (2026-09-24): what changed since

- "htmx and Tailwind via CDN": htmx left in the v0.1.0 redesign and nothing
  loads it. Tailwind is built by `npm run css` (the Tailwind CLI, a dev
  dependency) into `src/web/public/tailwind.css`, which is committed, so the
  runtime still has no build step. Since v2.7.0 no page loads anything from
  a third-party host (`src/web/self-contained.test.ts`).
- "~3 npm dependencies for the whole dashboard": the server needs `hono` and
  `@hono/node-server`; the resume module it hosts adds `unpdf`, `jszip`,
  `@xmldom/xmldom`, `docx` and `pdfkit`. `package.json` lists 17 runtime
  dependencies in all.
- "~10 pages" and "route files mirror page files 1:1": the dashboard serves
  about two dozen pages. `src/web/routes/` holds 18 files and
  `src/web/pages/` holds 33, many of them cards shared between pages.
