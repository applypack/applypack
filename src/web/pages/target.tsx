/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Button, Card, FitBadge, Flash, Hint, SUBMIT_ONCE } from '../ui';
import type { FlashMessage } from '../flash';
import { fitTone, formatRelative, type Tone } from '../format';
import type { MatchWithResume } from '../../resume/store';
import { readActions, readHardRequirements, readKeywords, readRemovals } from '../../resume/prompts';
import { readBreakdown } from '../../resume/score';
import {
  ActionsBlock,
  ConfirmFacts,
  DeltaBox,
  HardRequirementsDigest,
  KeywordTable,
  MatchSignals,
  RemovalsBlock,
  ScoreBreakdownChips,
} from './resume-match-card';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';

/*
 * Resume match (targeted resume): job description with keyword highlights on
 * the left, the resume text in an editor on the right. Editing is local
 * (nothing is saved until "Save as new version"); highlights and the live
 * estimate re-render on every keystroke from /static/target-page.mjs. The AI
 * match (keywords, actions, removals) is the fixed frame the live score works
 * within — "Re-analyze with AI" sends the edited text back to Claude.
 *
 * Layout rule (external UX audit, docs/archive/applypack-resume-match-ux-refactor.md):
 * everything needed for a decision — score, hard-requirement gates, confirm
 * questions — sits above the tabs. The Suggestions tab pairs the advice
 * column with the editor, so clicking a suggestion selects its text in place
 * and the live estimate reacts without leaving the view.
 */

export interface TargetPageProps {
  job: { id: number; title: string; companyName: string; location: string; description: string };
  /** ephemeral = the hidden /target scratch resume: no versions, no saving. */
  resume: { id: number; name: string; version: number; ephemeral: boolean };
  match: MatchWithResume;
  matches: MatchWithResume[];
  /** Most recent earlier run of the same resume — the "vs last time" delta. */
  previous: MatchWithResume | null;
  /** The text the selected match analysed (not necessarily the resume's current text). */
  resumeText: string;
  flash?: FlashMessage | null;
}

/* Side by side is first and default (user pref); Suggestions keeps its
 * advice-beside-the-editor layout as the second tab. "Your resume" as a
 * separate tab is gone — the editor already shows in the first two tabs. */
const TABS = [
  { key: 'both', label: 'Side by side' },
  { key: 'changes', label: 'Suggestions' },
  { key: 'job', label: 'Job description' },
] as const;

/** How many analysis runs stay visible in the header; the rest fold away. */
const RECENT_RUNS = 2;

const SUMMARY_BUTTON =
  'inline-flex min-h-[32px] cursor-pointer list-none items-center rounded-md py-1.5 text-sm font-medium transition-colors duration-150';

/* Dropdown panels are in-flow on phones (an absolute panel overflows the 375px
 * viewport) and anchored from sm: up. Width clamp uses vw, not %: for an
 * absolute panel "100%" is the tiny summary button. */
const MENU_PANEL =
  'z-10 mt-2 w-80 max-w-[calc(100vw-4rem)] rounded-lg border border-line bg-surface-raised p-3 shadow-lg sm:absolute sm:right-0';

/** Stroke colour for the static AI-match ring. */
const AI_TONE: Record<Tone, string> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  danger: 'text-danger',
  violet: 'text-violet',
  neutral: 'text-ink-faint',
};

/** Score at which the card tells the user to stop polishing and apply. */
const READY_TO_APPLY = 85;

/** Same cutoffs as fitTone — the word next to the number, so colour never stands alone. */
function matchQuality(score: number): string {
  if (score >= READY_TO_APPLY) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'moderate';
  return 'weak';
}

export const TargetPage: FC<TargetPageProps> = ({
  job,
  resume,
  match,
  matches,
  previous,
  resumeText,
  flash,
}) => {
  const keywords = readKeywords(match.keywords);
  const actions = readActions(match.actions);
  const removals = readRemovals(match.removals);
  const hard = readHardRequirements(match.hardRequirements);
  const asks = keywords.filter((k) => k.status === 'ask_user');
  const highActions = actions.filter((a) => a.priority === 'high').length;
  const breakdown = readBreakdown(match.breakdown);
  const recent = matches.slice(0, RECENT_RUNS);
  const shownRuns = recent.some((m) => m.id === match.id)
    ? recent
    : [match, ...recent.slice(0, RECENT_RUNS - 1)];
  const olderRuns = matches.filter((m) => !shownRuns.some((s) => s.id === m.id));
  const clientData = {
    matchId: match.id,
    aiScore: match.matchScore,
    resumeText,
    jobText: job.description,
    keywords,
    actions,
    removals,
    // Fixed score parts for the live estimate; null on pre-ADR-0012 matches.
    // penalty rides along frozen: the flag texts were judged against the
    // analysed snapshot, so live typing must not re-derive the offset.
    scoring: breakdown
      ? { alignment: breakdown.alignment, redFlagCount: match.redFlags.length, penalty: breakdown.penalty }
      : null,
  };
  return (
    <Layout title={`Resume match · ${job.title}`} active="jobs">
      <div class="w-full">
      <nav aria-label="Breadcrumb" class="mb-1.5 flex items-center gap-1.5 text-[13px] text-ink-faint">
        <a href="/jobs" class="transition-colors duration-150 hover:text-ink">
          Jobs
        </a>
        <span aria-hidden="true">/</span>
        <a
          href={`/jobs/${job.id}#resume-match`}
          class="max-w-[18rem] truncate transition-colors duration-150 hover:text-ink"
          title={job.title}
        >
          {job.title}
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" class="font-medium text-ink-muted">
          Resume match
        </span>
      </nav>
      <Flash flash={flash}>
        {flash?.rerun && (
          <Button
            form="reanalyze-form"
            name="force"
            value="1"
            variant="secondary"
            size="sm"
            title="Spend a fresh resume-model call on the text in the editor"
          >
            Re-run anyway
          </Button>
        )}
      </Flash>

      <div class="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0 lg:min-w-[15rem] lg:shrink-0">
          <h1 class="text-xl font-semibold tracking-tight">Resume match</h1>
          <div class="mt-1 text-sm text-ink-muted">
            {job.companyName} · {job.title}
            {job.location ? ` · ${job.location}` : ''}
          </div>
        </div>
        <div class="flex flex-col gap-2 lg:items-end">
          <ul class="flex flex-wrap gap-2">
            {shownRuns.map((m) => (
              <RunChip m={m} currentId={match.id} jobId={job.id} />
            ))}
          </ul>
          {olderRuns.length > 0 && (
            <details>
              {/* list-none + own caret so the label can right-align and stay put when
                  the open box grows to the chips' width. */}
              <summary class="runs-toggle cursor-pointer list-none text-xs text-ink-faint transition-colors duration-150 hover:text-ink lg:text-right">
                {olderRuns.length} older runs
              </summary>
              <ul class="mt-2 flex flex-wrap gap-2 lg:justify-end">
                {olderRuns.map((m) => (
                  <RunChip m={m} currentId={match.id} jobId={job.id} />
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      <Card class="mb-4">
        {/* Proportional columns instead of a scattered flex row: score | why (owns
            the middle) | actions rail. The gates line spans the full width below. */}
        <div class="grid grid-cols-1 items-start gap-x-8 gap-y-4 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
          {/* Primary: the honest score — the AI rubric verdict. Static until Re-analyze. */}
          <div class="flex items-center gap-4">
            <svg viewBox="0 0 96 96" class="h-20 w-20 -rotate-90" aria-hidden="true">
              <circle cx="48" cy="48" r="40" fill="none" stroke="rgb(var(--line))" stroke-width="8" />
              <circle
                cx="48"
                cy="48"
                r="40"
                fill="none"
                stroke="currentColor"
                stroke-width="8"
                stroke-linecap="round"
                stroke-dasharray="251.3"
                stroke-dashoffset={String(251.3 - (251.3 * match.matchScore) / 100)}
                class={AI_TONE[fitTone(match.matchScore)]}
              />
            </svg>
            <div>
              <div class="text-3xl font-semibold tabular-nums tracking-tight text-ink">
                {match.matchScore}
                <span class="text-base font-normal text-ink-faint">/100</span>
              </div>
              <div class="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
                AI match ·{' '}
                <span class={AI_TONE[fitTone(match.matchScore)]}>{matchQuality(match.matchScore)}</span>
                <span id="ai-stale" hidden class="font-medium text-warn">
                  edited — Re-analyze to refresh
                </span>
              </div>
              {/* Which resume/version is named by the pane header and the run chips —
                  repeating it here was pure duplication. */}
              <div class="mt-0.5 text-xs text-ink-faint">
                {match.draft ? 'draft · ' : ''}analyzed {formatRelative(match.createdAt)}
              </div>
              {match.matchScore >= READY_TO_APPLY && (
                <div class="mt-1 text-[13px] font-medium text-ok">
                  Ready to apply — stop polishing, send it.
                </div>
              )}
            </div>
          </div>

          {/* Why this score: the stack verdict + the deterministic components. */}
          <div class="min-w-0 space-y-1.5">
            <p class="text-sm leading-6 text-ink">{match.summary}</p>
            {breakdown && <ScoreBreakdownChips bd={breakdown} />}
            {(actions.length > 0 || removals.length > 0) && (
              <button
                type="button"
                data-goto-tab="changes"
                class="cursor-pointer text-left text-[13px] font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
              >
                {actions.length} suggested edits
                {highActions > 0 ? ` (${highActions} high)` : ''}
                {removals.length > 0 ? ` · ${removals.length} removals` : ''}
                {' →'}
              </button>
            )}
          </div>

          {/* Right rail: actions on top, the live estimate below while editing. */}
          <div class="flex flex-col gap-3 lg:items-end">
            <div class="flex flex-wrap items-center gap-2">
            {/* One visible action — a fresh file is how a better match usually happens.
                Re-analyze and Save live in the ⋯ menu; the sticky bar resurfaces them while editing.
                data-menu opts into light dismiss (outside click / Escape) in target-page.mjs. */}
            <details class="relative" data-menu>
              <summary class={`${SUMMARY_BUTTON} bg-accent-strong px-3 text-white shadow-sm hover:bg-accent-deep`}>
                Re-upload resume
              </summary>
              <div class={MENU_PANEL}>
                <div class="text-[13px] font-medium text-ink">
                  {resume.ephemeral ? 'Upload another resume' : 'Upload new resume version'}
                </div>
                <form
                  method="post"
                  action={`/jobs/${job.id}/target/reupload`}
                  enctype="multipart/form-data"
                  class="mt-2 space-y-2"
                  onsubmit={SUBMIT_ONCE}
                >
                  <input type="hidden" name="resumeId" value={resume.id} />
                  <input
                    type="file"
                    name="file"
                    required
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    class="block w-full text-xs text-ink file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink"
                  />
                  <Button size="sm" class="w-full">
                    {resume.ephemeral ? 'Upload & re-analyze' : `Upload v${resume.version + 1} & re-analyze`}
                  </Button>
                  <Hint>
                    {resume.ephemeral
                      ? 'Replaces this comparison with a fresh analysis — nothing lands in your Resumes (~2 min).'
                      : 'New version and AI match — about 2 minutes; the resume scan runs in the background.'}
                  </Hint>
                </form>
              </div>
            </details>
            <details class="relative" data-menu>
              <summary
                aria-label="More actions"
                class={`${SUMMARY_BUTTON} border border-line-strong bg-surface-raised px-2.5 shadow-sm hover:bg-surface-overlay`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4 text-ink" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </summary>
              <div class={`${MENU_PANEL} space-y-2`}>
                <form method="post" action={`/jobs/${job.id}/match`} id="reanalyze-form" onsubmit={SUBMIT_ONCE}>
                  <input type="hidden" name="resumeId" value={resume.id} />
                  <input type="hidden" name="draftText" id="reanalyze-text" value="" />
                  <input type="hidden" name="next" value="target" />
                  <Button variant="violet" class="w-full" title="Sends the text in the editor to the resume model (~2 min)">
                    Re-analyze with AI
                  </Button>
                </form>
                {!resume.ephemeral && (
                  <form
                    method="post"
                    action={`/resumes/${resume.id}/draft`}
                    id="save-form"
                    onsubmit={SUBMIT_ONCE}
                  >
                    <input type="hidden" name="text" id="save-text" value="" />
                    <input type="hidden" name="jobId" value={job.id} />
                    <Button
                      variant="secondary"
                      class="w-full"
                      id="save-button"
                      disabled
                      title="Enabled once you edit the text"
                    >
                      Save as v{resume.version + 1}
                    </Button>
                  </form>
                )}
              </div>
            </details>
            </div>

            {/* Appears only while the text differs from the analyzed version. */}
            <div id="live-est" hidden class="lg:max-w-[280px] lg:text-right">
              <div class="flex items-center gap-2 text-[13px] font-medium text-ink-muted lg:justify-end">
                {breakdown ? 'Estimate after your edits' : 'Keyword coverage after edits'}
                <span id="live-delta" class="text-xs font-medium"></span>
              </div>
              <div class="mt-1 flex items-center gap-2.5 lg:justify-end">
                <span id="score-value" class="text-lg font-semibold tabular-nums text-warn">
                  —
                </span>
                <span class="h-1.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <span id="score-bar" class="block h-full rounded-full bg-warn" style="width:0%"></span>
                </span>
              </div>
              <div id="score-detail" class="mt-0.5 text-xs text-ink-faint">
                {keywords.length} keywords from the AI match
              </div>
              <Hint class="mt-1">
                {breakdown
                  ? 'Same formula as the AI score, live as you type — "can\'t claim" terms never count. Re-analyze to make it official.'
                  : 'Keywords only, live as you type. Re-analyze to get the full score.'}
              </Hint>
            </div>
          </div>

          {hard.length > 0 && (
            <div class="border-t border-line pt-3 lg:col-span-3">
              <HardRequirementsDigest hard={hard} />
            </div>
          )}
        </div>
      </Card>

      {asks.length > 0 && (
        <Card class="mb-4">
          <ConfirmFacts asks={asks} matchId={match.id} back={`/jobs/${job.id}/target?match=${match.id}`} />
        </Card>
      )}

      <div class="mb-3 flex flex-wrap items-center gap-3">
        <div
          class="inline-flex rounded-md border border-line bg-surface-overlay p-0.5"
          role="tablist"
          aria-label="View"
        >
          {TABS.map((t) => (
            <button
              type="button"
              role="tab"
              data-tab={t.key}
              aria-selected={t.key === 'both'}
              class="tab cursor-pointer rounded-[5px] px-3 py-1 text-[13px] text-ink-muted transition-colors duration-150 hover:text-ink aria-selected:bg-surface-raised aria-selected:font-medium aria-selected:text-ink aria-selected:shadow-sm"
            >
              {t.label}
            </button>
          ))}
        </div>
        <label class="ml-auto inline-flex min-h-[28px] cursor-pointer items-center gap-1.5 text-xs text-ink-faint">
          <input id="show-matched" type="checkbox" checked class="h-3.5 w-3.5 accent-accent" />
          show matched highlights
        </label>
      </div>

      <div id="panes" class="show-matched grid gap-4 lg:grid-cols-2" data-view="both">
        <Card class="pane-job">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="text-[13px] font-medium text-ink">Job description</div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span><mark class="kw-found rounded px-1">matched</mark></span>
              <span><mark class="kw-missing rounded px-1">missing</mark></span>
              <span><mark class="kw-ask rounded px-1">confirm</mark></span>
              <span><mark class="kw-cannot rounded px-1">no evidence</mark></span>
            </div>
          </div>
          <div
            id="jd"
            class="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink-muted"
          ></div>
        </Card>

        <Card class="pane-resume">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="text-[13px] font-medium text-ink">
              Your resume · {resume.name}
              {resume.ephemeral ? '' : ` v${match.resumeVersion}`}
            </div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span><mark class="kw-present rounded px-1">matched</mark></span>
              <span><mark class="edit-change rounded px-1">change</mark></span>
              <span><mark class="edit-remove rounded px-1">remove</mark></span>
              <button
                type="button"
                id="reset-edits"
                class="cursor-pointer text-ink-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
              >
                reset edits
              </button>
            </div>
          </div>
          <div id="missing-chips" class="mb-3 flex flex-wrap gap-1.5"></div>
          <div class="editor relative h-[70vh] overflow-hidden rounded-md border border-line-strong bg-surface-raised">
            <div id="backdrop" class="editor-layer" aria-hidden="true"></div>
            <textarea
              id="editor"
              class="editor-layer"
              spellcheck={false}
              aria-label="Resume text (editable, not saved)"
            ></textarea>
          </div>
          <Hint class="mt-2">
            {resume.ephemeral
              ? 'Plain text — what an ATS parser sees. Edits stay in this browser tab until you Re-analyze. Click a suggestion to select the text it targets.'
              : 'Plain text — what an ATS parser sees. Edits stay in this browser tab until you Re-analyze or Save. Click a suggestion to select the text it targets.'}
          </Hint>
        </Card>

        <div class="pane-changes">
          <Card>
            <div class="space-y-5">
              <DeltaBox match={match} previous={previous} />
              <ActionsBlock actions={actions} jumpable />
              <RemovalsBlock removals={removals} jumpable />
              <MatchSignals match={match} />
              <KeywordTable keywords={keywords} />
            </div>
          </Card>
        </div>
      </div>

      <div id="dirty-bar" hidden class="sticky bottom-3 z-20 mt-4">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-warn/40 bg-surface-raised px-4 py-2.5 shadow-lg">
          <div class="min-w-0">
            <span class="text-sm font-medium text-ink" aria-live="polite">
              Unsaved changes
            </span>
            <span class="ml-2 text-xs text-ink-faint">
              kept in this browser tab{resume.ephemeral ? '' : ' until you save'}
            </span>
          </div>
          <span class="text-sm font-medium tabular-nums text-ink">
            Estimate <span id="bar-score">—</span>
            <span id="bar-delta" class="ml-1 text-xs font-medium"></span>
          </span>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" id="bar-discard">
              Discard
            </Button>
            <Button variant="violet" size="sm" form="reanalyze-form">
              Re-analyze with AI
            </Button>
            {!resume.ephemeral && (
              <Button
                variant="secondary"
                size="sm"
                form="save-form"
                title="Saves a text version, re-scans and re-analyzes (~2 min)"
              >
                Save as v{resume.version + 1}
              </Button>
            )}
          </div>
        </div>
      </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: TARGET_CSS }} />
      <script id="target-data" type="application/json" dangerouslySetInnerHTML={{ __html: safeJson(clientData) }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: TARGET_BOOT }} />
    </Layout>
  );
};

const RunChip: FC<{ m: MatchWithResume; currentId: number; jobId: number }> = ({
  m,
  currentId,
  jobId,
}) => (
  <li>
    <a
      href={`/jobs/${jobId}/target?match=${m.id}`}
      aria-current={m.id === currentId ? 'true' : undefined}
      class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors duration-150 ${
        m.id === currentId
          ? 'border-accent/50 bg-accent/5 text-ink'
          : 'border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink'
      }`}
    >
      <FitBadge score={m.matchScore} label="AI match" />
      {m.resume.name}
      <span class="font-mono text-ink-faint">v{m.resumeVersion}</span>
      {m.draft && <Badge tone="violet">draft</Badge>}
      <span class="text-ink-faint">{formatRelative(m.createdAt)}</span>
    </a>
  </li>
);

/** JSON inside a <script> must not contain "</script"; escaping "<" keeps it inert. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const TARGET_CSS = `
  mark { color: inherit; border-radius: 4px; }
  .kw-found, .kw-present { background: rgb(var(--ok) / 0.18); }
  .kw-missing { background: rgb(var(--warn) / 0.22); }
  .kw-ask { background: rgb(var(--violet) / 0.16); box-shadow: inset 0 0 0 1px rgb(var(--violet) / 0.4); }
  .kw-cannot { background: rgb(var(--ink-faint) / 0.2); text-decoration: line-through; }
  .edit-remove { background: rgb(var(--danger) / 0.15); text-decoration: line-through; }
  .edit-change { background: rgb(var(--warn) / 0.1); box-shadow: inset 0 0 0 1px rgb(var(--warn) / 0.55); }
  /* Matched highlights are opt-in inside the panes; issue marks always show.
     The legend samples above the panes keep their colour either way. */
  #jd .kw-found, #backdrop .kw-present { background: transparent; }
  #panes.show-matched #jd .kw-found, #panes.show-matched #backdrop .kw-present { background: rgb(var(--ok) / 0.18); }
  .editor-layer {
    position: absolute; inset: 0; margin: 0; padding: 16px; overflow: auto;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.6;
    white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; tab-size: 4;
  }
  #backdrop { color: rgb(var(--ink)); pointer-events: none; overflow: hidden; }
  #editor { background: transparent; color: transparent; caret-color: rgb(var(--ink)); border: 0; outline: none; resize: none; }
  #editor::selection { background: rgb(var(--accent) / 0.25); }
  #panes[data-view="job"] .pane-resume, #panes[data-view="job"] .pane-changes,
  #panes[data-view="both"] .pane-changes,
  #panes[data-view="changes"] .pane-job { display: none; }
  #panes[data-view="job"] .pane-job { grid-column: 1 / -1; }
  /* Suggestions view: advice column left, editor right; the editor card stays
     in sight while the (longer) advice column scrolls. */
  #panes[data-view="changes"] .pane-changes { order: -1; }
  @media (min-width: 1024px) {
    #panes[data-view="changes"] .pane-resume { position: sticky; top: 0.75rem; align-self: start; }
  }
  .chip { cursor: pointer; }
  .runs-toggle::-webkit-details-marker { display: none; }
  .runs-toggle::before { content: '▸ '; }
  details[open] > .runs-toggle::before { content: '▾ '; }
  .flash-target { animation: flash-target 1.2s ease-out; }
  @keyframes flash-target { from { background: rgb(var(--accent) / 0.25); } to { background: transparent; } }
`;

/* The page logic lives in /static/target-page.mjs so it is served, cached and
 * importable from node:test; this inline snippet only boots it with the data. */
const TARGET_BOOT = `
import { init } from '/static/target-page.mjs';
init(JSON.parse(document.getElementById('target-data').textContent));
`;
