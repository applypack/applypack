import type { FetchStatus } from '../fetchers/source-health';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

/*
 * A fetch status as a word in the reader's language (ADR 0061).
 * `source-health.ts:describeStatus` keeps the tone and an English reference
 * label (the alerts word a status through `sourceHealth.item`); the dashboard
 * says it from here.
 * Pure — tested in health-label.test.ts.
 */

const HEALTH_LABEL = {
  ok: 'sources.health.ok',
  empty: 'sources.health.empty',
  not_modified: 'sources.health.notModified',
  slug_gone: 'sources.health.slugGone',
  auth: 'sources.health.auth',
  rate_limit: 'sources.health.rateLimit',
  server: 'sources.health.server',
  network: 'sources.health.network',
  bad_payload: 'sources.health.badPayload',
  too_many: 'sources.health.tooMany',
  unknown: 'sources.health.unknown',
} as const satisfies Record<FetchStatus, MessageKey>;

/** A folder's own words for the statuses a file read produces: there is no board, slug or payload to speak of. */
const FOLDER_HEALTH_LABEL: Partial<Record<FetchStatus, MessageKey>> = {
  empty: 'sources.health.folder.empty',
  slug_gone: 'sources.health.folder.slugGone',
  auth: 'sources.health.folder.auth',
  bad_payload: 'sources.health.folder.badPayload',
};

/** "Slug not found"; "Folder not found" for a folder source; "Not fetched yet" before the first read. */
export function healthLabel(status: string | null, atsType?: string): string {
  // Compared as a string, as source-health.ts does: the Prisma enum would pull the client into a pure module.
  const folder = atsType === 'FOLDER' && status !== null && Object.hasOwn(FOLDER_HEALTH_LABEL, status) ? FOLDER_HEALTH_LABEL[status as FetchStatus] : undefined;
  if (folder) return t(folder);
  return t(status !== null && Object.hasOwn(HEALTH_LABEL, status) ? HEALTH_LABEL[status as FetchStatus] : 'sources.health.none');
}

/**
 * A status as the branch a message's select names it by: a folder's own
 * (`folder_slug_gone`) where it has words of its own, `other` for none yet or
 * one the build does not know.
 */
export function statusBranch(status: string | null, atsType: string | undefined): string {
  if (status === null) return 'other';
  if (atsType === 'FOLDER' && Object.hasOwn(FOLDER_HEALTH_LABEL, status)) return `folder_${status}`;
  return Object.hasOwn(HEALTH_LABEL, status) ? status : 'other';
}

/**
 * The label inside a sentence, with the failure streak: "slug not found — 3
 * checks in a row". One message per status — a language declines the words
 * there, so the label is never lowercased into the sentence.
 */
export function healthStreak(status: string | null, atsType: string | undefined, n: number): string {
  return t('sources.health.streakSentence', { status: statusBranch(status, atsType), n });
}
