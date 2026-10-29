import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

/*
 * The fields of forms whose schema names them its own way, as their pages
 * label them (#648): a refused one is named "Time zone: …", never
 * "timezone: …", and a nested path is marked on the input that carries it.
 * Pure — `flash.ts:firstIssue` takes the labels, `refusedField` the inputs.
 */

interface FormField {
  label: MessageKey;
  /** The input the path is posted in, when its name is not the path's. */
  input?: string;
}

type FormFields = Readonly<Record<string, FormField>>;

/** The schedule's three forms keep flat what `ScheduleSchema` nests. */
const SCHEDULE_FIELDS: FormFields = {
  timezone: { label: 'settings.timeZone' },
  'fetch.every': { label: 'settings.howOften', input: 'fetchEvery' },
  'fetch.from': { label: 'settings.from', input: 'fetchFrom' },
  'fetch.to': { label: 'settings.toInclusive', input: 'fetchTo' },
  'fetch.days': { label: 'settings.days', input: 'fetchDays' },
  'alerts.mode': { label: 'settings.sendAlerts', input: 'alertMode' },
  'alerts.from': { label: 'settings.from', input: 'alertFrom' },
  'alerts.to': { label: 'settings.untilInclusive', input: 'alertTo' },
  'alerts.days': { label: 'settings.days', input: 'alertDays' },
  'alerts.digestAt': { label: 'settings.scheduledMessages', input: 'digestAt' },
};

const PACK_FIELDS: FormFields = {
  enabled: { label: 'settings.pack.enabled' },
  minFit: { label: 'settings.pack.minFit' },
  dailyLimit: { label: 'settings.pack.dailyLimit' },
  maxAgeDays: { label: 'settings.pack.maxAge' },
  coverLetter: { label: 'settings.pack.letter' },
  sections: { label: 'settings.pack.policyTitle' },
  maxBullets: { label: 'settings.pack.maxBullets' },
  keywords: { label: 'settings.pack.keywords' },
  removals: { label: 'settings.pack.removals' },
};

const MUTE_FIELDS: FormFields = {
  name: { label: 'common.company' },
  reason: { label: 'mute.whyOptional' },
};

const WATCH_FIELDS: FormFields = {
  checkEvery: { label: 'watchlist.howOftenThisCompanyIs' },
  alertPolicy: { label: 'watchlist.whatThisCompanyAlertsAbout' },
};

const labelIn = (fields: FormFields) => (field: string): string | undefined => {
  const key = fields[field]?.label;
  return key ? t(key) : undefined;
};

export const scheduleFieldLabel = labelIn(SCHEDULE_FIELDS);
export const packFieldLabel = labelIn(PACK_FIELDS);
export const muteFieldLabel = labelIn(MUTE_FIELDS);
export const watchFieldLabel = labelIn(WATCH_FIELDS);

/** The schedule form's input for a field `ScheduleSchema` refused. */
export function scheduleInput(field: string): string | undefined {
  return SCHEDULE_FIELDS[field]?.input;
}
