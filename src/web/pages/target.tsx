/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Button, Card, FitBadge, Flash, Hint, SUBMIT_ONCE } from '../ui';
import type { FlashMessage } from '../flash';
import { fitTone, formatRelative, type Tone } from '../format';
import type { MatchWithResume } from '../../resume/store';
import type { CountedKeyword } from '../../resume/keyword-matcher';
import { effectiveKeywords } from '../../resume/keyword-overrides';
import { readActions, readHardRequirements, readRemovals } from '../../resume/prompts';
import { readMatchMode } from '../../resume/match-mode';
import { readBreakdown } from '../../resume/score';
import {
  ActionsBlock,
  ChangeSheetButton,
  ConfirmFacts,
  DeltaBox,
  HardRequirementsDigest,
  KeywordTable,
  MatchSignals,
  RemovalsBlock,
  ScoreBreakdownChips,
  SuggestionsPrompt,
} from './resume-match-card';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';

/*
 * Resume match (targeted resume): job description with keyword highlights on
 * the left, the resume text in an editor on the right. Editing is local
 * (nothing is saved until "Save as new version"); highlights and the live
 * estimate re-render on every keystroke from /static/target-page.mjs. The AI
 * match (keywords, actions, removals) is the fixed frame the live score works
 * within — "Re-check with AI" sends the edited text back to Claude.
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
  /** The match's keywords, ordered and counted against the posting (§5). */
  keywords: CountedKeyword[];
  matches: MatchWithResume[];
  /** Most recent earlier run of the same resume — the "vs last time" delta. */
  previous: MatchWithResume | null;
  /** The text the selected match analysed (not necessarily the resume's current text). */
  resumeText: string;
  /** An instant check's parsed upload — opens in the editor as the unsaved draft (target-page.mjs). */
  draftText?: string | null;
  flash?: FlashMessage | null;
  /** What a Save can do with this resume's file — one sentence (docx-structure.ts, ADR 0038). */
  fileVerdict: string;
  /** Where the clean re-render lives, when this file is one a Save cannot fully write (ADR 0039). */
  cleanHref?: string | null;
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
  keywords,
  matches,
  previous,
  resumeText,
  draftText,
  fileVerdict,
  cleanHref,
  flash,
}) => {
  // The panes, the chips and the live score work from the effective list: the
  // user's own levels, without the terms they ignored (§5). The table below
  // still gets the full list, so an ignored row can be brought back.
  const scored = effectiveKeywords(keywords);
  const actions = readActions(match.actions);
  const removals = readRemovals(match.removals);
  const hard = readHardRequirements(match.hardRequirements);
  const asks = scored.filter((k) => k.status === 'ask_user');
  const highActions = actions.filter((a) => a.priority === 'high').length;
  // A quick check has no suggestions yet — the tab offers the second call instead (ADR 0029).
  const fast = readMatchMode(match.breakdown) === 'fast';
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
    draftText: draftText ?? null,
    jobText: job.description,
    keywords: scored,
    actions,
    removals,
    // Fixed score parts for the live estimate; null on pre-ADR-0012 matches.
    // penalty rides along frozen: the flag texts were judged against the
    // analysed snapshot, so live typing must not re-derive the offset.
    scoring: breakdown
      ? { alignment: breakdown.alignment, redFlagCount: match.redFlags.length, penalty: breakdown.penalty }
      : null,
    // Heads "Copy my changes"; the suggestion sheet is rendered server-side.
    sheet: { jobTitle: job.title, companyName: job.companyName, resumeName: resume.name },
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
            // Repeats the comparison the user asked for, not the form's default.
            onclick={`document.getElementById('reanalyze-form').elements.mode.value='${flash.mode === 'full' ? 'full' : 'fast'}'`}
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
            the middle, never under 14rem — the rail grows while editing) | actions
            rail. The gates line spans the full width below. */}
        <div class="grid grid-cols-1 items-start gap-x-8 gap-y-4 lg:grid-cols-[auto_minmax(14rem,1fr)_auto]">
          {/* Primary: the honest score — the AI rubric verdict. Static until a re-check. */}
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
              {/* Wraps: the stale marker must not widen this auto column and squeeze the summary. */}
              <div class="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink-muted">
                AI match ·{' '}
                <span class={AI_TONE[fitTone(match.matchScore)]}>{matchQuality(match.matchScore)}</span>
                <span id="ai-stale" hidden class="font-medium text-warn">
                  edited — re-check to refresh
                </span>
              </div>
              {/* Which resume/version is named by the pane header and the run chips —
                  repeating it here was pure duplication. */}
              <div class="mt-0.5 text-xs text-ink-faint">
                {match.draft ? 'draft · ' : ''}
                {fast ? 'quick check' : 'full analysis'} {formatRelative(match.createdAt)}
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
            {(fast || actions.length > 0 || removals.length > 0) && (
              <button
                type="button"
                data-goto-tab="changes"
                class="cursor-pointer text-left text-[13px] font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
              >
                {fast ? (
                  'Keywords only — get edit suggestions'
                ) : (
                  <>
                    {actions.length} suggested edits
                    {highActions > 0 ? ` (${highActions} high)` : ''}
                    {removals.length > 0 ? ` · ${removals.length} removals` : ''}
                  </>
                )}
                {' →'}
              </button>
            )}
          </div>

          {/* Right rail: actions on top, the live estimate below while editing. */}
          <div class="flex flex-col gap-3 lg:items-end">
            <div class="flex flex-wrap items-center gap-2">
            {/* One visible action — a fresh file is how a better match usually happens.
                Re-check and Save live in the ⋯ menu; the sticky bar resurfaces them while editing.
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
                  <input type="hidden" name="matchId" value={match.id} />
                  {/* Set by the second button's click, not by the submitter's value: SUBMIT_ONCE
                      disables the buttons in the submit event, and a disabled submitter is left
                      out of the form data. */}
                  <input type="hidden" name="uploadMode" value="check" />
                  <input
                    type="file"
                    name="file"
                    required
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    class="block w-full text-xs text-ink file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink"
                  />
                  <Button size="sm" class="w-full" title="Parses the file into the editor and scores it against this analysis — no AI call">
                    Upload & check (seconds)
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    class="w-full"
                    onclick="this.form.elements.uploadMode.value='analyze'"
                    title={
                      resume.ephemeral
                        ? 'Replaces this comparison with a fresh quick AI check (~½ min)'
                        : `Saves the file as v${resume.version + 1} and runs the quick AI check (~½ min); the scan runs in the background`
                    }
                  >
                    {resume.ephemeral ? 'Upload & check with AI' : `Upload as v${resume.version + 1} & check with AI`}
                  </Button>
                  <Hint>
                    Check opens the new text as an unsaved draft scored against this analysis: the text confirms
                    what is present, while add / confirm / can't-claim keep the AI's verdict on the analysed
                    version until you re-check.{' '}
                    {resume.ephemeral
                      ? 'Nothing lands in your Resumes either way.'
                      : `Nothing is saved — Save as v${resume.version + 1} keeps the text, not the file.`}
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
                  {/* Set by the full-analysis and Rebuild buttons' clicks — a disabled submitter is left out of the form data. */}
                  <input type="hidden" name="mode" value="fast" />
                  <input type="hidden" name="rebuild" value="" />
                  <Button variant="violet" class="w-full" title="Re-scores the text in the editor: keywords, gates and the number (~½ min on Opus)">
                    Re-check with AI
                  </Button>
                  <Button
                    variant="secondary"
                    class="mt-2 w-full"
                    onclick="this.form.elements.mode.value='full'"
                    title="The same check plus fresh edit suggestions (~2 min on Opus)"
                  >
                    Full analysis with suggestions
                  </Button>
                </form>
                {/* The Compare page's scratch resume has no versions, so it saves one
                    way only: as a resume of its own (issue: a pasted posting, an
                    uploaded resume, an hour of edits and nowhere to put them). */}
                <form
                  method="post"
                  action={`/resumes/${resume.id}/draft`}
                  id="save-form"
                  onsubmit={SUBMIT_ONCE}
                >
                    <input type="hidden" name="text" id="save-text" value="" />
                    <input type="hidden" name="jobId" value={job.id} />
                    {/* The text the edits started from: the patcher diffs against it (ADR 0038). */}
                    <input type="hidden" name="baseText" value={resumeText} />
                    {/* Set by the copy buttons' click: SUBMIT_ONCE disables the submitter in the
                        submit event, and a disabled submitter is left out of the form data. */}
                    <input type="hidden" name="as" value="" />
                    <Button
                      variant="primary"
                      class="w-full"
                      onclick="this.form.elements.as.value='copy'"
                      data-save-button
                      disabled
                      title={
                        resume.ephemeral
                          ? 'Enabled once you edit the text — keeps this one-off check as a resume of its own, named after the company, on /resumes (~1 min)'
                          : 'Enabled once you edit the text — saves a new resume beside this one, named after the company, and leaves this one as it is; a .docx is patched in place when its layout allows (~1 min)'
                      }
                    >
                      {resume.ephemeral ? 'Save as a new resume' : 'Save as a tailored copy'}
                    </Button>
                    {!resume.ephemeral && (
                    <Button
                      variant="secondary"
                      class="mt-2 w-full"
                      id="save-button"
                      onclick="this.form.elements.as.value=''"
                      data-save-button
                      disabled
                      title={`Enabled once you edit the text — saves it as v${resume.version + 1} of this resume, re-scans and re-checks (~1 min)`}
                    >
                      Save as v{resume.version + 1}
                    </Button>
                    )}
                  </form>
              </div>
            </details>
            </div>

            {/* Appears only while the text differs from the analyzed version. */}
            <div id="live-est" hidden class="lg:max-w-[280px] lg:text-right">
              <div class="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink-muted lg:justify-end">
                {breakdown ? `Estimate vs the analysis from ${formatRelative(match.createdAt)}` : 'Keyword coverage after edits'}
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
                {scored.length} keywords from the AI match
              </div>
              <Hint class="mt-1">
                {breakdown
                  ? "Same formula as the AI score, live as you type — the text confirms what is present; add / confirm / can't-claim keep the AI's verdict on the analysed version. Re-check to make it official."
                  : 'Keywords only, live as you type. Re-check to get the full score.'}
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
              {/* The intensity key: same colour, graded by how hard the posting asks. */}
              <span class="inline-flex items-center gap-1">
                weight
                <mark class="kw-missing kw-w4 rounded px-1">must</mark>
                <mark class="kw-missing kw-w2 rounded px-1">preferred</mark>
                <mark class="kw-missing kw-w1 rounded px-1">nice</mark>
              </span>
            </div>
          </div>
          <div
            id="jd"
            class="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink-muted"
          ></div>
          <Hint class="mt-2">
            Highlights follow the AI's keyword list — benefits, perks and legal boilerplate are
            deliberately never keywords. The stronger a mark, the harder the posting asks; hover one
            to see how often it says the word. Re-level or ignore any of them in the keyword table.
          </Hint>
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
                id="expand-editor"
                class="cursor-pointer text-ink-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline lg:hidden"
                aria-expanded="false"
              >
                expand editor
              </button>
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
          <Hint class="mb-2">
            {fileVerdict}
            {cleanHref && (
              <>
                {' '}
                <a href={cleanHref} class="text-accent underline underline-offset-2 hover:no-underline">
                  Clean version in your typeface →
                </a>
              </>
            )}
          </Hint>
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
              ? 'Plain text — what an ATS parser sees. Edits stay in this browser tab until you re-check. Locate on a suggestion outlines the text it targets.'
              : 'Plain text — what an ATS parser sees. Edits stay in this browser tab until you re-check or Save. Locate on a suggestion outlines the text it targets.'}
          </Hint>
        </Card>

        <div class="pane-changes">
          <Card>
            <div class="space-y-5">
              <DeltaBox match={match} previous={previous} />
              {fast ? (
                <SuggestionsPrompt matchId={match.id} jobId={job.id} next="target" />
              ) : (
                <>
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <ChangeSheetButton
                        job={{ title: job.title, companyName: job.companyName }}
                        resumeName={resume.name}
                        actions={actions}
                        removals={removals}
                      />
                      <Button type="button" variant="secondary" size="sm" id="copy-edits" disabled>
                        Copy my changes
                      </Button>
                    </div>
                    <Hint class="mt-1.5">
                      Markdown, for the document your resume really lives in. The second one is the
                      diff of your own edits and turns on once you change the text.
                    </Hint>
                  </div>
                  <ActionsBlock actions={actions} interactive />
                  <RemovalsBlock removals={removals} interactive />
                </>
              )}
              <MatchSignals match={match} />
              {/* Wide screens open it on boot (target-page.mjs); narrow ones keep
                  it shut, because it is the longest block on the page by far. */}
              <details class="kw-fold">
                <summary class="cursor-pointer text-[13px] font-medium text-ink-muted">
                  Keyword coverage — {keywords.length} terms
                </summary>
                <div class="mt-3">
              <KeywordTable
                keywords={keywords}
                edit={
                  breakdown
                    ? { jobId: job.id, matchId: match.id, back: `/jobs/${job.id}/target?match=${match.id}` }
                    : undefined
                }
                // Through the editor's own form, so a rebuild judges the text on
                // screen — the same call Re-check makes, minus the stored frame.
                rebuild={{ jobId: job.id, resumeId: resume.id, mode: fast ? 'fast' : 'full', formId: 'reanalyze-form' }}
              />
                </div>
              </details>
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
              Re-check with AI
            </Button>
            <Button
              variant="primary"
              size="sm"
              form="save-form"
              onclick="document.getElementById('save-form').elements.as.value='copy'"
              title={resume.ephemeral ? 'Keeps this one-off check as a resume of its own on /resumes' : 'A new resume beside this one, named after the company; this one stays as it is'}
            >
              {resume.ephemeral ? 'Save as a new resume' : 'Save as a tailored copy'}
            </Button>
            {!resume.ephemeral && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  form="save-form"
                  onclick="document.getElementById('save-form').elements.as.value=''"
                  title={`Saves the text as v${resume.version + 1} of this resume, re-scans and re-checks (~1 min)`}
                >
                  Save as v{resume.version + 1}
                </Button>
              </>
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
  /* Visual weight (target-plan.md §5). jobSpans tags every mark kw-w0 (context)
     … kw-w4 (a primary-stack must), so a gap the posting insists on can never
     look like a gap it merely mentions. The base rules above are the preferred
     tier; only the problem marks are graded — a matched word is matched. */
  .kw-missing.kw-w3 { background: rgb(var(--warn) / 0.34); box-shadow: inset 0 0 0 1px rgb(var(--warn) / 0.6); }
  .kw-missing.kw-w4 { background: rgb(var(--warn) / 0.42); box-shadow: inset 0 0 0 1.5px rgb(var(--warn) / 0.85); font-weight: 600; }
  .kw-missing.kw-w1, .kw-missing.kw-w0 { background: rgb(var(--warn) / 0.1); }
  .kw-ask.kw-w3, .kw-ask.kw-w4 { background: rgb(var(--violet) / 0.24); box-shadow: inset 0 0 0 1.5px rgb(var(--violet) / 0.7); }
  .kw-ask.kw-w1, .kw-ask.kw-w0 { background: rgb(var(--violet) / 0.1); box-shadow: none; }
  .kw-cannot.kw-w1, .kw-cannot.kw-w0 { background: rgb(var(--ink-faint) / 0.12); text-decoration-color: rgb(var(--ink-faint) / 0.5); }
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
  /* A grid item defaults to min-width:auto, so it is sized by its widest
     content — which made the keyword table's own overflow-x-auto wrapper
     497px wide inside a 375px column and pushed the page sideways. */
  #panes > * { min-width: 0; }
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
  /* Locate: the outline says "here", and it fades on its own so it never
     becomes permanent furniture. It is never the ONLY signal — the card
     prints the line number beside the button. */
  .located { outline: 2px solid rgb(var(--accent) / 0.9); outline-offset: 1px; border-radius: 3px; animation: located-fade 2s ease-out forwards; }
  @keyframes located-fade { from { background: rgb(var(--accent) / 0.3); } to { background: transparent; } }
  @media (prefers-reduced-motion: reduce) {
    .located { animation: none; }
  }
  .kw-fold > summary::-webkit-details-marker { display: none; }
  .kw-fold > summary::before { content: '▸ '; }
  .kw-fold[open] > summary::before { content: '▾ '; }
  @media (max-width: 1023px) {
    /* The editor is what the user is here to change, so it comes first and
       starts short; the advice column below it is the long read. */
    #panes[data-view="changes"] .pane-changes { order: 0; }
    #panes .editor { height: 40vh; }
    #panes.editor-tall .editor { height: 75vh; }
  }
  /* The Button primitive is inline-flex, which outranks the user agent's
     [hidden] { display: none } — without this, every card's Undo button is
     visible from the first paint. */
  #panes [hidden] { display: none !important; }
  /* A card that has been applied or skipped steps back without disappearing —
     it is still the record of what was suggested, and Undo lives on it. */
  .card-done { opacity: 0.55; }
  .card-done:hover, .card-done:focus-within { opacity: 1; }
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
import { wireSelectCommits } from '/static/select-commit.mjs';
init(JSON.parse(document.getElementById('target-data').textContent));
wireSelectCommits(document);
`;
