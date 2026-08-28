import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { secureHeaders } from 'hono/secure-headers';
import { config } from '../config';
import { logger } from '../logger';
import { prisma } from '../db';
import { overviewRoute } from './routes/overview';
import { jobsRoute } from './routes/jobs';
import { companiesRoute } from './routes/companies';
import { runsRoute } from './routes/runs';
import { settingsRoute } from './routes/settings';
import { applicationsRoute } from './routes/applications';
import { discoveryRoute } from './routes/discovery';
import { resumesRoute } from './routes/resumes';
import { healthRoute } from './routes/health';

const app = new Hono();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // Tailwind + htmx from CDN, Fira fonts from Google Fonts (layout.tsx).
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://unpkg.com'],
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
        realm: 'job-hunter',
      }),
    );
    logger.info({ user: username }, 'web: basic auth enabled');
  } else {
    logger.warn('web: WEB_BASIC_AUTH set but malformed (expected user:password) — auth disabled');
  }
}

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

app.route('/', overviewRoute);
app.route('/', jobsRoute);
app.route('/', applicationsRoute);
app.route('/', resumesRoute);
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
