/*
 * Every GET route of the dashboard gets one request, in-process, against a
 * database that has just been migrated — plus the POSTs that create the rows
 * the other pages need, and one clean PDF render. No browser, no AI (the one
 * background scan it starts fails fast with no engine), no network. A route
 * that answers 500, or 4xx where 2xx/3xx is expected, fails the run.
 *
 * Run it on a throwaway database only — it inserts a job, a resume, a
 * screening and an applicant (and a search, where nothing was seeded), and
 * switches employer mode on:
 *
 *   DATABASE_URL=postgresql://…/scratch npx prisma migrate deploy
 *   npm run build && DATABASE_URL=… AI_PROVIDER=claude_code npm run smoke:routes
 *
 * CI runs exactly that on a Postgres service (.github/workflows/test.yml).
 * 145 handlers had zero automated requests before this (audit 2026-09-10,
 * TEST-1); the unit tests cover the pure modules, this covers the wiring.
 */
import './route-smoke-env';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from '../web/app';
import { DEFAULT_BODY_BYTES } from '../web/body-limits';
import { prisma } from '../db';
import { createManualJob } from '../jobs/manual-job';
import { createMatch, createResume } from '../resume/store';
import { parseMatchResponse, PROMPT_VERSION } from '../resume/prompts';
import { scoreMatch } from '../resume/score';
import { getSettings, setAiBudgetCents, setEmployerMode, setFetchingEnabled } from '../settings';
import { blankProfileInput, listActiveProfiles } from '../profiles';
import { recordAiCall } from '../ai-ledger';
import { NO_USAGE } from '../ai-usage';
import { createApplicants, createScreening } from '../screening/store';
import { draftRubric } from '../screening/rubric';
import { fingerprintText } from '../screening/intake';
import { tryFetchLock } from '../jobs/fetch-lock';
import { addToFunnel } from '../jobs/funnel-store';
import { getFetchRun } from '../web/fetch-runs';
import { getRun } from '../web/target-runs';

/** What a page may answer: itself, or a redirect to where the state lives. */
const ACCEPT = new Set([200, 302, 303]);
/** Routes whose subject is a run that has finished or a file that was never written: 404 is the honest answer. */
const MAY_404 = new Set([
  '/target/runs/:id/state',
  '/runs/fetch-now/:id/state',
  '/companies/watchlist/:id/state',
  '/jobs/:id/cover/:letterId/file/:fmt',
  // No letter is attached until the upload below runs.
  '/screen/:id/applicants/:aid/letters/:lid/file',
  // The fixture company is a pasted job's, not a folder; the folder walk below asks a real one.
  '/companies/:id/files',
]);
/** GETs the route patterns do not reach: a page under its query parameters (`:id` = the fixture job). */
const QUERY_VARIANTS = [
  // Every /jobs filter at once, the panel open: the where-clause, the facet tally and the status counts together.
  '/jobs?panel=1&status=NEW&q=node&minFit=10&sort=fitScore_desc&verified=1&watched=1&open=1&muted=1&country=DE,EU,unknown&workplace=remote,unknown&posted=30d',
  // The job page's three other tabs, and a tab nobody offers — that one must fall back, not fail.
  '/jobs/:id?tab=match',
  '/jobs/:id?tab=letter',
  '/jobs/:id?tab=verify',
  '/jobs/:id?tab=nonsense',
  // The AI ledger over each period, and a period nobody offers (ADR 0055).
  '/ai?period=month',
  '/ai?period=year',
  '/ai?period=nonsense',
  // Step 1 asks the default local addresses for a model server (TASKS S1); nothing answering is the usual case.
  '/welcome?step=ai',
];
/** The Overview under its chart's parameters; asked last, once setup is skipped (a fresh database redirects `/`). */
const OVERVIEW_VARIANTS = [
  '/',
  '/?range=7d&stack=node.js',
  '/?range=90d',
  // A technology on a range the jobs no longer cover, and values nobody offers: both fall back, neither fails.
  '/?range=180d&stack=node.js',
  '/?range=nonsense&stack=%3Cscript%3E',
];
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
  /** TASKS N8: a watched careers page drawn in the browser, for the paste box. */
  browserPageId: number;
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
  const {
    created: [applicant],
  } = await createApplicants(screening.id, [
    {
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
      sameAs: null,
      textHash: print.hash,
      simhash: print.simhash,
    },
  ]);
  if (!applicant) throw new Error('smoke fixture: the applicant was not written');
  // The ledger through its own write path: each kind of money, a timeout with
  // no usage, a model the price table does not know — and a one-cent budget,
  // so the billed row crosses it and the warning path runs (no chat here, so
  // it sends nothing).
  await setAiBudgetCents(1);
  const at = new Date();
  const usage = { ...NO_USAGE, inputTokens: 1_200, outputTokens: 300 };
  const call = { at, durationMs: 900, feature: 'resume-match' as const, viaFallback: false, jobId: job.job.id, resumeId: resume.id };
  await recordAiCall({ ...call, engine: 'anthropic_api', model: 'claude-opus-5', outcome: 'ok', billing: 'billed', spend: { usage, model: 'claude-opus-5', reportedUsd: null } });
  await recordAiCall({ ...call, engine: 'claude_code', model: 'claude-sonnet-5', outcome: 'ok', billing: 'plan', spend: { usage, model: 'claude-sonnet-5', reportedUsd: 0.004 } });
  await recordAiCall({ ...call, engine: 'openai_api', model: 'qwen2.5:14b', outcome: 'ok', billing: 'local', spend: { usage, model: 'qwen2.5:14b', reportedUsd: null } });
  await recordAiCall({ ...call, engine: 'openai_api', model: 'mystery-model', outcome: 'ok', billing: 'billed', spend: { usage, model: 'mystery-model', reportedUsd: null } });
  await recordAiCall({ ...call, engine: 'anthropic_api', model: 'claude-opus-5', outcome: 'timeout', billing: 'billed', spend: null });
  // One stored comparison, so the job page and the targeted view draw a keyword
  // table — the keyword matcher (a browser module imported by file URL) loads
  // on every OS the smoke runs on.
  const reply = parseMatchResponse(
    JSON.stringify({
      summary: 'Primary stack 2/2: Node.js and TypeScript present.',
      alignment: { title: 'strong', summary: 'strong', recent_role: 'strong' },
      keywords: [
        { term: 'Node.js', priority: 1, requirement: 'must', primary: true, status: 'present', aliases: ['node'], where: 'skills', note: null },
        { term: 'TypeScript', priority: 1, requirement: 'must', primary: true, status: 'present', aliases: [], where: 'skills', note: null },
        { term: 'PostgreSQL', priority: 2, requirement: 'must', primary: false, status: 'present', aliases: ['postgres'], where: 'skills', note: null, aliasOnly: 'Postgres' },
      ],
    }),
  );
  if (!reply.ok) throw new Error(`smoke fixture: ${reply.error}`);
  await createMatch({
    jobId: job.job.id,
    resumeId: resume.id,
    resumeVersion: resume.version,
    resumeText: RESUME,
    resumeName: 'Smoke resume',
    draft: false,
    model: 'smoke',
    result: reply.data,
    breakdown: scoreMatch(reply.data.keywords, reply.data.alignment, 0),
    promptVersion: PROMPT_VERSION,
    mode: 'full',
    frame: 'first-run',
    verificationId: null,
    evidence: 'own',
  });
  const browserPage = await prisma.company.create({
    data: { name: 'Smoke Page', atsType: 'BROWSER_PAGE', atsToken: 'https://smoke.example/careers', watched: true, active: false },
  });
  return {
    jobId: job.job.id,
    companyId: job.job.companyId,
    resumeId: resume.id,
    screeningId: screening.id,
    applicantId: applicant.id,
    browserPageId: browserPage.id,
  };
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
    .replace(':lid', '1')
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
  for (const url of QUERY_VARIANTS.map((v) => fill(v, f))) {
    const res = await app.request(url, { headers: ORIGIN });
    rows.push({ route: url, url, status: res.status, ok: res.status === 200 });
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
        body.set('file', new File([`${RESUME}\nLanguages: English, Ukrainian.`], 'smoke.txt', { type: 'text/plain' }));
        return { method: 'POST', headers: ORIGIN, body } satisfies RequestInit;
      })(),
      expect: (res) => res.status === 303 && (res.headers.get('location') ?? '').startsWith('/target/runs/'),
    },
    {
      // TASKS R16: the fixture's own text again is the resume already there — no second row, no scan.
      name: 'POST /resumes with the text of a saved resume (sent to it)',
      init: (() => {
        const body = new FormData();
        body.set('file', new File([RESUME], 'again.txt', { type: 'text/plain' }));
        return { method: 'POST', headers: ORIGIN, body } satisfies RequestInit;
      })(),
      expect: (res) => res.status === 303 && res.headers.get('location') === `/resumes/${f.resumeId}`,
    },
    {
      // TASKS R14: the same resume as another file, read beside the saved one — a page, nothing stored.
      name: 'POST /resumes/:id/compare-format (the same resume as another file)',
      init: (() => {
        const body = new FormData();
        body.set('file', new File([`${RESUME}\nCertificates: AWS Solutions Architect.`], 'smoke.md', { type: 'text/markdown' }));
        return { method: 'POST', headers: ORIGIN, body } satisfies RequestInit;
      })(),
      expect: (res) => res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/html'),
    },
    {
      // TASKS H23/H25 + E4: one upload decided whole and written in one transaction — a repeat
      // of the fixture skipped, a new resume added, and one whose phone digits survive the
      // redaction held for a look before any model reads it.
      name: 'POST /screen/:id/applicants (a repeat, a new file, a leak held)',
      init: (() => {
        const body = new FormData();
        body.append('files', new File([RESUME], 'again.txt', { type: 'text/plain' }));
        body.append('files', new File([`${RESUME.replace('Jane Example', 'Mark Sample')}\nAlso built the invoicing API.`], 'mark.txt', { type: 'text/plain' }));
        body.append(
          'files',
          new File([`Olena Test — QA Engineer. Phone +380 67 123 45 67.\n${RESUME.replace('Jane Example', 'Olena Test')}\nOrder ref 38067x1234567.`], 'olena.txt', { type: 'text/plain' }),
        );
        // Two copies of one file no text comes out of: one unreadable row, the copy skipped — not a unique-key 500.
        body.append('files', new File(['x'], 'scan-a.txt', { type: 'text/plain' }));
        body.append('files', new File(['x'], 'scan-b.txt', { type: 'text/plain' }));
        // TASKS E3: a cover letter goes to its person (the file name's stem is Mark's), never scored; one with nobody's resume is left out.
        const letter = (who: string) =>
          `Dear Hiring Team,\n\nI would like to apply for the backend role. At Acme I built the billing service in Node.js and TypeScript, moved it from MySQL to PostgreSQL and cut p95 latency by 40%. I would bring the same care for the details to your scheduling product.\n\nKind regards,\n${who}`;
        body.append('files', new File([letter('Mark')], 'mark_cover_letter.txt', { type: 'text/plain' }));
        body.append('files', new File([letter('Zed')], 'Zed_Cover_Letter.txt', { type: 'text/plain' }));
        // Only its words call this one a letter and nobody's resume came with it: it may be a polite resume, so it is added as one.
        body.append('files', new File([letter('Quinn')], 'quinn.txt', { type: 'text/plain' }));
        return { method: 'POST', headers: ORIGIN, body } satisfies RequestInit;
      })(),
      expect: (res) => {
        const flash = decodeURIComponent(res.headers.get('set-cookie') ?? '');
        return (
          res.status === 303 &&
          flash.includes('3 applicants added') &&
          flash.includes('2 files already added') &&
          flash.includes('1 held for a look') &&
          flash.includes('1 file could not be read') &&
          flash.includes('1 cover letter attached') &&
          flash.includes('1 cover letter left out')
        );
      },
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
    {
      // The rail rides on every tab: a status change made on one returns to it, and only a known tab is echoed.
      name: 'POST /jobs/:id/status with tab=match (back to that tab)',
      init: form({ status: 'SAVED', tab: 'match' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === `/jobs/${f.jobId}?tab=match`,
    },
    {
      name: 'POST /jobs/:id/status with a made-up tab (back to the posting)',
      init: form({ status: 'NEW', tab: 'https://evil.example' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === `/jobs/${f.jobId}`,
    },
    {
      name: 'POST /facts (not sure)',
      init: form({ term: 'Kubernetes', decision: 'unknown', back: '/resumes' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/resumes',
    },
    {
      name: 'POST /settings/ai/budget',
      init: form({ budget: '12.50' }),
      expect: (res) => res.status === 303 && (res.headers.get('location') ?? '').startsWith('/settings?tab=ai'),
    },
    {
      // TASKS N8: the text of a page drawn in the browser, read into lines.
      name: 'POST /companies/:id/paste',
      init: form({ page: 'Acme careers\nSenior Backend Engineer (Remote)\nSales Manager' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/companies#browser-pages',
    },
    {
      // ADR 0056: the pasted company above, muted from its posting's rail.
      name: 'POST /companies/mutes',
      init: form({ name: 'Smoke Two', reason: 'smoke', back: '/jobs' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/jobs',
    },
    {
      name: 'GET /jobs with a company muted (the hiding clause and its count)',
      init: { method: 'GET', headers: ORIGIN },
      expect: (res) => res.status === 200,
    },
    {
      name: 'POST /companies/mutes/delete',
      init: form({ key: 'smoke two', back: '/companies#muted' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/companies#muted',
    },
    {
      name: 'POST /settings/reapply',
      init: form({ days: '90' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/settings?tab=general',
    },
    {
      // TASKS S1: the OpenAI-compatible engine's server, set here; one on this machine takes no key.
      name: 'POST /settings/ai/openai-base',
      init: form({ baseUrl: 'http://127.0.0.1:9/v1' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/settings?tab=ai',
    },
    {
      name: 'GET /settings?tab=ai with a local server that does not answer',
      init: { method: 'GET', headers: ORIGIN },
      expect: (res) => res.status === 200,
    },
    {
      name: 'POST /welcome/ai/local with nothing answering (nothing changes)',
      init: form({ base: 'http://127.0.0.1:9/v1', model: 'llama3.1:8b' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/welcome?step=ai',
    },
    {
      // TASKS S5: no launcher here, so the login entry is refused and nothing is written.
      name: 'POST /settings/login-item without the launcher (refused)',
      init: form({ on: '1' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/settings?tab=general#login',
    },
    {
      // ADR 0057: the local engine's Ollama root and its context window.
      name: 'POST /settings/ai/local (an address)',
      init: form({ baseUrl: 'http://127.0.0.1:9/v1' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/settings?tab=ai',
    },
    {
      name: 'POST /settings/ai/local (the context window)',
      init: form({ contextTokens: '32768' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/settings?tab=ai',
    },
    {
      name: 'POST /settings/ai/local clear=1 (back to .env)',
      init: form({ clear: '1' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/settings?tab=ai',
    },
    {
      name: 'POST /settings/ai/openai-base clear=1 (back to .env)',
      init: form({ clear: '1' }),
      expect: (res) => res.status === 303 && res.headers.get('location') === '/settings?tab=ai',
    },
    {
      // The one route that reads files beside dist/: the PDF fonts a build must copy.
      name: 'POST /resumes/:id/render (a clean PDF)',
      init: form({ mode: 'pdf' }),
      expect: (res) => res.status === 200 && res.headers.get('content-type') === 'application/pdf',
    },
    {
      // The Tailor page's document pane: the draft drawn as a file, nothing stored.
      name: 'POST /resumes/:id/document (the draft as a document)',
      init: form({ text: `${RESUME}\n- Shipped a notification service.`, baseText: RESUME }),
      expect: (res) => res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('application/json'),
    },
    {
      name: 'POST /resumes/:id/document as=docx (the download)',
      init: form({ text: RESUME, baseText: RESUME, as: 'docx' }),
      expect: (res) => res.status === 200 && /attachment; filename=/.test(res.headers.get('content-disposition') ?? ''),
    },
    {
      name: 'POST /resumes/:id/document as=pdf (the clean PDF of the draft)',
      init: form({ text: RESUME, baseText: RESUME, as: 'pdf' }),
      expect: (res) => res.status === 200 && res.headers.get('content-type') === 'application/pdf',
    },
  ];
  const postPaths = [
    '/jobs/new',
    '/resumes',
    '/resumes',
    `/resumes/${f.resumeId}/compare-format`,
    `/screen/${f.screeningId}/applicants`,
    '/settings/fetching-toggle',
    `/jobs/${f.jobId}/status`,
    `/jobs/${f.jobId}/status`,
    `/jobs/${f.jobId}/status`,
    '/facts',
    '/settings/ai/budget',
    `/companies/${f.browserPageId}/paste`,
    '/companies/mutes',
    '/jobs',
    '/companies/mutes/delete',
    '/settings/reapply',
    '/settings/ai/openai-base',
    '/settings?tab=ai',
    '/welcome/ai/local',
    '/settings/login-item',
    '/settings/ai/local',
    '/settings/ai/local',
    '/settings/ai/local',
    '/settings/ai/openai-base',
    `/resumes/${f.resumeId}/render`,
    `/resumes/${f.resumeId}/document`,
    `/resumes/${f.resumeId}/document`,
    `/resumes/${f.resumeId}/document`,
  ];
  for (const [i, p] of posts.entries()) {
    const res = await app.request(postPaths[i]!, p.init);
    rows.push({ route: p.name, url: postPaths[i]!, status: res.status, ok: p.expect(res) });
  }

  // What a request gets WRONG. Every one of these used to be a 500 or worse,
  // and a 500 anywhere fails the build — so the negative paths need naming
  // as explicitly as the happy ones.
  const negatives: { name: string; url: string; init: RequestInit; expect: (res: Response) => boolean }[] = [
    {
      name: 'GET /jobs/:id with a non-numeric id (400, not a crash)',
      url: '/jobs/not-a-number',
      init: { headers: ORIGIN },
      expect: (res) => res.status === 400 || res.status === 404,
    },
    {
      name: 'GET /jobs/:id that does not exist (404)',
      url: '/jobs/99999999',
      init: { headers: ORIGIN },
      expect: (res) => res.status === 404,
    },
    {
      name: 'POST a body that is not the multipart it claims (400)',
      url: '/resumes',
      init: {
        method: 'POST',
        headers: { ...ORIGIN, 'content-type': 'multipart/form-data; boundary=----smoke' },
        body: 'this is not multipart at all',
      },
      expect: (res) => res.status === 400,
    },
    {
      // Just over DEFAULT_BODY_BYTES, not a round number of megabytes: the
      // point is the ceiling, and CI should not build a 30 MB string to
      // prove it.
      name: 'POST a body past the size limit (413)',
      url: '/jobs/new',
      init: {
        method: 'POST',
        headers: { ...ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
        body: `description=${'x'.repeat(DEFAULT_BODY_BYTES + 1024)}`,
      },
      expect: (res) => res.status === 413,
    },
  ];
  for (const n of negatives) {
    const res = await app.request(n.url, n.init);
    rows.push({ route: n.name, url: n.url, status: res.status, ok: n.expect(res) });
  }

  // The same posting pasted twice at once: the unique key settles it and BOTH
  // requests get an answer, rather than the loser reading on an aborted
  // transaction and returning a 500.
  const twice = {
    companyName: 'Smoke Race',
    title: 'Race Engineer',
    url: '',
    location: 'Berlin',
    description: POSTING,
  };
  const raced = await Promise.all([app.request('/jobs/new', form(twice)), app.request('/jobs/new', form(twice))]);
  rows.push({
    route: 'POST /jobs/new twice at once (both 303)',
    url: '/jobs/new',
    status: raced[0]!.status,
    ok: raced.every((r) => r.status === 303 && /^\/jobs\/\d+/.test(r.headers.get('location') ?? '')),
  });

  // "Fetch now" while another fetch holds the lock, as the worker's tick
  // would: the run is accepted and does nothing — no source read, no alert,
  // no AI — because two at once would score the same postings twice.
  const held = await tryFetchLock();
  if (!held) throw new Error('route smoke: the fetch lock is already taken');
  try {
    const started = await app.request('/runs/fetch-now', form({}));
    const runId = (started.headers.get('location') ?? '').split('/').pop() ?? '';
    const run = await settled(() => getFetchRun(runId));
    rows.push({
      route: 'POST /runs/fetch-now while another fetch holds the lock (overlap)',
      url: '/runs/fetch-now',
      status: started.status,
      ok: started.status === 303 && run?.stats?.reason === 'overlap',
    });
  } finally {
    await held.release();
  }

  rows.push(...(await importChecks()));
  rows.push(...(await folderChecks()));

  // The Overview itself. A fresh database sends `/` to /welcome, so until here
  // the dashboard was never drawn: setup is skipped, a scored match and a day
  // of the funnel are put in place, and the page is asked under every range of
  // its chart, under a technology, and under values nobody offers.
  await prisma.company.create({
    data: {
      name: 'Smoke Stats',
      atsType: 'MANUAL',
      atsToken: 'smoke-stats',
      active: false,
      jobs: {
        create: {
          externalId: 'smoke-match',
          title: 'Node Engineer',
          url: '',
          location: 'Remote',
          description: POSTING,
          postedAt: new Date(),
          status: 'ALERTED',
          fitScore: 88,
          alertedAt: new Date(),
          techMatch: ['node.js', 'typescript'],
        },
      },
    },
  });
  await addToFunnel(new Date(), { fetched: 40, filterRejected: 30, duplicate: 2, classified: 8, matched: 1, alerted: 1 });
  const skipped = await app.request('/welcome/skip', form({}));
  rows.push({ route: 'POST /welcome/skip (setup skipped)', url: '/welcome/skip', status: skipped.status, ok: skipped.status === 303 });
  for (const url of OVERVIEW_VARIANTS) {
    const res = await app.request(url, { headers: ORIGIN });
    const html = res.status === 200 ? await res.text() : '';
    rows.push({
      route: `GET ${url} (the Overview, with its chart)`,
      url,
      status: res.status,
      ok: res.status === 200 && html.includes('data-plot') && html.includes('Node.js'),
    });
  }

  const failed = rows.filter((r) => !r.ok);
  const width = Math.max(...rows.map((r) => r.route.length));
  for (const r of rows) console.log(`${r.ok ? 'ok ' : 'FAIL'}  ${r.status}  ${r.route.padEnd(width)}  ${r.url}`);
  console.log(`\n${rows.length} requests, ${rows.length - failed.length} as expected, ${failed.length} failed`);
  await prisma.$disconnect();
  // A background scan the upload started may still hold a child; the answer is in.
  process.exit(failed.length > 0 ? 1 : 0);
}

const IMPORT_CSV = [
  'Position,Organisation,Job link,Where,About the role,Recruiter email',
  'Backend Developer,Smoke Imports,https://rows.example/jobs/1,Remote,"Owns the ledger service, end to end.",someone@rows.example',
  'Mobile Developer,Smoke Imports,https://rows.example/jobs/2,Lisbon,Owns the offline queue.,someone@rows.example',
  'QA Engineer,Other Smoke,https://rows.example/jobs/3,Porto,Tests both.,other@rows.example',
  ',Other Smoke,https://rows.example/jobs/4,Porto,A row with no title.,other@rows.example',
].join('\r\n');
const IMPORT_MAPPING = { title: 'Position', employer: 'Organisation', url: 'Job link', location: 'Where', description: 'About the role' };

type Check = { route: string; url: string; status: number; ok: boolean };

/**
 * ADR 0062: a file of rows through its preview and its import, with fetching
 * paused so no engine is asked. While a fetch holds the lock the first press
 * stores nothing and keeps the rows; the second stores them unscored under an
 * inactive IMPORT source; the same file again adds nothing; deleting the
 * source takes its jobs.
 */
async function importChecks(): Promise<Check[]> {
  const out: Check[] = [];
  const check = (route: string, url: string, res: Response, ok: boolean): void => {
    out.push({ route, url, status: res.status, ok });
  };
  const wasFetching = (await getSettings()).fetchingEnabled;
  await setFetchingEnabled(false);
  // A migrated database with nothing seeded has no search, and an import with none running stores nothing.
  if ((await listActiveProfiles()).length === 0) {
    await prisma.profile.create({ data: { ...blankProfileInput(), name: 'Smoke search', active: true } });
  }
  const upload = (): Promise<Response> => {
    const body = new FormData();
    body.set('sourceName', 'Smoke export');
    body.set('file', new File([IMPORT_CSV], 'smoke.csv', { type: 'text/csv' }));
    return Promise.resolve(app.request('/jobs/import', { method: 'POST', headers: ORIGIN, body }));
  };
  const imported = (): Promise<number> => prisma.job.count({ where: { company: { atsType: 'IMPORT' } } });
  const pressImport = async (preview: string): Promise<{ res: Response; run: ReturnType<typeof getRun> }> => {
    const res = await app.request(preview, form(IMPORT_MAPPING));
    return { res, run: await settled(() => getRun((res.headers.get('location') ?? '').split('/').pop() ?? '')) };
  };

  const first = await upload();
  const preview = first.headers.get('location') ?? '';
  check('POST /jobs/import (a .csv upload)', '/jobs/import', first, first.status === 303 && /^\/jobs\/import\/[0-9a-f-]{36}$/.test(preview));
  const page = await app.request(preview, { headers: ORIGIN });
  const html = page.status === 200 ? await page.text() : '';
  check(
    'GET /jobs/import/:token (the mapping, three rows, the counts; no column about a person)',
    preview,
    page,
    html.includes('Which column is which') && html.includes('3 of them jobs') && !html.includes('Recruiter email') && !html.includes('someone@rows.example'),
  );
  // A hand-made POST naming the column the page never offers: refused, and nothing is written.
  const crafted = await app.request(preview, form({ ...IMPORT_MAPPING, employer: 'Recruiter email' }));
  check(
    'POST /jobs/import/:token mapping a column about a person (refused)',
    preview,
    crafted,
    crafted.status === 303 && crafted.headers.get('location') === preview && (await prisma.company.count({ where: { atsType: 'IMPORT' } })) === 0,
  );
  const mapped = await app.request(`${preview}/mapping`, form(IMPORT_MAPPING));
  check('POST /jobs/import/:token/mapping', `${preview}/mapping`, mapped, mapped.status === 303 && mapped.headers.get('location') === preview);
  const foreign = await app.request(preview, {
    method: 'POST',
    headers: { origin: 'http://evil.example', host: 'localhost', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(IMPORT_MAPPING).toString(),
  });
  check('POST /jobs/import/:token from another origin (refused)', preview, foreign, foreign.status === 403);

  const held = await tryFetchLock();
  if (!held) throw new Error('route smoke: the fetch lock is already taken');
  try {
    const { res, run } = await pressImport(preview);
    check(
      'POST /jobs/import/:token while a fetch holds the lock (nothing stored, the rows kept)',
      preview,
      res,
      res.status === 303 && run?.stage === 'done' && run.flashKind === 'warn' && run.resultUrl === preview && (await imported()) === 0,
    );
  } finally {
    await held.release();
  }

  const { res: stored, run } = await pressImport(preview);
  const source = await prisma.company.findFirst({ where: { atsType: 'IMPORT' }, include: { jobs: { select: { fitScore: true, employer: true } } } });
  check(
    'POST /jobs/import/:token while paused (stored unscored under an inactive source)',
    preview,
    stored,
    stored.status === 303 &&
      run?.stage === 'done' &&
      run.resultUrl === '/jobs' &&
      source?.active === false &&
      source.sourceConfig !== null &&
      source.jobs.length === 3 &&
      source.jobs.every((j) => j.fitScore === null && j.employer !== null),
  );

  const again = await upload();
  const second = await pressImport(again.headers.get('location') ?? '');
  check('POST /jobs/import with the same file again (nothing new)', '/jobs/import', second.res, second.run?.stage === 'done' && (await imported()) === 3);
  const list = await app.request('/jobs/import', { headers: ORIGIN });
  check('GET /jobs/import with a source imported', '/jobs/import', list, list.status === 200 && (await list.text()).includes('Smoke export'));
  const removed = await app.request(`/jobs/import/sources/${source?.id ?? 0}/delete`, form({}));
  check('POST /jobs/import/sources/:id/delete (the source and its jobs)', '/jobs/import/sources/:id/delete', removed, removed.status === 303 && (await imported()) === 0);

  await setFetchingEnabled(wasFetching);
  return out;
}

/**
 * ADR 0062: a folder a tool writes into, from Check to the ledger. The folder
 * is this run's own, under the one root route-smoke-env.ts names; fetching is
 * paused, so no engine is asked. Check stores nothing; Add stores the row
 * switched off; the first check reads the file and stores its rows; the
 * second reads nothing; a path outside the root is refused.
 */
async function folderChecks(): Promise<Check[]> {
  const out: Check[] = [];
  const check = (route: string, url: string, res: Response, ok: boolean): void => {
    out.push({ route, url, status: res.status, ok });
  };
  const inbox = (process.env.APPLYPACK_INBOX_ROOTS ?? '').split(path.delimiter)[0] ?? '';
  await fs.mkdir(inbox, { recursive: true });
  const file = path.join(inbox, 'run-1.json');
  await fs.writeFile(
    file,
    JSON.stringify([
      { id: 'f1', title: 'Backend Developer', company: 'Smoke Folder Co', url: 'https://rows.example/f/1', location: 'Remote' },
      { id: 'f2', title: 'Mobile Developer', company: 'Smoke Folder Co', url: 'https://rows.example/f/2', location: 'Lisbon' },
    ]),
  );
  // Written a minute ago, as far as the look can tell: a file changed this second waits.
  const settledAt = new Date(Date.now() - 60_000);
  await fs.utimes(file, settledAt, settledAt);
  const wasFetching = (await getSettings()).fetchingEnabled;
  await setFetchingEnabled(false);
  const mapping = { title: 'title', employer: 'company', url: 'url', location: 'location', id: 'id' };
  const stored = (): Promise<number> => prisma.job.count({ where: { company: { atsType: 'FOLDER' } } });
  const checkNow = async (id: number): Promise<Response> => {
    const res = await app.request(`/companies/${id}/check-now`, form({}));
    await settled(() => getFetchRun((res.headers.get('location') ?? '').split('/').pop() ?? ''));
    return res;
  };

  try {
    const outside = await app.request('/companies/folder/check', form({ path: path.dirname(inbox) }));
    check('POST /companies/folder/check outside the named root (refused)', '/companies/folder/check', outside, outside.status === 303 && outside.headers.get('location') === '/companies');
    const preview = await app.request('/companies/folder/check', form({ path: inbox, name: 'Smoke folder' }));
    const html = preview.status === 200 ? await preview.text() : '';
    check(
      'POST /companies/folder/check (what is in it, the mapping, the next check)',
      '/companies/folder/check',
      preview,
      html.includes('1 file of rows') && html.includes('Which column is which') && html.includes('2 rows of the files it reads are jobs') && (await prisma.company.count({ where: { atsType: 'FOLDER' } })) === 0,
    );
    const added = await app.request('/companies/folder', form({ path: inbox, name: 'Smoke folder', include: '', ...mapping }));
    const folder = await prisma.company.findFirst({ where: { atsType: 'FOLDER' } });
    check('POST /companies/folder (added, switched off)', '/companies/folder', added, added.status === 303 && folder?.active === false && folder.sourceConfig !== null);
    if (!folder) return out;

    const off = await app.request(`/companies/${folder.id}/check-now`, form({}));
    check('POST /companies/:id/check-now on a folder that is off (refused)', `/companies/${folder.id}/check-now`, off, off.status === 303 && off.headers.get('location') === '/companies');
    await app.request(`/companies/${folder.id}/toggle-active`, form({}));
    const first = await checkNow(folder.id);
    const ledger = await prisma.sourceFile.findMany({ where: { companyId: folder.id } });
    check(
      'POST /companies/:id/check-now on a folder (the file read once, its rows stored unscored)',
      `/companies/${folder.id}/check-now`,
      first,
      first.status === 303 && (await stored()) === 2 && ledger.length === 1 && ledger[0]?.status === 'done' && ledger[0].jobCount === 2 && ledger[0].sha256 !== null,
    );
    const second = await checkNow(folder.id);
    const after = await prisma.company.findUnique({ where: { id: folder.id }, select: { lastFetchStatus: true } });
    check('POST /companies/:id/check-now again (nothing read, nothing new)', `/companies/${folder.id}/check-now`, second, second.status === 303 && (await stored()) === 2 && after?.lastFetchStatus === 'empty');
    const files = await app.request(`/companies/${folder.id}/files`, { headers: ORIGIN });
    check('GET /companies/:id/files (the per-file list)', `/companies/${folder.id}/files`, files, files.status === 200 && (await files.text()).includes('2 rows read as jobs'));
    const list = await app.request('/companies', { headers: ORIGIN });
    check('GET /companies with a folder among the sources', '/companies', list, list.status === 200 && (await list.text()).includes('1 file · 0 new at the last check'));
    const removed = await app.request(`/companies/${folder.id}/delete`, form({}));
    check('POST /companies/:id/delete on a folder (its jobs and its ledger go, its files stay)', `/companies/${folder.id}/delete`, removed, removed.status === 303 && (await stored()) === 0 && (await prisma.sourceFile.count()) === 0 && (await fs.readdir(inbox)).length === 1);
  } finally {
    await setFetchingEnabled(wasFetching);
    await fs.rm(inbox, { recursive: true, force: true });
  }
  return out;
}

/** A run once it has finished, or null if it never does within the wait. */
async function settled<T extends { stage: string } | null>(read: () => T, waitMs = 10_000): Promise<T | null> {
  const until = Date.now() + waitMs;
  for (;;) {
    const run = read();
    if (run && (run.stage === 'done' || run.stage === 'error')) return run;
    if (Date.now() > until) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
