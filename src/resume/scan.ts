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
