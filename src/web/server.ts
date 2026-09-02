import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { secureHeaders } from 'hono/secure-headers';
import { config } from '../config';
import { logger } from '../logger';
import { prisma } from '../db';
import { originGuard } from './origin-guard';
import { overviewRoute } from './routes/overview';
import { jobsRoute } from './routes/jobs';
import { companiesRoute } from './routes/companies';
import { runsRoute } from './routes/runs';
import { settingsRoute } from './routes/settings';
import { applicationsRoute } from './routes/applications';
import { discoveryRoute } from './routes/discovery';
import { resumesRoute } from './routes/resumes';
import { targetRoute } from './routes/target';
import { letterRoute } from './routes/letter';
import { factsRoute } from './routes/facts';
import { keywordsRoute } from './routes/keywords';
import { healthRoute } from './routes/health';
import { welcomeRoute } from './routes/welcome';

const app = new Hono();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // Tailwind from CDN, Inter from Google Fonts (layout.tsx).
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
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
    logger.warn('web: WEB_BASIC_AUTH set but malformed (expected user:password) — auth disabled');
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

// Tiny request log.
app.use('*', async (c, next) => {
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

// Browser-side keyword matcher for /jobs/:id/target (ADR 0010).
app.use('/static/*', serveStatic({ root: './src/web/public', rewriteRequestPath: (p) => p.replace(/^\/static/, '') }));

app.route('/', overviewRoute);
app.route('/', welcomeRoute);
app.route('/', jobsRoute);
app.route('/', applicationsRoute);
app.route('/', resumesRoute);
app.route('/', targetRoute);
app.route('/', letterRoute);
app.route('/', factsRoute);
app.route('/', keywordsRoute);
app.route('/', companiesRoute);
app.route('/', discoveryRoute);
app.route('/', runsRoute);
app.route('/', settingsRoute);
app.route('/', healthRoute);

app.notFound((c) => c.text('Not found', 404));

app.onError((err, c) => {
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
