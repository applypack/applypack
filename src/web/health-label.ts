import type { FetchStatus } from '../fetchers/source-health';
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

/*
 * A fetch status as a word in the reader's language (ADR 0061).
 * `source-health.ts:describeStatus` keeps the tone, and its own English label
 * for the alerts that name a quiet source; the dashboard says it from here.
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
