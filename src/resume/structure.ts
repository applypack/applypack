import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { buildStructurePrompt, parseStructureResponse, RESUME_TIMEOUT_MS, STRUCTURE_MAX_TOKENS } from './prompts';
import type { JsonResume } from './json-resume';
import { anchorStructure, structureIsUsable } from './structure-anchor';
import { saveResumeStructure } from './store';

/**
 * The resume as a shape (ADR 0039), read by its own call and stored — asked
 * for by the render page on its first visit rather than by every scan
 * (#184: copying the resume into JSON was most of the scan's output, and one
 * page reads it). Checked against the text before it is stored: a string
 * the model wrote rather than copied is dropped, and a reply the guard
 * emptied is not stored at all — the render page's deterministic fallback is
 * better than a half-built shape. The drop count is the regression metric
 * for a prompt change, so it is logged every time. Null on AI failure or an
 * unusable reply.
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
      timeoutMs: RESUME_TIMEOUT_MS.structure,
      onError,
    },
    parseStructureResponse,
    { id: resume.id },
  );
  if (!answer) return null;
  const report = anchorStructure(answer.data, resume.text);
  const usable = structureIsUsable(report);
  logger.info(
    {
      id: resume.id,
      kept: report.kept,
      dropped: report.dropped,
      emptiedRoles: report.emptiedRoles,
      roles: report.structure.work.length,
      bullets: report.structure.work.reduce((n, w) => n + w.highlights.length, 0),
      usable,
      samples: report.samples,
      ms: answer.ms,
    },
    'resume: structure anchored',
  );
  if (!usable) {
    onError?.('the model rewrote the resume instead of copying it — nothing usable to store');
    return null;
  }
  await saveResumeStructure(resume.id, report.structure);
  return report.structure;
}
