/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { idParam } from '../params';
import { logger } from '../../logger';
import { createResume, getResume, getResumeOriginal, versionFileName, type ResumeSummary } from '../../resume/store';
import { readStructure, type JsonResume } from '../../resume/json-resume';
import { structureFromText } from '../../resume/structure-from-text';
import { anchorStructure, structureIsUsable } from '../../resume/structure-anchor';
import { blankStyle, type InferredStyle } from '../../resume/style-infer';
import { resumeStyle } from '../resume-style';
import { knobsFrom, readKnobs, type RenderKnobs } from '../../resume/render/knobs';
import { DOCX_MIME } from '../../resume/docx-write';
import { renderDocx } from '../../resume/render/clean-docx';
import { PDF_MIME, renderPdf } from '../../resume/render/clean-pdf';
import { droppedByRender } from '../../resume/render/sections';
import { docxStructure } from '../../resume/docx-structure';
import { docxToText } from '../../resume/docx-text';
import { parseWarnings } from '../../resume/parse-warnings';
import { scanInBackground } from '../../resume/scan';
import { structureResume } from '../../resume/structure';
import { hashShortId } from '../../text-utils';
import { claimRun, startRun, updateRun, type TargetRun } from '../target-runs';
import { runFailure } from '../run-failure';
import { ResumeRenderPage } from '../pages/resume-render';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';
import { t } from '../../i18n/t';

/*
 * "Clean version in your typeface" (ADR 0039). Everything here is derived from
 * the stored resume on each request — the structure, the typography, the
 * preview — so there is nothing to migrate and nothing to go stale when the
 * resume is re-scanned or replaced. Rendering is milliseconds; a run would be
 * ceremony (integration guide §8, Performance).
 */

export const resumeRenderRoute = new Hono();

type Origin = 'ai' | 'text';

interface RenderContext {
  resume: ResumeSummary;
  structure: JsonResume;
  origin: Origin;
  style: InferredStyle;
  /** Why this resume is offered a re-render at all — shown at the top of the page. */
  reason: string;
}

const isDocx = (filename: string) => /\.docx$/i.test(filename);
const isPdf = (filename: string) => /\.pdf$/i.test(filename);

resumeRenderRoute.get('/resumes/:id/render', async (c) => {
  const ctx = await load(c);
  if ('response' in ctx) return ctx.response;
  // The shape is read by its own AI call (#184) — started by the button on
  // this page, never by the visit itself: a GET that spends a model call is
  // one any page in the browser can fire with an image tag (audit
  // 2026-09-10, SEC-7). Until then the page shows the built-in reader's shape.
  const knobs = knobsFrom(ctx.style);
  return c.html(await page(ctx, knobs, parseFlashCookie(c.req.header('cookie'))), 200, {
    'Set-Cookie': clearFlashCookie(),
  });
});

/** "Read the shape with AI" on the page: the same run the first visit starts. */
resumeRenderRoute.post('/resumes/:id/render/shape', async (c) => {
  const ctx = await load(c);
  if ('response' in ctx) return ctx.response;
  return c.redirect(`/target/runs/${startStructureRun(ctx.resume).id}`, 303);
});

/**
 * One reading per resume text at a time (claimed on the text, so a new
 * version is a new run); a failure lands on the built-in reading with the
 * engine's reason, never on a page that would start the run again.
 */
function startStructureRun(resume: ResumeSummary): TargetRun {
  const back = `/resumes/${resume.id}/render`;
  const { run, joined } = claimRun(`structure:${resume.id}:${hashShortId(resume.text)}`, {
    steps: ['structure'],
    jobTitle: '',
    resumeName: resume.name,
    subtitle: t('render.run.subtitle'),
    backUrl: `${back}?shape=text`,
    backLabel: t('render.run.back'),
  });
  if (joined) return run;
  startRun(run.id, async () => {
    let reason = '';
    const structure = await structureResume(resume, (r) => {
      reason = r;
    });
    updateRun(
      run.id,
      structure
        ? {
            stage: 'done',
            resultUrl: back,
            flash: t('render.run.done', { roles: structure.work.length, bullets: structure.work.reduce((n, w) => n + w.highlights.length, 0) }),
          }
        : {
            stage: 'error',
            error: runFailure(t('render.run.failed'), reason, t('render.run.failedNext')),
          },
    );
  });
  return run;
}

resumeRenderRoute.post('/resumes/:id/render', async (c) => {
  const ctx = await load(c);
  if ('response' in ctx) return ctx.response;
  const form = await c.req.parseBody();
  const knobs = readKnobs(form as Record<string, unknown>, knobsFrom(ctx.style));
  // The button's own value when the browser sent one (no JavaScript), else
  // the hidden field the onclick set. See the form for why there are two.
  const mode =
    typeof form.submitMode === 'string' ? form.submitMode
    : typeof form.mode === 'string' ? form.mode
    : 'preview';
  const { resume } = ctx;

  if (mode === 'docx' || mode === 'pdf') {
    const started = Date.now();
    const bytes = mode === 'docx' ? await renderDocx(ctx.structure, knobs) : await renderPdf(ctx.structure, knobs);
    logger.info({ id: resume.id, format: mode, bytes: bytes.length, ms: Date.now() - started }, 'resume: rendered clean');
    return download(bytes, versionFileName(`${resume.name} clean`, resume.version, mode), mode === 'docx' ? DOCX_MIME : PDF_MIME);
  }

  if (mode === 'save') {
    const started = Date.now();
    const original = await renderDocx(ctx.structure, knobs);
    const name = `${resume.name} · clean`;
    const sourceFilename = versionFileName(name, 1, 'docx');
    const text = docxToText(original);
    const saved = await createResume({ name, sourceFilename, mimeType: DOCX_MIME, original, text });
    logger.info(
      { id: resume.id, newId: saved.id, bytes: original.length, ms: Date.now() - started },
      'resume: saved clean render as a new resume',
    );
    // The new row has no scan of its own yet, and the page it lands on reads
    // one. Nobody waits on it (the same background scan an upload gets).
    scanInBackground(saved);
    return flashRedirect(
      `/resumes/${saved.id}`,
      'ok',
      t('render.flash.saved', { name, original: resume.name }),
    );
  }

  return c.html(await page(ctx, knobs, null));
});

/**
 * The resume, its structure and its typography, or a response saying why not.
 * A resume with no file to read is still renderable — its text is enough — so
 * the only hard failures are a bad id and a missing row.
 */
async function load(c: Context): Promise<RenderContext | { response: Response }> {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return { response: c.text('Bad id', 400) };
  const resume = await getResume(id);
  if (!resume) return { response: c.text(t('http.notFound'), 404) };
  if (resume.hidden) {
    return {
      response: flashRedirect('/resumes', 'err', t('render.flash.hidden')),
    };
  }

  // The stored structure is checked against the CURRENT text before it is
  // drawn, not only when it was written: a scan that finished after a version
  // bump, or a row written before the bump cleared it, would otherwise render
  // words the resume no longer contains. Anchoring ~6 KB costs microseconds.
  const stored = readStructure(resume.structure);
  const guarded = stored ? anchorStructure(stored, resume.text) : null;
  const usable = guarded !== null && structureIsUsable(guarded);
  if (guarded && !usable) {
    logger.info({ id, dropped: guarded.dropped }, 'resume: stored structure no longer matches the text');
  }
  const row = await getResumeOriginal(id);
  const bytes = row ? Buffer.from(row.original) : null;
  const style = row ? await resumeStyle(resume, row) : blankStyle();
  // The built-in reading takes the page's own columns and skills table, when the file is a PDF that has them.
  const structure = usable ? guarded.structure : structureFromText(resume.text, style.layout);
  const origin: Origin = usable ? 'ai' : 'text';

  return { resume, structure, origin, style, reason: reasonFor(resume, bytes) };
}

/** Why this resume cannot simply be edited in place — the sentence the page opens with. */
function reasonFor(resume: ResumeSummary, bytes: Buffer | null): string {
  if (isPdf(resume.sourceFilename)) {
    return t('render.reason.pdf');
  }
  if (bytes && isDocx(resume.sourceFilename)) {
    const kind = docxStructure(bytes).kind;
    if (kind === 'flow') {
      return t('render.reason.flow');
    }
    if (kind === 'structural') {
      return t('render.reason.structural');
    }
    return t('render.reason.unsupported');
  }
  return t('render.reason.text');
}

async function page(ctx: RenderContext, knobs: RenderKnobs, flash: ReturnType<typeof parseFlashCookie>) {
  // The preview is the real thing read back, not a description of it: render
  // the .docx and run it through the same reader an upload goes through.
  const preview = docxToText(await renderDocx(ctx.structure, knobs));
  return (
    <ResumeRenderPage
      resume={ctx.resume}
      knobs={knobs}
      structure={ctx.structure}
      origin={ctx.origin}
      styleSource={ctx.style.source}
      preview={preview}
      dropped={droppedByRender(ctx.structure, knobs)}
      warnings={parseWarnings(preview)}
      reason={ctx.reason}
      flash={flash}
    />
  );
}

function download(bytes: Buffer, filename: string, mime: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`,
    },
  });
}
