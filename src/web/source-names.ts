import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

/*
 * Human names for AtsType values shown in the UI (settings pills, discovery
 * tags). Unknown values fall through unchanged so a new enum member is never
 * hidden by a stale map.
 *
 * A vendor's or a board's name is a name: it reads the same in every
 * language. The four kinds that are no vendor are described in words, and
 * those come from the catalog.
 */

const SOURCE_NAMES: Record<string, string> = {
  GREENHOUSE: 'Greenhouse',
  LEVER: 'Lever',
  ASHBY: 'Ashby',
  WORKABLE: 'Workable',
  SMARTRECRUITERS: 'SmartRecruiters',
  LARAJOBS_RSS: 'Laravel Jobs',
  REMOTEOK: 'RemoteOK',
  REMOTIVE: 'Remotive',
  JOBICY: 'Jobicy',
  WEWORKREMOTELY: 'We Work Remotely',
  HN_HIRING: 'HN Who is hiring',
  HN_JOBS: 'HN Jobs',
  ARBEITNOW: 'Arbeitnow',
  GOLANGPROJECTS: 'Golang Projects',
  WORKINGNOMADS: 'Working Nomads',
  HIMALAYAS: 'Himalayas',
  RECRUITEE: 'Recruitee',
  BREEZY: 'Breezy HR',
  BAMBOOHR: 'BambooHR',
  PINPOINT: 'Pinpoint',
  RIPPLING: 'Rippling',
  FOURDAYWEEK: '4 Day Week',
  SOLIDJOBS: 'solid.jobs',
  DEVITJOBS: 'DevITjobs',
  LANDINGJOBS: 'Landing.jobs',
  JOBTECH: 'JobTech',
  PERSONIO: 'Personio',
  TEAMTAILOR: 'Teamtailor',
  ADZUNA: 'Adzuna',
  FRANCETRAVAIL: 'France Travail',
  DOU: 'DOU',
  DJINNI: 'Djinni',
};

const SOURCE_KINDS: Record<string, MessageKey> = {
  FEED: 'sources.kind.feed',
  CAREER_PAGE: 'sources.kind.careerPage',
  BROWSER_PAGE: 'sources.kind.browserPage',
  MANUAL: 'sources.kind.manual',
};

export function sourceLabel(atsType: string): string {
  if (Object.hasOwn(SOURCE_KINDS, atsType)) return t(SOURCE_KINDS[atsType]!);
  return SOURCE_NAMES[atsType] ?? atsType;
}
