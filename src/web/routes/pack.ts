import { Hono } from 'hono';
import { prisma } from '../../db';
import { getPack, getPackFile, packFiles, queuePack } from '../../pack/store';
import { readPackEdits } from '../../pack/view';
import { DOCX_MIME } from '../../resume/docx-write';
import { contentDisposition } from '../../resume/draft-document';
import { loadLineDiff } from '../../resume/line-diff';
import { readKeywords } from '../../resume/prompts';
import { PDF_MIME } from '../../resume/render/clean-pdf';
import { getPackSettings } from '../../settings';
import { flashRedirect } from '../flash';
import { jobHref } from '../job-tabs';
import type { ApplicationPackProps } from '../pages/application-pack-card';
import { idParam } from '../params';

/*
 * The application pack in the dashboard (ADR 0060): asking for one, and the
 * file it kept. The dashboard never prepares a pack itself — it puts the row
 * in the queue and the worker's runner takes it within a minute, so a pack
 * the tick queued and one asked for here are made by the same code.
 */

export const packRoute = new Hono();

packRoute.post('/jobs/:id/pack', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  if (!(await prisma.job.findUnique({ where: { id }, select: { id: true } }))) return c.text('Not found', 404);
  const outcome = await queuePack(id, 'manual');
  const tab = jobHref(id, 'pack');
  if (outcome === 'sent') {
    return flashRedirect(tab, 'warn', 'This pack is the record of the file you sent, so it is not prepared again. Nothing was changed.');
  }
  return flashRedirect(
    tab,
    'ok',
    outcome === 'busy' ? 'This pack is already being prepared.' : 'Queued. The worker starts it within a minute; this page refreshes itself.',
  );
});

/** The file as the pack kept it — the same bytes on every download, whatever happened to the resume since. */
for (const kind of ['docx', 'pdf'] as const) {
  packRoute.get(`/jobs/:id/pack/resume.${kind}`, async (c) => {
    const id = idParam(c.req.param('id'));
    if (!Number.isFinite(id)) return c.text('Bad id', 400);
    const file = await getPackFile(id, kind);
    if (!file) return c.text('Not found', 404);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': kind === 'pdf' ? PDF_MIME : DOCX_MIME,
        'Content-Disposition': contentDisposition(file.fileName),
        'Cache-Control': 'no-store',
      },
    });
  });
}

/** Everything the job page's pack tab shows, read from what the pack stored. */
export async function loadPackView(jobId: number, url: string): Promise<ApplicationPackProps> {
  const [pack, files, settings] = await Promise.all([getPack(jobId), packFiles(jobId), getPackSettings()]);
  const [verification, match] = await Promise.all([
    pack?.verificationId
      ? prisma.jobVerification.findUnique({
          where: { id: pack.verificationId },
          select: { verdict: true, recommendation: true, summary: true, companySnapshot: true },
        })
      : null,
    pack?.matchId ? prisma.resumeMatch.findUnique({ where: { id: pack.matchId }, select: { keywords: true } }) : null,
  ]);
  const keywords = match ? readKeywords(match.keywords) : [];
  const changes =
    pack?.baseText && pack.text && pack.text !== pack.baseText
      ? (await loadLineDiff()).diffLines(pack.baseText, pack.text).filter((op) => op.op !== 'keep')
      : [];
  return {
    jobId,
    url,
    pack,
    files,
    edits: readPackEdits(pack?.edits),
    changes,
    company: verification && {
      verdict: verification.verdict,
      recommendation: verification.recommendation,
      summary: verification.summary,
      snapshot: verification.companySnapshot,
    },
    asks: keywords.filter((k) => k.status === 'ask_user').map((k) => k.term),
    unbacked: keywords.filter((k) => k.status === 'cannot_claim').map((k) => k.term),
    letter: pack?.coverLetterId !== null && pack?.coverLetterId !== undefined,
    automatic: settings.enabled,
  };
}
