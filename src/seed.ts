import { AtsType } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';

interface SeedCompany {
  name: string;
  atsType: AtsType;
  atsToken: string;
  careerUrl?: string;
  // Region- or stack-specific feeds start disabled — the user enables them
  // via the UI when they match the active profile.
  active?: boolean;
}

/**
 * Companies whose tokens have changed (or that left their old ATS for a
 * non-public one). These rows are deleted on every seed so a stale entry
 * doesn't keep producing 404s. Listed as (atsType, atsToken) pairs that
 * were tried in earlier seed revisions.
 */
const OBSOLETE_TOKENS: Array<{ atsType: AtsType; atsToken: string }> = [
  // moved to Workday / private ATS — no public API we can call
  { atsType: AtsType.GREENHOUSE, atsToken: 'vimeo' },
  { atsType: AtsType.GREENHOUSE, atsToken: 'etsy' },
  { atsType: AtsType.GREENHOUSE, atsToken: 'wpengine' },
  { atsType: AtsType.GREENHOUSE, atsToken: 'procore' },
  // wrong token guesses — replaced by correct ones below
  { atsType: AtsType.GREENHOUSE, atsToken: 'wikimediafoundation' },
  { atsType: AtsType.GREENHOUSE, atsToken: 'getlattice' },
  // moved Greenhouse → Ashby
  { atsType: AtsType.GREENHOUSE, atsToken: 'buffer' },
  { atsType: AtsType.GREENHOUSE, atsToken: 'niantic' },
  // moved Lever → Greenhouse / Ashby
  { atsType: AtsType.LEVER, atsToken: 'pleo' },
  { atsType: AtsType.LEVER, atsToken: 'toggl' },
  { atsType: AtsType.LEVER, atsToken: 'scribd' },
  { atsType: AtsType.LEVER, atsToken: 'attentivemobile' },
  // moved to Ashby (31 / 103 open jobs there on 2026-09-05); both boards
  // now live in the starter-pack catalog (ADR 0040)
  { atsType: AtsType.GREENHOUSE, atsToken: 'pleo' },
  { atsType: AtsType.LEVER, atsToken: 'plaid' },
];

/*
 * The default set is the aggregators, switched on, and the regional feeds,
 * off — the same nine boards answer a fresh install in Kyiv and one in
 * Austin, and the boards for a place are one press on the wizard's fourth
 * step. No employer board is on by default (ADR 0040): the curated ones
 * live in src/starter-packs/catalog.json and arrive as a pack the user
 * previews and confirms. What stays here per vendor is one reference
 * board, off, so the vendor's fetcher has a live row to be checked against.
 * The upsert below never touches `active` on an existing row, so an install
 * that has the old boards keeps them as they are.
 */
const SEED_COMPANIES: SeedCompany[] = [
  // Recruitee (F2) — verified live 2026-08-31. Tylko: Warsaw furniture-tech,
  // specialised — starts disabled.
  {
    name: 'Tylko',
    atsType: AtsType.RECRUITEE,
    atsToken: 'tylko',
    careerUrl: 'https://tylko.recruitee.com',
    active: false,
  },

  // Breezy (F2) — verified live 2026-08-31. SoftwareMill: Polish
  // Scala/backend consultancy; board valid but empty at seed time
  // (empty is healthy) — starts disabled, EU-skewed.
  {
    name: 'SoftwareMill',
    atsType: AtsType.BREEZY,
    atsToken: 'softwaremill',
    careerUrl: 'https://softwaremill.breezy.hr',
    active: false,
  },

  // BambooHR (F2) — verified live 2026-08-31. FreshBooks: Canadian
  // accounting SaaS; board valid but empty at seed time. List-only
  // source (no descriptions/dates) — starts disabled.
  {
    name: 'FreshBooks',
    atsType: AtsType.BAMBOOHR,
    atsToken: 'freshbooks',
    careerUrl: 'https://freshbooks.bamboohr.com/careers',
    active: false,
  },

  // Pinpoint (F2) — verified live 2026-08-31. YouLend: London/EU fintech.
  // Dateless source — postedAt is first-seen time.
  {
    name: 'YouLend',
    atsType: AtsType.PINPOINT,
    atsToken: 'youlend',
    careerUrl: 'https://youlend.pinpointhq.com',
    active: false,
  },

  // Personio (stage 3d, plan §4.2): the DACH mid-market ATS, public XML per
  // slug. Holidu is the reference board (54 positions, Munich / Italy /
  // Spain on 2026-09-03). Off until a search hunts in that market.
  {
    name: 'Holidu',
    atsType: AtsType.PERSONIO,
    atsToken: 'holidu',
    careerUrl: 'https://holidu.jobs.personio.de',
    active: false,
  },

  // Teamtailor (stage 3d, plan §4.2): the Nordic / UK / NL ATS, public JSON
  // Feed per board. Tibber is the reference board (Nordic energy tech,
  // ISO countries on every posting, 2026-09-03). Off until a search hunts there.
  {
    name: 'Tibber',
    atsType: AtsType.TEAMTAILOR,
    atsToken: 'tibber',
    careerUrl: 'https://tibber.teamtailor.com',
    active: false,
  },

  // LaraJobs RSS — Laravel-only board, single feed under one synthetic
  // company. Enable when the active profile targets PHP/Laravel.
  {
    name: 'LaraJobs Feed',
    atsType: AtsType.LARAJOBS_RSS,
    atsToken: 'larajobs',
    careerUrl: 'https://larajobs.com',
    active: false,
  },

  // Public aggregator feeds (Phase 3.1). Each is one synthetic Company row;
  // each source publishes hundreds of jobs across many real companies.
  {
    name: 'RemoteOK Feed',
    atsType: AtsType.REMOTEOK,
    atsToken: 'remoteok',
    careerUrl: 'https://remoteok.com',
  },
  {
    name: 'Remotive Feed',
    atsType: AtsType.REMOTIVE,
    atsToken: 'remotive',
    careerUrl: 'https://remotive.com',
  },
  {
    // EU-skewed; enable when an EU search is relevant.
    name: 'Arbeitnow Feed',
    atsType: AtsType.ARBEITNOW,
    atsToken: 'arbeitnow',
    careerUrl: 'https://www.arbeitnow.com',
    active: false,
  },
  {
    // Same board, only the postings whose employer sponsors a visa — a
    // server-side filter, so a feed of its own (stage 3a). Off until a
    // search needs it, like the plain feed.
    name: 'Arbeitnow · visa sponsorship',
    atsType: AtsType.ARBEITNOW,
    atsToken: 'visa',
    careerUrl: 'https://www.arbeitnow.com/?visa_sponsorship=true',
    active: false,
  },

  // DOU.ua (stage 3b) — one row per feed query; the reference deployment's
  // own search is PHP, so that is the seeded example. Off until a search
  // hunts in Ukraine; add other queries on /companies (category=…, search=…).
  {
    name: 'DOU · PHP, remote',
    atsType: AtsType.DOU,
    atsToken: 'category=PHP&remote',
    careerUrl: 'https://jobs.dou.ua/vacancies/?category=PHP&remote',
    active: false,
  },

  // Djinni (stage 3b) — one row per filter string; the location lives in the
  // filter, so the row's name says it. Off until a search hunts in Ukraine.
  {
    name: 'Djinni · PHP, remote, Ukraine',
    atsType: AtsType.DJINNI,
    atsToken: 'primary_keyword=PHP&employment=remote&region=UKR',
    careerUrl: 'https://djinni.co/jobs/?primary_keyword=PHP&employment=remote&region=UKR',
    active: false,
  },

  // HN /jobs — individual YC-job posts indexed by Algolia under
  // tags=job (separate from the monthly Who-is-hiring thread). Each
  // hit is a YC-portfolio company hiring continuously, with the post
  // URL pointing directly at the company's ATS — so the discovery
  // pipeline gets free CompanyCandidate harvest as a side-effect of
  // running this fetcher. High-ROI cross-company source because YC
  // companies skew remote-friendly.
  {
    name: 'HN /jobs Feed',
    atsType: AtsType.HN_JOBS,
    atsToken: 'hn-jobs',
    careerUrl: 'https://news.ycombinator.com/jobs',
  },

  // Jobicy — cross-company remote-job aggregator (~50 items/feed).
  // Indexes employers we'd never seed individually (PSI CRO, ManTech,
  // Mindrift, etc.). This is the answer to "monitor matching roles at
  // companies I haven't added yet" — without scraping LinkedIn /
  // Indeed (excluded by ADR 0005, which we hold to). Active by
  // default so users get cross-company coverage out of the box.
  {
    name: 'Jobicy Feed',
    atsType: AtsType.JOBICY,
    atsToken: 'jobicy',
    careerUrl: 'https://jobicy.com',
  },

  // Working Nomads — free no-auth JSON API, ~30 most recent cross-company
  // postings (Development-heavy, mixed categories; base filter culls).
  {
    name: 'Working Nomads',
    atsType: AtsType.WORKINGNOMADS,
    atsToken: 'workingnomads',
    careerUrl: 'https://www.workingnomads.com/jobs',
  },

  // 4 Day Week (F2) — global aggregator of 4-day-week jobs via the
  // robots-allowed /api/v2 endpoint; 25/page newest-first, fetcher caps
  // at 3 pages. Salary folded into the description (minor units ÷100).
  {
    name: '4 Day Week',
    atsType: AtsType.FOURDAYWEEK,
    atsToken: 'fourdayweek',
    careerUrl: 'https://4dayweek.io',
  },

  // solid.jobs (stage 3c, plan §4.2): the Polish IT board's public offers
  // API, ~1 500 offers with cities, remote / hybrid flags and PLN salaries.
  // Off until a search hunts in Poland — /companies suggests it then.
  {
    name: 'solid.jobs',
    atsType: AtsType.SOLIDJOBS,
    atsToken: 'solidjobs',
    careerUrl: 'https://solid.jobs',
    active: false,
  },

  // The DevITjobs family (stage 3c, plan §4.2): one RSS feed per country
  // site, the host is the token. Salary in every title, no city in the feed
  // — the country is the site. Off until a search hunts there.
  {
    name: 'GermanTechJobs',
    atsType: AtsType.DEVITJOBS,
    atsToken: 'germantechjobs.de',
    careerUrl: 'https://germantechjobs.de',
    active: false,
  },
  {
    name: 'DevITjobs UK',
    atsType: AtsType.DEVITJOBS,
    atsToken: 'devitjobs.uk',
    careerUrl: 'https://devitjobs.uk',
    active: false,
  },
  {
    name: 'DevITjobs NL',
    atsType: AtsType.DEVITJOBS,
    atsToken: 'devitjobs.nl',
    careerUrl: 'https://devitjobs.nl',
    active: false,
  },

  // Landing.jobs (stage 3c, plan §4.2): the Portuguese tech board's Atom
  // feed — city, country and remote policy in its own `lj:` fields. The
  // JSON API is off-limits by robots (ADR 0005). Off until a search hunts
  // in Portugal.
  {
    name: 'Landing.jobs',
    atsType: AtsType.LANDINGJOBS,
    atsToken: 'landingjobs',
    careerUrl: 'https://landing.jobs',
    active: false,
  },

  // JobTech JobSearch (stage 3c, plan §4.2): Arbetsförmedlingen's open API
  // over every ad in Sweden, CC0. The token is the search filter string;
  // this row is the Data/IT field, ~140 ads a day. Off until a search hunts
  // in Sweden.
  {
    name: 'JobTech · Data/IT, Sweden',
    atsType: AtsType.JOBTECH,
    atsToken: 'occupation-field=apaJ_2ja_LuF',
    careerUrl: 'https://arbetsformedlingen.se/platsbanken/annonser?q=&occupation-field=apaJ_2ja_LuF',
    active: false,
  },

  // Himalayas — free no-auth JSON API, 20 newest cross-company postings
  // per call across ALL categories (tech + Legal/Sales/…; base filter
  // culls). Carries structured salary + seniority that we fold into the
  // description for Claude.
  {
    name: 'Himalayas',
    atsType: AtsType.HIMALAYAS,
    atsToken: 'himalayas',
    careerUrl: 'https://himalayas.app/jobs',
  },

  // WeWorkRemotely — paid posting → low-spam. Two developer categories
  // to start; the user can add more (`design-jobs`, etc) via UI.
  {
    name: 'WeWorkRemotely · Back-End',
    atsType: AtsType.WEWORKREMOTELY,
    atsToken: 'back-end-programming',
    careerUrl:
      'https://weworkremotely.com/categories/remote-back-end-programming-jobs',
  },
  {
    name: 'WeWorkRemotely · Full-Stack',
    atsType: AtsType.WEWORKREMOTELY,
    atsToken: 'full-stack-programming',
    careerUrl:
      'https://weworkremotely.com/categories/remote-full-stack-programming-jobs',
  },

  // Curated Go-only board (~12 years old). Useful only when the active
  // profile actually targets Go — disabled by default.
  {
    name: 'Golangprojects',
    atsType: AtsType.GOLANGPROJECTS,
    atsToken: 'golangprojects',
    careerUrl: 'https://www.golangprojects.com',
    active: false,
  },
];

export async function runSeed(): Promise<{
  upserts: number;
  deleted: number;
}> {
  // Wipe obsolete entries first — onDelete: Cascade clears their jobs too.
  const deleted = await prisma.company.deleteMany({
    where: {
      OR: OBSOLETE_TOKENS.map((o) => ({
        atsType: o.atsType,
        atsToken: o.atsToken,
      })),
    },
  });
  if (deleted.count > 0) {
    logger.info({ count: deleted.count }, 'seed: removed obsolete companies');
  }

  let upserts = 0;
  for (const c of SEED_COMPANIES) {
    await prisma.company.upsert({
      where: {
        atsType_atsToken: { atsType: c.atsType, atsToken: c.atsToken },
      },
      update: {
        name: c.name,
        careerUrl: c.careerUrl ?? null,
        // Don't touch `active` on update — it's user-controlled via /companies.
      },
      create: {
        name: c.name,
        atsType: c.atsType,
        atsToken: c.atsToken,
        careerUrl: c.careerUrl ?? null,
        active: c.active ?? true,
      },
    });
    upserts++;
  }
  return { upserts, deleted: deleted.count };
}

if (require.main === module) {
  runSeed()
    .then(({ upserts, deleted }) => {
      logger.info({ upserts, deleted }, 'seed: done');
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'seed: failed');
      void prisma.$disconnect().finally(() => process.exit(1));
    });
}
