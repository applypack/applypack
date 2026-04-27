# Project conventions

## Stack
- TypeScript strict mode, Node 20
- Prisma + Postgres 16 (already in docker-compose)
- Native fetch (no axios). Use AbortController for timeouts (10s default).
- pino for logs (never console.log in production code)
- zod for ALL external data: env vars, API responses, Claude output

## Code style
- No default exports. Named exports only.
- Pure functions where possible. Side effects (DB, HTTP, Telegram) isolated to dedicated modules.
- async/await, never raw promise chains.
- Errors: throw typed errors with context. Caller decides logging.
- No magic numbers. Constants at top of file or in config.ts.

## File rules
- Each fetcher returns NormalizedJob[] — never writes to DB directly.
- filter.ts is pure — no I/O.
- classifier.ts only calls Claude — no DB.
- jobs/fetch-job.ts is the only orchestrator that touches DB + alerts.
- The cron worker (src/index.ts + src/jobs/*) MUST NOT run an HTTP server.
- The dashboard lives in src/web/ as a SEPARATE service (Hono). It shares Postgres with the worker but runs in its own container/process. It is read-mostly with limited writes (status changes, re-classify).

## DO NOT
- Do not add Express, Next.js, or any HTTP server to the worker process.
- Do not add Redis, BullMQ, or other queues — node-cron is sufficient.
- Do not expose the dashboard on a public interface by default — bind to 127.0.0.1 in compose.
- Do not store secrets anywhere except .env (gitignored).
- Do not commit node_modules, dist, or .env.
- Do not use any --save-dev that isn't necessary.

## Testing
Phase 1: manual. Run `npm run fetch:once` to trigger one cycle. Verify Telegram message arrives. No unit tests yet — add in Phase 2 when stack stabilizes.

## Docker
- Multi-stage Dockerfile: deps → build → runtime
- Runtime image: node:20-alpine
- Run prisma migrate deploy on container start (in init.ts, before cron registers)
- Use .dockerignore to exclude node_modules, .env, dist, .git