import type { WorkplaceCode } from '../location';

/*
 * "Enable sources for your countries" (plan §4.3): the token-driven sources
 * a search's places and stack call for — DOU and Djinni rows for Ukraine,
 * the Arbeitnow rows for the German-speaking and British markets, solid.jobs
 * for Poland, the DevITjobs site of Germany, the UK or the Netherlands. Pure: the
 * route hands in the running searches and the rows already tracked, gets
 * back what to offer and in which state. The aggregators that follow the
 * searches by themselves (Jobicy, Himalayas, 4dayweek) need no suggestion.
 */

export interface SuggestSearch {
  name: string;
  countries: string[];
  regions: string[];
  workplace: WorkplaceCode[];
  stackRequired: string[];
}

export interface TrackedRow {
  id: number;
  atsType: string;
  atsToken: string;
  active: boolean;
}

export interface SourceSuggestion {
  name: string;
  atsType: 'DOU' | 'DJINNI' | 'ARBEITNOW' | 'SOLIDJOBS' | 'DEVITJOBS';
  atsToken: string;
  careerUrl: string;
  /** Which search asked for it, in plain words: "🇺🇦 Ukraine in "PHP/Laravel"". */
  reason: string;
  /** missing = not tracked yet; off = tracked, inactive; on = running. */
  state: 'missing' | 'off' | 'on';
  companyId: number | null;
}

/** DOU `category=` names the feed knows (verified live 2026-09-03), by stack tag. */
const DOU_CATEGORY: Readonly<Record<string, string>> = {
  php: 'PHP', laravel: 'PHP', symfony: 'PHP', wordpress: 'PHP',
  javascript: 'JavaScript', typescript: 'JavaScript', react: 'Front End', vue: 'Front End', angular: 'Front End',
  node: 'Node.js', nodejs: 'Node.js', 'node.js': 'Node.js',
  python: 'Python', django: 'Python', fastapi: 'Python',
  java: 'Java', spring: 'Java', kotlin: 'Android',
  go: 'Golang', golang: 'Golang',
  'c#': '.NET', '.net': '.NET', dotnet: '.NET',
  ruby: 'Ruby', rails: 'Ruby', rust: 'Rust',
  qa: 'QA', devops: 'DevOps', kubernetes: 'DevOps',
};

/** Djinni `primary_keyword=` values from its channel category list (168, verified live 2026-09-03). */
const DJINNI_KEYWORD: Readonly<Record<string, string>> = {
  php: 'PHP', laravel: 'Laravel', symfony: 'PHP', wordpress: 'PHP',
  javascript: 'JavaScript', typescript: 'JavaScript', react: 'JavaScript', vue: 'JavaScript', angular: 'JavaScript',
  node: 'Node.js', nodejs: 'Node.js', 'node.js': 'Node.js',
  python: 'Python', django: 'Python', fastapi: 'Python',
  java: 'Java', spring: 'Java', kotlin: 'Java',
  go: 'Golang', golang: 'Golang',
  ruby: 'Ruby', rails: 'Ruby', rust: 'Rust',
  qa: 'QA', devops: 'DevOps', kubernetes: 'DevOps',
};

/** At most this many DOU and Djinni rows per search — a search rarely wants more feeds than that. */
const MAX_FEEDS_PER_SEARCH = 3;

/** The countries and groups that make Arbeitnow worth switching on. */
const ARBEITNOW_COUNTRIES = ['DE', 'AT', 'CH', 'GB'];
const ARBEITNOW_REGIONS = ['DACH', 'UK_IE'];

/** The DevITjobs family: one site per country, offered when a search names it. */
const DEVITJOBS_SITES: readonly { host: string; name: string; countries: string[]; regions: string[]; flag: string; place: string }[] = [
  { host: 'germantechjobs.de', name: 'GermanTechJobs', countries: ['DE'], regions: ['DACH'], flag: '🇩🇪', place: 'Germany' },
  { host: 'devitjobs.uk', name: 'DevITjobs UK', countries: ['GB'], regions: ['UK_IE'], flag: '🇬🇧', place: 'the UK' },
  { host: 'devitjobs.nl', name: 'DevITjobs NL', countries: ['NL'], regions: ['BENELUX'], flag: '🇳🇱', place: 'the Netherlands' },
];

export function suggestSources(searches: readonly SuggestSearch[], tracked: readonly TrackedRow[]): SourceSuggestion[] {
  const byKey = new Map(tracked.map((r) => [`${r.atsType}:${r.atsToken}`, r]));
  const out = new Map<string, SourceSuggestion>();
  const offer = (s: Omit<SourceSuggestion, 'state' | 'companyId'>) => {
    const key = `${s.atsType}:${s.atsToken}`;
    if (out.has(key)) return;
    const row = byKey.get(key);
    out.set(key, { ...s, state: row ? (row.active ? 'on' : 'off') : 'missing', companyId: row?.id ?? null });
  };

  for (const search of searches) {
    const remote = search.workplace.length === 0 || search.workplace.includes('REMOTE');
    if (search.countries.includes('UA') || search.regions.includes('CEE')) {
      const reason = `🇺🇦 Ukraine in "${search.name}"`;
      for (const category of pick(search.stackRequired, DOU_CATEGORY)) {
        offer({
          name: `DOU · ${category}${remote ? ', remote' : ''}`,
          atsType: 'DOU',
          atsToken: `category=${category}${remote ? '&remote' : ''}`,
          careerUrl: `https://jobs.dou.ua/vacancies/?category=${encodeURIComponent(category)}${remote ? '&remote' : ''}`,
          reason,
        });
      }
      for (const keyword of pick(search.stackRequired, DJINNI_KEYWORD)) {
        const employment = remote ? '&employment=remote' : '';
        offer({
          name: `Djinni · ${keyword}${remote ? ', remote' : ''}, Ukraine`,
          atsType: 'DJINNI',
          atsToken: `primary_keyword=${keyword}${employment}&region=UKR`,
          careerUrl: `https://djinni.co/jobs/?primary_keyword=${encodeURIComponent(keyword)}${employment}&region=UKR`,
          reason,
        });
      }
    }
    if (search.countries.includes('PL') || search.regions.includes('CEE')) {
      offer({
        name: 'solid.jobs',
        atsType: 'SOLIDJOBS',
        atsToken: 'solidjobs',
        careerUrl: 'https://solid.jobs',
        reason: `🇵🇱 Poland in "${search.name}"`,
      });
    }
    for (const site of DEVITJOBS_SITES) {
      const named = search.countries.some((c) => site.countries.includes(c)) || search.regions.some((r) => site.regions.includes(r));
      if (!named) continue;
      offer({
        name: site.name,
        atsType: 'DEVITJOBS',
        atsToken: site.host,
        careerUrl: `https://${site.host}`,
        reason: `${site.flag} ${site.place} in "${search.name}"`,
      });
    }
    const germanOrBritish =
      search.countries.some((c) => ARBEITNOW_COUNTRIES.includes(c)) || search.regions.some((r) => ARBEITNOW_REGIONS.includes(r));
    if (germanOrBritish) {
      const reason = `🇩🇪🇬🇧 Germany or the UK in "${search.name}"`;
      offer({ name: 'Arbeitnow Feed', atsType: 'ARBEITNOW', atsToken: 'arbeitnow', careerUrl: 'https://www.arbeitnow.com', reason });
      offer({
        name: 'Arbeitnow · visa sponsorship',
        atsType: 'ARBEITNOW',
        atsToken: 'visa',
        careerUrl: 'https://www.arbeitnow.com/?visa_sponsorship=true',
        reason,
      });
    }
  }
  return [...out.values()];
}

/** The feed names a stack maps to, in the stack's order, once each, capped. */
function pick(stack: readonly string[], table: Readonly<Record<string, string>>): string[] {
  const names: string[] = [];
  for (const tag of stack) {
    const name = table[tag.trim().toLowerCase()];
    if (name && !names.includes(name)) names.push(name);
    if (names.length === MAX_FEEDS_PER_SEARCH) break;
  }
  return names;
}
