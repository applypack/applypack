import { t } from '../i18n/t';
import { parseRange, yearsCovered, type DateRange } from './dates';
import { sectorLabels } from './sectors';
import type { ScreenRole } from './prompts';

/*
 * What the dated roles say about a career, computed in code (plan §5,
 * stage C): years in total and in relevant work, how many employers, the
 * average stay, whether the person is in a role now, the sectors and
 * company types in order. FACTS to read beside the score, never inside
 * it — tenure and employer counts are exactly the numbers a screener
 * misreads as a penalty (ADR 0047: a gap is never a criterion). Pure.
 */

export interface Trajectory {
  /** Dated roles the text carried. */
  roles: number;
  employers: number;
  yearsTotal: number | null;
  yearsRelevant: number | null;
  /** Years per role, one decimal — the average stay. */
  averageTenure: number | null;
  /** A role that has not ended. */
  inRoleNow: boolean;
  /** Distinct sectors, most recent first. */
  sectors: string[];
  companyTypes: string[];
}

export function trajectoryOf(roles: ScreenRole[], now: Date): Trajectory {
  const dated: { range: DateRange; role: ScreenRole }[] = [];
  for (const role of roles) {
    const range = parseRange(role.start, role.end, now);
    if (range) dated.push({ range, role });
  }
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  // The same roles the years are counted over — one sentence about one set.
  const employers = new Set(dated.map((d) => d.role.employer?.trim().toLowerCase()).filter((e): e is string => !!e));
  const distinct = (values: (string | null)[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
      const key = v?.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(v!.trim());
    }
    return out;
  };
  const yearsTotal = dated.length > 0 ? yearsCovered(dated.map((d) => d.range)) : null;
  const relevant = dated.filter((d) => d.role.relevant).map((d) => d.range);
  return {
    roles: dated.length,
    employers: employers.size,
    yearsTotal,
    yearsRelevant: relevant.length > 0 ? yearsCovered(relevant) : null,
    averageTenure: dated.length > 0 && yearsTotal !== null ? Math.round((dated.reduce((n, d) => n + yearsCovered([d.range]), 0) / dated.length) * 10) / 10 : null,
    inRoleNow: dated.some((d) => d.range.to.year * 12 + ((d.range.to.month ?? 12) - 1) >= nowIndex),
    // One vocabulary (sectors.ts, TASKS E6): three runs' spellings of a sector read as one.
    sectors: distinct(roles.flatMap((r) => sectorLabels(r.sector))),
    companyTypes: distinct(roles.map((r) => r.companyType)),
  };
}

/**
 * "9.8 years across 3 employers · average stay 3.3 years · in a role now · fintech, e-commerce".
 * The sectors are the vocabulary's labels (sectors.ts), data the criterion matches, so they stay as written.
 */
export function trajectoryLine(career: Trajectory): string {
  if (career.roles === 0) return t('screening.career.none');
  const years = career.yearsTotal ?? 0;
  const parts = [
    career.employers > 0 ? t('screening.career.acrossEmployers', { years, n: career.employers }) : t('screening.career.acrossRoles', { years, n: career.roles }),
    career.averageTenure !== null ? t('screening.career.averageStay', { years: career.averageTenure }) : '',
    career.inRoleNow ? t('screening.career.inRoleNow') : t('screening.career.notInRoleNow'),
    career.sectors.length > 0 ? career.sectors.slice(0, 4).join(', ') : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
