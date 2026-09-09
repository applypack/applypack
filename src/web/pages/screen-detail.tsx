/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Checkbox, Empty, Field, FILE_INPUT_CLASS, Flash, Hint, Input, PageHeader, SectionTitle, Select, SUBMIT_ONCE, Table, Td, Textarea, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDateShort, formatRelative } from '../format';
import { DEFAULT_WEIGHTS, RUBRIC_PART_LABELS, RUBRIC_PARTS, SCREEN_LEVEL_LABELS, SCREEN_LEVELS, rubricSummary, type Rubric } from '../../screening/rubric';
import { GATE_BUCKET_LABELS, type ConfidenceBand, type GateBucket } from '../../screening/score';
import { GATE_MARK, DECISION_LABELS } from '../../screening/export';
import { MAX_APPLICANTS_PER_SCREENING, MAX_BATCH_UPLOAD_MB, MAX_FILES_PER_UPLOAD } from '../../screening/intake';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import type { ScreenRunState } from '../../screening/batch';
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
  };
  rubric: Rubric;
  rows: ApplicantRowView[];
  run: ScreenRunState | null;
  /** Readable applicants without a verdict under the current rubric. */
  pending: number;
  /** Which engine the calls go to, and the warning when it is not one fit for other people's data. */
  engine: { label: string; warn: string | null };
  retentionDays: number;
  flash?: FlashMessage | null;
}

const CONFIDENCE_TONE: Record<ConfidenceBand, 'ok' | 'warn' | 'neutral'> = { high: 'ok', medium: 'neutral', low: 'warn' };
const BUCKET_TONE: Record<GateBucket, 'ok' | 'warn' | 'danger'> = { pass: 'ok', ask: 'warn', fail: 'danger' };

export const ScreenDetailPage: FC<ScreenDetailProps> = ({ screening, rubric, rows, run, pending, engine, retentionDays, flash }) => {
  const groups = groupRows(rows);
  const readable = rows.filter((r) => r.status === 'ok').length;
  const running = run?.running ?? false;
  const rubricEmpty = rubric.gates.length === 0 && rubric.must.length === 0 && rubric.nice.length === 0;
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
              confirm="Delete this screening with every applicant file and verdict? This cannot be undone."
            >
              <Button variant="danger" size="sm">
                Delete with files
              </Button>
            </ActionForm>
          </div>
        }
      >
        Position:{' '}
        <a href={`/jobs/${screening.job.id}`} class="text-ink hover:underline">
          {screening.job.title}
        </a>{' '}
        · {screening.job.companyName}
        {screening.job.location ? ` · ${screening.job.location}` : ''}. The order below is a priority to talk to,
        read off each resume against the rubric; every mark has its quote on the scorecard, and the decision column
        is yours alone.
      </PageHeader>
      <Flash flash={flash} />

      {engine.warn && (
        <div class="mb-4 rounded-md border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
          {engine.warn}
        </div>
      )}

      {/* 1. The rubric — open until the first run, a one-line summary after. */}
      <Card class="mb-4">
        <details open={!scoredAny || rubricEmpty}>
          <summary class="cursor-pointer list-none">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <SectionTitle>What this screen checks</SectionTitle>
              <span class="text-[13px] text-ink-faint">
                {rubricEmpty ? 'empty — write it below' : rubricSummary(rubric)} · rubric v{screening.rubricVersion}
              </span>
            </div>
          </summary>
          {rubricEmpty && (
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Hint>The posting could not be read into a draft. Write the gates and the must-have terms yourself, or read the posting again.</Hint>
              <ActionForm action={`/screen/${screening.id}/rubric/redraft`} once>
                <Button variant="secondary" size="sm">
                  Read the posting again
                </Button>
              </ActionForm>
            </div>
          )}
          <form method="post" action={`/screen/${screening.id}/rubric`} class="mt-4 space-y-4">
            <div class="grid gap-4 lg:grid-cols-2">
              <Field
                label="Gates — pass / unknown / fail, never points"
                hint="One per line. A failed gate puts the applicant in its own bucket; an unknown one becomes an interview question."
              >
                <Textarea name="gates" rows={5}>
                  {rubric.gates.join('\n')}
                </Textarea>
              </Field>
              <div class="grid gap-4 sm:grid-cols-2">
                <Field label="Level the posting hires at">
                  <Select name="level">
                    <option value="" selected={rubric.level === null}>
                      Not stated
                    </option>
                    {SCREEN_LEVELS.map((l) => (
                      <option value={l} selected={rubric.level === l}>
                        {SCREEN_LEVEL_LABELS[l]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Minimum relevant years">
                  <Input type="number" name="yearsMin" min="0" max="40" value={rubric.yearsMin ?? ''} placeholder="none" />
                </Field>
                <Field label="Sector" hint="Empty = not scored.">
                  <Input type="text" name="domain" maxlength="120" value={rubric.domain ?? ''} placeholder="fintech, e-commerce, healthtech…" />
                </Field>
                <div class="flex items-end pb-1.5">
                  <Checkbox name="educationRequired" checked={rubric.educationRequired}>
                    A degree or certificate is required
                  </Checkbox>
                </div>
              </div>
            </div>
            <div class="grid gap-4 lg:grid-cols-3">
              <Field label="Must-have skills" hint="Comma- or line-separated. Each is read at an evidence level: production, in a role, a project, a skills line, absent.">
                <Textarea name="must" rows={6}>
                  {rubric.must.map((t) => t.term).join('\n')}
                </Textarea>
              </Field>
              <Field label="Core stack" hint="The 2–5 must-haves the day-to-day code is written in. None of them anywhere in a resume caps its score at 30.">
                <Textarea name="core" rows={6}>
                  {rubric.must.filter((t) => t.primary).map((t) => t.term).join('\n')}
                </Textarea>
              </Field>
              <Field label="Nice-to-have skills" hint="Worth 5 points together by default.">
                <Textarea name="nice" rows={6}>
                  {rubric.nice.map((t) => t.term).join('\n')}
                </Textarea>
              </Field>
            </div>
            <details class="rounded-md border border-line bg-surface-overlay/50 px-3.5 py-2.5">
              <summary class="cursor-pointer text-[13px] font-medium text-ink">Weights — how the 100 points split</summary>
              <div class="mt-3 grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {RUBRIC_PARTS.map((p) => (
                  <Field label={RUBRIC_PART_LABELS[p]}>
                    <Input type="number" name={`weight_${p}`} min="0" max="100" value={rubric.weights[p]} />
                  </Field>
                ))}
              </div>
              <Hint class="mt-2">
                Relative, so they need not sum to 100 (the defaults do: {RUBRIC_PARTS.map((p) => DEFAULT_WEIGHTS[p]).join(' / ')}).
                A part the posting gives nothing to compare — no level, no sector, no education — weighs nothing,
                whatever its number.
              </Hint>
            </details>
            <div class="flex flex-wrap items-center gap-3">
              <Button>Save the rubric</Button>
              <Hint>
                A change to the yardstick makes every stored score stale — the table says so and "Score" reads
                everyone again.
              </Hint>
            </div>
          </form>
        </details>
      </Card>

      {/* 2. Applicants in. */}
      <Card class="mb-4">
        <SectionTitle>Applicants</SectionTitle>
        <form
          method="post"
          action={`/screen/${screening.id}/applicants`}
          enctype="multipart/form-data"
          class="flex flex-wrap items-center gap-3"
          data-needs-file
          onsubmit={SUBMIT_ONCE}
        >
          <input
            type="file"
            name="files"
            multiple
            accept={[...ACCEPTED_EXTENSIONS, '.zip'].join(',')}
            aria-label="Resume files or a zip"
            class={`text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
          />
          <Button variant="secondary">Add applicants</Button>
        </form>
        <Hint class="mt-2">
          {ACCEPTED_EXTENSIONS.join(' / ')} files or a .zip of them — up to {MAX_FILES_PER_UPLOAD} files and{' '}
          {MAX_BATCH_UPLOAD_MB} MB per upload, {MAX_APPLICANTS_PER_SCREENING} applicants per screening. Before any
          model reads a file, the name, contacts, links, date of birth, age, family, gender, citizenship, street and
          graduation years are removed; a scanned PDF with no text layer and a second copy of the same person are
          kept in the list unscored, so you can see them.
        </Hint>
      </Card>

      {/* 3. Score and the table. */}
      <Card flush id="results">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div>
            <SectionTitle>Results</SectionTitle>
            <div class="text-[13px] text-ink-faint" id="run-progress" data-screening={screening.id} data-running={running ? '1' : undefined}>
              {running
                ? `Scoring… ${run!.done + run!.failed} of ${run!.total}${run!.failed > 0 ? ` (${run!.failed} failed)` : ''} — one call per applicant, three at a time; the page updates itself.`
                : run && run.finishedAt !== null && run.failed > 0
                  ? `Last run: ${run.done} scored, ${run.failed} failed${run.lastError ? ` — ${run.lastError}` : ''}. Failed ones stay pending; press Score again.`
                  : pending > 0
                    ? `${pending} of ${readable} readable applicant${readable === 1 ? '' : 's'} not scored under rubric v${screening.rubricVersion}.`
                    : readable > 0
                      ? `All ${readable} readable applicant${readable === 1 ? '' : 's'} scored under rubric v${screening.rubricVersion} on ${engine.label}.`
                      : 'Add applicants above.'}
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
          <Table
            columns={['#', 'Name', 'Gates', 'Score', 'Confidence', 'Must-have', 'Years', 'Level', 'Flags', 'Decision']}
            hideBelow={['', '', 'sm', '', 'md', 'lg', 'lg', 'lg', 'xl', '']}
            thClasses={['', '', '', 'text-right', '', 'text-right', 'text-right', '', 'text-right', '']}
          >
            {(['pass', 'ask', 'fail'] as GateBucket[]).map((bucket) => {
              const group = groups.scored.filter((r) => r.verdict!.bucket === bucket);
              if (group.length === 0) return null;
              return (
                <>
                  <GroupRow tone={BUCKET_TONE[bucket]} label={GATE_BUCKET_LABELS[bucket]} count={group.length} />
                  {group.map((r) => (
                    <ApplicantRow r={r} screeningId={screening.id} gates={rubric.gates} />
                  ))}
                </>
              );
            })}
            {groups.pending.length > 0 && (
              <>
                <GroupRow tone="neutral" label={running ? 'Being scored' : 'Not scored yet'} count={groups.pending.length} />
                {groups.pending.map((r) => (
                  <ApplicantRow r={r} screeningId={screening.id} gates={rubric.gates} />
                ))}
              </>
            )}
            {groups.unread.length > 0 && (
              <>
                <GroupRow tone="neutral" label="Could not be screened" count={groups.unread.length} />
                {groups.unread.map((r) => (
                  <ApplicantRow r={r} screeningId={screening.id} gates={rubric.gates} />
                ))}
              </>
            )}
          </Table>
        )}
      </Card>
      <Hint class="mt-3">
        Created {formatRelative(screening.createdAt)}. Names are shown to you only — the model saw "Applicant №N".
        "Priority to talk to" means every gate passed; "Ask first" means one is unknown and the scorecard has the
        question. A failed gate is a fact about the posting's conditions, never a verdict on the person.
      </Hint>
      <script
        type="module"
        dangerouslySetInnerHTML={{ __html: "import { init } from '/static/screen.mjs'; init();" }}
      />
    </Layout>
  );
};

const GroupRow: FC<{ tone: 'ok' | 'warn' | 'danger' | 'neutral'; label: string; count: number }> = ({ tone, label, count }) => (
  <tr class="bg-surface-overlay/60">
    <td colspan={10} class="px-3.5 py-1.5 text-xs font-medium sm:px-5">
      <Badge tone={tone}>{label}</Badge>
      <span class="ml-2 text-ink-faint">{count}</span>
    </td>
  </tr>
);

const ApplicantRow: FC<{ r: ApplicantRowView; screeningId: number; gates: string[] }> = ({ r, screeningId, gates }) => {
  const v = r.verdict && !r.stale ? r.verdict : null;
  const href = `/screen/${screeningId}/applicants/${r.id}`;
  return (
    <Tr>
      <Td class="tabular-nums text-ink-faint">№{r.number}</Td>
      <Td>
        <a href={href} class="font-medium text-ink hover:underline">
          {r.name ?? <span class="text-ink-muted">(no name found)</span>}
        </a>
        <div class="truncate text-xs text-ink-faint" title={r.file}>
          {r.file}
          {r.status !== 'ok' && r.note ? ` — ${r.note}` : ''}
          {r.stale && r.verdict ? ` — scored ${r.verdict.score} under an earlier rubric` : ''}
        </div>
      </Td>
      <Td>
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
      <Td class="text-right tabular-nums">
        {v ? (
          <span class="font-semibold text-ink" title={v.cap !== null ? `capped at ${v.cap}` : undefined}>
            {v.score}
            {v.cap !== null && <span class="text-ink-faint">*</span>}
          </span>
        ) : (
          <span class="text-ink-faint">—</span>
        )}
      </Td>
      <Td>{v ? <Badge tone={CONFIDENCE_TONE[v.confidence]}>{v.confidence}</Badge> : ''}</Td>
      <Td class="text-right tabular-nums">{v ? `${v.mustCovered} / ${v.mustTotal}` : ''}</Td>
      <Td class="text-right tabular-nums">{v ? (v.years ?? '?') : ''}</Td>
      <Td class="text-ink-muted">{v ? (v.level ?? '?') : ''}</Td>
      <Td class="text-right tabular-nums">
        {v && v.injection && (
          <Badge tone="danger" class="mr-1">
            steering text
          </Badge>
        )}
        {v ? v.flags : ''}
      </Td>
      <Td>
        {r.status === 'ok' ? (
          <form method="post" action={`${href}/decision`} class="flex items-center gap-2">
            <input type="hidden" name="back" value={`/screen/${screeningId}#results`} />
            <Select name="decision" data-commit="submit" aria-label={`Decision for applicant ${r.number}`} class="!py-1 text-[13px]">
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
              <Button variant="ghost" size="sm">
                Save
              </Button>
            </noscript>
          </form>
        ) : (
          <ActionForm action={`${href}/delete`} confirm="Remove this file from the screening?">
            <Button variant="ghost" size="sm">
              Remove
            </Button>
          </ActionForm>
        )}
      </Td>
    </Tr>
  );
};
