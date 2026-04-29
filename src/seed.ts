import { AtsType } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';

interface SeedCompany {
  name: string;
  atsType: AtsType;
  atsToken: string;
  careerUrl?: string;
  // Some seed companies are added in disabled state — user enables via UI
  // when they're ready (e.g. EU-skewed feeds while user focuses on US).
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
];

const SEED_COMPANIES: SeedCompany[] = [
  // Greenhouse
  { name: 'Pantheon', atsType: AtsType.GREENHOUSE, atsToken: 'pantheon' },
  { name: 'Acquia', atsType: AtsType.GREENHOUSE, atsToken: 'acquia' },
  { name: 'TaskRabbit', atsType: AtsType.GREENHOUSE, atsToken: 'taskrabbit' },
  {
    name: 'Wikimedia Foundation',
    atsType: AtsType.GREENHOUSE,
    atsToken: 'wikimedia',
  },
  { name: 'Doximity', atsType: AtsType.GREENHOUSE, atsToken: 'doximity' },
  { name: 'Lattice', atsType: AtsType.GREENHOUSE, atsToken: 'lattice' },
  { name: 'Gusto', atsType: AtsType.GREENHOUSE, atsToken: 'gusto' },
  { name: 'Square (Block)', atsType: AtsType.GREENHOUSE, atsToken: 'block' },
  { name: 'Affirm', atsType: AtsType.GREENHOUSE, atsToken: 'affirm' },
  { name: 'Betterment', atsType: AtsType.GREENHOUSE, atsToken: 'betterment' },
  { name: 'Reddit', atsType: AtsType.GREENHOUSE, atsToken: 'reddit' },
  { name: 'MongoDB', atsType: AtsType.GREENHOUSE, atsToken: 'mongodb' },
  { name: 'Pleo', atsType: AtsType.GREENHOUSE, atsToken: 'pleo' },
  { name: 'Attentive', atsType: AtsType.GREENHOUSE, atsToken: 'attentive' },
  // HigherLogic — added phase-7.3 after the user found a "Sr. Software
  // Engineer (PHP)" posting on LinkedIn that wasn't in our DB. This is
  // exactly the long-tail case the system needs to scale to: companies
  // that post small numbers of senior PHP roles without crowding the
  // PHP-aggregator boards. The /companies UI is the proper way to grow
  // this list; the seed is just a starter set.
  {
    name: 'HigherLogic',
    atsType: AtsType.GREENHOUSE,
    atsToken: 'higherlogic',
    careerUrl: 'https://www.higherlogic.com/about/careers/',
  },

  // Lever — verified live as of phase-7.2 re-seed:
  //   plaid: ~95 postings; lots of fintech engineering, broad role-type
  //     coverage (Data Engineer / Eng Manager / Sales Engineer / Backend
  //     in mix). Always-on hiring.
  //   spotify: ~180 postings; many "Backend Engineer - X" titles that
  //     match the default profile's roleTypes filter directly.
  // Both endpoints respond 200 with non-trivial payloads. Other Lever
  // tokens we tried (figma/discord/box/retool/grammarly/etc.) are now
  // 404 — those companies migrated off Lever to Greenhouse / Workable
  // / private ATSes between 2024 and 2026.
  {
    name: 'Plaid',
    atsType: AtsType.LEVER,
    atsToken: 'plaid',
    careerUrl: 'https://plaid.com/careers/openings',
  },
  {
    name: 'Spotify',
    atsType: AtsType.LEVER,
    atsToken: 'spotify',
    careerUrl: 'https://www.lifeatspotify.com/jobs',
  },

  // Ashby
  {
    name: 'Buffer',
    atsType: AtsType.ASHBY,
    atsToken: 'buffer',
    careerUrl: 'https://buffer.com/journey',
  },
  {
    name: 'Niantic',
    atsType: AtsType.ASHBY,
    atsToken: 'niantic',
    careerUrl: 'https://nianticlabs.com/careers',
  },
  {
    name: 'Scribd / Everand',
    atsType: AtsType.ASHBY,
    atsToken: 'scribdinc',
    careerUrl: 'https://www.scribd.com/about',
  },

  // LaraJobs RSS — single feed under one synthetic company.
  {
    name: 'LaraJobs Feed',
    atsType: AtsType.LARAJOBS_RSS,
    atsToken: 'larajobs',
    careerUrl: 'https://larajobs.com',
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
    // EU-skewed; user enables when relocation/EU-search is relevant.
    name: 'Arbeitnow Feed',
    atsType: AtsType.ARBEITNOW,
    atsToken: 'arbeitnow',
    careerUrl: 'https://www.arbeitnow.com',
    active: false,
  },

  // Jobicy — cross-company remote-job aggregator (~50 items/feed).
  // Indexes employers we'd never seed individually (PSI CRO, ManTech,
  // Mindrift, etc.). This is the answer to "monitor PHP roles at
  // companies I haven't added yet" — without scraping LinkedIn /
  // Indeed (excluded by ADR 0005, which we hold to). Active by
  // default so users get cross-company coverage out of the box.
  {
    name: 'Jobicy Feed',
    atsType: AtsType.JOBICY,
    atsToken: 'jobicy',
    careerUrl: 'https://jobicy.com',
  },

  // WeWorkRemotely — paid posting → low-spam. Two relevant categories
  // for the default profile; user can add more (`design-jobs`, etc) via UI.
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
