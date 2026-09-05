import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { askForJson } from '../ai-json';
import { buildScanPrompt, parseScanResponse, RESUME_TIMEOUT_MS, SCAN_MAX_TOKENS, type ResumeScan } from './prompts';
import { saveResumeScan } from './store';


/** Extracts the structured profile of a resume and stores it. Null on AI failure. */
export async function scanResume(
  resume: { id: number; text: string },
  onError?: (reason: string) => void,
): Promise<ResumeScan | null> {
  const answer = await askForJson(
    await getAiRuntime(),
    { ...buildScanPrompt(resume.text), maxTokens: SCAN_MAX_TOKENS, label: 'resume-scan', role: 'resume', timeoutMs: RESUME_TIMEOUT_MS.scan, onError },
    parseScanResponse,
    { id: resume.id },
  );
  if (!answer) return null;
  const scan = answer.data;
  await saveResumeScan(resume.id, scan);
  logger.info(
    { id: resume.id, skills: scan.skills.length, issues: scan.issues.length, attempt: answer.attempt, chars: answer.chars, ms: answer.ms },
    'resume: scanned',
  );
  return scan;
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
