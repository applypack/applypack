/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Badge, Card, Hint, SectionTitle } from '../ui';
import type { Tone } from '../format';
import type { Calibration, Funnel, HopStats } from '../stats';
import { MIN_RATE_N } from '../stats';

// F5 (ADR 0024): funnel / velocity / calibration cards on /applications.
// The math lives in src/web/stats.ts; this file only renders it, and the
// "need 5" phrasing is the deliberate face of the null-not-zero rule.

export interface FunnelStatsProps {
  funnel: Funnel;
  hops: HopStats[];
  calibration: Calibration;
}

const HOP_LABEL: Record<string, string> = {
  applied: 'Applied',
  screen: 'Screen',
  tech: 'Tech',
  onsite: 'Onsite',
  offer: 'Offer',
  rejected: 'Rejected',
};

const VERDICT_VIEW: Record<Calibration['verdict'], { label: string; tone: Tone; note: string }> = {
  separating: {
    label: 'separating',
    tone: 'ok',
    note: 'Higher fit bands reach interviews more often — the score is earning its keep.',
  },
  flat: {
    label: 'flat',
    tone: 'warn',
    note: 'Interview rates barely differ across fit bands.',
  },
  inverted: {
    label: 'inverted',
    tone: 'danger',
    note: 'Lower fit bands out-interview higher ones — worth re-checking the profile.',
  },
  insufficient: {
    label: 'not enough data',
    tone: 'neutral',
    note: `A band needs ${MIN_RATE_N} resolved outcomes before its rate counts.`,
  },
};

const rate = (value: number | null, resolved: number): string =>
  value === null ? `— (n=${resolved}, need ${MIN_RATE_N})` : `${Math.round(value * 100)}%`;

export const FunnelStatsSection: FC<FunnelStatsProps> = ({
  funnel,
  hops,
  calibration,
}) => {
  const applied = funnel.rows[0]?.everReached ?? 0;
  if (applied === 0) {
    return (
      <section aria-labelledby="funnel-stats" class="mt-6">
        <h2 id="funnel-stats" class="sr-only">
          Funnel stats
        </h2>
        <Hint>
          Funnel, velocity and calibration stats appear here once an
          application moves through stages — every stage change is now
          kept as history.
        </Hint>
      </section>
    );
  }

  return (
    <section aria-labelledby="funnel-stats" class="mt-6">
      <h2 id="funnel-stats" class="sr-only">
        Funnel stats
      </h2>
      <div class="grid gap-4 xl:grid-cols-3">
        <Card>
          <SectionTitle>Ever reached</SectionTitle>
          <ul class="mt-3 space-y-2">
            {funnel.rows.map((r) => (
              <li class="flex items-center gap-3">
                <span class="w-16 shrink-0 text-[13px] text-ink-muted">
                  {HOP_LABEL[r.stage] ?? r.stage}
                </span>
                <span class="h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <span
                    class="block h-full rounded-full bg-accent"
                    style={`width:${r.everReached === 0 ? 0 : Math.max(2, Math.round((r.everReached / applied) * 100))}%`}
                  />
                </span>
                <span class="w-8 shrink-0 text-right text-sm tabular-nums text-ink">
                  {r.everReached}
                </span>
              </li>
            ))}
          </ul>
          <p class="mt-3 text-[13px] text-ink-faint">
            rejected {funnel.rejected} · ghosted {funnel.ghosted} · in flight{' '}
            {funnel.inFlight}
          </p>
          <Hint class="mt-2">
            A declined offer still counts as an offer — the fold is by the
            furthest stage ever reached.
          </Hint>
        </Card>

        <Card>
          <SectionTitle>Days per hop</SectionTitle>
          <ul class="mt-3 divide-y divide-line">
            {hops.map((h) => (
              <li class="flex items-baseline justify-between gap-3 py-1.5">
                <span class="text-[13px] text-ink-muted">
                  {HOP_LABEL[h.from] ?? h.from} → {HOP_LABEL[h.to] ?? h.to}
                </span>
                <span class="text-right text-sm tabular-nums text-ink">
                  {h.medianDays === null ? '—' : `${h.medianDays}d median`}
                  <span class="ml-2 text-xs text-ink-faint">
                    n={h.n}
                    {h.sameDay > 0 ? ` · ${h.sameDay} same-day` : ''}
                    {h.censored > 0 ? ` · ${h.censored} waiting` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Hint class="mt-2">
            Medians use real event days only — backfilled history carries
            no dates, and same-day hops are counted but not averaged.
          </Hint>
        </Card>

        <Card>
          <div class="flex items-center justify-between gap-2">
            <SectionTitle>Does fit predict interviews?</SectionTitle>
            <Badge tone={VERDICT_VIEW[calibration.verdict].tone}>
              {VERDICT_VIEW[calibration.verdict].label}
            </Badge>
          </div>
          <table class="mt-3 w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-ink-faint">
                <th class="py-1 font-medium">Fit band</th>
                <th class="py-1 text-right font-medium">In funnel</th>
                <th class="py-1 text-right font-medium">Interviews</th>
                <th class="py-1 text-right font-medium">Offers</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              {calibration.bands.map((b) => (
                <tr>
                  <td class="py-1.5 text-ink-muted">{b.label}</td>
                  <td class="py-1.5 text-right tabular-nums text-ink">{b.applied}</td>
                  <td class="py-1.5 text-right tabular-nums text-ink">
                    {rate(b.interviewRate, b.interviewResolved)}
                  </td>
                  <td class="py-1.5 text-right tabular-nums text-ink">
                    {rate(b.offerRate, b.offerResolved)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="mt-2 text-[13px] text-ink-faint">
            {VERDICT_VIEW[calibration.verdict].note}
            {calibration.unknownFit > 0
              ? ` ${calibration.unknownFit} funnel job${calibration.unknownFit === 1 ? ' has' : 's have'} no fit score.`
              : ''}
          </p>
        </Card>
      </div>
    </section>
  );
};
