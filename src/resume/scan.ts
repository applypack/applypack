import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { buildScanPrompt, parseScanResponse, SCAN_MAX_TOKENS, type ResumeScan } from './prompts';
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
      await saveResumeScan(resume.id, parsed.data);
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
