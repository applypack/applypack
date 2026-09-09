/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Flash, Hint, PageHeader } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDate } from '../format';
import { CRITERION_KIND_LABELS, EVIDENCE_RUNG_LABELS } from '../../screening/rubric';
import { GATE_BUCKET_LABELS, type ScoreRow } from '../../screening/score';
import { GATE_MARK } from '../../screening/export';
import { who, type ComparisonView } from '../../screening/comparison';
import type { SideBySide } from '../screen-compare';

/*
 * Side by side (plan §5) and Compare with AI (plan §5.1, ADR 0051): the
 * ticked applicants as columns, one row per criterion with the stored
 * answers and their quotes; below it, the shortlist read head to head by
 * the model, twice, with the places where the two readings differ. The
 * table on the screening page keeps its order — nothing here scores.
 */

export interface ScreenCompareProps {
  screening: { id: number; title: string; rubricVersion: number };
  side: SideBySide;
  /** The newest stored reading of exactly these applicants, or null. */
  comparison: { view: ComparisonView; model: string; createdAt: Date; rubricVersion: number; markdown: string } | null;
  /** The ids as the URL carries them — the form posts them back. */
  ids: string;
  engine: { label: string; warn: string | null };
  flash?: FlashMessage | null;
}

const BUCKET_TONE = { pass: 'ok', ask: 'warn', fail: 'danger' } as const;
const TONE: Record<string, 'danger' | 'warn' | 'neutral' | 'ok'> = { absent: 'danger', listed: 'warn', project: 'neutral', role: 'ok', production: 'ok', pass: 'ok', partial: 'neutral', unknown: 'warn', fail: 'danger', strong: 'ok', ok: 'neutral', weak: 'danger', exceptional: 'ok', none: 'danger' };
const RUNG_SHORT: Record<string, string> = { listed: 'skills list', role: 'in a role' };

const Cell: FC<{ r: ScoreRow | null }> = ({ r }) => {
  if (!r) return <span class="text-ink-faint">—</span>;
  const answer = r.mode === 'gate' ? `${GATE_MARK[r.gate ?? 'unknown']} ${r.gate ?? 'unknown'}` : (RUNG_SHORT[r.answer] ?? r.answer);
  const tone = r.mode === 'gate' && r.gate ? TONE[r.gate] : (TONE[r.answer] ?? 'neutral');
  return (
    <>
      <span title={(EVIDENCE_RUNG_LABELS as Record<string, string>)[r.answer]}>
        <Badge tone={tone ?? 'neutral'}>{answer}</Badge>
      </span>
      {r.mode === 'scored' && r.max > 0 && <span class="ml-1.5 text-xs tabular-nums text-ink-faint">{r.pts} / {r.max}</span>}
      {r.quote && <q class="mt-1 block text-[13px] leading-5 text-ink-muted">{r.quote}</q>}
      {!r.quote && r.detail && <div class="mt-1 text-xs text-ink-faint">{r.detail}</div>}
    </>
  );
};

const Ranking: FC<{ ranking: number[]; names: Map<number, string | null> }> = ({ ranking, names }) =>
  ranking.length === 0 ? <span class="text-ink-faint">no one placed</span> : <span class="font-medium text-ink">{ranking.map((n) => who(n, names)).join(' › ')}</span>;

export const ScreenComparePage: FC<ScreenCompareProps> = ({ screening, side, comparison, ids, engine, flash }) => {
  const back = `/screen/${screening.id}#results`;
  const names = new Map(side.columns.map((c) => [c.number, c.name]));
  const n = side.columns.length;
  const th = 'px-3 py-2 text-left align-top text-xs font-medium text-ink-muted sm:px-4';
  const td = 'px-3 py-2 align-top text-sm sm:px-4';
  const label = `${td} whitespace-nowrap text-ink-muted`;
  const view = comparison?.view ?? null;
  return (
    <Layout title={`Compare ${n} applicants`} active="screen">
      <PageHeader title={`Compare ${n} applicants`} back={{ href: back, label: screening.title }}>
        One column per applicant, one row per criterion, the quotes under the answers — the stored scorecards, no
        new call. Names are shown to you only.
      </PageHeader>
      <Flash flash={flash} />

      <Card flush>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-line bg-surface-overlay/60">
              <tr>
                <th class={th} />
                {side.columns.map((c) => (
                  <th class={th}>
                    <a href={`/screen/${screening.id}/applicants/${c.id}`} class="text-sm font-semibold text-ink hover:underline">
                      №{c.number}
                      {c.name ? ` — ${c.name}` : ''}
                    </a>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5 font-normal">
                      <Badge tone={BUCKET_TONE[c.bucket]}>{GATE_BUCKET_LABELS[c.bucket]}</Badge>
                      <span class="text-base font-semibold text-ink">{c.adjusted}</span>
                      <span class="text-xs text-ink-faint">
                        / 100{c.adjustment !== 0 ? ` (computed ${c.score}, your ${c.adjustment > 0 ? '+' : ''}${c.adjustment})` : ''} · {c.confidence}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr>
                <td class={label}>Relevant years</td>
                {side.columns.map((c) => (
                  <td class={`${td} tabular-nums`}>{c.years ?? '?'}</td>
                ))}
              </tr>
              <tr>
                <td class={label}>Level</td>
                {side.columns.map((c) => (
                  <td class={td}>{c.level ?? '?'}</td>
                ))}
              </tr>
              <tr>
                <td class={label}>Career</td>
                {side.columns.map((c) => (
                  <td class={`${td} text-ink-muted`}>{c.career ?? '—'}</td>
                ))}
              </tr>
              <tr class="bg-surface-overlay/60">
                <td colspan={n + 1} class="px-3 py-1.5 text-xs font-medium text-ink-muted sm:px-4">
                  Criteria, rubric v{screening.rubricVersion}
                </td>
              </tr>
              {side.rows.map((r) => (
                <tr>
                  <td class={`${td} text-ink`}>
                    <div>{r.label}</div>
                    <div class="text-xs text-ink-faint">
                      {CRITERION_KIND_LABELS[r.kind]} · {r.mode === 'gate' ? 'gate' : r.mode === 'note' ? 'note' : 'scored'}
                    </div>
                  </td>
                  {r.cells.map((cell) => (
                    <td class={td}>
                      <Cell r={cell} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td class={label}>Stands out</td>
                {side.columns.map((c) => (
                  <td class={`${td} text-ink-muted`}>
                    {c.standout.length === 0 ? '—' : (
                      <ul class="list-disc space-y-0.5 pl-4">
                        {c.standout.map((f) => (
                          <li>{f}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <td class={label}>Verdict</td>
                {side.columns.map((c) => (
                  <td class={`${td} text-ink`}>{c.verdictLine || '—'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card class="mt-4" id="ai">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-ink">Compare with AI — the shortlist read head to head</h2>
            <p class="mt-1 text-[13px] text-ink-muted">
              One call with these {n} resumes, the posting and the criteria, run twice — the second time with the
              resumes in the reverse order, because the first and last slots win in a listwise reading. It says who
              is stronger on each criterion and why, with the lines, and whom to talk to first. Never a score: the
              table above keeps its order. Runs on {engine.label}
              {engine.warn ? ' — a personal subscription; see Settings → Screening.' : '.'}
            </p>
          </div>
          <div class="flex items-center gap-2">
            {comparison && (
              <Button variant="secondary" size="sm" type="button" data-copy={comparison.markdown}>
                Copy as Markdown
              </Button>
            )}
            <ActionForm action={`/screen/${screening.id}/compare/ai`} once>
              <input type="hidden" name="ids" value={ids} />
              <Button variant="violet" size="sm">
                {comparison ? 'Read again' : 'Compare with AI'}
              </Button>
            </ActionForm>
          </div>
        </div>

        {comparison && view && (
          <div class="mt-4 space-y-4">
            <p class="text-[13px] text-ink-faint">
              Read {formatDate(comparison.createdAt)} on {comparison.model}, rubric v{comparison.rubricVersion}
              {comparison.rubricVersion !== screening.rubricVersion ? ' — the criteria changed since; read again for the current ones' : ''}. Shown as{' '}
              {view.shown[0].map((x) => `№${x}`).join(', ')} and then as {view.shown[1].map((x) => `№${x}`).join(', ')}.
            </p>
            <div class="rounded-md border border-line bg-surface-overlay px-3.5 py-2.5 text-[13px] leading-5 text-ink" role="status">
              {view.orderAgree
                ? 'The two readings agree on the whole order.'
                : view.firstAgree
                  ? 'The two readings agree on who to talk to first and differ below.'
                  : 'The two readings differ on who to talk to first — the order is not settled by the texts alone.'}{' '}
              {view.disagreements === 0
                ? 'On every criterion where both placed someone, they placed the same applicant first.'
                : `On ${view.disagreements} criteri${view.disagreements === 1 ? 'on' : 'a'} they placed different applicants first.`}
            </div>
            {view.injection && (
              <p class="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
                A resume in this shortlist carried text addressed to an AI reader; it was reported and the texts
                were judged on their merits. Read that scorecard before trusting the order.
              </p>
            )}
            <div class="grid gap-4 sm:grid-cols-2">
              {view.orders.map((order, i) => (
                <div>
                  <h3 class="text-[13px] font-medium text-ink">Order to talk to — reading {i === 0 ? 'A' : 'B'}</h3>
                  {order.length === 0 ? (
                    <Hint class="mt-1">No order given.</Hint>
                  ) : (
                    <ol class="mt-1 list-decimal space-y-1 pl-5 text-sm">
                      {order.map((o) => (
                        <li>
                          <span class="font-medium text-ink">{who(o.applicant, names)}</span>
                          {o.reason && <span class="text-ink-muted"> — {o.reason}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
            {view.deciders.some((d) => d !== null) && (
              <div>
                <h3 class="text-[13px] font-medium text-ink">What would decide between the first two</h3>
                <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                  {view.deciders.map((d, i) => d && <li>{d}{view.deciders[0] !== view.deciders[1] ? <span class="text-ink-faint"> (reading {i === 0 ? 'A' : 'B'})</span> : null}</li>)}
                </ul>
              </div>
            )}
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="border-b border-line bg-surface-overlay/60">
                  <tr>
                    <th class={th}>Criterion</th>
                    <th class={th}>Reading A</th>
                    <th class={th}>Reading B</th>
                    <th class={th} />
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {view.criteria.map((c) => (
                    <tr>
                      <td class={`${td} text-ink`}>{c.label}</td>
                      <td class={td}>
                        <Ranking ranking={c.rankings[0]} names={names} />
                        {c.why[0] && <div class="mt-0.5 text-[13px] text-ink-muted">{c.why[0]}</div>}
                      </td>
                      <td class={td}>
                        <Ranking ranking={c.rankings[1]} names={names} />
                        {c.why[1] && <div class="mt-0.5 text-[13px] text-ink-muted">{c.why[1]}</div>}
                      </td>
                      <td class={`${td} whitespace-nowrap`}>
                        {c.picks[0] !== null && c.picks[1] !== null && <Badge tone={c.agree ? 'ok' : 'warn'}>{c.agree ? 'agree' : 'differ'}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.criteria.some((c) => c.quotes.length > 0) && (
              <details>
                <summary class="cursor-pointer text-[13px] font-medium text-ink">The lines behind the rankings</summary>
                <ul class="mt-2 space-y-2 text-[13px]">
                  {view.criteria
                    .filter((c) => c.quotes.length > 0)
                    .map((c) => (
                      <li>
                        <span class="text-ink">{c.label}</span>
                        <ul class="mt-0.5 list-disc space-y-0.5 pl-5 text-ink-muted">
                          {c.quotes.map((q) => (
                            <li>
                              {who(q.applicant, names)}: <q>{q.quote}</q>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {!comparison && (
          <Hint class="mt-3">Nothing read yet for these {n}. A reading is kept with the screening and shown here until you read again.</Hint>
        )}
      </Card>
      <script type="module" dangerouslySetInnerHTML={{ __html: "import { wireCopy } from '/static/copy.mjs'; wireCopy(document);" }} />
    </Layout>
  );
};
