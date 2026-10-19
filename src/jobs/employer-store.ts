import type { CompanyMute } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { getSettings, markEmployersFilled } from '../settings';
import {
  cleanEmployer,
  employerFromDescription,
  employerKey,
  sourceIsEmployer,
  type EmployerRules,
} from '../employer';

/*
 * The database side of ADR 0056: the mute list, what the tick's gate reads,
 * and the one-time fill of the rows stored before Job.employerKey. The
 * decisions are employer.ts's; this module only reads and writes them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows read per pass by the one-time fill; a description is a few KB. */
const FILL_BATCH = 500;
/** Longer is not a reason, it is a letter. */
const MAX_REASON_CHARS = 300;

/** Read once per tick, like the schedule: the muted keys and, with the window on, the keys applied to inside it. */
export async function loadEmployerRules(now = new Date()): Promise<EmployerRules> {
  const [mutes, { reapplyDays }] = await Promise.all([
    prisma.companyMute.findMany({ select: { key: true } }),
    getSettings(),
  ]);
  const muted = new Set(mutes.map((m) => m.key));
  if (reapplyDays === null) return { muted, appliedUntil: new Map() };
  const applied = await prisma.job.groupBy({
    by: ['employerKey'],
    where: { appliedAt: { gte: new Date(now.getTime() - reapplyDays * DAY_MS) }, employerKey: { not: null } },
    _max: { appliedAt: true },
  });
  // The window runs from the latest application: a folder's file whose rows it turned away is read again once it closes (#448).
  return {
    muted,
    appliedUntil: new Map(
      applied.flatMap(({ employerKey, _max }) => (employerKey === null || _max.appliedAt === null ? [] : [[employerKey, new Date(_max.appliedAt.getTime() + reapplyDays * DAY_MS)] as const])),
    ),
  };
}

/** The keys /jobs hides by default. */
export async function mutedKeys(): Promise<string[]> {
  const rows = await prisma.companyMute.findMany({ select: { key: true } });
  return rows.map((r) => r.key);
}

/** Every mute, newest first, with how many stored postings it hides. */
export async function listMutes(): Promise<(CompanyMute & { hidden: number })[]> {
  const mutes = await prisma.companyMute.findMany({ orderBy: { createdAt: 'desc' } });
  if (mutes.length === 0) return [];
  const counts = await prisma.job.groupBy({
    by: ['employerKey'],
    where: { employerKey: { in: mutes.map((m) => m.key) } },
    _count: { _all: true },
  });
  const hidden = new Map(counts.map((c) => [c.employerKey, c._count._all]));
  return mutes.map((m) => ({ ...m, hidden: hidden.get(m.key) ?? 0 }));
}

export async function findMute(key: string): Promise<CompanyMute | null> {
  return prisma.companyMute.findUnique({ where: { key } });
}

/** Mutes a name; null when it is not one (nothing to match). Muting again rewrites the reason. */
export async function muteEmployer(name: string, reason: string | null): Promise<CompanyMute | null> {
  const clean = cleanEmployer(name);
  const key = clean === null ? null : employerKey(clean);
  if (clean === null || key === null) return null;
  const why = reason?.trim().slice(0, MAX_REASON_CHARS) || null;
  const mute = await prisma.companyMute.upsert({
    where: { key },
    create: { key, name: clean, reason: why },
    update: { name: clean, reason: why },
  });
  logger.info({ key }, 'employers: muted');
  return mute;
}

/** True when there was a mute to lift. */
export async function unmuteEmployer(key: string): Promise<boolean> {
  const { count } = await prisma.companyMute.deleteMany({ where: { key } });
  if (count > 0) logger.info({ key }, 'employers: unmuted');
  return count > 0;
}

/**
 * Once per install (`AppSettings.employersFilledAt`): the rows stored before
 * Job.employerKey get theirs. A source that is the employer gives every row
 * its own name, in one update per company; an aggregator's rows give back
 * the "Hiring company: …" line their fetcher wrote, grouped so there is one
 * update per employer. A row that names nobody keeps NULL. Zero AI.
 */
export async function fillEmployerKeys(): Promise<void> {
  if ((await getSettings()).employersFilledAt !== null) return;
  const companies = await prisma.company.findMany({ select: { id: true, name: true, atsType: true } });
  let filled = 0;
  for (const company of companies.filter((c) => sourceIsEmployer(c.atsType))) {
    const key = employerKey(company.name);
    if (key === null) continue;
    const { count } = await prisma.job.updateMany({ where: { companyId: company.id, employerKey: null }, data: { employerKey: key } });
    filled += count;
  }
  const aggregators = companies.filter((c) => !sourceIsEmployer(c.atsType)).map((c) => c.id);
  let after = 0;
  for (;;) {
    const rows = await prisma.job.findMany({
      where: { companyId: { in: aggregators }, employerKey: null, id: { gt: after } },
      select: { id: true, description: true },
      orderBy: { id: 'asc' },
      take: FILL_BATCH,
    });
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.id;
    const byName = new Map<string, number[]>();
    for (const row of rows) {
      const name = employerFromDescription(row.description);
      if (name !== null) byName.set(name, [...(byName.get(name) ?? []), row.id]);
    }
    for (const [name, ids] of byName) {
      const key = employerKey(name);
      if (key === null) continue;
      const { count } = await prisma.job.updateMany({ where: { id: { in: ids } }, data: { employer: name, employerKey: key } });
      filled += count;
    }
  }
  await markEmployersFilled(new Date());
  logger.info({ filled }, 'employers: older rows given their employer keys');
}
