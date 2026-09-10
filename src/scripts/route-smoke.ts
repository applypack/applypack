/*
 * Every GET route of the dashboard gets one request, in-process, against a
 * database that has just been migrated — plus the three POSTs that create
 * the rows the other pages need. No browser, no AI (the one background scan
 * it starts fails fast with no engine), no network. A route that answers
 * 500, or 4xx where 2xx/3xx is expected, fails the run.
 *
 * Run it on a throwaway database only — it inserts a job, a resume, a
 * screening and an applicant, and switches employer mode on:
 *
 *   DATABASE_URL=postgresql://…/scratch npx prisma migrate deploy
 *   npm run build && DATABASE_URL=… AI_PROVIDER=claude_code npm run smoke:routes
 *
 * CI runs exactly that on a Postgres service (.github/workflows/test.yml).
 * 145 handlers had zero automated requests before this (audit 2026-09-10,
 * TEST-1); the unit tests cover the pure modules, this covers the wiring.
 */
import { app } from '../web/app';
import { prisma } from '../db';
import { createManualJob } from '../jobs/manual-job';
import { createResume } from '../resume/store';
import { setEmployerMode } from '../settings';
import { createApplicant, createScreening } from '../screening/store';
import { draftRubric } from '../screening/rubric';
import { fingerprintText } from '../screening/intake';

/** What a page may answer: itself, or a redirect to where the state lives. */
const ACCEPT = new Set([200, 302, 303]);
/** Routes whose subject is a run that has finished or a file that was never written: 404 is the honest answer. */
const MAY_404 = new Set([
  '/target/runs/:id/state',
  '/runs/fetch-now/:id/state',
  '/companies/watchlist/:id/state',
  '/jobs/:id/cover/:letterId/file/:fmt',
]);
// app.request() builds no Host header of its own, and the origin guard
// compares Origin's host with it (same-origin.ts) — so the request says both.
const ORIGIN = { origin: 'http://localhost', host: 'localhost' };

const POSTING = [
  'Backend Engineer (Node.js, TypeScript, PostgreSQL). We build the services behind a scheduling product:',
  'REST APIs in Node.js and TypeScript, PostgreSQL with Prisma, Docker on a small VPS. You will own two',
  'services end to end, review pull requests, and keep the on-call rota honest. Remote within the EU.',
].join(' ');
const RESUME = [
  'Jane Example — Backend Engineer. Skills: Node.js, TypeScript, PostgreSQL, Prisma, Docker, Redis.',
  'Experience: Acme (2021–2026), backend engineer — built the billing service in Node.js and TypeScript,',
  'moved it from MySQL to PostgreSQL, cut p95 latency by 40%. Education: BSc Computer Science.',
].join('\n');

interface Fixtures {
  jobId: number;
  companyId: number;
  resumeId: number;
  screeningId: number;
  applicantId: number;
}

async function fixtures(): Promise<Fixtures> {
  const job = await createManualJob(
    { companyName: 'Smoke Co', title: 'Backend Engineer', url: '', location: 'Remote', description: POSTING },
    { classify: false },
  );
  const resume = await createResume({
    name: 'Smoke resume',
    sourceFilename: 'smoke.txt',
    mimeType: 'text/plain',
    original: Buffer.from(RESUME),
    text: RESUME,
  });
  await setEmployerMode(true);
  const screening = await createScreening({
    jobId: job.job.id,
    title: 'Smoke screening',
    postingText: POSTING,
    rubric: draftRubric(null),
    retainUntil: new Date(Date.now() + 7 * 86_400_000),
  });
  const print = fingerprintText(RESUME);
  const applicant = await createApplicant({
    screeningId: screening.id,
    name: null,
    email: null,
    phone: null,
    sourceFilename: 'smoke.txt',
    mimeType: 'text/plain',
    original: Buffer.from(RESUME),
    text: RESUME,
    redactedTextFor: (n) => RESUME.replace('Jane Example', `Applicant №${n}`),
    redactions: [],
    parseStatus: 'ok',
    parseNote: null,
    sameAsId: null,
    textHash: print.hash,
    simhash: print.simhash,
  });
  return { jobId: job.job.id, companyId: job.job.companyId, resumeId: resume.id, screeningId: screening.id, applicantId: applicant.id };
}

/** A route pattern with its params filled from the fixtures. */
function fill(path: string, f: Fixtures): string {
  const id =
    path.startsWith('/jobs/') ? f.jobId
    : path.startsWith('/resumes/') ? f.resumeId
    : path.startsWith('/screen/') ? f.screeningId
    : path.startsWith('/companies/watchlist/') ? 'gone'
    : path.startsWith('/companies/') ? f.companyId
    : 'gone';
  return path
    .replace(':aid', String(f.applicantId))
    .replace(':letterId', '1')
    .replace(':matchId', '1')
    .replace(':index', '0')
    .replace(':fmt', 'pdf')
    .replace(':key', 'applied')
    .replace(':id', String(id));
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { ...ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

async function main(): Promise<void> {
  const f = await fixtures();
  const gets = [...new Set(app.routes.filter((r) => r.method === 'GET' && !r.path.includes('*')).map((r) => r.path))].sort();

  const rows: { route: string; url: string; status: number; ok: boolean }[] = [];
  for (const route of gets) {
    const url = fill(route, f);
    const res = await app.request(url, { headers: ORIGIN });
    const ok = ACCEPT.has(res.status) || (res.status === 404 && MAY_404.has(route));
    rows.push({ route, url, status: res.status, ok });
  }

  // The writes a first run makes, through the same guard a browser meets.
  const posts: { name: string; init: RequestInit; expect: (res: Response) => boolean }[] = [
    {
      name: 'POST /jobs/new (a pasted posting)',
      init: form({ companyName: 'Smoke Two', title: 'Platform Engineer', url: '', location: 'Berlin', description: POSTING }),
      expect: (res) => res.status === 303 && /^\/jobs\/\d+/.test(res.headers.get('location') ?? ''),
    },
    {
      name: 'POST /resumes (a .txt upload)',
      init: (() => {
        const body = new FormData();
        body.set('name', 'Smoke upload');
        body.set('file', new File([RESUME], 'smoke.txt', { type: 'text/plain' }));
        return { method: 'POST', headers: ORIGIN, body } satisfies RequestInit;
      })(),
      expect: (res) => res.status === 303 && (res.headers.get('location') ?? '').startsWith('/target/runs/'),
    },
    {
      name: 'POST /settings/fetching-toggle',
      init: form({}),
      expect: (res) => res.status === 303,
    },
    {
      name: 'POST /jobs/:id/status from another origin (refused)',
      init: { method: 'POST', headers: { origin: 'http://evil.example', host: 'localhost', 'content-type': 'application/x-www-form-urlencoded' }, body: 'status=SAVED' },
      expect: (res) => res.status === 403,
    },
  ];
  const postPaths = ['/jobs/new', '/resumes', '/settings/fetching-toggle', `/jobs/${f.jobId}/status`];
  for (const [i, p] of posts.entries()) {
    const res = await app.request(postPaths[i]!, p.init);
    rows.push({ route: p.name, url: postPaths[i]!, status: res.status, ok: p.expect(res) });
  }

  const failed = rows.filter((r) => !r.ok);
  const width = Math.max(...rows.map((r) => r.route.length));
  for (const r of rows) console.log(`${r.ok ? 'ok ' : 'FAIL'}  ${r.status}  ${r.route.padEnd(width)}  ${r.url}`);
  console.log(`\n${rows.length} requests, ${rows.length - failed.length} as expected, ${failed.length} failed`);
  await prisma.$disconnect();
  // A background scan the upload started may still hold a child; the answer is in.
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
