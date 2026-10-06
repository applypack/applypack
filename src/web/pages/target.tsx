/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Button, Card, FitBadge, Flash, Hint, HistoryChip, More, SUBMIT_ONCE, TONE_TEXT, When } from '../ui';
import type { FlashMessage } from '../flash';
import { FIT_OK_FLOOR, fitTone } from '../format';
import type { MatchWithResume } from '../../resume/store';
import type { CountedKeyword } from '../../resume/keyword-matcher';
import type { VerificationForHint } from '../../resume/verification-hint';
import { effectiveKeywords, confirmable } from '../../resume/keyword-overrides';
import { DENIED_NOTE, UNSURE_NOTE } from '../../resume/facts';
import { readActions, readHardRequirements, readRemovals } from '../../resume/prompts';
import { readMatchEvidence, readMatchMode } from '../../resume/match-mode';
import { notEnglishNotice } from '../../text-language';
import { readBreakdown } from '../../resume/score';
import { mainAdvice, readyToApply } from '../score-lines';
import type { OrientationRow } from '../../resume/posting-orientation';
import type { SummaryGuide } from '../../resume/summary-guide';
import {
  ActionsBlock,
  ChangeSheetButton,
  ConfirmFacts,
  DeltaBox,
  HardRequirementsDigest,
  KeywordTable,
  MainAdviceLine,
  MatchSignals,
  reachOf,
  VerificationLine,
  RemovalsBlock,
  ScoreCeilingLine,
  SuggestionsPrompt,
} from './resume-match-card';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { jobHref } from '../job-tabs';

/*
 * Resume match (targeted resume): job description with keyword highlights on
 * the left, the resume text in an editor on the right. Editing is local
 * (nothing is saved until "Save as new version"); highlights and the live
 * estimate re-render on every keystroke from /static/target-page.mjs. The AI
 * match (keywords, actions, removals) is the fixed frame the live score works
 * within — "Analyse my resume again" sends the edited text back to Claude.
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
  /** What the posting itself said, when it did not say much (§17) — null when it did. */
  postingNotice?: string | null;
  /** The sectors differ (domain.ts) — one sentence, or nothing. */
  domainNotice?: string | null;
  /** What this posting is, from its own stored reading (posting-orientation.ts) — empty when it said nothing. */
  orientation?: OrientationRow[];
  /** What the first reader looks for in a summary, against the analysed text (summary-guide.ts). */
  summaryGuide?: SummaryGuide | null;
  /** The latest "Is this job real?" verdict — one line under the title, findings among the cautions (#162). */
  verification: VerificationForHint | null;
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


/** Score at which the card tells the user to stop polishing and apply — the `ok` tone's floor, one number in one place. */
const READY_TO_APPLY = FIT_OK_FLOOR;

/** The ring's circumference, 2πr for r=42 — the dash length the arc is cut from. */
const RING_LENGTH = 263.9;

export const TargetPage: FC<TargetPageProps> = ({
  job,
  resume,
  match,
  keywords,
  matches,
  previous,
  resumeText,
  postingNotice,
  domainNotice,
  orientation,
  summaryGuide = null,
  verification,
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
  // A file judged on its own text may not be the user's: its questions are not theirs to answer (TASKS R1).
  const { asks, unproven } = readMatchEvidence(match.breakdown) === 'text' ? { asks: [], unproven: [] } : confirmable(scored);
  const highActions = actions.filter((a) => a.priority === 'high').length;
  // A quick check has no suggestions yet — the tab offers the second call instead (ADR 0029).
  const fast = readMatchMode(match.breakdown) === 'fast';
  const breakdown = readBreakdown(match.breakdown);
  // The one move worth making next, ranked in code from the verdicts this row
  // already carries (score-lines.ts) — the editor is where it gets made.
  const advice = breakdown ? mainAdvice({ breakdown, keywords: scored, hard, actions }) : null;
  const recent = matches.slice(0, RECENT_RUNS);
  const shownRuns = recent.some((m) => m.id === match.id)
    ? recent
    : [match, ...recent.slice(0, RECENT_RUNS - 1)];
  const olderRuns = matches.filter((m) => !shownRuns.some((s) => s.id === m.id));
  const clientData = {
    matchId: match.id,
    resumeText,
    jobText: job.description,
    keywords: scored,
    // So a chip can tell the user's own "I don't" / "Not sure" from a term the model could not back.
    deniedNote: DENIED_NOTE,
    unsureNote: UNSURE_NOTE,
    actions,
    removals,
    // The score parts the live count holds fixed; null on pre-ADR-0012
    // matches. penalty rides along frozen: the flag texts were judged against
    // the analysed snapshot, so live typing must not re-derive the offset.
    scoring: breakdown
      ? { alignment: breakdown.alignment, redFlagCount: match.redFlags.length, penalty: breakdown.penalty }
      : null,
    // Heads "Copy my changes"; the suggestion sheet is rendered server-side.
    // The title also keeps the posting's own title off the skills lines (skillGaps).
    sheet: { jobTitle: job.title, companyName: job.companyName, resumeName: resume.name },
    // The document pane draws the draft through POST /resumes/:id/document.
    resumeId: resume.id,
    documentName: resume.name,
  };
  return (
    <Layout title={`Tailor resume · ${job.title}`} active="jobs">
      <div class="w-full" id="target-root">
      <nav aria-label="Breadcrumb" class="mb-1.5 flex items-center gap-1.5 text-note text-ink-faint">
        <a href="/jobs" class="transition-colors duration-150 hover:text-ink">
          Jobs
        </a>
        <span aria-hidden="true">/</span>
        <a
          href={jobHref(job.id, 'match', {}, 'resume-match')}
          class="max-w-[18rem] truncate transition-colors duration-150 hover:text-ink"
          title={job.title}
        >
          {job.title}
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" class="font-medium text-ink-muted">
          Tailor resume
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
          <h1 class="text-title text-ink">Tailor resume</h1>
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
              <summary class="runs-toggle cursor-pointer list-none text-meta text-ink-faint transition-colors duration-150 hover:text-ink lg:text-right">
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
      {verification && (
        <VerificationLine verification={verification} class="-mt-2 mb-4" href={jobHref(job.id, 'verify', {}, 'verification')} />
      )}

      <Card class="mb-4">
        {/* Proportional columns instead of a scattered flex row: score | why (owns
            the middle, never under 14rem — the rail grows while editing) | actions
            rail. The gates line spans the full width below. */}
        <div class="grid grid-cols-1 items-start gap-x-8 gap-y-4 lg:grid-cols-[auto_minmax(14rem,1fr)_auto]">
          {/* Primary: the honest score — the AI rubric verdict. The ring and
              nothing else. Everything that used to label it said something the
              page already said: "AI match" and the quality word restated the
              number, the draft marker and the age are on this run's own chip
              above, and "edited — analyse again" is what the sticky bar says
              in full the moment the text is dirty. Hovering the ring says what
              the number is. */}
          <div class="group relative w-28">
            <button
              type="button"
              id="score-ring"
              aria-describedby="score-help"
              aria-label={`Match score ${match.matchScore} of 100 — what this number is`}
              class="relative block cursor-help rounded-full"
            >
              <svg viewBox="0 0 96 96" class="h-28 w-28 -rotate-90" aria-hidden="true">
                <circle cx="48" cy="48" r="42" fill="none" stroke="rgb(var(--line))" stroke-width="7" />
                {/* Server-rendered at the stored score, then moved by
                    target-page.mjs on every edit — the script reads the dash
                    length off this attribute rather than repeating 2πr. */}
                <circle
                  id="score-arc"
                  cx="48"
                  cy="48"
                  r="42"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="7"
                  stroke-linecap="round"
                  stroke-dasharray={RING_LENGTH}
                  stroke-dashoffset={String(RING_LENGTH - (RING_LENGTH * match.matchScore) / 100)}
                  class={`transition-[stroke-dashoffset] duration-300 ${TONE_TEXT[fitTone(match.matchScore)]}`}
                />
              </svg>
              {/* The number alone. "/100" is in the sentence the ring shows
                  on hover, and in the button's own label for a screen reader —
                  it does not need to sit inside the dial as well. */}
              <span
                id="score-number"
                class="absolute inset-0 flex items-center justify-center text-kpi leading-none tabular-nums text-ink"
                aria-hidden="true"
              >
                {match.matchScore}
              </span>
            </button>
            {/* The live number for a screen reader: the button's aria-label
                changes with the score, and a changed label on an unfocused
                element announces nothing (audit 2026-09-10, A11Y-2). */}
            <span id="score-live" class="sr-only" aria-live="polite"></span>
            {/* Kept in the accessibility tree (opacity, not `hidden`) so
                aria-describedby has something to read on focus. */}
            <div
              id="score-help"
              role="tooltip"
              class="pointer-events-none absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-3rem)] space-y-1.5 rounded-lg border border-line bg-surface-raised p-3 text-meta leading-5 text-ink-muted opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <p>
                <span class="font-medium text-ink">Match score, 0–100.</span> How well this resume answers
                this posting: the words it asks for, whether you have its core stack, and how your title,
                summary and most recent role read at a glance.
              </p>
              <p data-ui="hint" class="text-ink-faint">
                It moves as you edit: every word is counted live, whatever the last analysis called it.
                What a word search cannot read — how your title and summary read, the red flags — stays as
                the last analysis judged it, so run “Analyse my resume again” once the text is settled.
              </p>
            </div>
          </div>

          {/* The verdict in the model's own sentence, then the two things a
              reader does something with: how high editing can take this, and
              whether it is already there. The rubric's own breakdown — what
              made the number, what it does not count — is off this page for
              now; it is still on the /jobs match card. */}
          <div class="min-w-0 space-y-1.5">
            <p class="text-sm leading-6 text-ink">{match.summary}</p>
            <MainAdviceLine advice={advice} />
            {breakdown && <ScoreCeilingLine bd={breakdown} />}
            {/* The number alone used to decide this, so "stop polishing" sat
                above three suggested edits, five removals and an unconfirmed
                hard requirement on a live 100/100. A score is not a verdict
                while something is still open (web/score-lines.ts). */}
            {breakdown &&
              readyToApply({
                breakdown,
                keywords: scored,
                hard,
                score: match.matchScore,
                threshold: READY_TO_APPLY,
                edits: actions.length + removals.length,
              }) && (
                <p class="text-note font-medium text-ok">Ready to apply — stop polishing, send it.</p>
              )}
            {(fast || actions.length > 0 || removals.length > 0) && (
              <button
                type="button"
                data-goto-tab="changes"
                class="cursor-pointer text-left text-note font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
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
            {/* The one-click path: every suggestion written into the text, then
                the Suggestions view, where the document shows the result.
                Hidden until the script has counted what it can do. */}
            {!fast && (actions.length > 0 || removals.length > 0) && (
              <div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-apply-all
                  data-goto-tab="changes"
                  hidden
                  title="Writes every suggestion the gate let through, the removals and the missing keywords your resume backs into the text — nothing is saved until you download or save"
                >
                  {/* One span: the button is a flex row, and its gap would stand between the words and the count. */}
                  <span>Apply all suggestions (<span data-apply-all-count>0</span>)</span>
                </Button>
              </div>
            )}
          </div>

          {/* Right rail: actions on top, the live estimate below while editing. */}
          <div class="flex flex-col gap-3 lg:items-end">
            <div class="flex flex-wrap items-center gap-2">
            {/* A fresh file is the other way to a better match. Outlined: the
                card's one solid button is Apply all. Analyse and Save live in
                the ⋯ menu; the sticky bar resurfaces them while editing.
                data-menu opts into light dismiss (outside click / Escape) in target-page.mjs. */}
            <details class="relative" data-menu>
              <summary class={`${SUMMARY_BUTTON} border border-line-strong bg-surface-raised px-3 text-ink shadow-sm hover:bg-surface-overlay`}>
                Re-upload resume
              </summary>
              <div class={MENU_PANEL}>
                <div class="text-label text-ink">
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
                  <input
                    type="file"
                    name="file"
                    required
                    aria-label="Resume file"
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    class="block w-full text-meta text-ink file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-meta file:font-medium file:text-ink"
                  />
                  <Button size="sm" class="w-full" title="Compares this file against the posting and opens the result here">
                    Compare this file
                  </Button>
                  <Hint>
                    A new comparison against this posting, with fresh suggestions — the posting itself is already
                    analysed, so only the resume is judged. The result opens here with its own score; this one stays
                    under "older runs".
                    {resume.ephemeral ? ' Nothing is added to your Resumes.' : ` Your resume is untouched until you Save as v${resume.version + 1}.`}
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
                {/* One AI action. There used to be two — a quick check and a full
                    analysis — and the only reliable way to tell them apart was to
                    read both tooltips. The editor's job is "judge this text and
                    tell me what to change", which is the full one. */}
                <form method="post" action={`/jobs/${job.id}/match`} id="reanalyze-form" onsubmit={SUBMIT_ONCE}>
                  <input type="hidden" name="resumeId" value={resume.id} />
                  <input type="hidden" name="matchId" value={match.id} />
                  <input type="hidden" name="draftText" id="reanalyze-text" value="" />
                  <input type="hidden" name="next" value="target" />
                  <input type="hidden" name="mode" value="full" />
                  {/* Set by the Rebuild button's click — a disabled submitter is left out of the form data. */}
                  <input type="hidden" name="rebuild" value="" />
                  <Button variant="violet" class="w-full" title="Judges the text in the editor against this posting and rewrites the suggestions">
                    Analyse my resume again
                  </Button>
                </form>
                {/* One save, and only for a resume of the user's own: the next
                    version of it. This page compares — it does not manage
                    resumes, and every extra "save as…" here ended up as another
                    row on /resumes that nobody asked for. A one-off check from
                    the Tailor resume page saves nothing at all: its text belongs to
                    this comparison, which keeps its own snapshot. */}
                {!resume.ephemeral && (
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
                    <Button
                      variant="primary"
                      class="w-full"
                      data-save-button
                      disabled
                      title={`Enabled once you edit the text — saves it as v${resume.version + 1} of this resume: your .docx with the edits written in, or the clean version the Document view shows (~1 min)`}
                    >
                      Save as v{resume.version + 1}
                    </Button>
                  </form>
                )}
              </div>
            </details>
            </div>

            {/* No second score here: a keyword edit re-scores the stored row
                server-side (routes/keywords.ts), so the ring itself moves, and
                the sticky bar carries the estimate while the text is dirty. */}
          </div>

          {/* Who is asking, before how well the words answer. The same stack is
              wanted by a radio network and a clinic, and the evidence each
              wants of it is not the same — every line here is a field the
              posting's own reading already wrote (ADR 0044). */}
          {orientation !== undefined && orientation.length > 0 && (
            <div class="border-t border-line pt-3 lg:col-span-3">
              <div class="text-label text-ink-muted">About this posting</div>
              <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-note leading-6">
                {orientation.map((row) => (
                  <>
                    <dt class="text-ink-faint">{row.label}</dt>
                    <dd class="min-w-0 text-ink">{row.text}</dd>
                  </>
                ))}
              </dl>
            </div>
          )}
          {postingNotice && (
            <div class="border-t border-line pt-3 lg:col-span-3">
              <p class="text-note leading-6 text-ink-muted">
                <span class="font-medium text-warn">Thin posting.</span> {postingNotice}
              </p>
            </div>
          )}
          {domainNotice && (
            <div class="border-t border-line pt-3 lg:col-span-3">
              <p class="text-note leading-6 text-ink-muted">
                <span class="font-medium text-info">Another sector.</span> {domainNotice}
              </p>
            </div>
          )}
          {hard.length > 0 && (
            <div class="border-t border-line pt-3 lg:col-span-3">
              <HardRequirementsDigest hard={hard} />
            </div>
          )}
        </div>
      </Card>

      {(asks.length > 0 || unproven.length > 0) && (
        <Card class="mb-4">
          <ConfirmFacts
            asks={asks}
            unproven={unproven}
            matchId={match.id}
            back={`/jobs/${job.id}/target?match=${match.id}`}
          />
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
              id={`view-tab-${t.key}`}
              data-tab={t.key}
              aria-controls="panes"
              aria-selected={t.key === 'both'}
              tabindex={t.key === 'both' ? 0 : -1}
              class="tab cursor-pointer rounded-[5px] px-3 py-1 text-note text-ink-muted transition-colors duration-150 hover:text-ink aria-selected:bg-surface-raised aria-selected:font-medium aria-selected:text-ink aria-selected:shadow-sm"
            >
              {t.label}
            </button>
          ))}
        </div>
        <label class="ml-auto inline-flex min-h-[28px] cursor-pointer items-center gap-1.5 text-meta text-ink-faint">
          <input id="show-matched" type="checkbox" checked class="h-3.5 w-3.5 accent-accent" />
          show matched highlights
        </label>
      </div>

      <div id="panes" class="show-matched grid gap-4 lg:grid-cols-2" data-view="both" role="tabpanel" aria-labelledby="view-tab-both">
        <Card class="pane-job">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="text-label text-ink">Job description</div>
            <div class="flex flex-wrap items-center gap-2 text-meta text-ink-faint">
              {/* One axis, four colours: green is a word you already have, and
                  every other colour is a gap graded by how hard the posting
                  asks for it. The old legend named four AI statuses and then
                  graded a fifth key by weight in the same hue — "add the word"
                  and "missing" were the same news to a reader, and the grey
                  strikethrough on a required term read as "ignore this". */}
              <mark class="kw-have rounded px-1">in your resume</mark>
              <mark class="kw-gap kw-must rounded px-1">must add</mark>
              <mark class="kw-gap kw-preferred rounded px-1">preferred</mark>
              <mark class="kw-gap kw-nice rounded px-1">nice to have</mark>
              <mark class="kw-gap kw-preferred kw-unproven rounded px-1">no evidence yet</mark>
            </div>
          </div>
          <div
            id="jd"
            class="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink-muted"
          ></div>
          <Hint class="mt-2">
            A dashed underline means nothing in your resume backs the word yet — write it in where
            it is true and it counts, or confirm it below.
          </Hint>
          <More class="mt-1">
            The number reads your text, not our guess about you. Benefits and equal-opportunity text
            stay unmarked on purpose: nobody is screened on them.
          </More>
        </Card>

        <Card class="pane-resume">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-3">
              <div class="text-label text-ink">
                Your resume · {resume.name}
                {resume.ephemeral ? '' : ` v${match.resumeVersion}`}
              </div>
              {/* The document is drawn by a script, so the switch appears with it. */}
              <div
                id="resume-views"
                hidden
                class="inline-flex rounded-md border border-line bg-surface-overlay p-0.5"
                role="group"
                aria-label="Show the resume as"
              >
                {(['doc', 'text'] as const).map((v) => (
                  <button
                    type="button"
                    data-resume-view={v}
                    aria-pressed={v === 'doc' ? 'true' : 'false'}
                    class="cursor-pointer rounded-[5px] px-2.5 py-0.5 text-note text-ink-muted transition-colors duration-150 hover:text-ink aria-pressed:bg-surface-raised aria-pressed:font-medium aria-pressed:text-ink aria-pressed:shadow-sm"
                  >
                    {v === 'doc' ? 'Document' : 'Plain text'}
                  </button>
                ))}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-meta text-ink-faint">
              <span data-text-only><mark class="kw-present rounded px-1">matched</mark></span>
              <span data-text-only><mark class="edit-change rounded px-1">change</mark></span>
              <span data-text-only><mark class="edit-remove rounded px-1">remove</mark></span>
              <span data-doc-only hidden><mark class="doc-changed-sample rounded px-1">changed</mark></span>
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
          {/* Every keyword the text does not spell, in one list, ticked where the
              resume already backs it — one press instead of one chip at a time.
              Filled by target-page.mjs, which hides it while nothing is missing. */}
          <details id="kw-bulk" hidden class="mb-3 rounded-md border border-line bg-surface-overlay/60 px-3 py-2">
            <summary class="cursor-pointer text-note font-medium text-ink">
              Add missing keywords to your skills (<span data-kw-bulk-count>0</span>)
            </summary>
            <Hint class="mt-1">
              Ticked are the ones your resume already backs. An unticked one has nothing behind it in your resume yet —
              tick it only if it is true. Each goes on the skills line it belongs to; what no line can take gets a line of
              its own.
            </Hint>
            <ul id="kw-bulk-list" class="mt-2 grid gap-1 sm:grid-cols-2"></ul>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" variant="primary" size="sm" id="kw-bulk-add">
                Add keywords
              </Button>
              <span id="kw-bulk-status" class="text-meta text-ink-muted" role="status"></span>
            </div>
          </details>
          {/* The draft as the file it would be: the user's own .docx with the
              edits written in, or the clean version of a PDF — drawn from the
              same text the plain view edits (public/doc-pane.mjs). */}
          <div id="doc-view" hidden>
            <p id="doc-notice" class="mb-2 text-note leading-6 text-ink-muted" hidden></p>
            <div
              id="doc-pane"
              class="doc-pane editor h-[70vh] overflow-auto rounded-md border border-line-strong bg-surface-overlay"
              role="region"
              aria-label="Your resume as a document — click a paragraph to edit it"
            ></div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" data-download="docx" title="The document as drawn above — nothing is saved">
                Download .docx
              </Button>
              <Button type="button" variant="secondary" size="sm" data-download="pdf" title="The document as drawn above — nothing is saved">
                Download .pdf
              </Button>
              <span id="doc-status" class="text-meta text-ink-faint" role="status"></span>
            </div>
            <Hint class="mt-1">
              Click a paragraph to change its words; Enter keeps the change, Escape puts it back. A formula is changed in
              Plain text. The downloads are this document as it stands — nothing is saved until you save a version.
            </Hint>
          </div>
          <div id="text-view">
          <Hint class="mb-2">
            {fileVerdict}
            {cleanHref && (
              <>
                {' '}
                <a href={cleanHref} class="text-accent-strong underline underline-offset-2 hover:no-underline">
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
              ? 'Plain text — what an ATS parser sees. Edits stay in this browser tab until you re-check.'
              : 'Plain text — what an ATS parser sees. Edits stay in this browser tab until you re-check or Save.'}
            {readMatchEvidence(match.breakdown) === 'text' &&
              ' Judged on its own text: your confirmed facts and other resumes were left out, since it may not be yours.'}
          </Hint>
          </div>
          {notEnglishNotice(job.description) && <Hint class="mt-1">{notEnglishNotice(job.description)}</Hint>}
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
                      {/* The same call that wrote them, over the same verdicts:
                          the advice changes, the score does not. */}
                      <form
                        method="post"
                        action={`/jobs/${job.id}/matches/${match.id}/suggestions`}
                        onsubmit={SUBMIT_ONCE}
                      >
                        <input type="hidden" name="next" value="target" />
                        <input type="hidden" name="rewrite" value="1" />
                        <Button variant="ghost" size="sm" title="Writes the whole list again from the same verdicts — the score stays (~1 min)">
                          Rewrite all
                        </Button>
                      </form>
                    </div>
                    <Hint class="mt-1.5">
                      Both are Markdown. The second is the diff of your own edits and turns on once
                      you change the text.
                    </Hint>
                  </div>
                  <ApplyAllBar removals={removals.filter((r) => r.quote).length} />
                  <ActionsBlock
                    actions={actions}
                    interactive
                    rewrite={{ jobId: job.id, matchId: match.id, next: 'target' }}
                    reach={reachOf(breakdown, match.matchScore)}
                    summaryGuide={summaryGuide}
                  />
                  <RemovalsBlock removals={removals} interactive />
                </>
              )}
              <MatchSignals match={match} verification={verification} />
              {/* Wide screens open it on boot (target-page.mjs); narrow ones keep
                  it shut, because it is the longest block on the page by far. */}
              <details class="kw-fold">
                <summary class="cursor-pointer text-note font-medium text-ink-muted">
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
                // screen — the same call the analyse button makes, minus the stored frame.
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
            <span class="text-sm font-medium text-ink">Unsaved changes</span>
            {/* A live region whose text never changed announced nothing; this one is written when the bar appears. */}
            <span id="dirty-live" class="sr-only" aria-live="polite"></span>
            <span class="ml-2 text-meta text-ink-faint">
              kept in this browser tab{resume.ephemeral ? ' — copy them out before you leave' : ' until you save'}
            </span>
          </div>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" id="bar-discard">
              Discard
            </Button>
            <Button variant="violet" size="sm" form="reanalyze-form" title="Runs the whole analysis on the text as it stands now">
              Analyse my resume again
            </Button>
            {!resume.ephemeral && (
              <Button
                variant="primary"
                size="sm"
                form="save-form"
                title={`Saves the text as v${resume.version + 1} of this resume, re-scans and re-checks (~1 min)`}
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

/**
 * Apply all, beside the cards it acts on: the same press as the header's, the
 * removals as a choice (they cut text, the rest only adds or rewords), Undo
 * all, and the line that says what landed. The count is the script's — it is
 * the only one that knows which quotes the text still carries.
 */
const ApplyAllBar: FC<{ removals: number }> = ({ removals }) => (
  <div class="rounded-md border border-line bg-surface-overlay/60 p-3">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button type="button" variant="primary" size="sm" data-apply-all hidden>
        <span>Apply all (<span data-apply-all-count>0</span>)</span>
      </Button>
      {removals > 0 && (
        <label class="inline-flex min-h-[28px] cursor-pointer items-center gap-1.5 text-note text-ink-muted">
          <input id="apply-all-removals" type="checkbox" checked class="h-3.5 w-3.5 accent-accent" />
          include the {removals === 1 ? 'removal' : `${removals} removals`}
        </label>
      )}
      <Button type="button" variant="ghost" size="sm" id="undo-all" hidden>
        Undo all
      </Button>
      <span id="apply-all-status" class="text-note text-ink-muted" role="status"></span>
    </div>
    <Hint class="mt-1.5">
      Every wording the check let through, the removals and the missing keywords your resume backs, written into
      your resume below in one press. Nothing is saved until you download it or save a version; each card keeps
      its own Undo.
    </Hint>
  </div>
);

const RunChip: FC<{ m: MatchWithResume; currentId: number; jobId: number }> = ({
  m,
  currentId,
  jobId,
}) => (
  <li>
    <HistoryChip href={`/jobs/${jobId}/target?match=${m.id}`} current={m.id === currentId}>
      <FitBadge score={m.matchScore} label="match" />
      {m.resume.name}
      {!m.resume.hidden && <span class="font-mono font-normal text-ink-faint">v{m.resumeVersion}</span>}
      {m.draft && <Badge tone="neutral">draft</Badge>}
      <span class="font-normal text-ink-faint"><When at={m.createdAt} /></span>
    </HistoryChip>
  </li>
);

/** JSON inside a <script> must not contain "</script"; escaping "<" keeps it inert. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const TARGET_CSS = `
  mark { color: inherit; border-radius: 4px; }
  /* Keyword marks answer ONE question by colour: what does this word mean for
     me? Green — already in the resume. Red — the posting requires it and the
     resume has not got it. Amber — preferred. Slate — nice to have, or just
     context. Nothing in the posting is ever struck through: the previous
     scheme greyed out and crossed off the terms the resume showed no evidence
     for, which on a WordPress posting struck through the word "WordPress". */
  .kw-have, .kw-present { background: rgb(var(--ok) / 0.25); }
  .kw-gap.kw-must { background: rgb(var(--danger) / 0.16); color: rgb(var(--danger)); font-weight: 600; }
  /* The primary stack — the terms the score's cap is counting. Same red, louder. */
  .kw-gap.kw-must.kw-core { background: rgb(var(--danger) / 0.26); box-shadow: inset 0 0 0 1.5px rgb(var(--danger) / 0.7); }
  .kw-gap.kw-preferred { background: rgb(var(--warn) / 0.2); color: rgb(var(--warn)); }
  .kw-gap.kw-nice { background: rgb(var(--ink-faint) / 0.16); }
  /* The one modifier: nothing in the resume backs this word, so writing it in
     would be a claim rather than an edit. It rides on top of the level colour
     instead of replacing it — the posting still wants the term as hard as it
     ever did, whether or not the candidate can offer it. */
  .kw-unproven { text-decoration: underline dashed; text-decoration-thickness: 1px; text-underline-offset: 3px; }
  .edit-remove { background: rgb(var(--danger) / 0.15); text-decoration: line-through; }
  .edit-change { background: rgb(var(--warn) / 0.1); box-shadow: inset 0 0 0 1px rgb(var(--warn) / 0.55); }
  /* Matched highlights are opt-in inside the panes; issue marks always show.
     The legend samples above the panes keep their colour either way. */
  #jd .kw-have, #backdrop .kw-present { background: transparent; }
  #panes.show-matched #jd .kw-have, #panes.show-matched #backdrop .kw-present { background: rgb(var(--ok) / 0.25); }
  .editor-layer {
    position: absolute; inset: 0; margin: 0; padding: 16px; overflow: auto;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.6;
    white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; tab-size: 4;
  }
  #backdrop { color: rgb(var(--ink)); pointer-events: none; overflow: hidden; }
  #editor { background: transparent; color: transparent; caret-color: rgb(var(--ink)); border: 0; outline: none; resize: none; }
  #editor::selection { background: rgb(var(--accent) / 0.25); }
  /* The id selector above outranks the global :focus-visible ring, and the
     page's main control had no visible focus but its caret (audit
     2026-09-10, A11Y-1). */
  #editor:focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: -2px; border-radius: 4px; }
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
     [hidden] { display: none } — without this, every card's Undo button (and
     Apply all before the script counts what it can do) is visible from the
     first paint. */
  #target-root [hidden] { display: none !important; }
  /* The document pane. The sheet is paper whatever the theme; docx-preview's
     grey wrapper gives way to the dashboard's surface, and its own shadow to
     ours. The stage is where a drawing settles (tab stops) before it swaps in. */
  .doc-stage { position: fixed; left: -20000px; top: 0; width: 1000px; visibility: hidden; pointer-events: none; }
  #doc-pane .docx-wrapper { background: transparent; padding: 16px; }
  /* docx-preview hyphenates every paragraph; Word does not unless the file asks. */
  #doc-pane section.docx { hyphens: manual; }
  #doc-pane .docx-wrapper > section.docx { box-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 8px 24px -8px rgb(0 0 0 / 0.18); margin-bottom: 16px; color: #000; }
  #doc-pane section.docx article p { cursor: text; border-radius: 2px; }
  #doc-pane section.docx article p:hover { box-shadow: 0 0 0 1px rgb(var(--accent) / 0.35); }
  #doc-pane .doc-changed, .doc-changed-sample { background: rgb(var(--accent) / 0.12); box-shadow: -3px 0 0 rgb(var(--accent) / 0.7); }
  #doc-pane .doc-editing { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; background: rgb(var(--accent) / 0.06); }
  .doc-page-guide { position: absolute; left: 0; right: 0; border-top: 1px dashed rgb(0 0 0 / 0.28); font: 10px/1 Inter, ui-sans-serif, sans-serif; color: rgb(0 0 0 / 0.45); text-align: right; padding: 2px 6px 0 0; pointer-events: none; }
  #doc-pane .located { outline: 2px solid rgb(var(--accent) / 0.9); }
  .doc-print-frame { position: fixed; right: 0; bottom: 0; width: 0; height: 0; border: 0; opacity: 0; }
  /* A card that has been applied or skipped steps back without disappearing —
     it is still the record of what was suggested, and Undo lives on it. */
  .card-done { opacity: 0.55; }
  .card-done:hover, .card-done:focus-within { opacity: 1; }
  .chip { cursor: pointer; }
  /* A gap the resume cannot back yet — the same dashed underline the panes use
     for 'no evidence yet', so the chip and the mark read as one thing. Typing
     the word does not clear it; writing the evidence does. */
  .chip-unproven { text-decoration: underline dashed; text-decoration-thickness: 1px; text-underline-offset: 3px; }
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
