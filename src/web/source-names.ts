/*
 * Human names for AtsType values shown in the UI (settings pills, discovery
 * tags). Unknown values fall through unchanged so a new enum member is never
 * hidden by a stale map.
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
  MANUAL: 'Manual',
};

export function sourceLabel(atsType: string): string {
  return SOURCE_NAMES[atsType] ?? atsType;
}
