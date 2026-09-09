import { parseRange, yearsCovered, type DateRange } from './dates';
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
  const employers = new Set(roles.map((r) => r.employer?.trim().toLowerCase()).filter((e): e is string => !!e));
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
    sectors: distinct(roles.map((r) => r.sector)),
    companyTypes: distinct(roles.map((r) => r.companyType)),
  };
}

/** "9.8 years across 3 employers · average stay 3.3 years · in a role now · fintech, e-commerce" */
export function trajectoryLine(t: Trajectory): string {
  if (t.roles === 0) return 'no dated roles in the text';
  const parts = [
    `${t.yearsTotal} year${t.yearsTotal === 1 ? '' : 's'} across ${t.employers || t.roles} employer${(t.employers || t.roles) === 1 ? '' : 's'}`,
    t.averageTenure !== null ? `average stay ${t.averageTenure} year${t.averageTenure === 1 ? '' : 's'}` : '',
    t.inRoleNow ? 'in a role now' : 'not in a role now',
    t.sectors.length > 0 ? t.sectors.slice(0, 4).join(', ') : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
