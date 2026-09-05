import { flagOf, groupsOf, placeLabel } from '../countries';
import { ADZUNA_MARKETS, adzunaCodeFor } from '../fetchers/adzuna';
import type { WorkplaceCode } from '../location';

/*
 * "Enable sources for your countries" (plan §4.3): the token-driven sources
 * a search's places and stack call for — DOU and Djinni rows for Ukraine,
 * the Arbeitnow rows for the German-speaking and British markets, solid.jobs
 * for Poland, the DevITjobs site of Germany, the UK or the Netherlands,
 * Landing.jobs for Portugal, JobTech for Sweden. Pure: the
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
  atsType: 'DOU' | 'DJINNI' | 'ARBEITNOW' | 'SOLIDJOBS' | 'DEVITJOBS' | 'LANDINGJOBS' | 'JOBTECH' | 'ADZUNA' | 'FRANCETRAVAIL';
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

/** Sources that need the user's own account with the vendor (ADR 0034). */
const KEYED: readonly string[] = ['ADZUNA', 'FRANCETRAVAIL'];

/**
 * `unlocked` lists the keyed sources whose credential is in place. A keyed
 * source the user has not registered for is not offered at all — it is an
 * extra the user opts into on Settings → Sources, not something the app
 * suggests to someone who cannot use it.
 */
export function suggestSources(
  searches: readonly SuggestSearch[],
  tracked: readonly TrackedRow[],
  opts: { unlocked?: readonly string[] } = {},
): SourceSuggestion[] {
  const unlocked = opts.unlocked ?? [];
  const byKey = new Map(tracked.map((r) => [`${r.atsType}:${r.atsToken}`, r]));
  const out = new Map<string, SourceSuggestion>();
  const offer = (s: Omit<SourceSuggestion, 'state' | 'companyId'>) => {
    const key = `${s.atsType}:${s.atsToken}`;
    if (out.has(key)) return;
    if (KEYED.includes(s.atsType) && !unlocked.includes(s.atsType)) return;
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
    if (search.countries.includes('PT')) {
      offer({
        name: 'Landing.jobs',
        atsType: 'LANDINGJOBS',
        atsToken: 'landingjobs',
        careerUrl: 'https://landing.jobs',
        reason: `🇵🇹 Portugal in "${search.name}"`,
      });
    }
    // Adzuna serves nineteen markets with the user's own free key (ADR 0034);
    // one row per country the search names.
    for (const country of search.countries) {
      const code = adzunaCodeFor(country);
      if (!code) continue;
      offer({
        name: `Adzuna · ${placeLabel(country)}`,
        atsType: 'ADZUNA',
        atsToken: code,
        careerUrl: `https://${ADZUNA_MARKETS[code]?.domain ?? 'www.adzuna.com'}/`,
        reason: `${flagOf(country)} ${placeLabel(country)} in "${search.name}"`,
      });
    }
    if (search.countries.includes('FR')) {
      offer({
        name: 'France Travail · développement informatique (M1805)',
        atsType: 'FRANCETRAVAIL',
        atsToken: 'codeROME=M1805',
        careerUrl: 'https://candidat.francetravail.fr/offres/recherche?codeROME=M1805',
        reason: `🇫🇷 France in "${search.name}"`,
      });
    }
    if (search.countries.includes('SE') || search.regions.includes('NORDICS')) {
      offer({
        name: 'JobTech · Data/IT, Sweden',
        atsType: 'JOBTECH',
        atsToken: 'occupation-field=apaJ_2ja_LuF',
        careerUrl: 'https://arbetsformedlingen.se/platsbanken/annonser?q=&occupation-field=apaJ_2ja_LuF',
        reason: `🇸🇪 Sweden in "${search.name}"`,
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

/** Starter-pack segments and the countries, regions and stack words that make each worth offering. */
const PACK_FOR: readonly { id: string; countries?: readonly string[]; regions?: readonly string[]; stack?: readonly string[] }[] = [
  { id: 'php-laravel', stack: ['php', 'laravel', 'symfony', 'wordpress', 'drupal', 'magento'] },
  { id: 'js-infra', stack: ['javascript', 'typescript', 'node', 'nodejs', 'node.js', 'react', 'vue', 'angular', 'next.js', 'nextjs'] },
  { id: 'js-product', stack: ['javascript', 'typescript', 'node', 'nodejs', 'node.js', 'react', 'vue', 'angular', 'next.js', 'nextjs'] },
  { id: 'ua-friendly', countries: ['UA'], regions: ['CEE'] },
  { id: 'us-product', countries: ['US'], regions: ['NORTH_AMERICA', 'AMERICAS'] },
  { id: 'eu-product', regions: ['EU', 'EEA', 'EUROPE', 'DACH', 'NORDICS', 'BENELUX', 'CEE', 'UK_IE'] },
];

/**
 * Which starter packs fit the running searches — offered on the wizard's
 * boards step, never presumed (ADR 0040: the seed ships no employer board).
 * "Remote-first, worldwide" fits a search that hunts anywhere or takes
 * remote work; a place pack fits a country the search names or a group it
 * belongs to; a stack pack fits a required technology. Catalog order.
 */
export function packsForSearches(
  searches: readonly Pick<SuggestSearch, 'countries' | 'regions' | 'workplace' | 'stackRequired'>[],
): string[] {
  const out = new Set<string>();
  for (const search of searches) {
    const anywhere = (search.countries.length === 0 && search.regions.length === 0) || search.regions.includes('WORLDWIDE');
    if (anywhere || search.workplace.includes('REMOTE')) out.add('remote-first');
    const regions = new Set([...search.regions, ...search.countries.flatMap(groupsOf)]);
    const stack = new Set(search.stackRequired.map((t) => t.trim().toLowerCase()));
    for (const pack of PACK_FOR) {
      const place = pack.countries?.some((c) => search.countries.includes(c)) || pack.regions?.some((r) => regions.has(r));
      const tech = pack.stack?.some((t) => stack.has(t));
      if (place || tech) out.add(pack.id);
    }
  }
  const order = ['php-laravel', 'js-infra', 'js-product', 'remote-first', 'ua-friendly', 'us-product', 'eu-product'];
  return order.filter((id) => out.has(id));
}
