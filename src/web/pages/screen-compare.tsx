/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Flash, Hint, Notice, PageHeader } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDate } from '../format';
import { CRITERION_KIND_LABELS, criterionLabel, EVIDENCE_RUNG_LABELS } from '../../screening/rubric';
import { answerBadge, GATE_BUCKET_LABELS, type ScoreRow } from '../../screening/score';
import { GATE_MARK } from '../../screening/export';
import { who, type ComparisonView } from '../../screening/comparison';
import type { SideBySide } from '../screen-compare';
import { ANSWER_TONE, BUCKET_TONE, confidenceLabel } from '../screen-view';
import { t } from '../../i18n/t';

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

const Cell: FC<{ r: ScoreRow | null }> = ({ r }) => {
  if (!r) return <span class="text-ink-faint">—</span>;
  const answer = r.mode === 'gate' ? `${GATE_MARK[r.gate ?? 'unknown']} ${answerBadge(r.gate ?? 'unknown')}` : answerBadge(r.answer);
  const tone = r.mode === 'gate' && r.gate ? ANSWER_TONE[r.gate] : (ANSWER_TONE[r.answer] ?? 'neutral');
  return (
    <>
      <span title={(EVIDENCE_RUNG_LABELS as Record<string, string>)[r.answer]}>
        <Badge tone={tone ?? 'neutral'}>{answer}</Badge>
      </span>
      {r.mode === 'scored' && r.max > 0 && <span class="ml-1.5 text-meta tabular-nums text-ink-faint">{r.pts} / {r.max}</span>}
      {r.quote && <q class="mt-1 block text-note leading-5 text-ink-muted" translate="no">{r.quote}</q>}
      {/* Written into the stored breakdown in English (score.ts) — data. */}
      {!r.quote && r.detail && <div class="mt-1 text-meta text-ink-faint" lang="en">{r.detail}</div>}
    </>
  );
};

const Ranking: FC<{ ranking: number[]; names: Map<number, string | null> }> = ({ ranking, names }) =>
  ranking.length === 0 ? <span class="text-ink-faint">{t('screen.compare.noOnePlaced')}</span> : <span class="font-medium text-ink" translate="no">{ranking.map((n) => who(n, names)).join(' › ')}</span>;

export const ScreenComparePage: FC<ScreenCompareProps> = ({ screening, side, comparison, ids, engine, flash }) => {
  const back = `/screen/${screening.id}#results`;
  const names = new Map(side.columns.map((c) => [c.number, c.name]));
  const n = side.columns.length;
  const th = 'px-3 py-2 text-left align-top text-meta font-medium text-ink-muted sm:px-4';
  const td = 'px-3 py-2 align-top text-sm sm:px-4';
  const label = `${td} whitespace-nowrap text-ink-muted`;
  const view = comparison?.view ?? null;
  return (
    <Layout title={t('screen.compare.title', { n })} active="screen">
      <PageHeader title={t('screen.compare.title', { n })} back={{ href: back, label: screening.title, labelIsData: true }}>
        {t('screen.compare.intro')}
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
                    <a href={`/screen/${screening.id}/applicants/${c.id}`} class="text-entity text-ink hover:underline" translate="no">
                      №{c.number}
                      {c.name ? ` — ${c.name}` : ''}
                    </a>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5 font-normal">
                      <Badge tone={BUCKET_TONE[c.bucket]}>{GATE_BUCKET_LABELS[c.bucket]}</Badge>
                      <span class="text-entity text-ink">{c.adjusted}</span>
                      <span class="text-meta text-ink-faint">
                        / 100{c.adjustment !== 0 ? ` ${t('screen.compare.adjusted', { score: c.score, adjustment: `${c.adjustment > 0 ? '+' : ''}${c.adjustment}` })}` : ''} · {confidenceLabel(c.confidence)}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr>
                <th scope="row" class={label}>{t('screen.compare.row.years')}</th>
                {side.columns.map((c) => (
                  <td class={`${td} tabular-nums`}>{c.years ?? '?'}</td>
                ))}
              </tr>
              <tr>
                <th scope="row" class={label}>{t('screen.compare.row.level')}</th>
                {side.columns.map((c) => (
                  <td class={td} translate="no">{c.level ?? '?'}</td>
                ))}
              </tr>
              <tr>
                <th scope="row" class={label}>{t('screen.compare.row.career')}</th>
                {side.columns.map((c) => (
                  <td class={`${td} text-ink-muted`}>{c.career ?? '—'}</td>
                ))}
              </tr>
              <tr class="bg-surface-overlay/60">
                <td colspan={n + 1} class="px-3 py-1.5 text-meta font-medium text-ink-muted sm:px-4">
                  {t('screen.compare.criteria', { version: screening.rubricVersion })}
                </td>
              </tr>
              {side.rows.map((r) => (
                <tr>
                  <td class={`${td} text-ink`}>
                    <div>{criterionLabel(r)}</div>
                    <div class="text-meta text-ink-faint">
                      {CRITERION_KIND_LABELS[r.kind]} · {t('screen.compare.mode', { mode: r.mode })}
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
                <th scope="row" class={label}>{t('screen.compare.row.standsOut')}</th>
                {side.columns.map((c) => (
                  <td class={`${td} text-ink-muted`} lang="en">
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
                <th scope="row" class={label}>{t('screen.compare.row.verdict')}</th>
                {side.columns.map((c) => (
                  <td class={`${td} text-ink`} lang="en">{c.verdictLine || '—'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card class="mt-4" id="ai">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-entity text-ink">{t('screen.compare.ai.title')}</h2>
            <p class="mt-1 text-note text-ink-muted">
              {t('screen.compare.ai.intro', { n, engine: engine.label, personal: engine.warn ? 'yes' : 'no' })}
            </p>
          </div>
          <div class="flex items-center gap-2">
            {comparison && (
              <Button variant="secondary" size="sm" type="button" data-copy={comparison.markdown}>
                {t('screen.compare.ai.copy')}
              </Button>
            )}
            <ActionForm action={`/screen/${screening.id}/compare/ai`} once>
              <input type="hidden" name="ids" value={ids} />
              <Button variant="violet" size="sm">
                {comparison ? t('screen.compare.ai.readAgain') : t('screen.compare.ai.compare')}
              </Button>
            </ActionForm>
          </div>
        </div>

        {comparison && view && (
          <div class="mt-4 space-y-4">
            <p data-ui="hint" class="text-note text-ink-faint">
              {t('screen.compare.ai.read', {
                date: formatDate(comparison.createdAt),
                model: comparison.model,
                version: comparison.rubricVersion,
                changed: comparison.rubricVersion !== screening.rubricVersion ? 'yes' : 'no',
                first: view.shown[0].map((x) => `№${x}`).join(', '),
                second: view.shown[1].map((x) => `№${x}`).join(', '),
              })}
            </p>
            <div class="rounded-md border border-line bg-surface-overlay px-3.5 py-2.5 text-note leading-5 text-ink" role="status">
              {view.orderAgree
                ? t('screen.compare.ai.orderAgree')
                : view.firstAgree
                  ? t('screen.compare.ai.firstAgree')
                  : t('screen.compare.ai.firstDiffer')}{' '}
              {view.disagreements === 0 ? t('screen.compare.ai.criteriaAgree') : t('screen.compare.ai.criteriaDiffer', { n: view.disagreements })}
            </div>
            {view.injection && (
              <Notice tone="danger">
                {t('screen.compare.ai.injection')}
              </Notice>
            )}
            <div class="grid gap-4 sm:grid-cols-2">
              {view.orders.map((order, i) => (
                <div>
                  <h3 class="text-label text-ink">{t('screen.compare.ai.order', { reading: i === 0 ? 'A' : 'B' })}</h3>
                  {order.length === 0 ? (
                    <Hint class="mt-1">{t('screen.compare.ai.noOrder')}</Hint>
                  ) : (
                    <ol class="mt-1 list-decimal space-y-1 pl-5 text-sm">
                      {order.map((o) => (
                        <li>
                          <span class="font-medium text-ink" translate="no">{who(o.applicant, names)}</span>
                          {o.reason && <span class="text-ink-muted" lang="en"> — {o.reason}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
            {view.deciders.some((d) => d !== null) && (
              <div>
                <h3 class="text-label text-ink">{t('screen.compare.ai.deciders')}</h3>
                <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                  {view.deciders.map(
                    (d, i) =>
                      d && (
                        <li>
                          <span lang="en">{d}</span>
                          {view.deciders[0] !== view.deciders[1] ? <span class="text-ink-faint"> {t('screen.compare.ai.readingNote', { reading: i === 0 ? 'A' : 'B' })}</span> : null}
                        </li>
                      ),
                  )}
                </ul>
              </div>
            )}
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="border-b border-line bg-surface-overlay/60">
                  <tr>
                    <th scope="col" class={th}>{t('screen.compare.ai.criterion')}</th>
                    <th scope="col" class={th}>{t('screen.compare.ai.reading', { reading: 'A' })}</th>
                    <th scope="col" class={th}>{t('screen.compare.ai.reading', { reading: 'B' })}</th>
                    <th scope="col" class={th} />
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {view.criteria.map((c) => (
                    <tr>
                      <td class={`${td} text-ink`}>{criterionLabel(c)}</td>
                      <td class={td}>
                        <Ranking ranking={c.rankings[0]} names={names} />
                        {c.why[0] && <div class="mt-0.5 text-note text-ink-muted" lang="en">{c.why[0]}</div>}
                      </td>
                      <td class={td}>
                        <Ranking ranking={c.rankings[1]} names={names} />
                        {c.why[1] && <div class="mt-0.5 text-note text-ink-muted" lang="en">{c.why[1]}</div>}
                      </td>
                      <td class={`${td} whitespace-nowrap`}>
                        {c.picks[0] !== null && c.picks[1] !== null && <Badge tone={c.agree ? 'ok' : 'warn'}>{c.agree ? t('screen.compare.ai.agree') : t('screen.compare.ai.differ')}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.criteria.some((c) => c.quotes.length > 0) && (
              <details>
                <summary class="cursor-pointer text-label text-ink">{t('screen.compare.ai.lines')}</summary>
                <ul class="mt-2 space-y-2 text-note">
                  {view.criteria
                    .filter((c) => c.quotes.length > 0)
                    .map((c) => (
                      <li>
                        <span class="text-ink">{criterionLabel(c)}</span>
                        <ul class="mt-0.5 list-disc space-y-0.5 pl-5 text-ink-muted">
                          {c.quotes.map((q) => (
                            <li translate="no">
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
          <Hint class="mt-3">{t('screen.compare.ai.nothingYet', { n })}</Hint>
        )}
      </Card>
      <script type="module" dangerouslySetInnerHTML={{ __html: "import { wireCopy } from '/static/copy.mjs'; wireCopy(document);" }} />
    </Layout>
  );
};
