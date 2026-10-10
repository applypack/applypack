import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { buildStructurePrompt, parseStructureResponse, RESUME_TIMEOUT_MS, STRUCTURE_MAX_TOKENS } from './prompts';
import type { JsonResume } from './json-resume';
import { anchorStructure, structureIsUsable } from './structure-anchor';
import { structureGaps, structureIsComplete } from './structure-complete';
import { saveResumeStructure } from './store';
import { t } from '../i18n/t';

/**
 * The resume as a shape (ADR 0039), read by its own call and stored — asked
 * for by the render page on its first visit rather than by every scan
 * (#184: copying the resume into JSON was most of the scan's output, and one
 * page reads it). Checked against the text before it is stored: a string
 * the model wrote rather than copied is dropped, and a reply the guard
 * emptied is not stored at all — the render page's deterministic fallback is
 * better than a half-built shape. Nor is a reply that copied faithfully and
 * left roles out (structure-complete.ts, #408): the clean version drawn from
 * it would be jobs short. The drop count and the gaps are the regression
 * metric for a prompt change, so they are logged every time. Null on AI
 * failure or an unusable reply.
 */
export async function structureResume(
  resume: { id: number; text: string },
  onError?: (reason: string) => void,
): Promise<JsonResume | null> {
  const answer = await askForJson(
    await getAiRuntime(),
    {
      ...buildStructurePrompt(resume.text),
      maxTokens: STRUCTURE_MAX_TOKENS,
      label: 'resume-structure',
      role: 'resume',
      subject: { resumeId: resume.id },
      timeoutMs: RESUME_TIMEOUT_MS.structure,
      onError,
    },
    parseStructureResponse,
    { id: resume.id },
  );
  if (!answer) return null;
  const report = anchorStructure(answer.data, resume.text);
  const usable = structureIsUsable(report);
  const gaps = structureGaps(report.structure, resume.text);
  const complete = structureIsComplete(gaps);
  logger.info(
    {
      id: resume.id,
      kept: report.kept,
      dropped: report.dropped,
      emptiedRoles: report.emptiedRoles,
      roles: gaps.roles,
      rolesInText: gaps.rolesInText,
      lostRoles: gaps.lostRoles.length,
      bullets: report.structure.work.reduce((n, w) => n + w.highlights.length, 0),
      lostLines: gaps.lostLines,
      usable,
      complete,
      samples: report.samples,
      ms: answer.ms,
    },
    'resume: structure anchored',
  );
  if (!usable) {
    onError?.(t('render.run.rewritten'));
    return null;
  }
  if (!complete) {
    onError?.(
      gaps.lostRoles.length > 0
        ? t('render.run.incompleteRoles', { read: gaps.rolesInText - gaps.lostRoles.length, roles: gaps.rolesInText })
        : t('render.run.incompleteLines', { n: gaps.lostLines }),
    );
    return null;
  }
  await saveResumeStructure(resume.id, report.structure);
  return report.structure;
}
