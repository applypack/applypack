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
    const text = await ai.provider.complete({
      ...prompt,
      maxTokens: SCAN_MAX_TOKENS,
      label: 'resume-scan',
      model: ai.resumeModel,
      timeoutMs: SCAN_TIMEOUT_MS,
    });
    if (text === null) return null;
    const parsed = parseScanResponse(text);
    if (parsed.ok) {
      await saveResumeScan(resume.id, parsed.data);
      logger.info(
        { id: resume.id, skills: parsed.data.skills.length, issues: parsed.data.issues.length },
        'resume: scanned',
      );
      return parsed.data;
    }
    logger.warn({ id: resume.id, attempt, error: parsed.error, raw: text.slice(0, 500) }, 'resume: scan reply did not match schema');
  }
  return null;
}
