/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Badge, Button, Card, FitBadge, Hint, SectionTitle, Select, Table, Td, Tr } from '../ui';
import type { Tone } from '../format';
import { formatRelative } from '../format';
import type { MatchWithResume } from '../../resume/store';
import {
  ACTION_SECTIONS,
  readActions,
  readKeywords,
  readRemovals,
  type MatchAction,
  type MatchKeyword,
} from '../../resume/prompts';

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

const STATUS_VIEW: Record<MatchKeyword['status'], { label: string; tone: Tone }> = {
  present: { label: 'present', tone: 'ok' },
  add: { label: 'add', tone: 'warn' },
  cannot_claim: { label: "can't claim", tone: 'danger' },
};

export const ResumeMatchCard: FC<ResumeMatchCardProps> = ({
  jobId,
  resumes,
  suggestedResumeId,
  matches,
  selected,
}) => (
  <div id="resume-match">
    <Card class="mb-6">
      <SectionTitle>Resume match</SectionTitle>
      {resumes.length === 0 ? (
        <Hint>
          No resumes uploaded.{' '}
          <a href="/resumes" class="text-accent hover:underline">
            Upload one
          </a>{' '}
          to see what to change before applying here.
        </Hint>
      ) : (
        <form method="post" action={`/jobs/${jobId}/match`} class="flex flex-wrap items-end gap-3">
          <label class="block">
            <span class="block text-xs uppercase tracking-wider text-ink-faint">Resume</span>
            <Select name="resumeId" class="mt-1 !w-auto">
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
            One call to the resume model, about a minute. Edit the resume, upload it as a new
            version on its page, then Compare again — the score uses the same rubric every time.
          </Hint>
        </form>
      )}

      {selected && <MatchReport match={selected} previous={previousFor(selected, matches)} />}

      {matches.length > 1 && (
        <div class="mt-5 border-t border-line pt-4">
          <div class="mb-2 text-xs uppercase tracking-wider text-ink-faint">All comparisons</div>
          <ul class="flex flex-wrap gap-2">
            {matches.map((m) => (
              <li>
                <a
                  href={`/jobs/${jobId}?match=${m.id}#resume-match`}
                  aria-current={selected?.id === m.id ? 'true' : undefined}
                  class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    selected?.id === m.id
                      ? 'border-accent/60 bg-accent/5 text-ink'
                      : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <FitBadge score={m.matchScore} label="match" />
                  {m.resume.name}
                  <span class="font-mono text-ink-faint">v{m.resumeVersion}</span>
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
function previousFor(selected: MatchWithResume, matches: MatchWithResume[]): MatchWithResume | null {
  return (
    matches.find((m) => m.resumeId === selected.resumeId && m.createdAt < selected.createdAt) ?? null
  );
}

const MatchReport: FC<{ match: MatchWithResume; previous: MatchWithResume | null }> = ({
  match,
  previous,
}) => {
  const actions = readActions(match.actions);
  const removals = readRemovals(match.removals);
  const keywords = readKeywords(match.keywords);
  const sections = ACTION_SECTIONS.filter((s) => actions.some((a) => a.section === s));
  const delta = previous ? match.matchScore - previous.matchScore : null;
  return (
    <div class="mt-5 space-y-5 border-t border-line pt-4">
      <div class="flex flex-wrap items-center gap-3">
        <FitBadge score={match.matchScore} label="match" />
        {delta !== null && (
          <Badge tone={delta > 0 ? 'ok' : delta < 0 ? 'danger' : 'neutral'}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {delta > 0 ? '+' : ''}
            {delta} vs v{previous?.resumeVersion}
          </Badge>
        )}
        <span class="text-sm text-ink">
          {match.resume.name} <span class="font-mono text-xs text-ink-faint">v{match.resumeVersion}</span>
        </span>
        <span class="text-xs text-ink-faint">
          {formatRelative(match.createdAt)} · <span class="font-mono">{match.model}</span>
        </span>
      </div>
      <p class="max-w-prose text-sm leading-6 text-ink">{match.summary}</p>

      <MarkedList label="Red flags" items={match.redFlags} mark="✗" tone="text-danger" />
      <MarkedList label="Already working for you" items={match.strengths} mark="✓" tone="text-ok" />

      <div>
        <div class="mb-2 text-xs uppercase tracking-wider text-ink-faint">
          What to change — {actions.length} edits
        </div>
        {actions.length === 0 ? (
          <Hint>No edits suggested.</Hint>
        ) : (
          <div class="space-y-4">
            {sections.map((section) => (
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  {section}
                </div>
                <ol class="divide-y divide-line rounded-md border border-line">
                  {actions
                    .filter((a) => a.section === section)
                    .map((a) => (
                      <li class="flex flex-col gap-1 p-3 sm:flex-row sm:gap-3">
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
          <div class="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            What to remove — {removals.length} items
          </div>
          <ul class="divide-y divide-line rounded-md border border-line">
            {removals.map((r) => (
              <li class="flex flex-col gap-1 p-3 sm:flex-row sm:gap-3">
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
          <div class="px-5 pt-4 text-xs uppercase tracking-wider text-ink-faint">
            Keyword coverage — {keywords.filter((k) => k.status === 'present').length} of{' '}
            {keywords.length} present
          </div>
          <Table columns={['Keyword', 'P', 'Status', 'Where', 'Note']}>
            {keywords.map((k) => (
              <Tr>
                <Td class="font-mono text-xs text-ink">{k.term}</Td>
                <Td class="font-mono text-xs text-ink-faint">{k.priority}</Td>
                <Td>
                  <Badge tone={STATUS_VIEW[k.status].tone}>{STATUS_VIEW[k.status].label}</Badge>
                </Td>
                <Td class="text-xs text-ink-muted">{k.where ?? '—'}</Td>
                <Td class="max-w-md text-xs text-ink-muted">{k.note ?? '—'}</Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
};

const MarkedList: FC<{ label: string; items: string[]; mark: string; tone: string }> = ({
  label,
  items,
  mark,
  tone,
}) =>
  items.length === 0 ? null : (
    <div>
      <div class="mb-1 text-xs uppercase tracking-wider text-ink-faint">{label}</div>
      <ul class="space-y-1 text-sm text-ink-muted">
        {items.map((s) => (
          <li class="flex gap-2">
            <span class={tone} aria-hidden="true">
              {mark}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
