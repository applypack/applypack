/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  ConfirmAction,
  Empty,
  FILE_INPUT_CLASS,
  Flash,
  Hint,
  Input,
  More,
  Notice,
  PageHeader,
  SectionTitle,
  Select,
  Stars,
  SUBMIT_ONCE,
  Table,
  Td,
  Textarea,
  Tr,
  When,
} from '../ui';
import type { FlashMessage } from '../flash';
import { formatDateShort, formatRelative } from '../format';
import {
  criterionLabel,
  criterionText,
  CRITERION_KIND_HINTS,
  CRITERION_KIND_LABELS,
  CRITERION_KINDS,
  CRITERION_MODES,
  MAX_WEIGHT,
  PRESET_HINTS,
  PRESET_LABELS,
  PRESETS,
  rubricSummary,
  type Criterion,
  type Rubric,
} from '../../screening/rubric';
import { answerBadge, GATE_BUCKET_LABELS, type ConfidenceBand, type GateBucket } from '../../screening/score';
import { GATE_MARK } from '../../screening/export';
import { adjustedScore } from '../screen-view';
import { MAX_APPLICANTS_PER_SCREENING, MAX_BATCH_UPLOAD_MB } from '../../screening/intake';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import type { ScreenRunState } from '../../screening/batch';
import { calibrationLine, MIN_DECISIONS, type Calibration } from '../../screening/calibration';
import { ordinal } from '../../screening/export';
import { DECISIONS, type Decision } from '../../screening/store';
import { BUCKET_TONE, confidenceLabel, groupRows, type ApplicantRowView } from '../screen-view';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';
import { formatList } from '../../i18n/format';

export interface ScreenDetailProps {
  screening: {
    id: number;
    title: string;
    rubricVersion: number;
    retainUntil: Date;
    createdAt: Date;
    job: { id: number; title: string; companyName: string; location: string };
    /** The posting as this screening reads it — a snapshot, edited here, never on the Job (plan §4). */
    postingText: string;
    postingUpdatedAt: Date | null;
    /** Current verdicts written before the last posting edit. */
    scoredBeforePosting: number;
  };
  rubric: Rubric;
  rows: ApplicantRowView[];
  run: ScreenRunState | null;
  /** Readable applicants without a verdict under the current rubric. */
  pending: number;
  /** Which engine the calls go to, and the warning when it is not one fit for other people's data. */
  engine: { label: string; warn: string | null };
  retentionDays: number;
  /** The person's decisions held against the table's order (plan §6 stage E). */
  calibration: Calibration;
  flash?: FlashMessage | null;
}

const CONFIDENCE_TONE: Record<ConfidenceBand, 'ok' | 'warn' | 'neutral'> = { high: 'ok', medium: 'neutral', low: 'warn' };
/** A decision in the reader's words; the export writes `DECISION_LABELS`, in English. */
const DECISION_WORD: Record<Decision, MessageKey> = { interview: 'screening.decision.interview', hold: 'screening.decision.hold', declined: 'screening.decision.declined' };

export const ScreenDetailPage: FC<ScreenDetailProps> = ({ screening, rubric, rows, run, pending, engine, retentionDays, calibration, flash }) => {
  const groups = groupRows(rows);
  const readable = rows.filter((r) => r.status === 'ok').length;
  const running = run?.running ?? false;
  const rubricEmpty = rubric.criteria.length === 0;
  const gateCriteria = rubric.criteria.filter((c) => c.mode === 'gate');
  const scoredAny = groups.scored.length > 0;
  return (
    <Layout title={screening.title} titleIsData active="screen">
      <PageHeader
        title={screening.title}
        titleIsData
        back={{ href: '/screen', label: t('nav.screen') }}
        meta={t('screen.detail.meta', { n: rows.length, date: formatDateShort(screening.retainUntil) })}
        actions={
          <div class="flex flex-wrap items-center gap-2">
            {/* Format names, never translated. */}
            <Button href={`/screen/${screening.id}/export.csv`} variant="secondary" size="sm">
              <span translate="no">CSV</span>
            </Button>
            <Button href={`/screen/${screening.id}/export.md`} variant="secondary" size="sm">
              <span translate="no">Markdown</span>
            </Button>
            <ActionForm action={`/screen/${screening.id}/retain`}>
              <Button variant="ghost" size="sm" title={t('screen.detail.keepTitle', { n: retentionDays })}>
                {t('screen.detail.keep', { n: retentionDays })}
              </Button>
            </ActionForm>
            <ConfirmAction
              action={`/screen/${screening.id}/delete`}
              label={t('screen.detail.delete')}
              confirm={t('screen.detail.deleteConfirm')}
            />
          </div>
        }
      >
        {t('screen.detail.intro')}
      </PageHeader>
      <Flash flash={flash} />

      {/* 0. The posting, as this screening reads it. */}
      <Card class="mb-4" id="position">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            <Step n={1} />
            {t('screen.detail.position')}
          </SectionTitle>
          <span class="text-note text-ink-faint">
            {screening.postingUpdatedAt
              ? t('screen.detail.postingEdited', { when: formatRelative(screening.postingUpdatedAt) })
              : t('screen.detail.postingAsStored')}{' '}
            ·{' '}
            <a href={`/jobs/${screening.job.id}`} class="hover:underline">
              {t('screen.detail.jobPage')}
            </a>
          </span>
        </div>
        <p class="mt-1 text-sm text-ink" translate="no">
          <span class="font-medium">{screening.job.title}</span> · {screening.job.companyName}
          {screening.job.location ? ` · ${screening.job.location}` : ''}
        </p>
        {screening.scoredBeforePosting > 0 && (
          <Notice tone="warn" role="status" class="mt-3 flex flex-wrap items-center gap-3">
            <span>{t('screen.detail.postingChanged', { n: screening.scoredBeforePosting })}</span>
            <ActionForm action={`/screen/${screening.id}/rubric/redraft`} once>
              <Button variant="secondary" size="sm">
                {t('screen.detail.rereadRubric')}
              </Button>
            </ActionForm>
            <ActionForm action={`/screen/${screening.id}/run-all`} once>
              <Button variant="violet" size="sm" disabled={running}>
                {t('screen.detail.scoreEveryoneAgain')}
              </Button>
            </ActionForm>
          </Notice>
        )}
        <details class="mt-3">
          <summary class={DISCLOSURE}>
            <span class="when-closed">{t('screen.detail.showPosting')}</span>
            <span class="when-open">{t('screen.detail.hidePosting')}</span>
            <Chevron />
          </summary>
          <pre translate="no" class="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-note leading-5 text-ink">{screening.postingText}</pre>
        </details>
        <details class="mt-2">
          <summary class={DISCLOSURE}>
            <span class="when-closed">{t('screen.detail.editPosting')}</span>
            <span class="when-open">{t('screen.detail.closeEditor')}</span>
            <Chevron />
          </summary>
          <form method="post" action={`/screen/${screening.id}/posting`} class="mt-2 space-y-2">
            <Textarea name="postingText" rows={14} aria-label={t('screen.detail.postingText')}>
              {screening.postingText}
            </Textarea>
            <div class="flex flex-wrap items-center gap-3">
              <Button variant="secondary">{t('screen.detail.savePosting')}</Button>
              <Hint>{t('screen.detail.savePostingHint')}</Hint>
            </div>
          </form>
        </details>
      </Card>


      {/* 2. The criteria — the editor is open until the first run; after that the chips say what is checked and the button opens it. */}
      <Card class="mb-4" id="rubric">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            <Step n={2} />
            {t('screen.detail.criteria')}
          </SectionTitle>
          <span class="text-note text-ink-faint">
            {rubricEmpty ? t('screen.detail.noCriteria') : rubricSummary(rubric)} · {t('screen.detail.rubricVersion', { version: screening.rubricVersion })}
          </span>
        </div>
        {!rubricEmpty && (
          <div class="rubric-chips mb-3 flex flex-wrap gap-1.5">
            {rubric.criteria.slice(0, MAX_CRITERION_CHIPS).map((c) => (
              <CriterionChip c={c} />
            ))}
            {rubric.criteria.length > MAX_CRITERION_CHIPS && (
              <span class="self-center text-meta text-ink-faint">{t('screen.detail.moreCriteria', { n: rubric.criteria.length - MAX_CRITERION_CHIPS })}</span>
            )}
          </div>
        )}
        <details open={!scoredAny || rubricEmpty}>
          <summary class={DISCLOSURE}>
            <span class="when-closed">{t('screen.detail.showCriteria')}</span>
            <span class="when-open">{t('screen.detail.hideEditor')}</span>
            <Chevron />
          </summary>
          <Hint class="mt-2">{tRich('screen.detail.modesHint', {}, { em: (words) => <span class="text-ink">{words}</span> })}</Hint>
          <More class="mt-1">{t('screen.detail.modesMore')}</More>
          {rubricEmpty && (
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <Hint>{t('screen.detail.noDraft')}</Hint>
              <ActionForm action={`/screen/${screening.id}/rubric/redraft`} once>
                <Button variant="secondary" size="sm">
                  {t('screen.detail.readPostingAgain')}
                </Button>
              </ActionForm>
            </div>
          )}
          <form method="post" action={`/screen/${screening.id}/rubric`} class="mt-3">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-label text-ink-muted [&>th]:font-[550]">
                    <th scope="col" class="py-2 pr-2">{t('screen.detail.col.kind')}</th>
                    <th scope="col" class="py-2 pr-2">{t('screen.detail.col.what')}</th>
                    <th scope="col" class="py-2 pr-2">{t('screen.detail.col.mode')}</th>
                    <th scope="col" class="py-2 pr-2">{t('screen.detail.col.weight')}</th>
                    <th scope="col" class="py-2 pr-2">{t('screen.detail.col.from')}</th>
                    <th scope="col" class="py-2 text-right">{t('common.remove')}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {rubric.criteria.map((c) => (
                    <CriterionRow c={c} />
                  ))}
                  <tr class="bg-surface-overlay/40">
                    <td class="py-2 pr-2 align-top">
                      <Select name="add_kind" aria-label={t('screen.detail.addKind')} class="!w-auto !py-1 text-note">
                        {CRITERION_KINDS.map((k) => (
                          <option value={k} selected={k === 'custom'}>
                            {CRITERION_KIND_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td class="py-2 pr-2 align-top">
                      <Input type="text" name="add_text" maxlength="200" placeholder={t('screen.detail.addPlaceholder')} aria-label={t('screen.detail.addLabel')} class="!py-1 text-note" />
                      <div class="mt-1 text-meta text-ink-faint" id="add-hint">
                        {CRITERION_KIND_HINTS.custom}
                      </div>
                      <label class="mt-1 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-muted">
                        {t('screen.detail.answeredAs')}
                        <Select name="add_answer" aria-label={t('screen.detail.addAnswerLabel')} class="!w-auto max-w-full !py-0.5 !text-meta">
                          <option value="yesno">{t('screen.detail.yesNoLong')}</option>
                          <option value="howmuch">{t('screen.detail.howMuchLong')}</option>
                        </Select>
                      </label>
                    </td>
                    <td class="py-2 pr-2 align-top">
                      <ModeSelect name="add_mode" value="scored" />
                    </td>
                    <td class="py-2 pr-2 align-top">
                      <WeightSelect name="add_weight" value={3} />
                    </td>
                    <td class="py-2 pr-2 align-top text-meta text-ink-faint">{t('screen.detail.fromYou')}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <Button>{t('screen.detail.saveCriteria')}</Button>
              <Hint>{t('screen.detail.saveCriteriaHint')}</Hint>
            </div>
          </form>
          <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span class="text-note text-ink-faint">{t('screen.detail.presets')}</span>
            {PRESETS.map((p) => (
              <ActionForm action={`/screen/${screening.id}/rubric/preset`} hidden={{ preset: p }} once>
                <Button variant="secondary" size="sm" title={PRESET_HINTS[p]}>
                  {PRESET_LABELS[p]}
                </Button>
              </ActionForm>
            ))}
            <Hint>{t('screen.detail.presetsHint')}</Hint>
          </div>
        </details>
      </Card>

      {/* 3. Applicants in. */}
      <Card class="mb-4">
        <SectionTitle>
          <Step n={3} />
          {t('screen.detail.applicants')}
        </SectionTitle>
        <form
          id="upload-form"
          method="post"
          action={`/screen/${screening.id}/applicants`}
          enctype="multipart/form-data"
          class="flex flex-wrap items-center gap-x-4 gap-y-3"
          onsubmit={SUBMIT_ONCE}
        >
          <label class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span class="text-ink">{t('screen.detail.files')}</span>
            <input
              type="file"
              name="files"
              multiple
              accept={[...ACCEPTED_EXTENSIONS, '.zip'].join(',')}
              aria-label={t('screen.detail.filesLabel')}
              class={`text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
            />
          </label>
          <label class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span class="text-ink">{t('screen.detail.folder')}</span>
            <input type="file" name="files" multiple webkitdirectory aria-label={t('screen.detail.folderLabel')} class={`text-sm text-ink-muted ${FILE_INPUT_CLASS}`} />
          </label>
          <Button variant="secondary" data-upload-button>
            {t('screen.detail.addAndScore')}
          </Button>
          <span class="text-note text-ink-faint" data-picked aria-live="polite"></span>
        </form>
        {/* Six facts, one line each — as one paragraph none of them was findable. */}
        <ul class="mt-2 list-disc space-y-1 pl-4 text-note leading-5 text-ink-faint">
          <li>{t('screen.detail.upload.pick', { formats: ACCEPTED_EXTENSIONS.join(' / ') })}</li>
          <li>{t('screen.detail.upload.limits', { max: MAX_APPLICANTS_PER_SCREENING, mb: MAX_BATCH_UPLOAD_MB })}</li>
          <li>{t('screen.detail.upload.redaction')}</li>
          <li>{t('screen.detail.upload.repeats')}</li>
        </ul>
      </Card>

      {/* 3. Score and the table. */}
      <Card flush id="results">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div>
            <SectionTitle>
              <Step n={4} />
              {t('screen.detail.results')}
            </SectionTitle>
            <div class="text-note text-ink-faint" id="run-progress" role="status" aria-live="polite" data-screening={screening.id} data-running={running ? '1' : undefined}>
              {running
                ? progressText(run!)
                : run && run.finishedAt !== null && run.failed > 0
                  ? run.lastError
                    ? t('screen.detail.lastRunError', { done: run.done, failed: run.failed, error: run.lastError })
                    : t('screen.detail.lastRun', { done: run.done, failed: run.failed })
                  : pending > 0
                    ? t('screen.detail.pending', { pending, readable, version: screening.rubricVersion })
                    : readable > 0
                      ? `${t('screen.detail.allScored', { readable, version: screening.rubricVersion, engine: engine.label })}${
                          screening.scoredBeforePosting > 0 ? ` ${t('screen.detail.allScoredBefore', { n: screening.scoredBeforePosting })}` : ''
                        }`
                      : t('screen.detail.addApplicants')}
            </div>
            <div class="mt-1 text-note text-ink-faint">
              {engine.warn
                ? tRich('screen.detail.runsOnPersonal', { engine: engine.label }, {
                    link: (words) => (
                      <a href="/settings?tab=screening" class="text-warn hover:underline">
                        {words}
                      </a>
                    ),
                  })
                : t('screen.detail.runsOn', { engine: engine.label })}
            </div>
          </div>
          <ActionForm action={`/screen/${screening.id}/run`} once>
            <Button variant="violet" disabled={running || pending === 0 || rubricEmpty}>
              {running ? t('screen.detail.scoring') : pending > 0 ? t('screen.detail.scoreN', { n: pending }) : t('screen.detail.score')}
            </Button>
          </ActionForm>
        </div>

        {rows.length === 0 ? (
          <div class="px-4 pb-5 sm:px-5">
            <Empty bare title={t('screen.detail.empty')}>
              {t('screen.detail.emptyBody')}
            </Empty>
          </div>
        ) : (
          <form id="bulk-form" method="post" action={`/screen/${screening.id}/applicants/bulk`}>
          <div class="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 sm:px-5">
            <span class="text-note text-ink-faint" data-selection>
              {t('screen.detail.withTicked')}
            </span>
            {DECISIONS.map((d) => (
              <Button variant="secondary" size="sm" name="do" value={d}>
                {t(DECISION_WORD[d])}
              </Button>
            ))}
            <Button variant="ghost" size="sm" name="do" value="clear">
              {t('screen.detail.clearDecision')}
            </Button>
            <Button variant="secondary" size="sm" name="do" value="compare" data-min="2" title={t('screen.detail.compareTitle')}>
              {t('screen.detail.compare')}
            </Button>
            <Button variant="violet" size="sm" name="do" value="again" disabled={running}>
              {t('screen.detail.scoreAgain')}
            </Button>
            <Button variant="danger" size="sm" name="do" value="delete">
              {t('common.delete')}
            </Button>
          </div>
          <Table caption={t('screen.detail.applicants')}
            columns={[
              <input type="checkbox" data-select-all aria-label={t('screen.detail.selectAll')} class="h-4 w-4 accent-accent" />,
              '#',
              t('screen.detail.col.name'),
              t('screen.detail.col.gates'),
              t('screen.detail.col.score'),
              t('screen.detail.col.confidence'),
              t('screen.detail.col.mustHave'),
              t('screen.detail.col.years'),
              t('screen.detail.col.level'),
              t('screen.detail.col.decision'),
            ]}
            hideBelow={['', '', '', 'sm', '', 'md', 'lg', 'lg', 'lg', '']}
            thClasses={['w-8', '', '', '', 'text-right', '', 'text-right', 'text-right', '', '']}
          >
            {(['pass', 'ask', 'fail'] as GateBucket[]).map((bucket) => {
              const group = groups.scored.filter((r) => r.verdict!.bucket === bucket);
              if (group.length === 0) return null;
              return (
                <>
                  <GroupRow tone={BUCKET_TONE[bucket]} label={GATE_BUCKET_LABELS[bucket]} count={group.length} />
                  {group.map((r) => (
                    <ApplicantRow r={r} screeningId={screening.id} gates={gateCriteria} run={run} />
                  ))}
                </>
              );
            })}
            {groups.pending.length > 0 && (
              <>
                <GroupRow tone="neutral" label={running ? t('screen.detail.group.scoring') : t('screen.detail.group.pending')} count={groups.pending.length} />
                {groups.pending.map((r) => (
                  <ApplicantRow r={r} screeningId={screening.id} gates={gateCriteria} run={run} />
                ))}
              </>
            )}
            {groups.held.length > 0 && (
              <>
                <GroupRow tone="warn" label={t('screen.detail.group.held')} count={groups.held.length} />
                {groups.held.map((r) => (
                  <ApplicantRow r={r} screeningId={screening.id} gates={gateCriteria} run={run} />
                ))}
              </>
            )}
            {groups.unread.length > 0 && (
              <>
                <GroupRow tone="neutral" label={t('screen.detail.group.unread')} count={groups.unread.length} />
                {groups.unread.map((r) => (
                  <ApplicantRow r={r} screeningId={screening.id} gates={gateCriteria} run={run} />
                ))}
              </>
            )}
          </Table>
          </form>
        )}
        {/* One small form per row, outside the table: a decision select inside the bulk form would post with it. */}
        {rows
          .filter((r) => r.status === 'ok')
          .map((r) => (
            <form id={`decision-${r.id}`} method="post" action={`/screen/${screening.id}/applicants/${r.id}/decision`} hidden>
              <input type="hidden" name="back" value={`/screen/${screening.id}#results`} />
            </form>
          ))}
      </Card>
      {/* 5. The person's decisions against the order — measured, never acted on by the tool (ADR 0052). */}
      <Card class="mt-4" id="calibration">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            <Step n={5} />
            {t('screen.detail.calibration')}
          </SectionTitle>
          {calibration.enough && (
            <span class="text-note text-ink-faint">
              {t('screen.detail.decided', { interview: calibration.decided.interview, hold: calibration.decided.hold, declined: calibration.decided.declined })}
            </span>
          )}
        </div>
        <p class={`text-sm ${calibration.enough ? 'text-ink' : 'text-ink-muted'}`}>{calibrationLine(calibration)}</p>
        {calibration.enough && (
          <div class="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 class="text-label text-ink">{t('screen.detail.partWays')}</h3>
              {calibration.surprises.length === 0 ? (
                <Hint class="mt-1">{t('screen.detail.partWaysNowhere', { k: calibration.top?.k ?? 0 })}</Hint>
              ) : (
                <ul class="mt-1 space-y-1.5 text-sm">
                  {calibration.surprises.map((sp) => (
                    <li>
                      <span class="font-medium text-ink">№{sp.number}</span>
                      <span class="text-ink-muted">
                        {' — '}
                        {t('screen.detail.surprise', { decision: sp.decision, position: sp.position, suffix: ordinal(sp.position), total: sp.total })}
                      </span>
                      {sp.why.length > 0 && <div class="text-note text-ink-faint">{sp.why.join(' · ')}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 class="text-label text-ink">{t('screen.detail.separations')}</h3>
              <table class="mt-1 w-full text-sm">
                <thead>
                  <tr class="text-left text-label text-ink-muted [&>th]:font-[550]">
                    <th scope="col" class="py-1 pr-2">{t('screen.detail.sep.criterion')}</th>
                    <th scope="col" class="py-1 pr-2 text-right">{t('screen.detail.sep.interview')}</th>
                    <th scope="col" class="py-1 pr-2 text-right">{t('screen.detail.sep.declined')}</th>
                    <th scope="col" class="py-1 text-right">{t('screen.detail.sep.gap')}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {calibration.separations
                    .filter((sep) => sep.gap !== null)
                    .slice(0, MAX_SEPARATIONS)
                    .map((sep) => (
                      <tr class={Math.abs(sep.gap!) < FLAT_GAP ? 'text-ink-faint' : ''}>
                        <td class="py-1 pr-2">
                          {sep.label} <Stars n={sep.weight} class="text-ink-faint" />
                        </td>
                        <td class="py-1 pr-2 text-right tabular-nums">{sep.interviewed}</td>
                        <td class="py-1 pr-2 text-right tabular-nums">{sep.declined}</td>
                        <td class={`py-1 text-right tabular-nums ${sep.gap! > 0 ? 'text-ok' : sep.gap! < 0 ? 'text-warn' : ''}`}>
                          {sep.gap! > 0 ? '+' : ''}
                          {sep.gap}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <Hint class="mt-2">{t('screen.detail.separationsHint')}</Hint>
            </div>
          </div>
        )}
        {!calibration.enough && (
          <Hint class="mt-1">{t('screen.detail.notEnough', { n: MIN_DECISIONS })}</Hint>
        )}
      </Card>
      <Hint class="mt-3">{tRich('screen.detail.created', {}, { when: () => <When at={screening.createdAt} /> })}</Hint>
      <More class="mt-1">{t('screen.detail.bucketsMore')}</More>
      <style dangerouslySetInnerHTML={{ __html: runBadgeCss() + DISCLOSURE_CSS }} />
      <script
        type="module"
        dangerouslySetInnerHTML={{ __html: "import { init } from '/static/screen.mjs'; init();" }}
      />
    </Layout>
  );
};

const MAX_CRITERION_CHIPS = 40;
/** Separation rows the calibration card lists, the widest gap first; and the gap below which a criterion reads as flat. */
const MAX_SEPARATIONS = 8;
const FLAT_GAP = 0.1;

/** One criterion as a chip in the closed card: its words, and whether it gates, scores (with the stars) or only notes. */
const CriterionChip: FC<{ c: Criterion }> = ({ c }) => {
  const words = c.kind === 'impact' || c.kind === 'overall' ? criterionLabel(c) : criterionText(c) || c.label;
  return (
    <span
      class={`inline-flex min-w-0 max-w-[32rem] items-center gap-1 rounded-md px-2 py-0.5 text-meta ring-1 ring-inset ${
        c.mode === 'gate' ? 'bg-warn/5 text-ink ring-warn/25' : c.mode === 'note' ? 'bg-surface-overlay text-ink-muted ring-line' : 'bg-surface-raised text-ink ring-line'
      }`}
      title={t('screen.detail.chipTitle', { kind: CRITERION_KIND_LABELS[c.kind], mode: t(MODE_WORD[c.mode]), yours: c.source === 'you' ? 'yes' : 'no' })}
    >
      {c.mode === 'gate' && <span class="text-warn">{t('screen.detail.chip.gate')}</span>}
      <span class="min-w-0 truncate">{words}</span>
      {c.mode === 'scored' && <Stars n={c.weight} class="shrink-0 text-ink-faint" />}
      {c.mode === 'note' && <span class="text-ink-faint">{t('screen.detail.chip.note')}</span>}
    </span>
  );
};

/** A mode's short name — the select's options and the chip's tooltip. */
const MODE_WORD: Record<Criterion['mode'], MessageKey> = { gate: 'screen.detail.mode.gate', scored: 'screen.detail.mode.scored', note: 'screen.detail.mode.note' };

const ModeSelect: FC<{ name: string; value: Criterion['mode'] }> = ({ name, value }) => (
  <Select name={name} aria-label={t('screen.detail.col.mode')} class="!w-auto !py-1 text-note">
    {CRITERION_MODES.map((m) => (
      <option value={m} selected={m === value}>
        {t(MODE_WORD[m])}
      </option>
    ))}
  </Select>
);

const WeightSelect: FC<{ name: string; value: number }> = ({ name, value }) => (
  <Select name={name} aria-label={t('screen.detail.col.weight')} class="!w-auto !py-1 text-note">
    {Array.from({ length: MAX_WEIGHT }, (_, i) => i + 1).map((w) => (
      <option value={w} selected={w === value} aria-label={t('screen.detail.weightOf', { w, max: MAX_WEIGHT })}>
        {'★'.repeat(w)}
        {'☆'.repeat(MAX_WEIGHT - w)}
      </option>
    ))}
  </Select>
);

/** One criterion as the editor shows it: the kind, the words, the mode, the stars, where it came from. */
const CriterionRow: FC<{ c: Criterion }> = ({ c }) => {
  const fixed = c.kind === 'impact' || c.kind === 'overall';
  return (
    <tr>
      <td class="py-2 pr-2 align-top whitespace-nowrap text-note text-ink">{CRITERION_KIND_LABELS[c.kind]}</td>
      <td class="py-2 pr-2 align-top">
        {fixed ? (
          <span class="text-note text-ink-muted">{criterionLabel(c)}</span>
        ) : (
          <Input type="text" name={`text_${c.id}`} value={criterionText(c)} maxlength="200" aria-label={t('screen.detail.criterionLabel', { kind: CRITERION_KIND_LABELS[c.kind] })} title={CRITERION_KIND_HINTS[c.kind]} class="!py-1 text-note" />
        )}
        {c.kind === 'custom' && (
          <label class="mt-1 inline-flex items-center gap-2 text-meta text-ink-muted">
            {t('screen.detail.answeredAs')}
            <Select name={`answer_${c.id}`} aria-label={t('screen.detail.answerLabel')} class="!w-auto !py-0.5 !text-meta">
              <option value="yesno" selected={c.spec.answer === 'yesno'}>
                {t('screen.detail.yesNo')}
              </option>
              <option value="howmuch" selected={c.spec.answer === 'howmuch'}>
                {t('screen.detail.howMuch')}
              </option>
            </Select>
          </label>
        )}
      </td>
      <td class="py-2 pr-2 align-top">
        <ModeSelect name={`mode_${c.id}`} value={c.mode} />
      </td>
      <td class="py-2 pr-2 align-top">
        <WeightSelect name={`weight_${c.id}`} value={c.weight} />
      </td>
      <td class="py-2 pr-2 align-top text-meta text-ink-faint">{c.source === 'posting' ? t('screen.detail.fromPosting') : t('screen.detail.fromYou')}</td>
      <td class="py-2 text-right align-top">
        <input type="checkbox" name={`remove_${c.id}`} value="1" aria-label={t('screen.detail.removeNamed', { label: criterionLabel(c) })} class="h-4 w-4 accent-accent" />
      </td>
    </tr>
  );
};

/** The step number in a card's title — the page reads top to bottom: position, criteria, applicants, results. */
const Step: FC<{ n: number }> = ({ n }) => (
  <span class="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-overlay text-meta font-semibold text-ink-muted ring-1 ring-inset ring-line">
    {n}
  </span>
);

/** A <summary> that reads as a button, with a chevron that turns when the block is open; the bare marker was missed. */
const DISCLOSURE =
  'inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-line bg-surface-raised px-2.5 py-1 text-note font-medium text-ink hover:bg-surface-overlay list-none [&::-webkit-details-marker]:hidden';
const Chevron: FC = () => (
  <svg class="chev h-3.5 w-3.5 text-ink-faint transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const DISCLOSURE_CSS = `
  details[open] > summary .chev { transform: rotate(180deg); }
  details[open] > summary .when-closed { display: none; }
  details:not([open]) > summary .when-open { display: none; }
  #rubric:has(details[open]) .rubric-chips { display: none; }
`;

/* The Score cell's run badge, keyed on the row's data-run-state so the poller only flips attributes. */
const runBadgeCss = (): string => `
  .run-badge { display: none; margin-right: .5rem; font-size: 11px; font-weight: 500; border-radius: 9999px; padding: 1px 8px; vertical-align: middle; }
  tr[data-run-state] .run-badge { display: inline-block; }
  tr[data-run-state="queued"] .run-badge { background: rgb(var(--surface-overlay)); color: rgb(var(--ink-muted)); }
  /* Info, as DESIGN.md names the run badges: violet is for the button that starts the spend, not the row it is spent on. */
  tr[data-run-state="scoring"] .run-badge { background: rgb(var(--info) / .12); color: rgb(var(--info)); }
  tr[data-run-state="scored"] .run-badge { background: rgb(var(--ok) / .12); color: rgb(var(--ok)); }
  /* While a row is in the run, the number beside the badge is its previous verdict — say so, or it reads as the new one. */
  tr[data-run-state] .score-now { color: rgb(var(--ink-faint)); font-weight: 400; }
  tr[data-run-state] .score-now::before { content: ${JSON.stringify(`${t('screen.detail.was')} `)}; font-size: 11px; }
`;

const GroupRow: FC<{ tone: 'ok' | 'warn' | 'danger' | 'neutral'; label: string; count: number }> = ({ tone, label, count }) => (
  <tr class="bg-surface-overlay/60">
    <td colspan={10} class="px-3.5 py-1.5 text-meta font-medium sm:px-5">
      <Badge tone={tone}>{label}</Badge>
      <span class="ml-2 text-ink-faint">{count}</span>
    </td>
  </tr>
);

/** "Scoring… 2 of 5 — now reading №3, №4; 1 queued" — the message screen.mjs paints on every poll, with the same arguments. */
function progressText(run: ScreenRunState): string {
  return t('browser.screen.progress', {
    done: run.done + run.failed,
    total: run.total,
    failed: run.failed,
    hasFailed: run.failed > 0 ? 'yes' : 'no',
    // Joined as screen.mjs joins it on every poll, so the first paint reads the same.
    reading: formatList(run.inFlight.map((n) => `№${n}`), 'unit'),
    hasReading: run.inFlight.length > 0 ? 'yes' : 'no',
    queued: run.queued.length,
    hasQueued: run.queued.length > 0 ? 'yes' : 'no',
  });
}

type RowRunState = 'queued' | 'scoring' | 'scored' | null;

/** Where this applicant is in the run right now — the badge in the Score cell. */
function rowRunState(number: number, run: ScreenRunState | null): RowRunState {
  if (!run || !run.running) return null;
  if (run.inFlight.includes(number)) return 'scoring';
  if (run.queued.includes(number)) return 'queued';
  if (run.finished.includes(number)) return 'scored';
  return null;
}

/** The same keys screen.mjs flips the badge to. */
const RUN_BADGE: Record<Exclude<RowRunState, null>, MessageKey> = { queued: 'browser.screen.queued', scoring: 'browser.screen.scoring', scored: 'browser.screen.scored' };

const ApplicantRow: FC<{ r: ApplicantRowView; screeningId: number; gates: Criterion[]; run: ScreenRunState | null }> = ({ r, screeningId, gates, run }) => {
  const v = r.verdict && !r.stale ? r.verdict : null;
  const href = `/screen/${screeningId}/applicants/${r.id}`;
  const adjusted = v ? adjustedScore(v.score, r.adjustment) : null;
  const state = rowRunState(r.number, run);
  return (
    <Tr data-applicant={r.number} data-run-state={state ?? undefined}>
      <Td class="w-8 pr-0">
        <input type="checkbox" name="ids" value={r.id} aria-label={t('screen.detail.selectApplicant', { n: r.number })} class="h-4 w-4 accent-accent" />
      </Td>
      <Td class="whitespace-nowrap tabular-nums text-ink-faint">№{r.number}</Td>
      <Td class="w-full max-w-0">
        <a href={href} class="font-medium text-ink hover:underline">
          {r.name ? <span translate="no">{r.name}</span> : <span class="text-ink-muted">{t('screen.detail.noName')}</span>}
        </a>
        {r.sameAs !== null && (
          <span title={t('screen.detail.sameAsTitle')}>
            <Badge tone="neutral" class="ml-1.5">
              {t('screen.detail.sameAs', { n: r.sameAs })}
            </Badge>
          </span>
        )}
        {v?.injection && (
          <span title={t('screen.detail.injectionTitle')}>
            <Badge tone="danger" class="ml-1.5">
              {t('screen.detail.injection')}
            </Badge>
          </span>
        )}
        <div class="truncate text-meta text-ink-faint">
          <span translate="no" title={r.file}>
            {r.file}
          </span>
          {r.letters > 0 ? ` · ${t('screen.detail.letters', { n: r.letters })}` : ''}
          {r.status !== 'ok' && r.note ? ` — ${r.note}` : ''}
          {r.stale && r.verdict ? ` — ${t('screen.detail.scoredEarlier', { score: r.verdict.score })}` : ''}
        </div>
        {/* Phone width leaves the name cell too narrow for a list; the scorecard has the same facts. */}
        {v && (v.standout.length > 0 || v.career.roles > 0) && (
          <details class="mt-0.5 hidden text-meta sm:block">
            <summary class="cursor-pointer truncate text-ink-muted" title={v.standout.length > 0 ? v.standout.map((f) => f.fact).join(' · ') : v.careerLine}>
              {v.standout.length > 0 ? <span lang="en">{v.standout.map((f) => f.fact).join(' · ')}</span> : t('screen.detail.career', { line: v.careerLine })}
            </summary>
            <ul class="mt-1 space-y-0.5 whitespace-normal text-ink-muted">
              {v.standout.map((f) => (
                <li lang="en">
                  {f.fact}
                  {f.quote && (
                    <>
                      {' — '}
                      <q class="text-ink-faint">{f.quote}</q>
                    </>
                  )}
                </li>
              ))}
              {v.career.roles > 0 && <li class="text-ink-faint">{t('screen.detail.careerRead', { line: v.careerLine })}</li>}
            </ul>
          </details>
        )}
      </Td>
      <Td class="whitespace-nowrap">
        {v ? (
          <span class="inline-flex gap-1.5 font-mono text-note">
            {gates.map((g) => {
              // Matched on the stored label, the verdict's own; shown in the reader's words.
              const status = v.gates.find((x) => x.gate.toLowerCase() === g.label.toLowerCase())?.status ?? 'unknown';
              const said = `${criterionLabel(g)}: ${answerBadge(status)}`;
              return (
                <span title={said} class={status === 'pass' ? 'text-ok' : status === 'fail' ? 'text-danger' : 'text-warn'}>
                  <span aria-hidden="true">{GATE_MARK[status]}</span>
                  <span class="sr-only">{said}</span>
                </span>
              );
            })}
          </span>
        ) : (
          <span class="text-ink-faint">—</span>
        )}
      </Td>
      <Td class="whitespace-nowrap text-right tabular-nums">
        <span class="run-badge" data-run-badge>
          {state ? t(RUN_BADGE[state]) : ''}
        </span>
        {v ? (
          <span class="score-now font-semibold text-ink" title={v.cap !== null ? t('screen.detail.capped', { n: v.cap }) : undefined}>
            {adjusted}
            {v.cap !== null && <span class="text-ink-faint">*</span>}
            {r.adjustment !== 0 && (
              <span
                class={`ml-1 text-meta font-normal ${r.adjustment > 0 ? 'text-ok' : 'text-warn'}`}
                title={
                  r.adjustmentNote
                    ? t('screen.detail.adjustedNote', { score: v.score, adjustment: `${r.adjustment > 0 ? '+' : ''}${r.adjustment}`, note: r.adjustmentNote })
                    : t('screen.detail.adjusted', { score: v.score, adjustment: `${r.adjustment > 0 ? '+' : ''}${r.adjustment}` })
                }
              >
                {r.adjustment > 0 ? '+' : ''}
                {r.adjustment}
              </span>
            )}
          </span>
        ) : (
          <span class="text-ink-faint">—</span>
        )}
      </Td>
      <Td>{v ? <Badge tone={CONFIDENCE_TONE[v.confidence]}>{confidenceLabel(v.confidence)}</Badge> : ''}</Td>
      <Td class="whitespace-nowrap text-right tabular-nums" title={v ? t('screen.detail.mustTitle', { strong: v.mustStrong, total: v.mustTotal }) : undefined}>
        {v ? (
          <>
            {v.mustCovered} / {v.mustTotal}
            <span class="block text-meta text-ink-faint">{t('screen.detail.strong', { n: v.mustStrong })}</span>
          </>
        ) : (
          ''
        )}
      </Td>
      <Td class="text-right tabular-nums" title={v && v.career.roles > 0 ? t('screen.detail.yearsTitle', { line: v.careerLine }) : undefined}>
        {v ? (v.years ?? '?') : ''}
      </Td>
      <Td class="text-ink-muted">{v ? (v.level ?? '?') : ''}</Td>
      <Td class="whitespace-nowrap">
        {r.status === 'ok' ? (
          <span class="flex items-center gap-2">
            <Select name="decision" form={`decision-${r.id}`} data-commit="submit" aria-label={t('screen.detail.decisionFor', { n: r.number })} class="min-w-[7.5rem] !py-1 text-note">
              <option value="" selected={r.decision === null}>
                —
              </option>
              {DECISIONS.map((d) => (
                <option value={d} selected={r.decision === d}>
                  {t(DECISION_WORD[d])}
                </option>
              ))}
            </Select>
            <noscript>
              <Button variant="ghost" size="sm" form={`decision-${r.id}`}>
                {t('common.save')}
              </Button>
            </noscript>
          </span>
        ) : r.status === 'held' ? (
          <a href={`/screen/${screeningId}/applicants/${r.id}`} class="text-note text-ink hover:underline">
            {t('screen.detail.readFirst')}
          </a>
        ) : (
          <span class="text-note text-ink-faint">{t('screen.detail.tickDelete')}</span>
        )}
      </Td>
    </Tr>
  );
};
