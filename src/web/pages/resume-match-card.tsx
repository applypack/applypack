/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  FitBadge,
  Hint,
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
import { readBreakdown, type ScoreBreakdown } from '../../resume/score';
import { diffMatches } from '../../resume/diff';

export interface ResumeMatchCardProps {
  jobId: number;
  resumes: { id: number; name: string; isDefault: boolean }[];
  /** Best skill overlap for this posting — preselected in the dropdown. */
  suggestedResumeId: number | null;
  matches: MatchWithResume[];
  selected: MatchWithResume | null;
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

/** Sort order for the needs-attention keyword rows: hardest requirement first. */
const REQ_RANK: Record<string, number> = { must: 0, preferred: 1, nice: 2, context: 3 };

const KEYWORD_COLUMNS = ['Keyword', 'Wants it', 'Status', 'Where', 'Note'];

const HARD_VIEW: Record<MatchHardRequirement['status'], { label: string; tone: Tone }> = {
  pass: { label: 'pass', tone: 'ok' },
  unknown: { label: 'unknown', tone: 'warn' },
  fail: { label: 'fail', tone: 'danger' },
};

const SUBHEAD = 'mb-2 text-[13px] font-medium text-ink-muted';

export const ResumeMatchCard: FC<ResumeMatchCardProps> = ({
  jobId,
  resumes,
  suggestedResumeId,
  matches,
  selected,
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
        <form method="post" action={`/jobs/${jobId}/match`} class="flex flex-wrap items-end gap-3">
          <label class="block min-w-0 max-w-full">
            <span class="block text-[13px] font-medium text-ink">Resume</span>
            <Select name="resumeId" class="mt-1.5 !w-auto max-w-full">
              {resumes.map((r) => (
                <option value={r.id} selected={r.id === (suggestedResumeId ?? resumes[0]?.id)}>
                  {r.name}
                  {r.id === suggestedResumeId ? ' · best skill overlap' : ''}
                  {r.isDefault ? ' · default' : ''}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="violet">Compare</Button>
          <Hint class="basis-full">
            One call to the resume model, about a minute. The score itself is computed
            deterministically from the reply — same facts, same number, every time.
          </Hint>
        </form>
      )}

      {selected && (
        <MatchReport
          match={selected}
          previous={previousFor(selected, matches)}
          factsBack={`/jobs/${jobId}?match=${selected.id}#resume-match`}
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
        <span class="inline-flex items-center gap-1.5 text-[13px] text-ink">
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
  /** Where the ask_user confirm/deny forms return to. */
  factsBack: string;
  /** On the targeted view: items carry their quote so a click can select it in the editor. */
  jumpable?: boolean;
  /** The targeted view hoists the confirm forms above the tabs — skip them here. */
  hideConfirms?: boolean;
}> = ({ match, previous, factsBack, jumpable = false, hideConfirms = false }) => {
  const actions = readActions(match.actions);
  const removals = readRemovals(match.removals);
  const keywords = readKeywords(match.keywords);
  const hard = readHardRequirements(match.hardRequirements);
  const bd = readBreakdown(match.breakdown);
  const asks = keywords.filter((k) => k.status === 'ask_user');
  // Problems first: unmatched keywords sorted hardest-requirement-first; matched
  // rows fold behind a disclosure so success noise never buries the gaps.
  const attention = keywords
    .filter((k) => k.status !== 'present')
    .sort((a, b) => (REQ_RANK[a.requirement ?? ''] ?? 4) - (REQ_RANK[b.requirement ?? ''] ?? 4));
  const matchedKeywords = keywords.filter((k) => k.status === 'present');
  const sections = ACTION_SECTIONS.filter((s) => actions.some((a) => a.section === s));
  const delta =
    previous !== null
      ? diffMatches(
          { keywords: readKeywords(previous.keywords), breakdown: readBreakdown(previous.breakdown) },
          { keywords, breakdown: bd },
        )
      : null;
  const scoreDelta = previous ? match.matchScore - previous.matchScore : null;
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
        {!jumpable && (
          <a
            href={`/jobs/${match.jobId}/target?match=${match.id}`}
            class="ml-auto text-sm font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
          >
            Open targeted view →
          </a>
        )}
      </div>
      <p class="max-w-prose text-sm leading-6 text-ink">{match.summary}</p>
      {bd && <ScoreBreakdownChips bd={bd} />}

      {delta && (delta.gained.length > 0 || delta.lost.length > 0 || delta.components) && (
        <div class="rounded-md border border-line bg-surface-overlay/50 px-3 py-2 text-xs leading-5 text-ink-muted">
          <span class="font-medium text-ink">vs v{previous?.resumeVersion}: </span>
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
            <span>score {fmtDelta(scoreDelta ?? 0)}</span>
          )}
        </div>
      )}

      {hard.length > 0 && (
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
      )}

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

      {!hideConfirms && <ConfirmFacts asks={asks} matchId={match.id} back={factsBack} />}

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
                      <li
                        class={`flex flex-col gap-1 p-3 sm:flex-row sm:gap-3 ${
                          jumpable && a.quote
                            ? 'cursor-pointer transition-colors duration-150 hover:bg-surface-overlay/50'
                            : ''
                        }`}
                        data-quote={jumpable && a.quote ? a.quote : undefined}
                        title={
                          jumpable && a.quote ? 'Click to select this text in the editor' : undefined
                        }
                      >
                        <div class="w-16 shrink-0">
                          <Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge>
                        </div>
                        <div class="min-w-0 text-sm">
                          <div class="font-medium text-ink">{a.where}</div>
                          <div class="mt-0.5 leading-6 text-ink">{a.what}</div>
                          <div class="mt-0.5 text-xs leading-5 text-ink-faint">why: {a.why}</div>
                        </div>
                      </li>
                    ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>

      {removals.length > 0 && (
        <div>
          <div class={SUBHEAD}>What to remove — {removals.length} items</div>
          <ul class="divide-y divide-line rounded-md border border-line">
            {removals.map((r) => (
              <li
                class={`flex flex-col gap-1 p-3 sm:flex-row sm:gap-3 ${
                  jumpable && r.quote
                    ? 'cursor-pointer transition-colors duration-150 hover:bg-surface-overlay/50'
                    : ''
                }`}
                data-quote={jumpable && r.quote ? r.quote : undefined}
                title={jumpable && r.quote ? 'Click to select this text in the editor' : undefined}
              >
                <div class="w-24 shrink-0">
                  <Badge tone="neutral">{r.section}</Badge>
                </div>
                <div class="min-w-0 text-sm">
                  <div class="font-medium text-ink">{r.where}</div>
                  <div class="mt-0.5 leading-6 text-ink">{r.what}</div>
                  <div class="mt-0.5 text-xs leading-5 text-ink-faint">why: {r.why}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {keywords.length > 0 && (
        <div class="-mx-5 -mb-5 border-t border-line">
          <div class="px-5 py-3 text-[13px] font-medium text-ink-muted">
            Keyword coverage — {matchedKeywords.length} of {keywords.length} matched
          </div>
          {attention.length > 0 ? (
            <Table columns={KEYWORD_COLUMNS}>
              {attention.map((k) => (
                <KeywordRow k={k} />
              ))}
            </Table>
          ) : (
            <Hint class="px-5 pb-3">Every keyword the posting wants is matched.</Hint>
          )}
          {matchedKeywords.length > 0 && (
            <details>
              <summary class="cursor-pointer border-t border-line px-5 py-2.5 text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
                Matched — {matchedKeywords.length} keywords
              </summary>
              <Table columns={KEYWORD_COLUMNS}>
                {matchedKeywords.map((k) => (
                  <KeywordRow k={k} />
                ))}
              </Table>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

function fmtDelta(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

const KeywordRow: FC<{ k: MatchKeyword }> = ({ k }) => (
  <Tr>
    <Td class="text-xs font-medium text-ink">
      <span class="inline-flex flex-wrap items-center gap-1.5">
        {k.term}
        {k.primary && <Badge tone="info">primary</Badge>}
      </span>
    </Td>
    <Td class="text-xs text-ink-faint" title={`priority ${k.priority}`}>
      {k.requirement}
    </Td>
    <Td>
      <span class="inline-flex flex-wrap items-center gap-1">
        <Badge tone={STATUS_VIEW[k.status].tone}>{STATUS_VIEW[k.status].label}</Badge>
        {k.elsewhere && <Badge tone="violet">in "{k.elsewhere}"</Badge>}
      </span>
    </Td>
    <Td class="text-xs text-ink-muted">{k.where ?? '—'}</Td>
    <Td class="max-w-md text-xs text-ink-muted">{k.note ?? '—'}</Td>
  </Tr>
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
