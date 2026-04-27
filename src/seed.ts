import { AtsType } from '@prisma/client';
import { prisma } from './db';
import { logger } from './logger';

interface SeedCompany {
  name: string;
  atsType: AtsType;
  atsToken: string;
  careerUrl?: string;
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
        // Always re-enable seeded companies on seed; manual disables made via
        // the dashboard will be reset by an explicit re-seed.
        active: true,
      },
      create: {
        name: c.name,
        atsType: c.atsType,
        atsToken: c.atsToken,
        careerUrl: c.careerUrl ?? null,
        active: true,
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
