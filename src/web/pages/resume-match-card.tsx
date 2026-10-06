/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  FitBadge,
  Hint,
  HistoryChip,
  Input,
  MarkIcon,
  SectionTitle,
  Select,
  SUBMIT_ONCE,
  Table,
  Td,
  Tr,
  When,
} from '../ui';
import type { Tone } from '../format';

import type { MatchWithResume } from '../../resume/store';
import {
  ACTION_SECTIONS,
  readActions,
  readHardRequirements,
  readKeywords,
  readRemovals,
  type MatchAction,
  type MatchHardRequirement,
  type MatchKeyword,
} from '../../resume/prompts';
import { freshFrame, freshFrameNotice } from '../../resume/keyword-frame';
import { proposalOf, suggestionKey, suggestionSheet, type Proposal } from '../../resume/change-sheet';
import { readMatchEvidence, readMatchMode, type MatchMode } from '../../resume/match-mode';
import { verificationCautions, verificationHint, type VerificationForHint, type VerificationHint } from '../../resume/verification-hint';
import type { CountedKeyword } from '../../resume/keyword-matcher';
import { STALE_MONTHS, usageLine, type TermUsage } from '../../resume/usage';
import { effectiveRequirement, isIgnored, confirmable } from '../../resume/keyword-overrides';
import { REQUIREMENT_LEVELS, type RequirementLevel } from '../../resume/score';
import { readBreakdown, type ScoreBreakdown } from '../../resume/score';
import { noEditsLine, type Reach } from '../no-edits';
import { readyToApply, scoreLines, type Advice, type ScoreLine } from '../score-lines';
import { diffMatches } from '../../resume/diff';
import { earlierParams, previousFor } from '../../resume/match-name';
import { jobHref } from '../job-tabs';
import type { SummaryGuide } from '../../resume/summary-guide';
import { SummaryGuideBlock } from './summary-guide';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

export interface ResumeMatchCardProps {
  jobId: number;
  /** `label` is `resume-label.ts:resumeOptionLabel`, the preselect's reason included. */
  resumes: { id: number; label: string }[];
  /** The search's resume, else the best skill overlap — preselected in the dropdown. */
  suggestedResumeId: number | null;
  matches: MatchWithResume[];
  selected: MatchWithResume | null;
  /** The selected comparison's keywords, ordered and counted by the matcher. */
  selectedKeywords: CountedKeyword[];
  /** What the first reader looks for in a summary, against the selected comparison's text (summary-guide.ts). */
  selectedSummaryGuide: SummaryGuide | null;
  /** Names the change sheet the Copy button hands over. */
  job: { title: string; companyName: string };
  /** The latest "Is this job real?" verdict, read for one line and the cautions — never scored (#162). */
  verification: VerificationForHint | null;
  /** What a comparison usually costs here (ai-spend.ts:costHintText); null until there are three. */
  costHint: string | null;
}

const PRIORITY_TONE: Record<MatchAction['priority'], Tone> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

/** One status vocabulary everywhere: table badges, pane legends and tooltips agree. */
/*
 * Four phrases about the CANDIDATE's own document, not about the model's
 * confidence, and each one says what to do next. `add` means the resume
 * already evidences the term and only the word is absent — the easiest win on
 * the page — while cannot_claim means there is nothing here to write it from.
 * A bare "missing" for the second of those was read as the same news as the
 * first; the difference is the whole point of the pair, so it is spelled out.
 * The requirement level sits in the next column and the panes colour by it.
 */
const STATUS_VIEW = {
  present: { label: 'keyword.status.present', tone: 'ok' },
  add: { label: 'keyword.status.add', tone: 'warn' },
  // Unknown until the candidate answers: neutral, the tone DESIGN.md gives "unknown".
  ask_user: { label: 'keyword.status.askUser', tone: 'neutral' },
  cannot_claim: { label: 'keyword.status.cannotClaim', tone: 'danger' },
} as const satisfies Record<MatchKeyword['status'], { label: MessageKey; tone: Tone }>;

const keywordColumns = (): string[] => [
  t('keyword.column.keyword'),
  t('keyword.column.wants'),
  t('keyword.column.status'),
  t('keyword.column.where'),
  t('keyword.column.note'),
];

/** Where a keyword edit posts and where it comes back to (§5). */
export interface KeywordEditTarget {
  jobId: number;
  matchId: number;
  back: string;
}

/**
 * What "Rebuild keywords" needs to re-run this comparison (issue #79). The
 * targeted view passes `formId` so its own form — the one carrying the live
 * editor text — is submitted instead of ours.
 */
export interface RebuildTarget {
  jobId: number;
  resumeId: number;
  /** The comparison being rebuilt — on the scratch row it names the file whose text is judged again. */
  matchId?: number;
  mode: MatchMode;
  /** The analysed text when it was an unsaved draft: re-judged as is, so the frame is the only thing that changes. */
  draftText?: string;
  formId?: string;
}

const HARD_VIEW = {
  pass: { label: 'match.hard.pass', tone: 'ok' },
  unknown: { label: 'match.hard.unknown', tone: 'warn' },
  fail: { label: 'match.hard.fail', tone: 'danger' },
} as const satisfies Record<MatchHardRequirement['status'], { label: MessageKey; tone: Tone }>;

const SUBHEAD = 'mb-2 text-note font-medium text-ink-muted';
/**
 * The Now / Proposed captions. Micro step (12px/500) — the ramp's floor — and
 * no uppercase tracking: DESIGN.md says nothing in this app is ever set that
 * way, and the caption is a real word the model chose ("Rewrite", "Add"), not
 * a category shouting at the reader.
 */
const LABEL = 'text-meta font-medium text-ink-faint';

export const ResumeMatchCard: FC<ResumeMatchCardProps> = ({
  jobId,
  resumes,
  suggestedResumeId,
  matches,
  selected,
  selectedKeywords,
  selectedSummaryGuide,
  job,
  verification,
  costHint,
}) => (
  <div id="resume-match">
    <Card>
      <SectionTitle>{t('match.title')}</SectionTitle>
      <VerificationLine verification={verification} href={jobHref(jobId, 'verify', {}, 'verification')} />
      {resumes.length === 0 ? (
        <Hint>
          {tRich('match.noResumes', {}, {
            upload: (words) => (
              <a href="/resumes" class="font-medium text-accent-strong hover:text-accent-deep">
                {words}
              </a>
            ),
            once: (words) => (
              <a href={`/target?job=${jobId}`} class="font-medium text-accent-strong hover:text-accent-deep">
                {words}
              </a>
            ),
          })}
        </Hint>
      ) : (
        <form method="post" action={`/jobs/${jobId}/match`} class="flex flex-wrap items-end gap-3" onsubmit={SUBMIT_ONCE}>
          {/* One comparison, everywhere. The quick check still exists in the
              code (ADR 0029) — the memo and the suggestions call are built on
              it — but a user choosing between "Compare" and "Full analysis"
              was choosing between two tooltips. */}
          <input type="hidden" name="mode" value="full" />
          <label class="block min-w-0 max-w-full">
            <span class="block text-label text-ink">{t('match.resume')}</span>
            <Select name="resumeId" class="mt-1.5 !w-auto max-w-full">
              {resumes.map((r) => (
                <option value={r.id} selected={r.id === (suggestedResumeId ?? resumes[0]?.id)}>
                  {r.label}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="violet" title={t('match.compareTitle')}>
            {t('match.compare')}
          </Button>
          {/* Only the Resumes rows are listed here; a file that is not one of
              them, or pasted text, is compared from the Tailor resume page with this
              job already picked. */}
          <a
            href={`/target?job=${jobId}`}
            class="py-2 text-sm font-medium text-accent-strong hover:text-accent-deep"
          >
            {t('match.compareFile')}
          </a>
          {!selected && (
            <Hint class="basis-full">
              {t('match.compareHint')}
            </Hint>
          )}
          {costHint && <Hint class="basis-full">{costHint}</Hint>}
        </form>
      )}

      {selected && (
        <MatchReport
          match={selected}
          previous={previousFor(selected, matches)}
          keywords={selectedKeywords}
          summaryGuide={selectedSummaryGuide}
          factsBack={`/jobs/${jobId}?match=${selected.id}#resume-match`}
          job={job}
          verification={verification}
        />
      )}

      {matches.length > 1 && (
        <div class="mt-5 border-t border-line pt-4">
          <div class={SUBHEAD}>{t('match.allComparisons')}</div>
          <ul class="flex flex-wrap gap-2">
            {matches.map((m) => (
              <li>
                <HistoryChip href={`/jobs/${jobId}?match=${m.id}#resume-match`} current={selected?.id === m.id}>
                  <FitBadge score={m.matchScore} label={t('match.scoreLabel')} />
                  <span translate="no">{m.resume.name}</span>
                  <span class="font-mono font-normal text-ink-faint">
                    {m.resume.hidden ? '' : `v${m.resumeVersion}`}
                    {m.draft ? ` ${t('match.draft')}` : ''}
                  </span>
                  <span class="font-normal text-ink-faint"><When at={m.createdAt} /></span>
                </HistoryChip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  </div>
);

/** "Why this score" — the lines under the number on the /jobs match card. */
/*
 * What the number was made of, in sentences (docs/score-lines-plan.md). This
 * replaced a row of the formula's own parts — "Keywords 60/60 · Alignment
 * 40/40" — which said how the sum was done rather than what it decided. Same
 * place on the page, same amount of it, and the arithmetic moves into the
 * tooltips where it is still there for anyone who wants it.
 */
const ScoreBreakdownChips: FC<{ bd: ScoreBreakdown; keywords: MatchKeyword[]; hard: MatchHardRequirement[] }> = ({
  bd,
  keywords,
  hard,
}) => {
  const lines = scoreLines({ breakdown: bd, keywords, hard });
  return (
    <div class="space-y-1.5 text-meta">
      <LineGroup heading={t('score.heading.counted')} lines={lines.scored} />
      {/* The split is stated, not implied: a reader who sees "2 of 3 in a
          bullet" under a 100 asks why the 100 is a 100, and the heading
          answers before they ask. */}
      <LineGroup heading={t('score.heading.notCounted')} lines={lines.diagnostic} />
      <ScoreCeilingLine bd={bd} class="border-t border-line pt-1.5" />
    </div>
  );
};

/*
 * The advice ladder's one sentence (score-lines.ts:mainAdvice), in the same
 * place on both cards: under the model's summary, above the arithmetic. Null
 * renders nothing — a report with nothing open has the "Ready to apply" line
 * instead, and both at once would be two sentences saying one thing.
 */
export const MainAdviceLine: FC<{ advice: Advice | null }> = ({ advice }) =>
  advice === null ? null : (
    <p class="text-note leading-6 text-ink">
      <span class="font-medium text-accent-strong">{t('score.advice.lead')}</span>{' '}
      <span lang={advice.modelWritten ? 'en' : undefined}>{advice.text}</span>
    </p>
  );

/*
 * Two different questions (§4 of the intelligence analysis): the score is how
 * well this RESUME shows the fit, the ceiling is how well the CANDIDATE fits.
 * A wide gap is good news — all of it is editing.
 *
 * Its own component because the targeted view keeps this sentence and shows
 * none of the lines above it.
 */
export const ScoreCeilingLine: FC<{ bd: ScoreBreakdown; class?: string }> = ({ bd, class: className = '' }) =>
  bd.ceiling === undefined ? null : (
    <p
      class={`text-meta text-ink-muted ${className}`}
      title={t('score.ceiling.title')}
    >
      {bd.ceiling > bd.score ? (
        tRich('score.ceiling.reach', { ceiling: bd.ceiling }, {
          n: (words) => <span class="font-medium tabular-nums text-ink">{words}</span>,
        })
      ) : (
        <span class="font-medium text-ok">{t('score.ceiling.reached')}</span>
      )}
    </p>
  );

const LINE_TONE: Record<NonNullable<ScoreLine['tone']>, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
};

const LineGroup: FC<{ heading: string; lines: ScoreLine[] }> = ({ heading, lines }) =>
  lines.length === 0 ? null : (
    <div>
      <div class="text-label text-ink-muted">{heading}</div>
      <dl class="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {lines.map((l) => (
          <>
            <dt class="text-ink-faint">{l.label}</dt>
            <dd class={`min-w-0 ${l.tone ? LINE_TONE[l.tone] : 'text-ink'}`} title={l.title}>
              {l.text}
            </dd>
          </>
        ))}
      </dl>
    </div>
  );

/** The pair the empty state reads: today's score and what editing could reach. */
export function reachOf(bd: ScoreBreakdown | null, score: number): Reach | null {
  return bd?.ceiling === undefined ? null : { score, ceiling: bd.ceiling };
}

/** Hard-requirement gates as one compact line — for the targeted view's score card. */
export const HardRequirementsDigest: FC<{ hard: MatchHardRequirement[] }> = ({ hard }) => {
  if (hard.length === 0) return null;
  const pass = hard.filter((h) => h.status === 'pass').length;
  const issues = hard.filter((h) => h.status !== 'pass');
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span class="text-note font-medium text-ink-muted">{t('match.hard.title')}</span>
      <Badge tone={issues.length === 0 ? 'ok' : issues.some((h) => h.status === 'fail') ? 'danger' : 'warn'}>
        {t('match.hard.passCount', { pass, total: hard.length })}
      </Badge>
      {issues.map((h) => (
        <span class="inline-flex items-center gap-1.5 text-note text-ink" title={h.note ?? undefined}>
          <Badge tone={HARD_VIEW[h.status].tone}>{t(HARD_VIEW[h.status].label)}</Badge>
          {/* The gate as the model read it off the posting. */}
          <span lang="en">{h.requirement}</span>
        </span>
      ))}
    </div>
  );
};

/** One term the user can answer for. Answers persist as CandidateFact rows. */
const FactRow: FC<{ k: MatchKeyword; matchId: number; back: string }> = ({ k, matchId, back }) => (
  <li class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
    <div class="min-w-0 flex-1 text-sm">
      <span class="font-medium text-ink" translate="no">
        {k.term}
      </span>
      {k.note && (
        <span class="ml-2 text-meta text-ink-faint" lang="en">
          {k.note}
        </span>
      )}
      {k.elsewhere && (
        <Badge tone="neutral" class="ml-2">
          {t('keyword.elsewhere', { name: k.elsewhere })}
        </Badge>
      )}
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-1.5">
      <form method="post" action="/facts" class="flex items-center gap-1.5">
        <input type="hidden" name="term" value={k.term} />
        <input type="hidden" name="decision" value="confirmed" />
        <input type="hidden" name="matchId" value={String(matchId)} />
        <input type="hidden" name="back" value={back} />
        <Input
          name="note"
          maxlength="300"
          placeholder={t('facts.notePlaceholder')}
          aria-label={t('facts.noteAria', { term: k.term })}
          class="!w-44 !px-2 !py-1 !text-meta"
        />
        {/* Saved as a fact and re-scored in code — no AI call, so not violet. */}
        <Button variant="secondary">
          {t('facts.have')}
        </Button>
      </form>
      <ActionForm action="/facts" hidden={{ term: k.term, decision: 'denied', matchId, back }}>
        <Button size="sm" variant="ghost">
          {t('facts.dont')}
        </Button>
      </ActionForm>
      {/* Stops the question without a claim either way (facts.ts:UNSURE_NOTE). */}
      <ActionForm action="/facts" hidden={{ term: k.term, decision: 'unknown', matchId, back }}>
        <Button size="sm" variant="ghost">
          {t('facts.notSure')}
        </Button>
      </ActionForm>
    </div>
  </li>
);

/**
 * The card takes both tiers of `keyword-overrides.ts:confirmable`. The asks are open; the
 * terms the model could not back sit behind a summary, because on a resume
 * from another profession there are twenty-five of them and a wall of forms
 * is not an offer. The dashed chips above the editor open it (target-page.mjs).
 */
export const ConfirmFacts: FC<{ asks: MatchKeyword[]; unproven: MatchKeyword[]; matchId: number; back: string }> = ({
  asks,
  unproven,
  matchId,
  back,
}) =>
  asks.length === 0 && unproven.length === 0 ? null : (
    <div>
      <div class={SUBHEAD}>{t('facts.heading')}</div>
      {asks.length > 0 && (
        <ul class="divide-y divide-line rounded-md border border-line">
          {asks.map((k) => (
            <FactRow k={k} matchId={matchId} back={back} />
          ))}
        </ul>
      )}
      {unproven.length > 0 && (
        <details id="confirm-unproven" class={`${asks.length > 0 ? 'mt-2 ' : ''}rounded-md border border-line`}>
          <summary class="cursor-pointer px-3 py-2 text-note text-ink-muted transition-colors duration-150 hover:text-ink">
            {tRich('facts.unproven', { n: unproven.length }, { b: (words) => <span class="font-medium text-ink">{words}</span> })}
          </summary>
          <ul class="divide-y divide-line border-t border-line">
            {unproven.map((k) => (
              <FactRow k={k} matchId={matchId} back={back} />
            ))}
          </ul>
        </details>
      )}
      <Hint class="mt-1.5">
        {t('facts.stored')}
      </Hint>
    </div>
  );

const MatchReport: FC<{
  match: MatchWithResume;
  previous: MatchWithResume | null;
  /** This match's keywords, ordered and counted by the matcher (§5). */
  keywords: CountedKeyword[];
  /** Where the ask_user confirm/deny and keyword-override forms return to. */
  factsBack: string;
  /** Names the change sheet the Copy button hands over. */
  job: { title: string; companyName: string };
  /** The latest verdict's findings ride along the cautions (#162). */
  verification: VerificationForHint | null;
  summaryGuide: SummaryGuide | null;
}> = ({ match, previous, keywords, summaryGuide, factsBack, job, verification }) => {
  const bd = readBreakdown(match.breakdown);
  // A re-extracted frame counts different terms, so the older number is not a
  // baseline for this one (keyword-frame.ts). DeltaBox says so in words.
  const scoreDelta = previous && !freshFrame(match.breakdown) ? match.matchScore - previous.matchScore : null;
  return (
    <div class="mt-5 space-y-5 border-t border-line pt-4">
      <div class="flex flex-wrap items-center gap-3">
        <FitBadge score={match.matchScore} label={t('match.scoreLabel')} />
        {scoreDelta !== null && previous && (
          <Badge tone={scoreDelta > 0 ? 'ok' : scoreDelta < 0 ? 'danger' : 'neutral'}>
            {t('match.delta.badge', {
              arrow: scoreDelta > 0 ? '▲' : scoreDelta < 0 ? '▼' : '=',
              delta: fmtDelta(scoreDelta),
              ...earlierParams(previous),
            })}
          </Badge>
        )}
        <span class="text-sm text-ink">
          {match.resume.hidden ? (
            <span translate="no">{match.resume.name}</span>
          ) : (
            // TASKS R20: how strong the resume is on its own is one click away from how it fits.
            <a href={`/resumes/${match.resume.id}#resume-strength`} class="hover:underline" title={t('match.strengthTitle')} translate="no">
              {match.resume.name}
            </a>
          )}{' '}
          {!match.resume.hidden && <span class="font-mono text-meta text-ink-faint">v{match.resumeVersion}</span>}
        </span>
        <span class="text-meta text-ink-faint">
          <When at={match.createdAt} /> ·{' '}
          <span class="font-mono" translate="no">
            {match.model}
          </span>
          {match.draft ? ` · ${t('match.draft')}` : ''}
        </span>
        {/* The card's primary once a result exists: free, and the step the verdict leads to (#164). Full-width under the score row on a phone. */}
        <Button href={`/jobs/${match.jobId}/target?match=${match.id}`} size="sm" class="ml-auto max-sm:basis-full">
          {t('match.tailorResume')}
        </Button>
      </div>
      <p class="text-sm leading-6 text-ink" lang="en">
        {match.summary}
      </p>
      {readMatchEvidence(match.breakdown) === 'text' && (
        <Hint>{t('match.judgedOnText')}</Hint>
      )}
      {/* The advice line is the tailoring page's, not this card's: the five
          lines below already carry the facts it would rank, and saying the
          same thing twice two lines apart is what the copy pass just cut. */}
      {bd && (
        <ScoreBreakdownChips bd={bd} keywords={keywords} hard={readHardRequirements(match.hardRequirements)} />
      )}

      <DeltaBox match={match} previous={previous} />
      <HardRequirementsBlock hard={readHardRequirements(match.hardRequirements)} />
      <MatchSignals match={match} verification={verification} />
      {/* A file judged on its own text may not be the user's: its questions are not theirs to answer (R1). */}
      {readMatchEvidence(match.breakdown) === 'own' && <ConfirmFacts {...confirmable(keywords)} matchId={match.id} back={factsBack} />}

      {readMatchMode(match.breakdown) === 'fast' ? (
        <SuggestionsPrompt matchId={match.id} jobId={match.jobId} />
      ) : (
        <>
          <div class="flex flex-wrap items-center gap-2">
            <ChangeSheetButton
              job={job}
              resumeName={match.resume.name}
              actions={readActions(match.actions)}
              removals={readRemovals(match.removals)}
            />
            <Hint class="!mt-0">{t('match.sheetHint')}</Hint>
          </div>
          <ActionsBlock actions={readActions(match.actions)} reach={reachOf(bd, match.matchScore)} summaryGuide={summaryGuide} />
          <RemovalsBlock removals={readRemovals(match.removals)} />
        </>
      )}
      {/* A comparison written before ADR 0012 has no breakdown to re-score
          from, so it gets the table without the controls rather than buttons
          that can only fail. */}
      <KeywordTable
        keywords={keywords}
        edit={bd ? { jobId: match.jobId, matchId: match.id, back: factsBack } : undefined}
        rebuild={{
          jobId: match.jobId,
          resumeId: match.resumeId,
          matchId: match.id,
          mode: readMatchMode(match.breakdown),
          ...(match.draft ? { draftText: match.resumeText } : {}),
        }}
      />
    </div>
  );
};

/**
 * What a quick check shows where the suggestions would be: the second call is
 * one button away and never changes the score (ADR 0029).
 */
export const SuggestionsPrompt: FC<{ matchId: number; jobId: number; next?: 'target' }> = ({
  matchId,
  jobId,
  next,
}) => (
  <div class="rounded-md border border-line bg-surface-overlay/50 p-3">
    <div class={SUBHEAD}>{t('match.quick.heading')}</div>
    <p class="mb-2.5 text-sm leading-6 text-ink-muted">
      {t('match.quick.body')}
    </p>
    <ActionForm action={`/jobs/${jobId}/matches/${matchId}/suggestions`} hidden={next ? { next } : undefined}>
      <Button size="sm" variant="violet">
        {t('match.quick.get')}
      </Button>
    </ActionForm>
  </div>
);

/** Version-over-version diff: gained/lost keywords + component deltas. */
export const DeltaBox: FC<{ match: MatchWithResume; previous: MatchWithResume | null }> = ({
  match,
  previous,
}) => {
  if (!previous) return null;
  const fresh = freshFrame(match.breakdown);
  if (fresh) {
    return (
      <div class="rounded-md border border-line bg-surface-overlay/50 px-3 py-2 text-meta leading-5 text-ink-muted">
        <span class="font-medium text-ink">{t('match.delta.notComparable', earlierParams(previous))} </span>
        {freshFrameNotice(fresh)}
      </div>
    );
  }
  const delta = diffMatches(
    { keywords: readKeywords(previous.keywords), breakdown: readBreakdown(previous.breakdown) },
    { keywords: readKeywords(match.keywords), breakdown: readBreakdown(match.breakdown) },
  );
  if (delta.gained.length === 0 && delta.lost.length === 0 && !delta.components) return null;
  return (
    <div class="rounded-md border border-line bg-surface-overlay/50 px-3 py-2 text-meta leading-5 text-ink-muted">
      <span class="font-medium text-ink">{t('match.delta.heading', earlierParams(previous))} </span>
      {delta.gained.length > 0 && (
        <span>
          {tRich('match.delta.gained', { terms: delta.gained.join(', ') }, {
            list: (words) => (
              <span class="text-ok" translate="no">
                {words}
              </span>
            ),
          })}
          {' · '}
        </span>
      )}
      {delta.lost.length > 0 && (
        <span>
          {tRich('match.delta.lost', { terms: delta.lost.join(', ') }, {
            list: (words) => (
              <span class="text-danger" translate="no">
                {words}
              </span>
            ),
          })}
          {' · '}
        </span>
      )}
      <span>{delta.components ? componentMoves(delta.components) : t('match.delta.score', { delta: fmtDelta(match.matchScore - previous.matchScore) })}</span>
    </div>
  );
};

/** What each part of the formula moved by, the parts that did not move left out: "keywords +3 · alignment +2 · cap none → 70". */
function componentMoves(c: NonNullable<ReturnType<typeof diffMatches>['components']>): string {
  const cap = (value: number | null) => value ?? t('match.delta.capNone');
  return [
    t('match.delta.keywords', { delta: fmtDelta(c.keywordPts) }),
    t('match.delta.alignment', { delta: fmtDelta(c.alignmentPts) }),
    c.penalty !== 0 ? t('match.delta.flags', { delta: fmtDelta(-c.penalty) }) : null,
    c.capBefore !== c.capAfter ? t('match.delta.cap', { before: cap(c.capBefore), after: cap(c.capAfter) }) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** Full hard-requirement list with notes — the score card shows only the digest. */
const HardRequirementsBlock: FC<{ hard: MatchHardRequirement[] }> = ({ hard }) =>
  hard.length === 0 ? null : (
    <div>
      <div class={SUBHEAD}>{t('match.hard.heading')}</div>
      <ul class="space-y-1.5 text-sm">
        {hard.map((h) => (
          <li class="flex flex-wrap items-center gap-2">
            <Badge tone={HARD_VIEW[h.status].tone}>{t(HARD_VIEW[h.status].label)}</Badge>
            <span class="text-ink" lang="en">
              {h.requirement}
            </span>
            {h.note && (
              <span class="text-meta text-ink-faint" lang="en">
                — {h.note}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

/**
 * What the comparison says about the stored verdict before any AI is spent
 * (#162 stage 0): one line, the verifier's own recommendation, a link to the
 * card that holds the evidence — and the mirror of the cover card's hint
 * when nothing is stored yet.
 */
export const VerificationLine: FC<{ verification: VerificationForHint | null; class?: string; href: string }> = ({
  verification,
  class: className = 'mb-3',
  href,
}) => {
  const link = (words: Child[]) => (
    <a href={href} class="font-medium text-accent-strong hover:text-accent-deep">
      {words}
    </a>
  );
  if (!verification) {
    return <Hint class={className}>{tRich('match.verification.notChecked', {}, { link })}</Hint>;
  }
  const hint = verificationHint(verification);
  return (
    <p class={`${className} text-note leading-5 ${VERIFICATION_TONE[hint.tone]}`}>
      {tRich('match.verification.line', { text: hint.text }, { link })}
    </p>
  );
};

const VERIFICATION_TONE: Record<VerificationHint['tone'], string> = {
  ok: 'text-ink-muted',
  warn: 'text-warn',
  danger: 'text-danger',
};

/** Red flags, unscored cautions and strengths — the qualitative read on a match. */
export const MatchSignals: FC<{ match: MatchWithResume; verification?: VerificationForHint | null }> = ({
  match,
  verification,
}) => {
  // The verifier's findings ride along the model's cautions, labelled — a
  // finding about the posting is not a finding about the resume (#162 stage 1).
  // The model's cautions are its own English; the verifier's lines open with our label.
  const cautions = [
    ...match.cautions.map((text) => ({ text, modelWritten: true })),
    ...(verification ? verificationCautions(verification) : []).map((text) => ({ text, modelWritten: false })),
  ];
  return (
    <>
      <MarkedList label={t('match.redFlags')} items={match.redFlags} kind="x" tone="text-danger" />
      {cautions.length > 0 && (
        <div>
          <div class={SUBHEAD}>{t('match.cautions')}</div>
          <ul class="space-y-1 text-sm text-ink-muted">
            {cautions.map((c) => (
              <li class="flex gap-2">
                <span class="mt-[3px] h-3.5 w-3.5 shrink-0 text-center text-meta leading-none text-ink-faint" aria-hidden="true">
                  ·
                </span>
                <span lang={c.modelWritten ? 'en' : undefined}>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <MarkedList label={t('match.strengths')} items={match.strengths} kind="check" tone="text-ok" />
    </>
  );
};

/**
 * One suggestion: what the resume says now, the wording proposed for it, and
 * the two controls that make the manual path bearable. Copy is always there —
 * a proposal you cannot get onto the clipboard is a proposal you retype.
 * Locate only exists where there is an editor to scroll (`interactive`), and
 * it never moves the page.
 */
const SuggestionCard: FC<{
  item: {
    section: string;
    where: string;
    what: string;
    why: string;
    quote?: string | null;
    /** An addition's anchor line (ADR 0037): Apply inserts after it instead of replacing. */
    insert_after?: string | null;
  };
  badge: Child;
  /** The wording to copy, when the model quoted one inside `what`. */
  proposal: Proposal | null;
  /** True on the targeted view, where an editor exists to locate the quote in. */
  interactive: boolean;
  /** A removal: its quote is the text to cut, shown struck through, and Remove acts on it. */
  removal?: boolean;
  /** Priority badges are one word, section badges are up to four syllables. */
  badgeWidth?: string;
  /** Where "Rewrite" posts: the same edit, a different sentence. Actions only. */
  rewrite?: { jobId: number; matchId: number; index: number; next?: 'target' };
}> = ({ item, badge, proposal, interactive, removal = false, badgeWidth = 'w-16', rewrite }) => {
  const copyable = proposal?.text ?? item.quote ?? item.what;
  // Stable across re-runs of the same comparison, so applied/skipped marks survive a reload.
  const key = suggestionKey(item);
  // A change applies over its quote; an addition applies after its anchor line.
  // The edit box is the one carrier of that target — Apply reads it from there.
  const target = item.quote ? { 'data-quote': item.quote } : item.insert_after ? { 'data-anchor': item.insert_after } : null;
  const canApply = interactive && Boolean(proposal) && target !== null;
  // Edit & apply needs only a place to write: a card whose wording the gate
  // refused (ADR 0037) keeps it, prefilled with the text as it stands.
  const canEdit = interactive && target !== null && !removal;
  const canRemove = interactive && Boolean(item.quote) && removal;
  return (
    <li class="flex flex-col gap-1 p-3 sm:flex-row sm:gap-3" data-card={interactive ? key : undefined}>
      <div class={`${badgeWidth} shrink-0`}>{badge}</div>
      <div class="min-w-0 flex-1 text-sm">
        {/* Where, what and why are the model's sentences; the quote is the resume's own line. */}
        <div class="font-medium text-ink" lang="en">
          {item.where}
        </div>
        <div class="mt-0.5 leading-6 text-ink" lang="en">
          {item.what}
        </div>
        {item.quote && (
          <div class="mt-2">
            <div class={LABEL}>{t('match.card.now')}</div>
            <p
              translate="no"
              class={`mt-0.5 whitespace-pre-wrap break-words border-l-2 border-line-strong pl-2 leading-6 text-ink-muted ${
                removal ? 'line-through decoration-danger/60' : ''
              }`}
            >
              {item.quote}
            </p>
          </div>
        )}
        {proposal && (
          <div class="mt-2">
            <ProposalCaption verb={proposal.verb} />
            <p class="mt-0.5 whitespace-pre-wrap break-words border-l-2 border-accent/50 pl-2 leading-6 text-ink" lang="en">
              {proposal.text}
            </p>
          </div>
        )}
        <div class="mt-1 text-meta leading-5 text-ink-faint">
          {tRich('match.card.why', {}, { reason: () => <span lang="en">{item.why}</span> })}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          {/* Outlined, not solid: five cards are one region, and the solid button in
              sight is the page's own (DESIGN.md, one primary per region). */}
          {canApply && (
            <Button type="button" variant="secondary" size="sm" data-apply={proposal?.text}>
              {t('match.card.apply')}
            </Button>
          )}
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" data-edit-apply>
              {t('match.card.editApply')}
            </Button>
          )}
          {canRemove && (
            <Button type="button" variant="danger" size="sm" data-remove={item.quote}>
              {t('common.remove')}
            </Button>
          )}
          <Button type="button" variant={canApply || canRemove ? 'ghost' : 'secondary'} size="sm" data-copy={copyable}>
            {t('common.copy')}
          </Button>
          {rewrite && (
            <form method="post" action={`/jobs/${rewrite.jobId}/matches/${rewrite.matchId}/actions/${rewrite.index}/rewrite`} onsubmit={SUBMIT_ONCE}>
              {rewrite.next && <input type="hidden" name="next" value={rewrite.next} />}
              <Button
                variant="ghost"
                size="sm"
                title={t('match.card.rewriteTitle')}
              >
                {t('match.card.rewrite')}
              </Button>
            </form>
          )}
          {interactive && item.quote && (
            <Button type="button" variant="ghost" size="sm" data-locate={item.quote}>
              {t('match.card.locate')}
            </Button>
          )}
          {(canEdit || canRemove) && (
            <Button type="button" variant="ghost" size="sm" data-skip>
              {t('match.card.skip')}
            </Button>
          )}
          {interactive && (
            <Button type="button" variant="ghost" size="sm" data-undo hidden>
              {t('match.card.undo')}
            </Button>
          )}
          {/* One status line per card: Locate's line number, and what an edit did. */}
          {interactive && <span class="text-meta text-ink-faint" data-card-status role="status"></span>}
        </div>
        {canEdit && (
          <div class="mt-2" data-edit-box hidden {...target}>
            <label class="block">
              <span class={LABEL}>{t('match.card.yourWording')}</span>
              <textarea
                class="mt-1 block w-full rounded-md border border-line-strong bg-surface-raised p-2 text-sm leading-6 text-ink"
                rows={3}
                data-edit-text
              >
                {proposal?.text ?? item.quote ?? ''}
              </textarea>
            </label>
            <div class="mt-1.5 flex flex-wrap gap-2">
              <Button type="button" variant="primary" size="sm" data-edit-save>
                {t('match.card.applyThis')}
              </Button>
              <Button type="button" variant="ghost" size="sm" data-edit-cancel>
                {t('ui.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
};

/** "What to change" — one card per edit, with Copy and (on the targeted view) Locate. */
/**
 * An empty list is an answer, and it has two meanings the user cannot tell
 * apart without help: the resume is already as close as it gets, or the
 * posting is for a different profession and no wording bridges it. The
 * ceiling separates them — it is what honest editing could reach — so the
 * empty state says which one this is instead of "No edits suggested."
 */
const NoEdits: FC<{ reach: Reach | null }> = ({ reach }) => {
  const line = noEditsLine(reach);
  return (
    <Hint>
      {line.offerRewrite && reach
        ? // The same sentence as `line.text`, with the button it ends on set in bold.
          tRich('match.noEdits.room', { ceiling: reach.ceiling }, { button: (words) => <span class="font-medium text-ink">{words}</span> })
        : line.text}
    </Hint>
  );
};

/**
 * The caption over a proposed wording. "Replace" and "Add" are the two words
 * change-sheet.ts gives a row that carries its wording in a field of its own;
 * any other lead is how the model itself introduced it, and stays as written.
 */
const ProposalCaption: FC<{ verb: string | null }> = ({ verb }) => {
  if (verb === null) return <div class={LABEL}>{t('match.card.proposed')}</div>;
  if (verb === 'Replace') return <div class={LABEL}>{t('match.card.replace')}</div>;
  if (verb === 'Add') return <div class={LABEL}>{t('match.card.add')}</div>;
  return (
    <div class={LABEL} lang="en">
      {verb}
    </div>
  );
};

export const ActionsBlock: FC<{
  actions: MatchAction[];
  interactive?: boolean;
  /** Enables "Rewrite" on each card; the index is the action's place in the stored row. */
  rewrite?: { jobId: number; matchId: number; next?: 'target' };
  /** The score and its ceiling — what an empty list is allowed to say about itself. */
  reach?: Reach | null;
  /** What the first reader looks for in a summary (summary-guide.ts) — it keeps the summary section open with no card in it. */
  summaryGuide?: SummaryGuide | null;
}> = ({ actions, interactive = false, rewrite, reach = null, summaryGuide = null }) => {
  // The index is taken before the per-section filter: it addresses the action
  // in the stored row, which is what the rewrite route updates.
  const numbered = actions.map((a, index) => ({ a, index }));
  const sections = ACTION_SECTIONS.filter(
    (s) => actions.some((a) => a.section === s) || (s === 'summary' && summaryGuide !== null),
  );
  return (
    <div>
      <div class={SUBHEAD}>{t('match.actions.heading', { n: actions.length })}</div>
      {actions.length === 0 && <NoEdits reach={reach} />}
      {sections.length > 0 && (
        <div class={`space-y-4 ${actions.length === 0 ? 'mt-3' : ''}`}>
          {sections.map((section) => (
            <div>
              <div class="mb-1.5 text-meta font-semibold text-ink">{t(`match.section.${section}`)}</div>
              {section === 'summary' && summaryGuide && <SummaryGuideBlock guide={summaryGuide} />}
              {actions.some((a) => a.section === section) && (
                <ol class="divide-y divide-line rounded-md border border-line">
                  {numbered
                    .filter(({ a }) => a.section === section)
                    .map(({ a, index }) => (
                      <SuggestionCard
                        item={a}
                        badge={<Badge tone={PRIORITY_TONE[a.priority]}>{t(`match.priority.${a.priority}`)}</Badge>}
                        proposal={proposalOf(a)}
                        interactive={interactive}
                        rewrite={rewrite ? { ...rewrite, index } : undefined}
                      />
                    ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** "What to remove" — the same card, showing the text to cut rather than hiding it. */
export const RemovalsBlock: FC<{
  removals: ReturnType<typeof readRemovals>;
  interactive?: boolean;
}> = ({ removals, interactive = false }) =>
  removals.length === 0 ? null : (
    <div>
      <div class={SUBHEAD}>{t('match.removals.heading', { n: removals.length })}</div>
      <ul class="divide-y divide-line rounded-md border border-line">
        {removals.map((r) => (
          <SuggestionCard
            item={r}
            badge={<Badge tone="neutral">{t(`match.section.${r.section}`)}</Badge>}
            proposal={null}
            interactive={interactive}
            removal
            badgeWidth="w-24"
          />
        ))}
      </ul>
    </div>
  );

/**
 * The whole list as Markdown, on the clipboard in one press. The payload is
 * rendered here rather than built in the browser, so it works on this page
 * too — which carries no editor and no JSON blob.
 */
export const ChangeSheetButton: FC<{
  job: { title: string; companyName: string };
  resumeName: string;
  actions: MatchAction[];
  removals: ReturnType<typeof readRemovals>;
}> = ({ job, resumeName, actions, removals }) =>
  actions.length === 0 && removals.length === 0 ? null : (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      data-copy={suggestionSheet(
        { jobTitle: job.title, companyName: job.companyName, resumeName },
        actions,
        removals,
      )}
    >
      {t('match.copyAll')}
    </Button>
  );

/**
 * Keyword coverage: needs-attention rows first, matched rows behind a
 * disclosure, and — when the user has ignored any — a third group they can
 * bring back. Rows arrive ORDERED (hardest requirement first, ties broken by
 * how often the posting repeats the term): only the matcher can count that,
 * so the routes order through it and this component renders what it is given.
 *
 * With `edit`, every row carries the §5 controls: re-level, ignore, reset,
 * and a form to add a term the model missed. Each is a plain POST that
 * recomputes the score in code — no AI call.
 */
export const KeywordTable: FC<{
  keywords: (CountedKeyword & { usage?: TermUsage })[];
  edit?: KeywordEditTarget;
  rebuild?: RebuildTarget;
}> = ({ keywords, edit, rebuild }) => {
  if (keywords.length === 0) return null;
  const ignored = keywords.filter(isIgnored);
  const counted = keywords.filter((k) => !isIgnored(k));
  const attention = counted.filter((k) => k.status !== 'present');
  const matchedKeywords = counted.filter((k) => k.status === 'present');
  return (
    <div class="-mx-5 -mb-5 border-t border-line">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-note font-medium text-ink-muted">
        <span>
          {t(ignored.length > 0 ? 'keyword.coverageIgnored' : 'keyword.coverage', {
            matched: matchedKeywords.length,
            total: counted.length,
            ignored: ignored.length,
          })}
        </span>
        {rebuild && <RebuildKeywords target={rebuild} />}
      </div>
      {attention.length > 0 ? (
        <Table columns={keywordColumns()}>
          {attention.map((k) => (
            <KeywordRow k={k} edit={edit} />
          ))}
        </Table>
      ) : (
        <Hint class="px-5 pb-3">{t('keyword.allMatched')}</Hint>
      )}
      {matchedKeywords.length > 0 && (
        <details>
          <summary class={KEYWORD_SUMMARY}>{t('keyword.matchedFold', { n: matchedKeywords.length })}</summary>
          <Table columns={keywordColumns()}>
            {matchedKeywords.map((k) => (
              <KeywordRow k={k} edit={edit} />
            ))}
          </Table>
        </details>
      )}
      {ignored.length > 0 && (
        <details>
          <summary class={KEYWORD_SUMMARY}>{t('keyword.ignoredFold', { n: ignored.length })}</summary>
          <Table columns={keywordColumns()}>
            {ignored.map((k) => (
              <KeywordRow k={k} edit={edit} />
            ))}
          </Table>
        </details>
      )}
      {edit && <AddKeywordForm edit={edit} />}
    </div>
  );
};

/**
 * The way out of a keyword frame that got it wrong (issue #79): one run with
 * the stored list withheld, so the model reads the posting again. The user's
 * own keyword edits are re-applied to whatever comes back — a rebuild resets
 * the model's guess, not their decisions.
 */
function rebuildTitle(mode: MatchMode): string {
  return t(mode === 'fast' ? 'keyword.rebuild.titleFast' : 'keyword.rebuild.titleFull');
}

const RebuildKeywords: FC<{ target: RebuildTarget }> = ({ target }) =>
  target.formId ? (
    <button
      type="submit"
      form={target.formId}
      class={`${ROW_LINK} ml-auto`}
      title={rebuildTitle(target.mode)}
      onclick={`this.form.elements.rebuild.value='1';this.form.elements.mode.value='${target.mode}'`}
    >
      {t('keyword.rebuild')}
    </button>
  ) : (
    <form method="post" action={`/jobs/${target.jobId}/match`} class="ml-auto" onsubmit={SUBMIT_ONCE}>
      <input type="hidden" name="resumeId" value={String(target.resumeId)} />
      {target.matchId !== undefined && <input type="hidden" name="matchId" value={String(target.matchId)} />}
      <input type="hidden" name="mode" value={target.mode} />
      <input type="hidden" name="rebuild" value="1" />
      {/* A draft row was judged on text no version holds — send it back, or the
          rebuild would quietly score the stored resume instead. */}
      {target.draftText !== undefined && <input type="hidden" name="draftText" value={target.draftText} />}
      <button type="submit" class={ROW_LINK} title={rebuildTitle(target.mode)}>
        {t('keyword.rebuild')}
      </button>
    </form>
  );

const KEYWORD_SUMMARY =
  'cursor-pointer border-t border-line px-5 py-2.5 text-note font-medium text-ink-muted transition-colors duration-150 hover:text-ink';

function fmtDelta(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

const KeywordRow: FC<{ k: CountedKeyword & { usage?: TermUsage }; edit?: KeywordEditTarget }> = ({ k, edit }) => (
  <Tr class={isIgnored(k) ? 'opacity-60' : ''}>
    <Td class="text-meta font-medium text-ink">
      <span class="inline-flex flex-wrap items-center gap-1.5">
        <span translate="no">{k.term}</span>
        {k.primary && <Badge tone="info">{t('keyword.primary')}</Badge>}
        {k.count > 1 && (
          <span class="font-mono text-ink-faint" title={t('keyword.countTitle', { n: k.count })}>
            ×{k.count}
          </span>
        )}
        {k.override?.added && <Badge tone="neutral">{t('keyword.yours')}</Badge>}
        {k.group && (
          <span title={t('keyword.group.title', { group: k.group })}>
            <Badge>{t('keyword.group.badge', { group: k.group })}</Badge>
          </span>
        )}
      </span>
    </Td>
    <Td class="text-meta text-ink-faint">
      {edit ? <LevelControls k={k} edit={edit} /> : t(`keyword.level.${effectiveRequirement(k)}`)}
    </Td>
    <Td>
      <span class="inline-flex flex-wrap items-center gap-1">
        <Badge tone={STATUS_VIEW[k.status].tone}>{t(STATUS_VIEW[k.status].label)}</Badge>
        {/* Measured off the text, never judged (evidence.ts, §23): "listed" is a
            name on a skills line and nothing more, which is what a recruiter
            discounts fastest. */}
        {k.evidence === 'listed' && (
          <span title={t('keyword.listed.title')}>
            <Badge tone="warn">{t('keyword.listed.badge')}</Badge>
          </span>
        )}
        {k.evidence === 'measured' && (
          <span title={t('keyword.measured.title')}>
            <Badge tone="ok">{t('keyword.measured.badge')}</Badge>
          </span>
        )}
        {k.elsewhere && <Badge tone="neutral">{t('keyword.elsewhere', { name: k.elsewhere })}</Badge>}
        {/* TASKS R8: the dated roles that name it — not scored, read by every screener. */}
        {k.usage && (
          <span
            class={`text-meta ${k.usage.monthsSince >= STALE_MONTHS ? 'text-warn' : 'text-ink-faint'}`}
            title={
              k.usage.monthsSince >= STALE_MONTHS
                ? t('keyword.usage.staleTitle', { term: k.term })
                : t('keyword.usage.title', { term: k.term })
            }
          >
            {usageLine(k.usage)}
          </span>
        )}
        {k.aliasOnly && (
          <span title={t('keyword.alias.title', { alias: k.aliasOnly, term: k.term })}>
            <Badge tone="warn">{t('keyword.alias.badge', { alias: k.aliasOnly })}</Badge>
          </span>
        )}
        {k.unanchored && (
          <span
            title={
              k.override?.added
                ? t('keyword.unanchored.titleYours')
                : t('keyword.unanchored.titleAi')
            }
          >
            <Badge>{t('keyword.unanchored.badge')}</Badge>
          </span>
        )}
      </span>
    </Td>
    {/* Where the resume shows it and the note beside it are the model's own words. */}
    <Td class="text-meta text-ink-muted">
      <span lang="en">{k.where ?? '—'}</span>
    </Td>
    <Td class="max-w-md text-meta text-ink-muted">
      <span lang="en">{k.note ?? '—'}</span>
    </Td>
  </Tr>
);

/*
 * One form per row: the select posts on change, and each button sets `op`
 * before submitting (the same idiom as the Compare / Full analysis pair
 * above), so the row never sends two conflicting values for one field.
 */
const LevelControls: FC<{ k: CountedKeyword; edit: KeywordEditTarget }> = ({ k, edit }) => {
  const level = effectiveRequirement(k);
  const overridden = k.override?.requirement !== undefined;
  return (
    <form
      method="post"
      action={`/jobs/${edit.jobId}/matches/${edit.matchId}/keywords`}
      class="flex flex-wrap items-center gap-1.5"
    >
      <input type="hidden" name="term" value={k.term} />
      <input type="hidden" name="back" value={edit.back} />
      <input type="hidden" name="op" value="level" />
      <Select
        name="requirement"
        class="!w-auto py-1 text-meta"
        data-commit="submit"
        aria-label={t('keyword.wants.aria', { term: k.term })}
        title={
          !overridden
            ? t('keyword.wants.title')
            : level === k.requirement
              ? t('keyword.wants.titleYours')
              : t('keyword.wants.titleOverridden', { level: t(`keyword.level.${k.requirement}`) })
        }
      >
        {REQUIREMENT_LEVELS.map((r) => (
          <option value={r} selected={r === level}>
            {t(`keyword.level.${r}`)}
          </option>
        ))}
      </Select>
      {overridden && <Badge tone="neutral">{t('keyword.yours')}</Badge>}
      <button
        type="submit"
        class={ROW_LINK}
        onclick={`this.form.elements.op.value='${isIgnored(k) ? 'restore' : 'ignore'}'`}
        title={
          isIgnored(k)
            ? t('keyword.restoreTitle')
            : t('keyword.ignoreTitle')
        }
      >
        {isIgnored(k) ? t('keyword.restore') : t('keyword.ignore')}
      </button>
      {(overridden || k.override?.added) && (
        <button
          type="submit"
          class={ROW_LINK}
          onclick="this.form.elements.op.value='reset'"
          title={k.override?.added ? t('keyword.removeTitle') : t('keyword.resetTitle')}
        >
          {k.override?.added ? t('keyword.remove') : t('keyword.reset')}
        </button>
      )}
    </form>
  );
};

const ROW_LINK =
  'cursor-pointer whitespace-nowrap text-meta text-ink-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline';

/** A word the model missed. Status is read from the resume text, never guessed. */
const AddKeywordForm: FC<{ edit: KeywordEditTarget }> = ({ edit }) => (
  <form
    method="post"
    action={`/jobs/${edit.jobId}/matches/${edit.matchId}/keywords`}
    class="flex flex-wrap items-end gap-2 border-t border-line px-5 py-3"
  >
    <input type="hidden" name="op" value="add" />
    <input type="hidden" name="back" value={edit.back} />
    <label class="block">
      <span class="block text-label text-ink">{t('keyword.add.label')}</span>
      <Input
        name="term"
        required
        maxlength={60}
        placeholder={t('keyword.add.placeholder')}
        class="mt-1.5 !w-56 py-1 text-meta"
      />
    </label>
    <Select name="requirement" class="!w-auto py-1 text-meta" aria-label={t('keyword.add.levelAria')}>
      {REQUIREMENT_LEVELS.map((r) => (
        <option value={r} selected={r === 'preferred'}>
          {t(`keyword.level.${r}`)}
        </option>
      ))}
    </Select>
    <Button variant="secondary">
      {t('keyword.add.button')}
    </Button>
    <Hint class="basis-full">
      {t('keyword.add.hint')}
    </Hint>
  </form>
);

const MarkedList: FC<{ label: string; items: string[]; kind: 'check' | 'x'; tone: string }> = ({
  label,
  items,
  kind,
  tone,
}) =>
  items.length === 0 ? null : (
    <div>
      <div class={SUBHEAD}>{label}</div>
      <ul class="space-y-1 text-sm text-ink-muted">
        {items.map((s) => (
          <li class="flex gap-2">
            <MarkIcon kind={kind} class={`mt-[3px] ${tone}`} />
            {/* Red flags and strengths are the model's sentences. */}
            <span lang="en">{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
