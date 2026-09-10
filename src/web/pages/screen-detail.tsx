/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Empty, FILE_INPUT_CLASS, Flash, Hint, Input, PageHeader, SectionTitle, Select, SUBMIT_ONCE, Table, Td, Textarea, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDateShort, formatRelative } from '../format';
import {
  criterionText,
  CRITERION_KIND_HINTS,
  CRITERION_KIND_LABELS,
  CRITERION_KINDS,
  CRITERION_MODE_LABELS,
  CRITERION_MODES,
  MAX_WEIGHT,
  PRESET_HINTS,
  PRESET_LABELS,
  PRESETS,
  rubricSummary,
  type Criterion,
  type Rubric,
} from '../../screening/rubric';
import { GATE_BUCKET_LABELS, type ConfidenceBand, type GateBucket } from '../../screening/score';
import { GATE_MARK, DECISION_LABELS } from '../../screening/export';
import { adjustedScore } from '../screen-view';
import { MAX_APPLICANTS_PER_SCREENING, MAX_BATCH_UPLOAD_MB } from '../../screening/intake';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import type { ScreenRunState } from '../../screening/batch';
import { calibrationLine, MIN_DECISIONS, type Calibration } from '../../screening/calibration';
import { ordinal } from '../../screening/export';
import { DECISIONS } from '../../screening/store';
import { groupRows, type ApplicantRowView } from '../screen-view';

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
const BUCKET_TONE: Record<GateBucket, 'ok' | 'warn' | 'danger'> = { pass: 'ok', ask: 'warn', fail: 'danger' };

export const ScreenDetailPage: FC<ScreenDetailProps> = ({ screening, rubric, rows, run, pending, engine, retentionDays, calibration, flash }) => {
  const groups = groupRows(rows);
  const readable = rows.filter((r) => r.status === 'ok').length;
  const running = run?.running ?? false;
  const rubricEmpty = rubric.criteria.length === 0;
  const gateLabels = rubric.criteria.filter((c) => c.mode === 'gate').map((c) => c.label);
  const scoredAny = groups.scored.length > 0;
  return (
    <Layout title={screening.title} active="screen">
      <PageHeader
        title={screening.title}
        back={{ href: '/screen', label: 'Screening' }}
        meta={`${rows.length} applicant${rows.length === 1 ? '' : 's'} · kept until ${formatDateShort(screening.retainUntil)}`}
        actions={
          <div class="flex flex-wrap items-center gap-2">
            <Button href={`/screen/${screening.id}/export.csv`} variant="secondary" size="sm">
              CSV
            </Button>
            <Button href={`/screen/${screening.id}/export.md`} variant="secondary" size="sm">
              Markdown
            </Button>
            <ActionForm action={`/screen/${screening.id}/retain`}>
              <Button variant="ghost" size="sm" title={`Keep for another ${retentionDays} days from today`}>
                Keep {retentionDays} more days
              </Button>
            </ActionForm>
            <ActionForm
              action={`/screen/${screening.id}/delete`}
              confirm="Delete this screening? It removes the screening, the uploaded copies of the resumes and every verdict from the database. Your files on disk are not touched. This cannot be undone."
            >
              <Button variant="danger" size="sm">
                Delete screening
              </Button>
            </ActionForm>
          </div>
        }
      >
        Five cards, top to bottom: the position, the criteria it is screened against, the applicants, the results,
        and how your decisions sit against the order. The order in the results is a priority to talk to; every mark
        has its quote on the scorecard, and the decision column is yours alone.
      </PageHeader>
      <Flash flash={flash} />

      {/* 0. The posting, as this screening reads it. */}
      <Card class="mb-4" id="position">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            <Step n={1} />
            Position
          </SectionTitle>
          <span class="text-[13px] text-ink-faint">
            {screening.postingUpdatedAt
              ? `edited here ${formatRelative(screening.postingUpdatedAt)}`
              : 'as stored on the job'}{' '}
            ·{' '}
            <a href={`/jobs/${screening.job.id}`} class="hover:underline">
              the job page
            </a>
          </span>
        </div>
        <p class="mt-1 text-sm text-ink">
          <span class="font-medium">{screening.job.title}</span> · {screening.job.companyName}
          {screening.job.location ? ` · ${screening.job.location}` : ''}
        </p>
        {screening.scoredBeforePosting > 0 && (
          <div class="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
            <span>
              The posting changed after {screening.scoredBeforePosting} of the current scores were written. Re-read the
              rubric from it (a new yardstick), or score everyone again against the new text with the rubric as it is.
            </span>
            <ActionForm action={`/screen/${screening.id}/rubric/redraft`} once>
              <Button variant="secondary" size="sm">
                Re-read the rubric
              </Button>
            </ActionForm>
            <ActionForm action={`/screen/${screening.id}/run-all`} once>
              <Button variant="violet" size="sm" disabled={running}>
                Score everyone again
              </Button>
            </ActionForm>
          </div>
        )}
        <details class="mt-3">
          <summary class={DISCLOSURE}>
            <span class="when-closed">Read the posting</span>
            <span class="when-open">Hide the posting</span>
            <Chevron />
          </summary>
          <pre class="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-[13px] leading-5 text-ink">{screening.postingText}</pre>
        </details>
        <details class="mt-2">
          <summary class={DISCLOSURE}>
            <span class="when-closed">Edit the posting for this screening</span>
            <span class="when-open">Close the editor</span>
            <Chevron />
          </summary>
          <form method="post" action={`/screen/${screening.id}/posting`} class="mt-2 space-y-2">
            <Textarea name="postingText" rows={14} aria-label="Posting text">
              {screening.postingText}
            </Textarea>
            <div class="flex flex-wrap items-center gap-3">
              <Button variant="secondary">Save the posting</Button>
              <Hint>
                Edits stay on this screening — the job page keeps its own text. After saving, re-read the rubric or
                score everyone again; the page will say which scores predate the edit.
              </Hint>
            </div>
          </form>
        </details>
      </Card>


      {/* 2. The criteria — the editor is open until the first run; after that the chips say what is checked and the button opens it. */}
      <Card class="mb-4" id="rubric">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            <Step n={2} />
            Criteria — what this screen checks
          </SectionTitle>
          <span class="text-[13px] text-ink-faint">
            {rubricEmpty ? 'no criteria yet' : rubricSummary(rubric)} · rubric v{screening.rubricVersion}
          </span>
        </div>
        {!rubricEmpty && (
          <div class="rubric-chips mb-3 flex flex-wrap gap-1.5">
            {rubric.criteria.slice(0, MAX_CRITERION_CHIPS).map((c) => (
              <CriterionChip c={c} />
            ))}
            {rubric.criteria.length > MAX_CRITERION_CHIPS && (
              <span class="self-center text-xs text-ink-faint">+{rubric.criteria.length - MAX_CRITERION_CHIPS} more</span>
            )}
          </div>
        )}
        <details open={!scoredAny || rubricEmpty}>
          <summary class={DISCLOSURE}>
            <span class="when-closed">Show and edit the criteria</span>
            <span class="when-open">Hide the editor</span>
            <Chevron />
          </summary>
          <Hint class="mt-2">
            One row per criterion. A <span class="text-ink">gate</span> buckets (pass / unknown / fail, never points), the
            <span class="text-ink"> stars</span> weigh a scored criterion, a <span class="text-ink">note</span> is shown and
            not counted. Rows the posting wrote say so; edit the words, change the mode, tick Remove — and add your own in
            the last row, in your own words.
          </Hint>
          {rubricEmpty && (
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <Hint>The posting could not be read into a draft. Add criteria below, or read the posting again.</Hint>
              <ActionForm action={`/screen/${screening.id}/rubric/redraft`} once>
                <Button variant="secondary" size="sm">
                  Read the posting again
                </Button>
              </ActionForm>
            </div>
          )}
          <form method="post" action={`/screen/${screening.id}/rubric`} class="mt-3">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-xs font-medium text-ink-muted">
                    <th scope="col" class="py-2 pr-2">Kind</th>
                    <th scope="col" class="py-2 pr-2">What</th>
                    <th scope="col" class="py-2 pr-2">Mode</th>
                    <th scope="col" class="py-2 pr-2">Weight</th>
                    <th scope="col" class="py-2 pr-2">From</th>
                    <th scope="col" class="py-2 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {rubric.criteria.map((c) => (
                    <CriterionRow c={c} />
                  ))}
                  <tr class="bg-surface-overlay/40">
                    <td class="py-2 pr-2 align-top">
                      <Select name="add_kind" aria-label="Kind of the new criterion" class="!py-1 text-[13px]">
                        {CRITERION_KINDS.map((k) => (
                          <option value={k} selected={k === 'custom'}>
                            {CRITERION_KIND_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td class="py-2 pr-2 align-top">
                      <Input type="text" name="add_text" maxlength="200" placeholder="In your own words: a question the resume can answer — or a term, a band of years, a sector…" aria-label="The new criterion" class="!py-1 text-[13px]" />
                      <div class="mt-1 text-xs text-ink-faint" id="add-hint">
                        {CRITERION_KIND_HINTS.custom}
                      </div>
                      <label class="mt-1 inline-flex items-center gap-2 text-xs text-ink-muted">
                        answered as
                        <Select name="add_answer" aria-label="How a question in your own words is answered" class="!py-0.5 !text-xs">
                          <option value="yesno">yes / no (pass, partial, unknown, fail)</option>
                          <option value="howmuch">how much (the evidence ladder)</option>
                        </Select>
                      </label>
                    </td>
                    <td class="py-2 pr-2 align-top">
                      <ModeSelect name="add_mode" value="scored" />
                    </td>
                    <td class="py-2 pr-2 align-top">
                      <WeightSelect name="add_weight" value={3} />
                    </td>
                    <td class="py-2 pr-2 align-top text-xs text-ink-faint">you</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <Button>Save the criteria</Button>
              <Hint>
                A change to the yardstick makes every stored score stale — the table says so and "Score" reads
                everyone again. A criterion naming age, gender, family, origin or health is refused, with the lawful
                criterion offered instead.
              </Hint>
            </div>
          </form>
          <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span class="text-[13px] text-ink-faint">Start over from a shape of hiring:</span>
            {PRESETS.map((p) => (
              <ActionForm action={`/screen/${screening.id}/rubric/preset`} hidden={{ preset: p }} once>
                <Button variant="secondary" size="sm" title={PRESET_HINTS[p]}>
                  {PRESET_LABELS[p]}
                </Button>
              </ActionForm>
            ))}
            <Hint>Re-reads the posting, applies the shape, keeps your own rows; every stored score turns stale.</Hint>
          </div>
        </details>
      </Card>

      {/* 3. Applicants in. */}
      <Card class="mb-4">
        <SectionTitle>
          <Step n={3} />
          Applicants
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
            <span class="text-ink">Files or a zip</span>
            <input
              type="file"
              name="files"
              multiple
              accept={[...ACCEPTED_EXTENSIONS, '.zip'].join(',')}
              aria-label="Resume files or a zip"
              class={`text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
            />
          </label>
          <label class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span class="text-ink">…or a whole folder</span>
            <input type="file" name="files" multiple webkitdirectory aria-label="A folder of resumes" class={`text-sm text-ink-muted ${FILE_INPUT_CLASS}`} />
          </label>
          <Button variant="secondary" data-upload-button>
            Add and score
          </Button>
          <span class="text-[13px] text-ink-faint" data-picked aria-live="polite"></span>
        </form>
        <Hint class="mt-2">
          Choosing is adding: the moment you pick {ACCEPTED_EXTENSIONS.join(' / ')} files, a .zip, or a folder with
          its subfolders, they are uploaded and the scoring starts — nothing else to press. (On a folder, your
          browser asks once whether to upload its files; that question is the browser's, not ours.) Up to{' '}
          {MAX_APPLICANTS_PER_SCREENING} applicants per screening, {MAX_BATCH_UPLOAD_MB} MB per upload; other file
          types in a folder are left out. Files added while a run is on join the same run. Before any model reads a file, the name, contacts, links, date of birth, age, family,
          gender, citizenship, street and graduation years are removed. A second document of someone already in the
          list is scored too and labelled; the same file twice is skipped; a scanned PDF with no text layer stays in
          the list unscored, so you can see it.
        </Hint>
      </Card>

      {/* 3. Score and the table. */}
      <Card flush id="results">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div>
            <SectionTitle>
              <Step n={4} />
              Results
            </SectionTitle>
            <div class="text-[13px] text-ink-faint" id="run-progress" role="status" aria-live="polite" data-screening={screening.id} data-running={running ? '1' : undefined}>
              {running
                ? progressText(run!)
                : run && run.finishedAt !== null && run.failed > 0
                  ? `Last run: ${run.done} scored, ${run.failed} failed${run.lastError ? ` — ${run.lastError}` : ''}. Failed ones stay pending; press Score again.`
                  : pending > 0
                    ? `${pending} of ${readable} readable applicant${readable === 1 ? '' : 's'} not scored under rubric v${screening.rubricVersion}.`
                    : readable > 0
                      ? `All ${readable} readable applicant${readable === 1 ? '' : 's'} scored under rubric v${screening.rubricVersion} on ${engine.label}.${
                          screening.scoredBeforePosting > 0 ? ` ${screening.scoredBeforePosting} of them before the posting was edited — see Position above.` : ''
                        }`
                      : 'Add applicants above.'}
            </div>
            <div class="mt-1 text-[13px] text-ink-faint">
              Runs on {engine.label}
              {engine.warn ? (
                <>
                  , a personal subscription —{' '}
                  <a href="/settings?tab=screening" class="text-warn hover:underline">
                    read why that matters for other people's resumes
                  </a>
                  .
                </>
              ) : (
                '.'
              )}
            </div>
          </div>
          <ActionForm action={`/screen/${screening.id}/run`} once>
            <Button variant="violet" disabled={running || pending === 0 || rubricEmpty}>
              {running ? 'Scoring…' : pending > 0 ? `Score ${pending} applicant${pending === 1 ? '' : 's'}` : 'Score'}
            </Button>
          </ActionForm>
        </div>

        {rows.length === 0 ? (
          <div class="px-4 pb-5 sm:px-5">
            <Empty>No applicants yet.</Empty>
          </div>
        ) : (
          <form id="bulk-form" method="post" action={`/screen/${screening.id}/applicants/bulk`}>
          <div class="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 sm:px-5">
            <span class="text-[13px] text-ink-faint" data-selection>
              With the ticked applicants:
            </span>
            {(['interview', 'hold', 'declined'] as const).map((d) => (
              <Button variant="secondary" size="sm" name="do" value={d}>
                {DECISION_LABELS[d]}
              </Button>
            ))}
            <Button variant="ghost" size="sm" name="do" value="clear">
              Clear decision
            </Button>
            <Button variant="secondary" size="sm" name="do" value="compare" data-min="2" title="Two to five scored applicants, side by side">
              Compare
            </Button>
            <Button variant="violet" size="sm" name="do" value="again" disabled={running}>
              Score again
            </Button>
            <Button variant="danger" size="sm" name="do" value="delete">
              Delete
            </Button>
          </div>
          <Table caption="Applicants"
            columns={[
              <input type="checkbox" data-select-all aria-label="Select every applicant" class="h-4 w-4 accent-accent" />,
              '#',
              'Name',
              'Gates',
              'Score',
              'Confidence',
              'Must-have',
              'Years',
              'Level',
              'Decision',
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
                    <ApplicantRow r={r} screeningId={screening.id} gates={gateLabels} run={run} />
                  ))}
                </>
              );
            })}
            {groups.pending.length > 0 && (
              <>
                <GroupRow tone="neutral" label={running ? 'Being scored' : 'Not scored yet'} count={groups.pending.length} />
                {groups.pending.map((r) => (
                  <ApplicantRow r={r} screeningId={screening.id} gates={gateLabels} run={run} />
                ))}
              </>
            )}
            {groups.unread.length > 0 && (
              <>
                <GroupRow tone="neutral" label="Could not be screened" count={groups.unread.length} />
                {groups.unread.map((r) => (
                  <ApplicantRow r={r} screeningId={screening.id} gates={gateLabels} run={run} />
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
            Calibration — your decisions against the order
          </SectionTitle>
          {calibration.enough && (
            <span class="text-[13px] text-ink-faint">
              {calibration.decided.interview} to interview · {calibration.decided.hold} on hold · {calibration.decided.declined} declined
            </span>
          )}
        </div>
        <p class={`text-sm ${calibration.enough ? 'text-ink' : 'text-ink-muted'}`}>{calibrationLine(calibration)}</p>
        {calibration.enough && (
          <div class="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 class="text-[13px] font-medium text-ink">Where you and the table part ways</h3>
              {calibration.surprises.length === 0 ? (
                <Hint class="mt-1">Nowhere: every To interview sits in the top {calibration.top?.k ?? 0}, no Declined does.</Hint>
              ) : (
                <ul class="mt-1 space-y-1.5 text-sm">
                  {calibration.surprises.map((sp) => (
                    <li>
                      <span class="font-medium text-ink">№{sp.number}</span>
                      <span class="text-ink-muted">
                        {' — '}
                        {sp.decision === 'interview' ? 'To interview' : 'Declined'}, {sp.position}
                        {ordinal(sp.position)} of {sp.total} in the table
                      </span>
                      {sp.why.length > 0 && <div class="text-[13px] text-ink-faint">{sp.why.join(' · ')}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 class="text-[13px] font-medium text-ink">Which criteria tell your picks from the rest</h3>
              <table class="mt-1 w-full text-sm">
                <thead>
                  <tr class="text-left text-xs font-medium text-ink-muted">
                    <th scope="col" class="py-1 pr-2">Criterion</th>
                    <th scope="col" class="py-1 pr-2 text-right">To interview</th>
                    <th scope="col" class="py-1 pr-2 text-right">Declined</th>
                    <th scope="col" class="py-1 text-right">Gap</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {calibration.separations
                    .filter((sep) => sep.gap !== null)
                    .slice(0, MAX_SEPARATIONS)
                    .map((sep) => (
                      <tr class={Math.abs(sep.gap!) < FLAT_GAP ? 'text-ink-faint' : ''}>
                        <td class="py-1 pr-2">
                          {sep.label} <span class="text-ink-faint">{'★'.repeat(sep.weight)}</span>
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
              <Hint class="mt-2">
                Mean credit per criterion (0–1) among the applicants you chose to interview and among those you
                declined. A gap near zero means the criterion does not tell your picks from the rest; a negative gap
                means the ones you declined scored higher on it. The tool never changes a criterion or a weight from
                this — that is card 2, and yours.
              </Hint>
            </div>
          </div>
        )}
        {!calibration.enough && (
          <Hint class="mt-1">
            Decisions are the one thing the tool never writes (ADR 0047); {MIN_DECISIONS} of them, with a To interview and a
            Declined among them, are enough for the first reading. The CSV and Markdown carry it too.
          </Hint>
        )}
      </Card>
      <Hint class="mt-3">
        Created {formatRelative(screening.createdAt)}. Names are shown to you only — the model saw "Applicant №N".
        "Priority to talk to" means every gate passed; "Ask first" means one is unknown and the scorecard has the
        question. A failed gate is a fact about the posting's conditions, never a verdict on the person. A score
        with a small +N or −N beside it carries your own adjustment from the scorecard; the computed number is in
        its tooltip and in the export.
      </Hint>
      <style dangerouslySetInnerHTML={{ __html: RUN_BADGE_CSS + DISCLOSURE_CSS }} />
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
  const words = c.kind === 'impact' || c.kind === 'overall' ? c.label : criterionText(c) || c.label;
  return (
    <span
      class={`inline-flex min-w-0 max-w-[32rem] items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
        c.mode === 'gate' ? 'bg-warn/5 text-ink ring-warn/25' : c.mode === 'note' ? 'bg-surface-overlay text-ink-muted ring-line' : 'bg-surface-raised text-ink ring-line'
      }`}
      title={`${CRITERION_KIND_LABELS[c.kind]} · ${CRITERION_MODE_LABELS[c.mode].split(' — ')[0]}${c.source === 'you' ? ' · yours' : ''}`}
    >
      {c.mode === 'gate' && <span class="text-warn">gate</span>}
      <span class="min-w-0 truncate">{words}</span>
      {c.mode === 'scored' && <span class="shrink-0 text-ink-faint">{'★'.repeat(c.weight)}</span>}
      {c.mode === 'note' && <span class="text-ink-faint">note</span>}
    </span>
  );
};

const ModeSelect: FC<{ name: string; value: Criterion['mode'] }> = ({ name, value }) => (
  <Select name={name} aria-label="Mode" class="!py-1 text-[13px]">
    {CRITERION_MODES.map((m) => (
      <option value={m} selected={m === value}>
        {CRITERION_MODE_LABELS[m].split(' — ')[0]}
      </option>
    ))}
  </Select>
);

const WeightSelect: FC<{ name: string; value: number }> = ({ name, value }) => (
  <Select name={name} aria-label="Weight" class="!py-1 text-[13px]">
    {Array.from({ length: MAX_WEIGHT }, (_, i) => i + 1).map((w) => (
      <option value={w} selected={w === value}>
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
      <td class="py-2 pr-2 align-top whitespace-nowrap text-[13px] text-ink">{CRITERION_KIND_LABELS[c.kind]}</td>
      <td class="py-2 pr-2 align-top">
        {fixed ? (
          <span class="text-[13px] text-ink-muted">{c.label}</span>
        ) : (
          <Input type="text" name={`text_${c.id}`} value={criterionText(c)} maxlength="200" aria-label={`${CRITERION_KIND_LABELS[c.kind]} criterion`} title={CRITERION_KIND_HINTS[c.kind]} class="!py-1 text-[13px]" />
        )}
        {c.kind === 'custom' && (
          <label class="mt-1 inline-flex items-center gap-2 text-xs text-ink-muted">
            answered as
            <Select name={`answer_${c.id}`} aria-label="How this question is answered" class="!py-0.5 !text-xs">
              <option value="yesno" selected={c.spec.answer === 'yesno'}>
                yes / no
              </option>
              <option value="howmuch" selected={c.spec.answer === 'howmuch'}>
                how much
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
      <td class="py-2 pr-2 align-top text-xs text-ink-faint">{c.source === 'posting' ? 'the posting' : 'you'}</td>
      <td class="py-2 text-right align-top">
        <input type="checkbox" name={`remove_${c.id}`} value="1" aria-label={`Remove ${c.label}`} class="h-4 w-4 accent-accent" />
      </td>
    </tr>
  );
};

/** The step number in a card's title — the page reads top to bottom: position, criteria, applicants, results. */
const Step: FC<{ n: number }> = ({ n }) => (
  <span class="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-overlay text-[11px] font-semibold text-ink-muted ring-1 ring-inset ring-line">
    {n}
  </span>
);

/** A <summary> that reads as a button, with a chevron that turns when the block is open; the bare marker was missed. */
const DISCLOSURE =
  'inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-line bg-surface-raised px-2.5 py-1 text-[13px] font-medium text-ink hover:bg-surface-overlay list-none [&::-webkit-details-marker]:hidden';
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
const RUN_BADGE_CSS = `
  .run-badge { display: none; margin-right: .5rem; font-size: 11px; font-weight: 500; border-radius: 9999px; padding: 1px 8px; vertical-align: middle; }
  tr[data-run-state] .run-badge { display: inline-block; }
  tr[data-run-state="queued"] .run-badge { background: rgb(var(--surface-overlay)); color: rgb(var(--ink-muted)); }
  tr[data-run-state="scoring"] .run-badge { background: rgb(var(--violet) / .12); color: rgb(var(--violet)); }
  tr[data-run-state="scored"] .run-badge { background: rgb(var(--ok) / .12); color: rgb(var(--ok)); }
  /* While a row is in the run, the number beside the badge is its previous verdict — say so, or it reads as the new one. */
  tr[data-run-state] .score-now { color: rgb(var(--ink-faint)); font-weight: 400; }
  tr[data-run-state] .score-now::before { content: "was "; font-size: 11px; }
`;

const GroupRow: FC<{ tone: 'ok' | 'warn' | 'danger' | 'neutral'; label: string; count: number }> = ({ tone, label, count }) => (
  <tr class="bg-surface-overlay/60">
    <td colspan={10} class="px-3.5 py-1.5 text-xs font-medium sm:px-5">
      <Badge tone={tone}>{label}</Badge>
      <span class="ml-2 text-ink-faint">{count}</span>
    </td>
  </tr>
);

/** "Scoring… 2 of 5 — now reading №3, №4; 1 queued" — the same words screen.mjs paints on every poll. */
function progressText(run: ScreenRunState): string {
  const done = run.done + run.failed;
  const failed = run.failed > 0 ? ` (${run.failed} failed)` : '';
  const reading = run.inFlight.length > 0 ? ` — now reading ${run.inFlight.map((n) => `№${n}`).join(', ')}` : '';
  const queued = run.queued.length > 0 ? `; ${run.queued.length} queued` : '';
  return `Scoring… ${done} of ${run.total}${failed}${reading}${queued}. Each row says where it is; scored rows appear on refresh.`;
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

const RUN_BADGE: Record<Exclude<RowRunState, null>, string> = { queued: 'queued', scoring: 'scoring…', scored: 'scored — refresh for the new number' };

const ApplicantRow: FC<{ r: ApplicantRowView; screeningId: number; gates: string[]; run: ScreenRunState | null }> = ({ r, screeningId, gates, run }) => {
  const v = r.verdict && !r.stale ? r.verdict : null;
  const href = `/screen/${screeningId}/applicants/${r.id}`;
  const adjusted = v ? adjustedScore(v.score, r.adjustment) : null;
  const state = rowRunState(r.number, run);
  return (
    <Tr data-applicant={r.number} data-run-state={state ?? undefined}>
      <Td class="w-8 pr-0">
        <input type="checkbox" name="ids" value={r.id} aria-label={`Select applicant ${r.number}`} class="h-4 w-4 accent-accent" />
      </Td>
      <Td class="whitespace-nowrap tabular-nums text-ink-faint">№{r.number}</Td>
      <Td class="w-full max-w-0">
        <a href={href} class="font-medium text-ink hover:underline">
          {r.name ?? <span class="text-ink-muted">(no name found)</span>}
        </a>
        {r.sameAs !== null && (
          <span title="Same email, phone or near-identical text as that applicant — another document of theirs, scored on its own">
            <Badge tone="neutral" class="ml-1.5">
              also №{r.sameAs}
            </Badge>
          </span>
        )}
        {v?.injection && (
          <span title="The resume carried text addressed to an AI reader — see the scorecard">
            <Badge tone="danger" class="ml-1.5">
              steering text
            </Badge>
          </span>
        )}
        <div class="truncate text-xs text-ink-faint" title={r.file}>
          {r.file}
          {r.status !== 'ok' && r.note ? ` — ${r.note}` : ''}
          {r.stale && r.verdict ? ` — scored ${r.verdict.score} under an earlier rubric` : ''}
        </div>
        {/* Phone width leaves the name cell too narrow for a list; the scorecard has the same facts. */}
        {v && (v.standout.length > 0 || v.career.roles > 0) && (
          <details class="mt-0.5 hidden text-xs sm:block">
            <summary class="cursor-pointer truncate text-ink-muted" title={v.standout.length > 0 ? v.standout.map((f) => f.fact).join(' · ') : v.careerLine}>
              {v.standout.length > 0 ? v.standout.map((f) => f.fact).join(' · ') : `Career: ${v.careerLine}`}
            </summary>
            <ul class="mt-1 space-y-0.5 whitespace-normal text-ink-muted">
              {v.standout.map((f) => (
                <li>
                  {f.fact}
                  {f.quote && (
                    <>
                      {' — '}
                      <q class="text-ink-faint">{f.quote}</q>
                    </>
                  )}
                </li>
              ))}
              {v.career.roles > 0 && <li class="text-ink-faint">Career: {v.careerLine}. Read off the dates, never scored.</li>}
            </ul>
          </details>
        )}
      </Td>
      <Td class="whitespace-nowrap">
        {v ? (
          <span class="inline-flex gap-1.5 font-mono text-[13px]">
            {gates.map((g) => {
              const status = v.gates.find((x) => x.gate.toLowerCase() === g.toLowerCase())?.status ?? 'unknown';
              return (
                <span
                  title={`${g}: ${status}`}
                  class={status === 'pass' ? 'text-ok' : status === 'fail' ? 'text-danger' : 'text-warn'}
                >
                  {GATE_MARK[status]}
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
          {state ? RUN_BADGE[state] : ''}
        </span>
        {v ? (
          <span class="score-now font-semibold text-ink" title={v.cap !== null ? `capped at ${v.cap}` : undefined}>
            {adjusted}
            {v.cap !== null && <span class="text-ink-faint">*</span>}
            {r.adjustment !== 0 && (
              <span
                class={`ml-1 text-xs font-normal ${r.adjustment > 0 ? 'text-ok' : 'text-warn'}`}
                title={`Computed ${v.score}; your adjustment ${r.adjustment > 0 ? '+' : ''}${r.adjustment}${r.adjustmentNote ? ` — ${r.adjustmentNote}` : ''}`}
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
      <Td>{v ? <Badge tone={CONFIDENCE_TONE[v.confidence]}>{v.confidence}</Badge> : ''}</Td>
      <Td class="whitespace-nowrap text-right tabular-nums" title={v ? `${v.mustStrong} of ${v.mustTotal} shown in a role or in production — the rest on a skills line only` : undefined}>
        {v ? (
          <>
            {v.mustCovered} / {v.mustTotal}
            <span class="block text-xs text-ink-faint">{v.mustStrong} strong</span>
          </>
        ) : (
          ''
        )}
      </Td>
      <Td class="text-right tabular-nums" title={v && v.career.roles > 0 ? `Relevant years. Career: ${v.careerLine}` : undefined}>
        {v ? (v.years ?? '?') : ''}
      </Td>
      <Td class="text-ink-muted">{v ? (v.level ?? '?') : ''}</Td>
      <Td class="whitespace-nowrap">
        {r.status === 'ok' ? (
          <span class="flex items-center gap-2">
            <Select name="decision" form={`decision-${r.id}`} data-commit="submit" aria-label={`Decision for applicant ${r.number}`} class="min-w-[7.5rem] !py-1 text-[13px]">
              <option value="" selected={r.decision === null}>
                —
              </option>
              {DECISIONS.map((d) => (
                <option value={d} selected={r.decision === d}>
                  {DECISION_LABELS[d]}
                </option>
              ))}
            </Select>
            <noscript>
              <Button variant="ghost" size="sm" form={`decision-${r.id}`}>
                Save
              </Button>
            </noscript>
          </span>
        ) : (
          <span class="text-[13px] text-ink-faint">tick and Delete</span>
        )}
      </Td>
    </Tr>
  );
};
