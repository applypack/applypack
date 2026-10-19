import { claimRun, findLiveRun, startRun, updateRun, type TargetRun } from './target-runs';
import { hashShortId } from '../text-utils';
import type { ResumeScan } from '../resume/prompts';
import { t } from '../i18n/t';

/*
 * A resume's scan as a run of the shared progress page: an upload, a new
 * version, Scan, a clean version saved as a new resume and the scan behind
 * Save as vN's comparison all go through it, so a second request for the same
 * text joins the one in flight instead of paying for it again (#590, #608).
 * The scan itself comes in as `scan` (resume/scan.ts:scanResume).
 */

type Scan = (resume: { id: number; text: string }) => Promise<ResumeScan | null>;

export interface ScanCopy {
  subtitle: string;
  onScanned: (scan: ResumeScan) => string;
  onFailed: string;
}

const scanKey = (resume: { id: number; text: string }) => `scan:${resume.id}:${hashShortId(resume.text)}`;

/** The scan of this text in flight, if one is: the resume page says so instead of offering another. */
export function liveScanRun(resume: { id: number; text: string }): TargetRun | null {
  return findLiveRun(scanKey(resume));
}

/** Starts the scan of the resume's text, or hands back the run already doing it. Nobody has to be watching. */
export function beginScan(
  resume: { id: number; name: string; text: string },
  copy: ScanCopy,
  scan: Scan,
): { run: TargetRun; joined: boolean } {
  const { id, name, text } = resume;
  const claimed = claimRun(scanKey(resume), {
    steps: ['scan'],
    jobTitle: '',
    resumeName: name,
    heading: { running: t('resume.run.scanRunning'), failed: t('resume.run.scanFailed') },
    subtitle: copy.subtitle,
    // The row exists either way, so the error state has somewhere real to go.
    backUrl: `/resumes/${id}`,
    backLabel: t('resume.backToResume'),
  });
  if (claimed.joined) return claimed;
  const { run } = claimed;
  startRun(run.id, async () => {
    const scanned = await scan({ id, text });
    updateRun(run.id, scanned
      ? { stage: 'done', resultUrl: `/resumes/${id}`, flash: copy.onScanned(scanned) }
      : { stage: 'error', error: copy.onFailed });
  });
  return claimed;
}
