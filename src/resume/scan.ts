import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { buildScanPrompt, parseScanResponse, SCAN_MAX_TOKENS, type ResumeScan } from './prompts';
import type { JsonResume } from './json-resume';
import { anchorStructure, structureIsUsable } from './structure-anchor';
import { saveResumeScan } from './store';

const SCAN_TIMEOUT_MS = 5 * 60_000;
const PARSE_ATTEMPTS = 2;

/** Extracts the structured profile of a resume and stores it. Null on AI failure. */
export async function scanResume(resume: { id: number; text: string }): Promise<ResumeScan | null> {
  const prompt = buildScanPrompt(resume.text);
  const ai = await getAiRuntime();
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const started = Date.now();
    const out = await ai.complete({
      ...prompt,
      maxTokens: SCAN_MAX_TOKENS,
      label: 'resume-scan',
      role: 'resume',
      timeoutMs: SCAN_TIMEOUT_MS,
    });
    if (out === null) return null;
    const parsed = parseScanResponse(out.text);
    if (parsed.ok) {
      const structure = guardStructure(resume, parsed.data);
      await saveResumeScan(resume.id, parsed.data, structure);
      logger.info(
        {
          id: resume.id,
          skills: parsed.data.skills.length,
          issues: parsed.data.issues.length,
          attempt,
          ms: Date.now() - started,
        },
        'resume: scanned',
      );
      return parsed.data;
    }
    logger.warn({ id: resume.id, attempt, error: parsed.error, raw: out.text.slice(0, 500) }, 'resume: scan reply did not match schema');
  }
  return null;
}

/**
 * The structure block, checked against the resume before it is stored
 * (ADR 0039): a string the model wrote rather than copied is dropped, and a
 * reply the guard emptied is not stored at all — the render page's
 * deterministic fallback is better than a half-built shape. The drop count is
 * the regression metric for a scan-prompt change, so it is logged every time.
 */
function guardStructure(resume: { id: number; text: string }, scan: ResumeScan): JsonResume | null {
  if (!scan.structure) return null;
  const report = anchorStructure(scan.structure, resume.text);
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
    },
    'resume: structure anchored',
  );
  return usable ? report.structure : null;
}

/**
 * The scan with nobody waiting on it. Until it lands, the row's headline /
 * skills / primary stack still describe the previous version (scannedAt:
 * null already marks that) — read by /resumes and by other resumes'
 * "elsewhere" hints, never by the match that runs next to it
 * (docs/target-plan.md §3.1 item 2). A failure is logged, never surfaced.
 */
export function scanInBackground(resume: { id: number; text: string }): void {
  void scanResume(resume).catch((err) => {
    logger.error({ err, id: resume.id }, 'resume: background scan failed');
  });
}
