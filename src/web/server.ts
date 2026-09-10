import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { config } from '../config';
import { logger } from '../logger';
import { prisma } from '../db';
import { originGuard } from './origin-guard';
import { overviewRoute } from './routes/overview';
import { jobsRoute } from './routes/jobs';
import { companiesRoute } from './routes/companies';
import { watchlistRoute } from './routes/watchlist';
import { runsRoute } from './routes/runs';
import { settingsRoute } from './routes/settings';
import { applicationsRoute } from './routes/applications';
import { discoveryRoute } from './routes/discovery';
import { resumesRoute } from './routes/resumes';
import { resumeRenderRoute } from './routes/resume-render';
import { targetRoute } from './routes/target';
import { letterRoute } from './routes/letter';
import { factsRoute } from './routes/facts';
import { keywordsRoute } from './routes/keywords';
import { healthRoute } from './routes/health';
import { welcomeRoute } from './routes/welcome';
import { countriesRoute } from './routes/countries';
import { screenRoute } from './routes/screen';
import { ensureEmployerMode } from './employer-mode';
import { DEFAULT_BODY_BYTES, hasOwnBodyLimit } from './body-limits';

const app = new Hono();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // Nothing from a third party: the Tailwind build and Inter are served
      // from /static (layout.tsx, npm run css).
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
  }),
);

if (config.WEB_BASIC_AUTH) {
  const [username, ...rest] = config.WEB_BASIC_AUTH.split(':');
  const password = rest.join(':');
  if (username && password) {
    app.use(
      '*',
      basicAuth({
        username,
        password,
        realm: 'applypack',
      }),
    );
    logger.info({ user: username }, 'web: basic auth enabled');
  } else {
    // Fail closed: the operator asked for a lock and got the value wrong.
    // Serving open with a warning in the log is how that goes unnoticed on
    // a host bound to 0.0.0.0 (audit 2026-09-10, SEC-7).
    logger.error('web: WEB_BASIC_AUTH is set but not user:password — refusing to start without the lock');
    process.exit(1);
  }
}

/**
 * Cross-origin writes are refused (issue #69). The dashboard binds to
 * 127.0.0.1 and its Basic Auth is optional, so the attack that actually
 * reaches it is a page in the same browser POSTing to localhost:4747 — this
 * is the check that costs nothing and stops it. Same-origin forms, curl and
 * the repo's own scripts are unaffected; see same-origin.ts for why there is
 * no token, and origin-guard.ts for why the wiring is not inline here.
 */
app.use('*', originGuard());

// Static files (the browser modules of ADR 0010 among them) never touch the
// database: served before anything that does, so an unreachable Postgres
// cannot turn a stylesheet into a 500.
app.use('/static/*', serveStatic({ root: './src/web/public', rewriteRequestPath: (p) => p.replace(/^\/static/, '') }));

// Every POST carries a body ceiling; the upload routes bring their own,
// larger one and are stepped around here (body-limits.ts).
app.use('*', async (c, next) =>
  hasOwnBodyLimit(c.req.method, c.req.path) ? next() : bodyLimit({ maxSize: DEFAULT_BODY_BYTES })(c, next),
);

// Tiny request log; also loads the employer-mode switch once, for the sidebar (ADR 0049).
app.use('*', async (c, next) => {
  // The sidebar's one switch. With the database down every route used to
  // die here, /health included — the route decides what a missing database
  // means for it (a 503 on /health), so the failure is logged and passed.
  try {
    await ensureEmployerMode();
  } catch (err) {
    logger.warn({ err, path: c.req.path }, 'web: employer mode unknown — database unreachable');
  }
  const started = Date.now();
  await next();
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - started,
    },
    'web: request',
  );
});

app.route('/', overviewRoute);
app.route('/', welcomeRoute);
app.route('/', countriesRoute);
app.route('/', jobsRoute);
app.route('/', applicationsRoute);
app.route('/', resumesRoute);
app.route('/', resumeRenderRoute);
app.route('/', targetRoute);
app.route('/', letterRoute);
app.route('/', factsRoute);
app.route('/', keywordsRoute);
app.route('/', watchlistRoute);
app.route('/', companiesRoute);
app.route('/', discoveryRoute);
app.route('/', runsRoute);
app.route('/', screenRoute);
app.route('/', settingsRoute);
app.route('/', healthRoute);

app.notFound((c) => c.text('Not found', 404));

app.onError((err, c) => {
  // A status hono itself raised — the 413 of a body past its limit — is the
  // answer, not an accident to flatten into a 500.
  if (err instanceof HTTPException) return err.getResponse();
  logger.error({ err, path: c.req.path }, 'web: unhandled error');
  return c.text('Internal server error', 500);
});

const server = serve(
  {
    fetch: app.fetch,
    port: config.WEB_PORT,
    hostname: config.WEB_HOST,
  },
  (info) => {
    logger.info(
      { host: info.address, port: info.port },
      'web: listening',
    );
  },
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'web: shutting down');
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
