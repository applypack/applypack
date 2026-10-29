import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { firstIssue, type Issue } from './flash';

/*
 * What a refused launcher form says (#682): a missing choice (no job source,
 * no resume) or a posting too short keeps the form's own sentence; any other
 * refusal names the field it is about, in the page's words, instead of one
 * fixed line for every refusal. Pure.
 */

const POSTING_FIELD_LABEL: Record<string, MessageKey> = {
  companyName: 'common.company',
  title: 'job.new.jobTitle',
  url: 'job.new.postingUrl',
  jobUrl: 'job.new.postingUrl',
  location: 'common.location',
  description: 'job.new.jobDescription',
  resumeText: 'letter.start.resumeText',
};

function postingFieldLabel(field: string): string | undefined {
  const key = POSTING_FIELD_LABEL[field];
  return key ? t(key) : undefined;
}

/** Codes that mean "not given": missing, empty, or not one of the choices. */
const NOT_GIVEN = new Set(['invalid_type', 'too_small', 'invalid_value']);

/** The flash for a refused launcher: `sentence` when the first issue is a field in `given` left out, else that field named. */
export function launcherRefusal(issues: readonly Issue[], sentence: string, given: readonly string[]): string {
  const first = issues[0];
  const name = first?.path[0];
  if (!first || (typeof name === 'string' && given.includes(name) && NOT_GIVEN.has(String(first.code)))) return sentence;
  return t('flash.formRefused', { issue: firstIssue(issues, postingFieldLabel) });
}
