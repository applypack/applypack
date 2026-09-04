/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import { logger } from '../../logger';
import { createResume, getResume, getResumeOriginal, versionFileName, type ResumeSummary } from '../../resume/store';
import { readStructure, type JsonResume } from '../../resume/json-resume';
import { structureFromText } from '../../resume/structure-from-text';
import { blankStyle, inferFromDocx, inferFromPdf, type InferredStyle } from '../../resume/style-infer';
import { knobsFrom, readKnobs, type RenderKnobs } from '../../resume/render/knobs';
import { DOCX_MIME, renderDocx } from '../../resume/render/clean-docx';
import { PDF_MIME, renderPdf } from '../../resume/render/clean-pdf';
import { docxStructure } from '../../resume/docx-structure';
import { docxToText } from '../../resume/docx-text';
import { parseWarnings } from '../../resume/parse-warnings';
import { scanInBackground } from '../../resume/scan';
import { ResumeRenderPage } from '../pages/resume-render';
import { clearFlashCookie, flashRedirect, parseFlashCookie } from '../flash';

/*
 * "Clean version in your typeface" (ADR 0039). Everything here is derived from
 * the stored resume on each request — the structure, the typography, the
 * preview — so there is nothing to migrate and nothing to go stale when the
 * resume is re-scanned or replaced. Rendering is milliseconds; a run would be
 * ceremony (integration guide §8, Performance).
 */

export const resumeRenderRoute = new Hono();

type Origin = 'scan' | 'text';

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
  const knobs = knobsFrom(ctx.style);
  return c.html(await page(ctx, knobs, parseFlashCookie(c.req.header('cookie'))), 200, {
    'Set-Cookie': clearFlashCookie(),
  });
});

resumeRenderRoute.post('/resumes/:id/render', async (c) => {
  const ctx = await load(c);
  if ('response' in ctx) return ctx.response;
  const form = await c.req.parseBody();
  const knobs = readKnobs(form as Record<string, unknown>, knobsFrom(ctx.style));
  const mode = typeof form.mode === 'string' ? form.mode : 'preview';
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
      `Saved "${name}" as a resume of its own — a .docx the editor can write into. "${resume.name}" is untouched. Reading it now; the headline and skills fill in shortly.`,
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
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return { response: c.text('Bad id', 400) };
  const resume = await getResume(id);
  if (!resume) return { response: c.text('Not found', 404) };
  if (resume.hidden) {
    return {
      response: flashRedirect('/resumes', 'err', 'That is the scratch resume the Compare page uses — save it as a resume of its own first.'),
    };
  }

  const stored = readStructure(resume.structure);
  const structure = stored ?? structureFromText(resume.text);
  const origin: Origin = stored ? 'scan' : 'text';

  const row = await getResumeOriginal(id);
  const bytes = row ? Buffer.from(row.original) : null;
  let style = blankStyle();
  if (bytes && isDocx(row!.sourceFilename)) style = inferFromDocx(bytes);
  else if (bytes && isPdf(row!.sourceFilename)) style = await inferFromPdf(bytes);

  return { resume, structure, origin, style, reason: reasonFor(resume, bytes) };
}

/** Why this resume cannot simply be edited in place — the sentence the page opens with. */
function reasonFor(resume: ResumeSummary, bytes: Buffer | null): string {
  if (isPdf(resume.sourceFilename)) {
    return 'This resume is a PDF, so there is nothing in it to edit in place — a PDF has no paragraphs, only glyphs at coordinates. A clean version gives you a .docx the editor can write into.';
  }
  if (bytes && isDocx(resume.sourceFilename)) {
    const kind = docxStructure(bytes).kind;
    if (kind === 'flow') {
      return 'Your .docx can already be edited in place, so you do not need this — it is here for when you want a plainer, single-column version anyway.';
    }
    if (kind === 'structural') {
      return 'Your .docx keeps some of its text in tables or text boxes, which a save cannot rewrite line by line. A clean version puts the same words in plain paragraphs.';
    }
    return 'This .docx is one the editor cannot write into at all. A clean version puts the same words in a file it can.';
  }
  return 'This resume is stored as text, so there is no layout to keep. A clean version gives it one, plus a .docx the editor can write into.';
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
