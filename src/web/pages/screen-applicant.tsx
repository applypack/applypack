/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  Badge,
  Button,
  Card,
  ConfirmAction,
  Flash,
  Hint,
  Input,
  Notice,
  PageHeader,
  Select,
  Stars,
  Table,
  Td,
  Tr,
  inEnglish,
} from '../ui';
import type { FlashMessage } from '../flash';
import { formatDate } from '../format';
import { formatRange, parseRange } from '../../screening/dates';
import { trajectoryLine, trajectoryOf } from '../../screening/trajectory';
import { STANDOUT_SINCE } from '../../screening/prompts';
import { criterionLabel, CRITERION_KIND_LABELS, EVIDENCE_RUNG_LABELS, type Rubric } from '../../screening/rubric';
import type { ScreenReply } from '../../screening/prompts';
import { answerBadge, answerWords, capExplanation, detailWords, GATE_BUCKET_LABELS, type ScoreRow, type ScreenBreakdown } from '../../screening/score';
import { describeRedactions, leakKinds, leakLabel, type Redaction } from '../../screening/redact';
import { GATE_MARK, MAX_ADJUSTMENT } from '../../screening/export';
import { adjustedScore, ANSWER_TONE, confidenceLabel } from '../screen-view';
import { DECISIONS, type Decision } from '../../screening/store';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/*
 * The scorecard (hr-screening-plan.md §4, "a scorecard, not a number"):
 * who / what they did / verdict, every gate and term with its quote, the
 * score read off a table, the questions for the interview, the facts to
 * discuss — and, at the bottom, what the model saw and what it did not.
 */

export interface ScreenApplicantProps {
  screening: { id: number; title: string; rubricVersion: number; job: { id: number; title: string; companyName: string } };
  applicant: {
    id: number;
    number: number;
    name: string | null;
    email: string | null;
    phone: string | null;
    file: string;
    status: 'ok' | 'unreadable' | 'held';
    note: string | null;
    decision: string | null;
    decidedAt: Date | null;
    /** Another document of applicant №N. */
    sameAs: number | null;
    adjustment: number;
    adjustmentNote: string | null;
    redactions: Redaction[];
    leaks: string[];
    text: string;
    redactedText: string;
  };
  /** Cover letters that came with the resume (TASKS E3): read here, never by a model. */
  letters: { id: number; sourceFilename: string; text: string }[];
  rubric: Rubric;
  reply: ScreenReply | null;
  breakdown: ScreenBreakdown | null;
  /** The verdict is about an earlier rubric version. */
  stale: boolean;
  model: string | null;
  /** Which prompt wrote the verdict — an older one has no stand-out block. */
  promptVersion: number | null;
  scoredAt: Date | null;
  now: Date;
  flash?: FlashMessage | null;
}

/** The person's decision as the select names it; the stored value is the key. */
const DECISION_WORDS: Record<Decision, MessageKey> = {
  interview: 'screening.decision.interview',
  hold: 'screening.decision.hold',
  declined: 'screening.decision.declined',
};

/** One criterion on the scorecard: what was asked, how the text answered, the quote, the points. */
const CriterionAnswerRow: FC<{ r: ScoreRow }> = ({ r }) => {
  const answerTitle = (EVIDENCE_RUNG_LABELS as Record<string, string>)[r.answer];
  const tone = r.mode === 'gate' && r.gate ? ANSWER_TONE[r.gate] : (ANSWER_TONE[r.answer] ?? 'neutral');
  return (
    <Tr>
      <Td class="align-top">
        <div class="text-ink">{criterionLabel(r)}</div>
        <div class="text-meta text-ink-faint">
          {CRITERION_KIND_LABELS[r.kind as keyof typeof CRITERION_KIND_LABELS] ?? r.kind} ·{' '}
          {r.mode === 'gate' ? t('screening.applicant.modeGate') : r.mode === 'note' ? t('screening.applicant.modeNote') : <Stars n={r.weight} />}
        </div>
      </Td>
      <Td class="align-top">
        <span title={answerTitle}>
          <Badge tone={tone ?? 'neutral'}>{r.mode === 'gate' ? `${GATE_MARK[r.gate ?? 'unknown']} ${answerWords(r.gate ?? 'unknown')}` : answerBadge(r.answer)}</Badge>
        </span>
      </Td>
      <Td class="align-top text-ink-muted">
        {r.quote ? <q class="text-ink">{r.quote}</q> : null}
        {r.detail && <div class={`text-meta ${r.quote ? 'mt-1' : ''} text-ink-faint`}>{detailWords(r.detail)}</div>}
        {!r.quote && !r.detail && '—'}
      </Td>
      <Td class="whitespace-nowrap text-right align-top tabular-nums">{r.mode === 'scored' ? (r.max === 0 ? '—' : `${r.pts} / ${r.max}`) : ''}</Td>
    </Tr>
  );
};

export const ScreenApplicantPage: FC<ScreenApplicantProps> = ({ screening, applicant, letters, rubric, reply, breakdown, stale, model, promptVersion, scoredAt, now, flash }) => {
  const title = `№${applicant.number}${applicant.name ? ` — ${applicant.name}` : ''}`;
  const back = `/screen/${screening.id}`;
  const career = reply ? trajectoryOf(reply.roles, now) : null;
  return (
    <Layout title={title} titleIsData active="screen">
      <PageHeader
        title={title}
        back={{ href: back, label: screening.title, labelIsData: true }}
        meta={
          breakdown && !stale ? (
            <span class="flex flex-wrap items-center gap-2">
              <Badge tone={breakdown.gateBucket === 'pass' ? 'ok' : breakdown.gateBucket === 'ask' ? 'warn' : 'danger'}>
                {GATE_BUCKET_LABELS[breakdown.gateBucket]}
              </Badge>
              <span class="text-entity text-ink">{adjustedScore(breakdown.score, applicant.adjustment)}</span>
              <span>
                / 100
                {applicant.adjustment !== 0
                  ? ` ${t('screening.applicant.computed', { score: breakdown.score, adjustment: `${applicant.adjustment > 0 ? '+' : ''}${applicant.adjustment}` })}`
                  : ''}{' '}
                · {t('screening.applicant.confidence', { band: confidenceLabel(breakdown.confidence.band) })}
              </span>
            </span>
          ) : undefined
        }
        actions={
          <Button href={`${back}/applicants/${applicant.id}/file`} variant="secondary" size="sm">
            {t('screening.applicant.downloadFile')}
          </Button>
        }
      >
        <span translate="no">{applicant.file}</span>
        {applicant.email && (
          <>
            {' · '}
            <span translate="no">{applicant.email}</span>
          </>
        )}
        {applicant.phone && (
          <>
            {' · '}
            <span translate="no">{applicant.phone}</span>
          </>
        )}{' '}
        — {t('screening.applicant.shownToYou', { n: applicant.number })}
        {scoredAt &&
          ` ${
            model
              ? t('screening.applicant.scoredOn', { date: formatDate(scoredAt), model, version: screening.rubricVersion })
              : t('screening.applicant.scored', { date: formatDate(scoredAt), version: screening.rubricVersion })
          }`}
      </PageHeader>
      <Flash flash={flash} />

      {applicant.status === 'unreadable' && (
        <Card class="mb-4">
          <Badge tone="warn">{t('screening.applicant.unreadable')}</Badge>
          <p class="mt-2 text-sm text-ink-muted">{applicant.note ?? t('screening.applicant.noText')}</p>
        </Card>
      )}
      {/* TASKS E4 (Q6): the redaction promise is what the mode rests on, so a leak waits for a person. */}
      {applicant.status === 'held' && (
        <Card class="mb-4">
          <Badge tone="warn">{t('screening.applicant.held')}</Badge>
          <p class="mt-2 text-sm text-ink-muted">
            {t('screening.applicant.heldBody', { kinds: leakKinds(applicant.leaks).map(leakLabel).join(', ') || t('screening.applicant.somethingIdentifying') })}
          </p>
          <form method="post" action={`${back}/applicants/${applicant.id}/release`} class="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="secondary">{t('screening.applicant.scoreAnyway')}</Button>
            <Hint>{t('screening.applicant.orDelete')}</Hint>
          </form>
        </Card>
      )}
      {applicant.sameAs !== null && (
        <div class="mb-4 rounded-md border border-line bg-surface-overlay px-3.5 py-2.5 text-note leading-5 text-ink-muted" role="status">
          {tRich(
            'screening.applicant.sameAs',
            { n: applicant.sameAs },
            {
              link: (words) => (
                <a href={`${back}#results`} class="text-ink hover:underline">
                  {words}
                </a>
              ),
            },
          )}
        </div>
      )}
      {stale && reply && (
        <Notice tone="warn" role="status" class="mb-4">
          {t('screening.applicant.stale')}
        </Notice>
      )}

      {reply && breakdown && (
        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div class="space-y-4">
            <Card>
              <dl class="grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
                <dt class="text-ink-faint">{t('screening.applicant.who')}</dt>
                <dd class="text-ink" lang="en">
                  {reply.summary.who || '—'}
                </dd>
                <dt class="text-ink-faint">{t('screening.applicant.did')}</dt>
                <dd class="text-ink" lang="en">
                  {reply.summary.did || '—'}
                </dd>
                <dt class="text-ink-faint">{t('screening.applicant.verdict')}</dt>
                <dd class="font-medium text-ink" lang="en">
                  {reply.summary.verdict || '—'}
                </dd>
              </dl>
              {reply.injection && (
                <Notice tone="danger" class="mt-3">
                  {t('screening.applicant.injection')}
                </Notice>
              )}
            </Card>

            <Card>
              <h2 class="text-entity text-ink">{t('screening.applicant.standout')}</h2>
              {reply.standout.length === 0 ? (
                <Hint class="mt-1">
                  {promptVersion !== null && promptVersion < STANDOUT_SINCE ? t('screening.applicant.standoutOld') : t('screening.applicant.standoutNone')}
                </Hint>
              ) : (
                <ul class="mt-2 space-y-1.5 text-sm">
                  {reply.standout.map((f) => (
                    <li>
                      <span class="text-ink" lang="en">
                        {f.fact}
                      </span>
                      {f.quote && (
                        <>
                          {' — '}
                          <q class="text-ink-muted">{f.quote}</q>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Hint class="mt-2">{t('screening.applicant.standoutHint')}</Hint>
            </Card>

            <Card flush>
              <Table
                columns={[t('screening.applicant.col.criterion'), t('screening.applicant.col.answer'), t('screening.applicant.col.says'), t('screening.applicant.col.points')]}
                widths={['w-[24%]', 'w-[17%]', 'w-[47%]', 'w-[12%]']}
                hideBelow={['', '', 'sm', '']}
                thClasses={['', '', '', 'text-right']}
              >
                {breakdown.rows.map((r) => (
                  <CriterionAnswerRow r={r} />
                ))}
              </Table>
            </Card>

            <Card>
              <h2 class="text-entity text-ink">{t('screening.applicant.roles')}</h2>
              {career && career.roles > 0 && <p class="mt-1 text-note text-ink-muted">{t('screening.applicant.career', { line: trajectoryLine(career) })}</p>}
              {reply.roles.length === 0 ? (
                <Hint class="mt-1">{t('screening.applicant.noRoles')}</Hint>
              ) : (
                <ul class="mt-2 space-y-1.5 text-sm">
                  {reply.roles.map((r) => {
                    const range = parseRange(r.start, r.end, now);
                    return (
                      <li class={`flex flex-wrap gap-x-2 ${r.relevant ? 'text-ink' : 'text-ink-faint'}`}>
                        <span class="font-medium">{r.position}</span>
                        {r.employer && <span>· {r.employer}</span>}
                        <span class="tabular-nums text-ink-faint">
                          {range ? formatRange(range, now) : [r.start, r.end].filter(Boolean).join(' – ') || t('screening.applicant.noDates')}
                        </span>
                        {(r.sector || r.companyType) && (
                          <span class="text-ink-faint">
                            · {[r.sector, r.companyType].filter(Boolean).join(', ')}
                          </span>
                        )}
                        <span class="text-ink-faint">
                          {/* The model's reason is its own English; "not counted" is ours. */}
                          — {r.relevant ? <span lang="en">{r.why}</span> : tRich('screening.applicant.notCountedWhy', { why: r.why }, { en: inEnglish })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <div class="flex items-baseline justify-between gap-3">
                <h2 class="text-entity text-ink">{t('screening.applicant.questions')}</h2>
                {reply.questions.length > 0 && (
                  <Button variant="ghost" size="sm" type="button" data-copy={reply.questions.map((q) => `- ${q}`).join('\n')}>
                    {t('common.copy')}
                  </Button>
                )}
              </div>
              {reply.questions.length === 0 ? (
                <Hint class="mt-1">{t('screening.applicant.noneWritten')}</Hint>
              ) : (
                <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink" lang="en">
                  {reply.questions.map((q) => (
                    <li>{q}</li>
                  ))}
                </ol>
              )}
              {(reply.risks.length > 0 || reply.consistency.length > 0) && (
                <div class="mt-4 grid gap-4 sm:grid-cols-2">
                  {reply.risks.length > 0 && (
                    <div>
                      <h3 class="text-label text-ink">{t('screening.applicant.risks')}</h3>
                      <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted" lang="en">
                        {reply.risks.map((r) => (
                          <li>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {reply.consistency.length > 0 && (
                    <div>
                      <h3 class="text-label text-ink">{t('screening.applicant.consistency')}</h3>
                      <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted" lang="en">
                        {reply.consistency.map((r) => (
                          <li>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          <div class="space-y-4">
            <Card>
              <h2 id="score-made" class="text-entity text-ink">{t('screening.applicant.howMade')}</h2>
              {/* TASKS U13: header cells with a scope, and the heading as the table's name. */}
              <table class="mt-2 w-full text-sm" aria-labelledby="score-made">
                <thead class="sr-only">
                  <tr>
                    <th scope="col">{t('screening.applicant.criterionAndAnswer')}</th>
                    <th scope="col">{t('screening.applicant.col.points')}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {breakdown.rows
                    .filter((r) => r.mode === 'scored')
                    .map((r) => (
                      <tr class={r.max === 0 ? 'text-ink-faint' : ''}>
                        <th scope="row" class="py-1.5 pr-2 text-left align-top font-normal">
                          <div class="text-ink">{criterionLabel(r)}</div>
                          <div class="text-meta text-ink-faint">
                            {r.max === 0 ? t('screening.applicant.answerNotCounted', { answer: answerWords(r.answer) }) : answerWords(r.answer)}
                          </div>
                        </th>
                        <td class="whitespace-nowrap py-1.5 text-right align-top tabular-nums">{r.max === 0 ? '—' : `${r.pts} / ${r.max}`}</td>
                      </tr>
                    ))}
                  <tr class="font-medium text-ink">
                    <th scope="row" class="py-1.5 pr-2 text-left font-medium">
                      {breakdown.cap !== null ? t('screening.applicant.scoreCapped') : t('screening.applicant.score')}
                    </th>
                    <td class="py-1.5 text-right tabular-nums">{breakdown.score}</td>
                  </tr>
                </tbody>
              </table>
              {capExplanation(breakdown) && <p class="mt-2 text-note text-warn">{capExplanation(breakdown)}</p>}
              <Hint class="mt-2">
                {t('screening.applicant.pointsHint', {
                  stars: breakdown.weightTotal,
                  band: confidenceLabel(breakdown.confidence.band),
                  answered: breakdown.confidence.answered,
                  total: breakdown.confidence.total,
                  thin: breakdown.confidence.thin ? 'yes' : 'no',
                })}
              </Hint>
            </Card>

            <Card>
              <h2 class="text-entity text-ink">{t('screening.applicant.yourDecision')}</h2>
              <form method="post" action={`${back}/applicants/${applicant.id}/decision`} class="mt-2 flex items-center gap-2">
                <input type="hidden" name="back" value={`${back}/applicants/${applicant.id}`} />
                <Select name="decision" aria-label={t('screening.applicant.decision')}>
                  <option value="" selected={applicant.decision === null}>
                    {t('screening.applicant.notDecided')}
                  </option>
                  {DECISIONS.map((d) => (
                    <option value={d} selected={applicant.decision === d}>
                      {t(DECISION_WORDS[d])}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary">{t('common.save')}</Button>
              </form>
              <Hint class="mt-2">
                {applicant.decidedAt ? `${t('screening.applicant.decidedAt', { date: formatDate(applicant.decidedAt) })} ` : ''}
                {t('screening.applicant.decisionHint')}
              </Hint>
            </Card>

            <Card>
              <h2 class="text-entity text-ink">{t('screening.applicant.yourAdjustment')}</h2>
              <form method="post" action={`${back}/applicants/${applicant.id}/adjust`} class="mt-2 space-y-2">
                <input type="hidden" name="back" value={`${back}/applicants/${applicant.id}`} />
                <div class="flex items-center gap-2">
                  <Input
                    type="number"
                    name="points"
                    min={-MAX_ADJUSTMENT}
                    max={MAX_ADJUSTMENT}
                    step="1"
                    value={applicant.adjustment}
                    class="w-24"
                    aria-label={t('screening.applicant.points')}
                  />
                  <span class="text-sm text-ink-muted">{t('screening.applicant.pointsRange', { max: MAX_ADJUSTMENT })}</span>
                </div>
                <Input
                  type="text"
                  name="note"
                  maxlength="200"
                  value={applicant.adjustmentNote ?? ''}
                  placeholder={t('screening.applicant.reasonPlaceholder')}
                  aria-label={t('screening.applicant.reason')}
                />
                <Button variant="secondary">{t('common.save')}</Button>
              </form>
              <Hint class="mt-2">{t('screening.applicant.adjustHint')}</Hint>
            </Card>

            <Card>
              <h2 class="text-entity text-ink">{t('screening.applicant.unseen')}</h2>
              <p class="mt-1 text-sm text-ink-muted">{t('screening.applicant.removedBefore', { list: describeRedactions(applicant.redactions) })}</p>
              <p data-ui="hint" class="mt-1 text-note text-ink-faint">
                {applicant.leaks.length === 0
                  ? t('screening.applicant.leakNone')
                  : t('screening.applicant.leakFound', { leaks: applicant.leaks.map(leakLabel).join(', ') })}
              </p>
            </Card>
          </div>
        </div>
      )}

      {!reply && applicant.status === 'ok' && (
        <Card class="mb-4">
          <p class="text-sm text-ink-muted">{t('screening.applicant.notScored')}</p>
        </Card>
      )}

      {letters.length > 0 && (
        <Card class="mt-4">
          <h2 class="text-entity text-ink">{t('screening.applicant.letters', { n: letters.length })}</h2>
          <Hint class="mt-1">{t('screening.applicant.lettersHint', { n: letters.length })}</Hint>
          {letters.map((l) => (
            <details class="mt-3">
              <summary class="cursor-pointer text-label text-ink">
                {l.sourceFilename}{' '}
                <a href={`${back}/applicants/${applicant.id}/letters/${l.id}/file`} class="ml-2 text-meta font-normal text-ink-muted hover:text-ink">
                  {t('screening.applicant.download')}
                </a>
              </summary>
              <pre class="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-note leading-5 text-ink">{l.text}</pre>
            </details>
          ))}
        </Card>
      )}

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <details>
            <summary class="cursor-pointer text-label text-ink">
              {applicant.status === 'held' ? t('screening.applicant.textWouldRead') : t('screening.applicant.textRead')}
            </summary>
            <pre class="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-note leading-5 text-ink">{applicant.redactedText}</pre>
          </details>
        </Card>
        <Card>
          <details>
            <summary class="cursor-pointer text-label text-ink">{t('screening.applicant.fullText')}</summary>
            <pre class="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-note leading-5 text-ink">{applicant.text}</pre>
          </details>
        </Card>
      </div>
      <div class="mt-4">
        <ConfirmAction
          action={`${back}/applicants/${applicant.id}/delete`}
          label={t('screening.applicant.remove')}
          confirm={t('screening.applicant.removeConfirm')}
          class="inline-block"
        />
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: "import { wireCopy } from '/static/copy.mjs'; wireCopy(document);" }} />
    </Layout>
  );
};
