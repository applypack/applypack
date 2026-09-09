/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Flash, Hint, Input, PageHeader, Select, Table, Td, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDate } from '../format';
import { formatRange, parseRange } from '../../screening/dates';
import { RUBRIC_PART_LABELS, RUBRIC_PARTS, type Rubric } from '../../screening/rubric';
import { EVIDENCE_RUNG_LABELS, type ScreenReply } from '../../screening/prompts';
import { capExplanation, GATE_BUCKET_LABELS, type ScreenBreakdown } from '../../screening/score';
import { describeRedactions, type Redaction } from '../../screening/redact';
import { DECISION_LABELS, GATE_MARK, MAX_ADJUSTMENT } from '../../screening/export';
import { adjustedScore } from '../screen-view';
import { DECISIONS } from '../../screening/store';

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
    status: 'ok' | 'unreadable';
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
  rubric: Rubric;
  reply: ScreenReply | null;
  breakdown: ScreenBreakdown | null;
  /** The verdict is about an earlier rubric version. */
  stale: boolean;
  model: string | null;
  scoredAt: Date | null;
  now: Date;
  flash?: FlashMessage | null;
}

const RUNG_TONE = { absent: 'danger', listed: 'warn', project: 'neutral', role: 'ok', production: 'ok' } as const;

export const ScreenApplicantPage: FC<ScreenApplicantProps> = ({ screening, applicant, rubric, reply, breakdown, stale, model, scoredAt, now, flash }) => {
  const title = `№${applicant.number}${applicant.name ? ` — ${applicant.name}` : ''}`;
  const back = `/screen/${screening.id}`;
  return (
    <Layout title={title} active="screen">
      <PageHeader
        title={title}
        back={{ href: back, label: screening.title }}
        meta={
          breakdown && !stale ? (
            <span class="flex flex-wrap items-center gap-2">
              <Badge tone={breakdown.gateBucket === 'pass' ? 'ok' : breakdown.gateBucket === 'ask' ? 'warn' : 'danger'}>
                {GATE_BUCKET_LABELS[breakdown.gateBucket]}
              </Badge>
              <span class="text-base font-semibold text-ink">{adjustedScore(breakdown.score, applicant.adjustment)}</span>
              <span>
                / 100
                {applicant.adjustment !== 0 ? ` (computed ${breakdown.score}, your ${applicant.adjustment > 0 ? '+' : ''}${applicant.adjustment})` : ''} · confidence{' '}
                {breakdown.confidence.band}
              </span>
            </span>
          ) : undefined
        }
        actions={
          <Button href={`${back}/applicants/${applicant.id}/file`} variant="secondary" size="sm">
            Download the file
          </Button>
        }
      >
        {applicant.file}
        {applicant.email ? ` · ${applicant.email}` : ''}
        {applicant.phone ? ` · ${applicant.phone}` : ''} — shown to you only; the model read "Applicant №{applicant.number}".
        {scoredAt && ` Scored ${formatDate(scoredAt)}${model ? ` on ${model}` : ''}, rubric v${screening.rubricVersion}.`}
      </PageHeader>
      <Flash flash={flash} />

      {applicant.status !== 'ok' && (
        <Card class="mb-4">
          <Badge tone="warn">Could not be read</Badge>
          <p class="mt-2 text-sm text-ink-muted">{applicant.note ?? 'The file gave no text to read.'}</p>
        </Card>
      )}
      {applicant.sameAs !== null && (
        <div class="mb-4 rounded-md border border-line bg-surface-overlay px-3.5 py-2.5 text-[13px] leading-5 text-ink-muted" role="status">
          Another document of{' '}
          <a href={`${back}#results`} class="text-ink hover:underline">
            applicant №{applicant.sameAs}
          </a>{' '}
          — same email, phone or near-identical text. Scored on its own; keep the version you want and tick the other
          for Delete.
        </div>
      )}
      {stale && reply && (
        <div class="mb-4 rounded-md border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
          This scorecard was written under an earlier rubric. The screening page's Score button reads the applicant
          again with the current one; until then the number below is about a different yardstick.
        </div>
      )}

      {reply && breakdown && (
        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div class="space-y-4">
            <Card>
              <dl class="grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
                <dt class="text-ink-faint">Who</dt>
                <dd class="text-ink">{reply.summary.who || '—'}</dd>
                <dt class="text-ink-faint">Did</dt>
                <dd class="text-ink">{reply.summary.did || '—'}</dd>
                <dt class="text-ink-faint">Verdict</dt>
                <dd class="font-medium text-ink">{reply.summary.verdict || '—'}</dd>
              </dl>
              {reply.injection && (
                <p class="mt-3 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
                  The resume carried text addressed to an AI reader. It was ignored and the resume judged on its
                  merits; see "Consistency" below.
                </p>
              )}
            </Card>

            {rubric.gates.length > 0 && (
              <Card flush>
                <Table columns={['Gate', 'Status', 'Evidence or question']} widths={['w-[32%]', 'w-[12%]', 'w-[56%]']}>
                  {reply.gates.map((g) => (
                    <Tr>
                      <Td class="text-ink">{g.gate}</Td>
                      <Td>
                        <span class={`font-mono ${g.status === 'pass' ? 'text-ok' : g.status === 'fail' ? 'text-danger' : 'text-warn'}`}>
                          {GATE_MARK[g.status]} {g.status}
                        </span>
                      </Td>
                      <Td class="text-ink-muted">
                        {g.quote ? <q class="text-ink">{g.quote}</q> : g.question ? `Ask: ${g.question}` : '—'}
                      </Td>
                    </Tr>
                  ))}
                </Table>
              </Card>
            )}

            {(['must', 'nice'] as const).map((kind) =>
              reply[kind].length === 0 ? null : (
                <Card flush>
                  <Table
                    columns={[kind === 'must' ? 'Must-have' : 'Nice-to-have', 'Evidence', 'Where it shows', 'Last used']}
                    widths={['w-[22%]', 'w-[18%]', 'w-[44%]', 'w-[16%]']}
                    hideBelow={['', '', 'sm', 'md']}
                  >
                    {reply[kind].map((t) => {
                      const term = rubric[kind].find((x) => x.term.toLowerCase() === t.term.toLowerCase());
                      return (
                        <Tr>
                          <Td class="text-ink">
                            {t.term}
                            {term?.primary && (
                              <Badge tone="info" class="ml-1.5">
                                core
                              </Badge>
                            )}
                          </Td>
                          <Td>
                            <Badge tone={RUNG_TONE[t.level]}>{EVIDENCE_RUNG_LABELS[t.level]}</Badge>
                          </Td>
                          <Td class="text-ink-muted">{t.quote ? <q class="text-ink">{t.quote}</q> : '—'}</Td>
                          <Td class="text-ink-faint">{t.last_used ?? ''}</Td>
                        </Tr>
                      );
                    })}
                  </Table>
                </Card>
              ),
            )}

            <Card>
              <h2 class="text-sm font-semibold text-ink">Relevant experience</h2>
              {reply.roles.length === 0 ? (
                <Hint class="mt-1">No roles with dates the text carries — the years part was left out of the score.</Hint>
              ) : (
                <ul class="mt-2 space-y-1.5 text-sm">
                  {reply.roles.map((r) => {
                    const range = parseRange(r.start, r.end, now);
                    return (
                      <li class={`flex flex-wrap gap-x-2 ${r.relevant ? 'text-ink' : 'text-ink-faint'}`}>
                        <span class="font-medium">{r.position}</span>
                        {r.employer && <span>· {r.employer}</span>}
                        <span class="tabular-nums text-ink-faint">
                          {range ? formatRange(range, now) : [r.start, r.end].filter(Boolean).join(' – ') || 'no dates'}
                        </span>
                        <span class="text-ink-faint">— {r.relevant ? r.why : `not counted: ${r.why}`}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <dl class="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt class="text-ink-faint">Level the text shows</dt>
                  <dd class="text-ink">
                    {reply.level.observed ?? 'too little to say'}
                    {reply.level.signals.map((s) => (
                      <q class="block text-ink-muted">{s}</q>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-faint">Impact evidence</dt>
                  <dd class="text-ink">
                    {reply.impact.grade}
                    {reply.impact.quotes.map((s) => (
                      <q class="block text-ink-muted">{s}</q>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-faint">Sector</dt>
                  <dd class="text-ink">
                    {reply.domain.grade}
                    {reply.domain.why ? ` — ${reply.domain.why}` : ''}
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-faint">Education</dt>
                  <dd class="text-ink">
                    {rubric.educationRequired ? `${reply.education.status}${reply.education.note ? ` — ${reply.education.note}` : ''}` : 'not required by the posting'}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card>
              <div class="flex items-baseline justify-between gap-3">
                <h2 class="text-sm font-semibold text-ink">Questions for the interview</h2>
                {reply.questions.length > 0 && (
                  <Button variant="ghost" size="sm" type="button" data-copy={reply.questions.map((q) => `- ${q}`).join('\n')}>
                    Copy
                  </Button>
                )}
              </div>
              {reply.questions.length === 0 ? (
                <Hint class="mt-1">None written.</Hint>
              ) : (
                <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink">
                  {reply.questions.map((q) => (
                    <li>{q}</li>
                  ))}
                </ol>
              )}
              {(reply.risks.length > 0 || reply.consistency.length > 0) && (
                <div class="mt-4 grid gap-4 sm:grid-cols-2">
                  {reply.risks.length > 0 && (
                    <div>
                      <h3 class="text-[13px] font-medium text-ink">Facts to discuss</h3>
                      <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                        {reply.risks.map((r) => (
                          <li>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {reply.consistency.length > 0 && (
                    <div>
                      <h3 class="text-[13px] font-medium text-ink">Consistency</h3>
                      <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
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
              <h2 class="text-sm font-semibold text-ink">How the score was made</h2>
              <table class="mt-2 w-full text-sm">
                <tbody class="divide-y divide-line">
                  {RUBRIC_PARTS.map((p) => {
                    const part = breakdown.parts[p];
                    return (
                      <tr class={part.max === 0 ? 'text-ink-faint' : ''}>
                        <td class="py-1.5 pr-2 align-top">
                          <div class="text-ink">{RUBRIC_PART_LABELS[p]}</div>
                          <div class="text-xs text-ink-faint">{part.detail}</div>
                        </td>
                        <td class="py-1.5 text-right align-top tabular-nums">
                          {part.max === 0 ? '—' : `${part.pts} / ${part.max}`}
                        </td>
                      </tr>
                    );
                  })}
                  <tr class="font-medium text-ink">
                    <td class="py-1.5 pr-2">Score{breakdown.cap !== null ? ' (capped)' : ''}</td>
                    <td class="py-1.5 text-right tabular-nums">{breakdown.score}</td>
                  </tr>
                </tbody>
              </table>
              {capExplanation(breakdown) && <p class="mt-2 text-[13px] text-warn">{capExplanation(breakdown)}</p>}
              <Hint class="mt-2">
                Points are the model's marks × the rubric's weights, normalised over the parts the text could answer
                ({breakdown.weightTotal} of the weight counted). Confidence {breakdown.confidence.band}:{' '}
                {breakdown.confidence.answered} of {breakdown.confidence.total} criteria answered
                {breakdown.confidence.thin ? ', and the text is short' : ''}.
              </Hint>
            </Card>

            <Card>
              <h2 class="text-sm font-semibold text-ink">Your decision</h2>
              <form method="post" action={`${back}/applicants/${applicant.id}/decision`} class="mt-2 flex items-center gap-2">
                <input type="hidden" name="back" value={`${back}/applicants/${applicant.id}`} />
                <Select name="decision" aria-label="Decision">
                  <option value="" selected={applicant.decision === null}>
                    Not decided
                  </option>
                  {DECISIONS.map((d) => (
                    <option value={d} selected={applicant.decision === d}>
                      {DECISION_LABELS[d]}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary">Save</Button>
              </form>
              <Hint class="mt-2">
                {applicant.decidedAt ? `Set ${formatDate(applicant.decidedAt)}. ` : ''}The tool never sets this: a
                bucket is a fact about the resume, a decision is yours.
              </Hint>
            </Card>

            <Card>
              <h2 class="text-sm font-semibold text-ink">Your adjustment</h2>
              <form method="post" action={`${back}/applicants/${applicant.id}/adjust`} class="mt-2 space-y-2">
                <input type="hidden" name="back" value={`${back}/applicants/${applicant.id}`} />
                <div class="flex items-center gap-2">
                  <Input type="number" name="points" min={-MAX_ADJUSTMENT} max={MAX_ADJUSTMENT} step="1" value={applicant.adjustment} class="w-24" aria-label="Points" />
                  <span class="text-sm text-ink-muted">points, −{MAX_ADJUSTMENT} to +{MAX_ADJUSTMENT}</span>
                </div>
                <Input type="text" name="note" maxlength="200" value={applicant.adjustmentNote ?? ''} placeholder="Why — a referral, a fact the resume does not carry…" aria-label="Reason" />
                <Button variant="secondary">Save</Button>
              </form>
              <Hint class="mt-2">
                Moves this applicant in the table and travels into the export with its reason. The computed score
                stays visible beside it — your correction is a fact about the person, not a change to the rubric.
              </Hint>
            </Card>

            <Card>
              <h2 class="text-sm font-semibold text-ink">What the model did not see</h2>
              <p class="mt-1 text-sm text-ink-muted">Removed before the call: {describeRedactions(applicant.redactions)}.</p>
              <p class="mt-1 text-[13px] text-ink-faint">
                {applicant.leaks.length === 0
                  ? 'Leak check after redaction: nothing identifying left.'
                  : `Leak check found: ${applicant.leaks.join(', ')} — read the text below before trusting the mark.`}
              </p>
            </Card>
          </div>
        </div>
      )}

      {!reply && applicant.status === 'ok' && (
        <Card class="mb-4">
          <p class="text-sm text-ink-muted">Not scored yet — press Score on the screening page.</p>
        </Card>
      )}

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <details>
            <summary class="cursor-pointer text-sm font-semibold text-ink">Text the model read (redacted)</summary>
            <pre class="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-[13px] leading-5 text-ink">{applicant.redactedText}</pre>
          </details>
        </Card>
        <Card>
          <details>
            <summary class="cursor-pointer text-sm font-semibold text-ink">Full text (you only)</summary>
            <pre class="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-[13px] leading-5 text-ink">{applicant.text}</pre>
          </details>
        </Card>
      </div>
      <div class="mt-4">
        <ActionForm action={`${back}/applicants/${applicant.id}/delete`} confirm="Remove this applicant with the file and every verdict?">
          <Button variant="danger" size="sm">
            Remove this applicant
          </Button>
        </ActionForm>
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: "import { wireCopy } from '/static/copy.mjs'; wireCopy(document);" }} />
    </Layout>
  );
};
