/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  FitBadge,
  Hint,
  SUBMIT_ONCE,
  Input,
  MarkIcon,
  SectionTitle,
  Select,
  Table,
  Td,
  Tr,
} from '../ui';
import type { Tone } from '../format';
import { formatRelative } from '../format';
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
import { proposalOf, suggestionSheet, type Proposal } from '../../resume/change-sheet';
import { hashShortId } from '../../text-utils';
import { readMatchMode, type MatchMode } from '../../resume/match-mode';
import type { CountedKeyword } from '../../resume/keyword-matcher';
import { effectiveRequirement, isIgnored } from '../../resume/keyword-overrides';
import { REQUIREMENT_LEVELS, type RequirementLevel } from '../../resume/score';
import { readBreakdown, type ScoreBreakdown } from '../../resume/score';
import { diffMatches } from '../../resume/diff';

export interface ResumeMatchCardProps {
  jobId: number;
  resumes: { id: number; name: string; isDefault: boolean }[];
  /** Best skill overlap for this posting — preselected in the dropdown. */
  suggestedResumeId: number | null;
  /** Why that one is preselected: the search names it, or it overlaps the posting most. */
  suggestedReason: 'linked' | 'overlap';
  matches: MatchWithResume[];
  selected: MatchWithResume | null;
  /** The selected comparison's keywords, ordered and counted by the matcher. */
  selectedKeywords: CountedKeyword[];
  /** Names the change sheet the Copy button hands over. */
  job: { title: string; companyName: string };
}

const PRIORITY_TONE: Record<MatchAction['priority'], Tone> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

/** One status vocabulary everywhere: table badges, pane legends and tooltips agree. */
const STATUS_VIEW: Record<MatchKeyword['status'], { label: string; tone: Tone }> = {
  present: { label: 'matched', tone: 'ok' },
  add: { label: 'missing', tone: 'warn' },
  ask_user: { label: 'confirm', tone: 'violet' },
  cannot_claim: { label: 'no evidence', tone: 'danger' },
};

const KEYWORD_COLUMNS = ['Keyword', 'Wants it', 'Status', 'Where', 'Note'];

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
  mode: MatchMode;
  /** The analysed text when it was an unsaved draft: re-judged as is, so the frame is the only thing that changes. */
  draftText?: string;
  formId?: string;
}

const HARD_VIEW: Record<MatchHardRequirement['status'], { label: string; tone: Tone }> = {
  pass: { label: 'pass', tone: 'ok' },
  unknown: { label: 'unknown', tone: 'warn' },
  fail: { label: 'fail', tone: 'danger' },
};

const SUBHEAD = 'mb-2 text-[13px] font-medium text-ink-muted';
/**
 * The Now / Proposed captions. Micro step (12px/500) — the ramp's floor — and
 * no uppercase tracking: DESIGN.md says nothing in this app is ever set that
 * way, and the caption is a real word the model chose ("Rewrite", "Add"), not
 * a category shouting at the reader.
 */
const LABEL = 'text-xs font-medium text-ink-faint';

export const ResumeMatchCard: FC<ResumeMatchCardProps> = ({
  jobId,
  resumes,
  suggestedResumeId,
  suggestedReason,
  matches,
  selected,
  selectedKeywords,
  job,
}) => (
  <div id="resume-match">
    <Card>
      <SectionTitle>Resume match</SectionTitle>
      {resumes.length === 0 ? (
        <Hint>
          No resumes uploaded.{' '}
          <a href="/resumes" class="font-medium text-accent-strong hover:text-accent-deep">
            Upload one
          </a>{' '}
          to see what to change before applying here.
        </Hint>
      ) : (
        <form method="post" action={`/jobs/${jobId}/match`} class="flex flex-wrap items-end gap-3" onsubmit={SUBMIT_ONCE}>
          {/* Set by the second button's click: SUBMIT_ONCE disables the buttons in the
              submit event, and a disabled submitter is left out of the form data. */}
          <input type="hidden" name="mode" value="fast" />
          <label class="block min-w-0 max-w-full">
            <span class="block text-[13px] font-medium text-ink">Resume</span>
            <Select name="resumeId" class="mt-1.5 !w-auto max-w-full">
              {resumes.map((r) => (
                <option value={r.id} selected={r.id === (suggestedResumeId ?? resumes[0]?.id)}>
                  {r.name}
                  {r.id === suggestedResumeId
                    ? suggestedReason === 'linked'
                      ? ' · your search hunts with this'
                      : ' · best skill overlap'
                    : ''}
                  {r.isDefault ? ' · default' : ''}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="violet" title="Keywords, hard requirements and the score — no edit suggestions">
            Compare
          </Button>
          <Button
            variant="secondary"
            onclick="this.form.elements.mode.value='full'"
            title="The same check plus what to change and what to remove"
          >
            Full analysis
          </Button>
          <Hint class="basis-full">
            Compare is the quick check — one call to the resume model, about half a minute on
            Opus, and you can ask for the suggestions afterwards. Full analysis writes them right
            away and takes 1½ to 2 minutes. The score itself is computed deterministically from
            the reply — same facts, same number, every time.
          </Hint>
        </form>
      )}

      {selected && (
        <MatchReport
          match={selected}
          previous={previousFor(selected, matches)}
          keywords={selectedKeywords}
          factsBack={`/jobs/${jobId}?match=${selected.id}#resume-match`}
          job={job}
        />
      )}

      {matches.length > 1 && (
        <div class="mt-5 border-t border-line pt-4">
          <div class={SUBHEAD}>All comparisons</div>
          <ul class="flex flex-wrap gap-2">
            {matches.map((m) => (
              <li>
                <a
                  href={`/jobs/${jobId}?match=${m.id}#resume-match`}
                  aria-current={selected?.id === m.id ? 'true' : undefined}
                  class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors duration-150 ${
                    selected?.id === m.id
                      ? 'border-accent/50 bg-accent/5 text-ink'
                      : 'border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <FitBadge score={m.matchScore} label="match" />
                  {m.resume.name}
                  <span class="font-mono text-ink-faint">
                    v{m.resumeVersion}
                    {m.draft ? ' draft' : ''}
                  </span>
                  <span class="text-ink-faint">{formatRelative(m.createdAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  </div>
);

/** The most recent earlier comparison of the same resume — for the "vs last time" delta. */
export function previousFor(selected: MatchWithResume, matches: MatchWithResume[]): MatchWithResume | null {
  return (
    matches.find((m) => m.resumeId === selected.resumeId && m.createdAt < selected.createdAt) ?? null
  );
}

/** "Why this score" — component chips under the number. Shared with the targeted view. */
export const ScoreBreakdownChips: FC<{ bd: ScoreBreakdown }> = ({ bd }) => (
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
    <span>
      Keywords <span class="font-medium tabular-nums text-ink">{bd.keywordPts}</span>/{bd.keywordMax}
    </span>
    <span title="title + summary + most recent role">
      Alignment <span class="font-medium tabular-nums text-ink">{bd.alignmentPts}</span>/{bd.alignmentMax}
      {bd.alignment && (
        <span class="text-ink-faint">
          {' '}
          ({bd.alignment.title} · {bd.alignment.summary} · {bd.alignment.recent_role})
        </span>
      )}
    </span>
    {bd.penalty > 0 && <span class="text-danger">−{bd.penalty} red flags</span>}
    {bd.cap !== null && (
      <span class="font-medium text-warn">
        capped at {bd.cap} — primary stack {bd.primaryPresent}/{bd.primaryTotal}
      </span>
    )}
    {bd.ceiling !== undefined && (
      <span
        title="The honest maximum for this resume on this posting: every claimable keyword written in, alignment perfect. Going higher needs experience this resume doesn't show."
      >
        {bd.ceiling > bd.score ? (
          <>
            max reachable <span class="font-medium tabular-nums text-ink">{bd.ceiling}</span>
          </>
        ) : (
          <span class="font-medium text-ok">at its ceiling — nothing left to squeeze</span>
        )}
      </span>
    )}
  </div>
);

/** Hard-requirement gates as one compact line — for the targeted view's score card. */
export const HardRequirementsDigest: FC<{ hard: MatchHardRequirement[] }> = ({ hard }) => {
  if (hard.length === 0) return null;
  const pass = hard.filter((h) => h.status === 'pass').length;
  const issues = hard.filter((h) => h.status !== 'pass');
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span class="text-[13px] font-medium text-ink-muted">Hard requirements</span>
      <Badge tone={issues.length === 0 ? 'ok' : issues.some((h) => h.status === 'fail') ? 'danger' : 'warn'}>
        {pass}/{hard.length} pass
      </Badge>
      {issues.map((h) => (
        <span class="inline-flex items-center gap-1.5 text-[13px] text-ink" title={h.note ?? undefined}>
          <Badge tone={HARD_VIEW[h.status].tone}>{HARD_VIEW[h.status].label}</Badge>
          {h.requirement}
        </span>
      ))}
    </div>
  );
};

/** ask_user keywords → confirm/deny forms. Answers persist as CandidateFact rows. */
export const ConfirmFacts: FC<{ asks: MatchKeyword[]; matchId: number; back: string }> = ({
  asks,
  matchId,
  back,
}) =>
  asks.length === 0 ? null : (
    <div>
      <div class={SUBHEAD}>Confirm your experience — the posting wants these</div>
      <ul class="divide-y divide-line rounded-md border border-violet/30">
        {asks.map((k) => (
          <li class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
            <div class="min-w-0 flex-1 text-sm">
              <span class="font-medium text-ink">{k.term}</span>
              {k.note && <span class="ml-2 text-xs text-ink-faint">{k.note}</span>}
              {k.elsewhere && (
                <Badge tone="violet" class="ml-2">
                  in "{k.elsewhere}"
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
                  placeholder="where / when? (optional)"
                  aria-label={`Where or when did you use ${k.term}?`}
                  class="!w-44 !px-2 !py-1 !text-xs"
                />
                <Button size="sm" variant="violet">
                  I have it
                </Button>
              </form>
              <ActionForm
                action="/facts"
                hidden={{ term: k.term, decision: 'denied', matchId, back }}
              >
                <Button size="sm" variant="ghost">
                  I don't
                </Button>
              </ActionForm>
            </div>
          </li>
        ))}
      </ul>
      <Hint class="mt-1.5">
        Answers are stored once and reused in every future comparison. Confirming updates this
        score instantly — no AI call.
      </Hint>
    </div>
  );

export const MatchReport: FC<{
  match: MatchWithResume;
  previous: MatchWithResume | null;
  /** This match's keywords, ordered and counted by the matcher (§5). */
  keywords: CountedKeyword[];
  /** Where the ask_user confirm/deny and keyword-override forms return to. */
  factsBack: string;
  /** Names the change sheet the Copy button hands over. */
  job: { title: string; companyName: string };
}> = ({ match, previous, keywords, factsBack, job }) => {
  const bd = readBreakdown(match.breakdown);
  // A re-extracted frame counts different terms, so the older number is not a
  // baseline for this one (keyword-frame.ts). DeltaBox says so in words.
  const scoreDelta = previous && !freshFrame(match.breakdown) ? match.matchScore - previous.matchScore : null;
  return (
    <div class="mt-5 space-y-5 border-t border-line pt-4">
      <div class="flex flex-wrap items-center gap-3">
        <FitBadge score={match.matchScore} label="match" />
        {scoreDelta !== null && (
          <Badge tone={scoreDelta > 0 ? 'ok' : scoreDelta < 0 ? 'danger' : 'neutral'}>
            {scoreDelta > 0 ? '▲' : scoreDelta < 0 ? '▼' : '='} {scoreDelta > 0 ? '+' : ''}
            {scoreDelta} vs v{previous?.resumeVersion}
          </Badge>
        )}
        <span class="text-sm text-ink">
          {match.resume.name}{' '}
          <span class="font-mono text-xs text-ink-faint">v{match.resumeVersion}</span>
        </span>
        <span class="text-xs text-ink-faint">
          {formatRelative(match.createdAt)} · <span class="font-mono">{match.model}</span>
          {match.draft ? ' · draft' : ''}
        </span>
        <a
          href={`/jobs/${match.jobId}/target?match=${match.id}`}
          class="ml-auto text-sm font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
        >
          Open targeted view →
        </a>
      </div>
      <p class="text-sm leading-6 text-ink">{match.summary}</p>
      {bd && <ScoreBreakdownChips bd={bd} />}

      <DeltaBox match={match} previous={previous} />
      <HardRequirementsBlock hard={readHardRequirements(match.hardRequirements)} />
      <MatchSignals match={match} />
      <ConfirmFacts
        asks={keywords.filter((k) => k.status === 'ask_user')}
        matchId={match.id}
        back={factsBack}
      />

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
            <Hint class="!mt-0">as Markdown, for the document your resume really lives in</Hint>
          </div>
          <ActionsBlock actions={readActions(match.actions)} />
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
    <div class={SUBHEAD}>What to change — not written yet</div>
    <p class="mb-2.5 text-sm leading-6 text-ink-muted">
      This was a quick check: keywords, hard requirements and the score. Edit suggestions are a
      second call to the resume model that reuses these verdicts — about a minute on Opus, and the
      score stays exactly as it is.
    </p>
    <ActionForm action={`/jobs/${jobId}/matches/${matchId}/suggestions`} hidden={next ? { next } : undefined}>
      <Button size="sm" variant="violet">
        Get suggestions
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
      <div class="rounded-md border border-line bg-surface-overlay/50 px-3 py-2 text-xs leading-5 text-ink-muted">
        <span class="font-medium text-ink">Not comparable with v{previous.resumeVersion}: </span>
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
    <div class="rounded-md border border-line bg-surface-overlay/50 px-3 py-2 text-xs leading-5 text-ink-muted">
      <span class="font-medium text-ink">vs v{previous.resumeVersion}: </span>
      {delta.gained.length > 0 && (
        <span>
          gained <span class="text-ok">{delta.gained.join(', ')}</span>
          {' · '}
        </span>
      )}
      {delta.lost.length > 0 && (
        <span>
          lost <span class="text-danger">{delta.lost.join(', ')}</span>
          {' · '}
        </span>
      )}
      {delta.components ? (
        <span>
          keywords {fmtDelta(delta.components.keywordPts)} · alignment{' '}
          {fmtDelta(delta.components.alignmentPts)}
          {delta.components.penalty !== 0 && ` · flags ${fmtDelta(-delta.components.penalty)}`}
          {delta.components.capBefore !== delta.components.capAfter &&
            ` · cap ${delta.components.capBefore ?? 'none'} → ${delta.components.capAfter ?? 'none'}`}
        </span>
      ) : (
        <span>score {fmtDelta(match.matchScore - previous.matchScore)}</span>
      )}
    </div>
  );
};

/** Full hard-requirement list with notes — the score card shows only the digest. */
export const HardRequirementsBlock: FC<{ hard: MatchHardRequirement[] }> = ({ hard }) =>
  hard.length === 0 ? null : (
    <div>
      <div class={SUBHEAD}>Hard requirements — gates outside the score</div>
      <ul class="space-y-1.5 text-sm">
        {hard.map((h) => (
          <li class="flex flex-wrap items-center gap-2">
            <Badge tone={HARD_VIEW[h.status].tone}>{HARD_VIEW[h.status].label}</Badge>
            <span class="text-ink">{h.requirement}</span>
            {h.note && <span class="text-xs text-ink-faint">— {h.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );

/** Red flags, unscored cautions and strengths — the qualitative read on a match. */
export const MatchSignals: FC<{ match: MatchWithResume }> = ({ match }) => (
  <>
    <MarkedList label="Red flags" items={match.redFlags} kind="x" tone="text-danger" />
    {match.cautions.length > 0 && (
      <div>
        <div class={SUBHEAD}>Worth knowing — not scored</div>
        <ul class="space-y-1 text-sm text-ink-muted">
          {match.cautions.map((s) => (
            <li class="flex gap-2">
              <span class="mt-[3px] h-3.5 w-3.5 shrink-0 text-center text-xs leading-none text-ink-faint" aria-hidden="true">
                ·
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
    <MarkedList label="Already working for you" items={match.strengths} kind="check" tone="text-ok" />
  </>
);

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
}> = ({ item, badge, proposal, interactive, removal = false, badgeWidth = 'w-16' }) => {
  const copyable = proposal?.text ?? item.quote ?? item.what;
  // Stable across re-runs of the same comparison, so applied/skipped marks survive a reload.
  const key = hashShortId(`${item.section}|${item.where}|${item.quote ?? ''}`);
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
        <div class="font-medium text-ink">{item.where}</div>
        <div class="mt-0.5 leading-6 text-ink">{item.what}</div>
        {item.quote && (
          <div class="mt-2">
            <div class={LABEL}>Now</div>
            <p
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
            <div class={LABEL}>{proposal.verb ?? 'Proposed'}</div>
            <p class="mt-0.5 whitespace-pre-wrap break-words border-l-2 border-accent/50 pl-2 leading-6 text-ink">
              {proposal.text}
            </p>
          </div>
        )}
        <div class="mt-1 text-xs leading-5 text-ink-faint">why: {item.why}</div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          {canApply && (
            <Button type="button" variant="primary" size="sm" data-apply={proposal?.text}>
              Apply
            </Button>
          )}
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" data-edit-apply>
              Edit &amp; apply
            </Button>
          )}
          {canRemove && (
            <Button type="button" variant="danger" size="sm" data-remove={item.quote}>
              Remove
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" data-copy={copyable}>
            Copy
          </Button>
          {interactive && item.quote && (
            <Button type="button" variant="ghost" size="sm" data-locate={item.quote}>
              Locate
            </Button>
          )}
          {(canEdit || canRemove) && (
            <Button type="button" variant="ghost" size="sm" data-skip>
              Skip
            </Button>
          )}
          {interactive && (
            <Button type="button" variant="ghost" size="sm" data-undo hidden>
              Undo
            </Button>
          )}
          {/* One status line per card: Locate's line number, and what an edit did. */}
          {interactive && <span class="text-xs text-ink-faint" data-card-status role="status"></span>}
        </div>
        {canEdit && (
          <div class="mt-2" data-edit-box hidden {...target}>
            <label class="block">
              <span class={LABEL}>Your wording</span>
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
                Apply this
              </Button>
              <Button type="button" variant="ghost" size="sm" data-edit-cancel>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
};

/** "What to change" — one card per edit, with Copy and (on the targeted view) Locate. */
export const ActionsBlock: FC<{ actions: MatchAction[]; interactive?: boolean }> = ({
  actions,
  interactive = false,
}) => {
  const sections = ACTION_SECTIONS.filter((s) => actions.some((a) => a.section === s));
  return (
    <div>
      <div class={SUBHEAD}>What to change — {actions.length} edits</div>
      {actions.length === 0 ? (
        <Hint>No edits suggested.</Hint>
      ) : (
        <div class="space-y-4">
          {sections.map((section) => (
            <div>
              <div class="mb-1.5 text-xs font-semibold text-ink">{section}</div>
              <ol class="divide-y divide-line rounded-md border border-line">
                {actions
                  .filter((a) => a.section === section)
                  .map((a) => (
                    <SuggestionCard
                      item={a}
                      badge={<Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge>}
                      proposal={proposalOf(a)}
                      interactive={interactive}
                    />
                  ))}
              </ol>
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
      <div class={SUBHEAD}>What to remove — {removals.length} items</div>
      <ul class="divide-y divide-line rounded-md border border-line">
        {removals.map((r) => (
          <SuggestionCard
            item={r}
            badge={<Badge tone="neutral">{r.section}</Badge>}
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
      Copy all suggestions
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
  keywords: CountedKeyword[];
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
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px] font-medium text-ink-muted">
        <span>
          Keyword coverage — {matchedKeywords.length} of {counted.length} matched
          {ignored.length > 0 ? ` · ${ignored.length} ignored` : ''}
        </span>
        {rebuild && <RebuildKeywords target={rebuild} />}
      </div>
      {attention.length > 0 ? (
        <Table columns={KEYWORD_COLUMNS}>
          {attention.map((k) => (
            <KeywordRow k={k} edit={edit} />
          ))}
        </Table>
      ) : (
        <Hint class="px-5 pb-3">Every keyword the posting wants is matched.</Hint>
      )}
      {matchedKeywords.length > 0 && (
        <details>
          <summary class={KEYWORD_SUMMARY}>Matched — {matchedKeywords.length} keywords</summary>
          <Table columns={KEYWORD_COLUMNS}>
            {matchedKeywords.map((k) => (
              <KeywordRow k={k} edit={edit} />
            ))}
          </Table>
        </details>
      )}
      {ignored.length > 0 && (
        <details>
          <summary class={KEYWORD_SUMMARY}>
            Ignored — {ignored.length} keyword{ignored.length === 1 ? '' : 's'} out of the score
          </summary>
          <Table columns={KEYWORD_COLUMNS}>
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
  return `Runs this ${mode === 'fast' ? 'check (~½ min on Opus)' : 'full analysis (~2 min on Opus)'} once without the stored keyword list, so the model reads the terms out of the posting again. Your own keyword edits are kept; the new score counts a different set of terms.`;
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
      Rebuild keywords
    </button>
  ) : (
    <form method="post" action={`/jobs/${target.jobId}/match`} class="ml-auto" onsubmit={SUBMIT_ONCE}>
      <input type="hidden" name="resumeId" value={String(target.resumeId)} />
      <input type="hidden" name="mode" value={target.mode} />
      <input type="hidden" name="rebuild" value="1" />
      {/* A draft row was judged on text no version holds — send it back, or the
          rebuild would quietly score the stored resume instead. */}
      {target.draftText !== undefined && <input type="hidden" name="draftText" value={target.draftText} />}
      <button type="submit" class={ROW_LINK} title={rebuildTitle(target.mode)}>
        Rebuild keywords
      </button>
    </form>
  );

const KEYWORD_SUMMARY =
  'cursor-pointer border-t border-line px-5 py-2.5 text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink';

function fmtDelta(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

const KeywordRow: FC<{ k: CountedKeyword; edit?: KeywordEditTarget }> = ({ k, edit }) => (
  <Tr class={isIgnored(k) ? 'opacity-60' : ''}>
    <Td class="text-xs font-medium text-ink">
      <span class="inline-flex flex-wrap items-center gap-1.5">
        {k.term}
        {k.primary && <Badge tone="info">primary</Badge>}
        {k.count > 1 && (
          <span class="font-mono text-ink-faint" title={`the posting says it ${k.count} times`}>
            ×{k.count}
          </span>
        )}
        {k.override?.added && <Badge tone="violet">yours</Badge>}
      </span>
    </Td>
    <Td class="text-xs text-ink-faint">
      {edit ? <LevelControls k={k} edit={edit} /> : effectiveRequirement(k)}
    </Td>
    <Td>
      <span class="inline-flex flex-wrap items-center gap-1">
        <Badge tone={STATUS_VIEW[k.status].tone}>{STATUS_VIEW[k.status].label}</Badge>
        {k.elsewhere && <Badge tone="violet">in "{k.elsewhere}"</Badge>}
        {k.unanchored && (
          <span
            title={
              k.override?.added
                ? 'You added this word and the posting does not contain it, so the description pane cannot highlight it.'
                : 'The AI worded this keyword differently from the posting, so the description pane cannot highlight it.'
            }
          >
            <Badge>not in posting</Badge>
          </span>
        )}
      </span>
    </Td>
    <Td class="text-xs text-ink-muted">{k.where ?? '—'}</Td>
    <Td class="max-w-md text-xs text-ink-muted">{k.note ?? '—'}</Td>
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
        class="!w-auto py-1 text-xs"
        data-commit="submit"
        aria-label={`How much the posting wants ${k.term}`}
        title={
          !overridden
            ? 'how much the posting wants it'
            : level === k.requirement
              ? 'you set this level — it stays yours on every re-run'
              : `you set this — the AI said ${k.requirement}`
        }
      >
        {REQUIREMENT_LEVELS.map((r) => (
          <option value={r} selected={r === level}>
            {r}
          </option>
        ))}
      </Select>
      {overridden && <Badge tone="violet">yours</Badge>}
      <button
        type="submit"
        class={ROW_LINK}
        onclick={`this.form.elements.op.value='${isIgnored(k) ? 'restore' : 'ignore'}'`}
        title={
          isIgnored(k)
            ? 'Count this keyword again'
            : 'Noise: drop it from the score and the highlights (you can bring it back)'
        }
      >
        {isIgnored(k) ? 'restore' : 'ignore'}
      </button>
      {(overridden || k.override?.added) && (
        <button
          type="submit"
          class={ROW_LINK}
          onclick="this.form.elements.op.value='reset'"
          title={k.override?.added ? 'Remove the keyword you added' : "Back to the AI's own verdict"}
        >
          {k.override?.added ? 'remove' : 'reset'}
        </button>
      )}
    </form>
  );
};

const ROW_LINK =
  'cursor-pointer whitespace-nowrap text-xs text-ink-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline';

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
      <span class="block text-[13px] font-medium text-ink">Add a keyword</span>
      <Input
        name="term"
        required
        maxlength={60}
        placeholder="a word this posting wants"
        class="mt-1.5 !w-56 py-1 text-xs"
      />
    </label>
    <Select name="requirement" class="!w-auto py-1 text-xs" aria-label="How much the posting wants it">
      {REQUIREMENT_LEVELS.map((r) => (
        <option value={r} selected={r === 'preferred'}>
          {r}
        </option>
      ))}
    </Select>
    <Button size="sm" variant="secondary">
      Add
    </Button>
    <Hint class="basis-full">
      It counts in the score straight away — matched if your resume already says it, otherwise a
      confirm question. No AI call.
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
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
