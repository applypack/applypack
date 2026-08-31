/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { ActionForm, Badge, Button, Card, Hint, Input, SectionTitle, Select, Tag, Textarea } from '../ui';
import type { Tone } from '../format';
import { formatRelative } from '../format';
import type { CoverLetterWithResume } from '../../resume/store';
import {
  countWords,
  COVER_TONES,
  COVER_WORDS_MAX,
  COVER_WORDS_MIN,
  type CoverAngles,
} from '../../resume/prompts';

export interface CoverLetterCardProps {
  jobId: number;
  resumes: { id: number; name: string; isDefault: boolean }[];
  /** Best skill overlap for this posting — preselected, same as the match card. */
  suggestedResumeId: number | null;
  letters: CoverLetterWithResume[];
  selected: CoverLetterWithResume | null;
  /** A stored verification snapshot exists — company facts beyond the posting. */
  hasCompanyFacts: boolean;
  /** Saved on every generation, prefilled here — typed once, remembered (F8.1). */
  angles: CoverAngles;
}

/** `block` is reachable only through a manual edit — generation never persists one. */
const GATE_VIEW: Record<string, { label: string; tone: Tone }> = {
  pass: { label: 'fact-check pass', tone: 'ok' },
  warn: { label: 'fact-check warn', tone: 'warn' },
  block: { label: 'fact-check block', tone: 'danger' },
};

const SUBHEAD = 'mb-2 text-[13px] font-medium text-ink-muted';

export const CoverLetterCard: FC<CoverLetterCardProps> = ({
  jobId,
  resumes,
  suggestedResumeId,
  letters,
  selected,
  hasCompanyFacts,
  angles,
}) => (
  <div id="cover-letter">
    <Card>
      <SectionTitle>Cover letter</SectionTitle>
      {resumes.length === 0 ? (
        <Hint>
          No resumes uploaded.{' '}
          <a href="/resumes" class="font-medium text-accent-strong hover:text-accent-deep">
            Upload one
          </a>{' '}
          — the letter is written from your resume, never from thin air.
        </Hint>
      ) : (
        <form method="post" action={`/jobs/${jobId}/cover`} class="space-y-3">
          <input type="hidden" name="saveAngles" value="1" />
          <div class="flex flex-wrap items-end gap-3">
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
            <label class="block">
              <span class="block text-[13px] font-medium text-ink">Tone</span>
              <Select name="tone" class="mt-1.5 !w-auto">
                {COVER_TONES.map((t) => (
                  <option value={t} selected={t === 'warm'}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="violet">Generate letter</Button>
          </div>
          <details class="rounded-md border border-line px-3 py-2" open={hasAngles(angles)}>
            <summary class="cursor-pointer text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
              Angle — optional, saved for your next letters
            </summary>
            <div class="mt-2.5 grid gap-2.5 sm:grid-cols-3">
              <label class="block">
                <span class="block text-xs text-ink-muted">Why this company</span>
                <Input name="whyCompany" maxlength="300" class="mt-1 !text-xs" value={angles.whyCompany ?? ''} />
              </label>
              <label class="block">
                <span class="block text-xs text-ink-muted">What problem you'd solve</span>
                <Input name="problem" maxlength="300" class="mt-1 !text-xs" value={angles.problem ?? ''} />
              </label>
              <label class="block">
                <span class="block text-xs text-ink-muted">Your approach</span>
                <Input name="approach" maxlength="300" class="mt-1 !text-xs" value={angles.approach ?? ''} />
              </label>
            </div>
            <label class="mt-2.5 block">
              <span class="block text-xs text-ink-muted">
                Anything every letter should mention
              </span>
              <Textarea name="notes" rows={2} maxlength="500" class="mt-1 !text-xs" placeholder="e.g. my open-source work matters to me; I can start immediately; I want to mention my blog">
                {angles.notes ?? ''}
              </Textarea>
            </label>
            <Hint class="mt-2">
              These steer what the letter emphasises and are remembered after you generate —
              edit or clear them any time. Facts and numbers still come only from your resume
              and confirmed facts; a number typed here is not enough for the fact check.
            </Hint>
          </details>
          <Hint>
            One model call, about half a minute. Every claim is fact-checked against the resume
            before you see the letter — an invented number or tool is rejected, not shown.
            {!hasCompanyFacts && (
              <>
                {' '}
                No company research stored yet, so company lines stick to the posting itself —{' '}
                <a href="#verification" class="font-medium text-accent-strong hover:text-accent-deep">
                  Verify first
                </a>{' '}
                for researched company facts.
              </>
            )}
          </Hint>
        </form>
      )}

      {selected && <LetterReport jobId={jobId} letter={selected} />}

      {letters.length > 1 && (
        <div class="mt-5 border-t border-line pt-4">
          <div class={SUBHEAD}>All letters</div>
          <ul class="flex flex-wrap gap-2">
            {letters.map((l) => (
              <li>
                <a
                  href={`/jobs/${jobId}?letter=${l.id}#cover-letter`}
                  aria-current={selected?.id === l.id ? 'true' : undefined}
                  class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors duration-150 ${
                    selected?.id === l.id
                      ? 'border-accent/50 bg-accent/5 text-ink'
                      : 'border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <Badge tone={(GATE_VIEW[l.gateVerdict] ?? GATE_VIEW.pass!).tone}>
                    {l.gateVerdict}
                  </Badge>
                  {l.resume.name}
                  <span class="font-mono text-ink-faint">v{l.resumeVersion}</span>
                  <span class="text-ink-faint">{formatRelative(l.createdAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  </div>
);

/** Open the details when saved values exist — hidden prefills would be invisible state. */
function hasAngles(a: CoverAngles): boolean {
  return Boolean(a.whyCompany || a.problem || a.approach || a.notes);
}

const LetterReport: FC<{ jobId: number; letter: CoverLetterWithResume }> = ({ jobId, letter }) => {
  const gate = GATE_VIEW[letter.gateVerdict] ?? GATE_VIEW.pass!;
  const text = letter.editedText ?? letter.text;
  const words = countWords(text);
  return (
    <div class="mt-5 space-y-4 border-t border-line pt-4">
      <div class="flex flex-wrap items-center gap-3">
        <Badge tone={gate.tone}>{gate.label}</Badge>
        <span class="text-sm text-ink">
          {letter.resume.name}{' '}
          <span class="font-mono text-xs text-ink-faint">v{letter.resumeVersion}</span>
        </span>
        <Badge tone="neutral">{letter.tone}</Badge>
        {letter.editedText && <Badge tone="info">edited</Badge>}
        <span class="text-xs text-ink-faint">
          {formatRelative(letter.createdAt)} · <span class="font-mono">{letter.model}</span>
        </span>
        <ActionForm
          action={`/jobs/${jobId}/cover`}
          hidden={{ resumeId: letter.resumeId, tone: letter.tone }}
          class="ml-auto"
        >
          <Button
            variant="ghost"
            size="sm"
            title="Fresh draft — same resume and tone, current saved angle and prompt"
          >
            Regenerate
          </Button>
        </ActionForm>
      </div>

      <form
        method="post"
        action={`/jobs/${jobId}/cover/${letter.id}`}
        data-letter-form
        class="space-y-2"
      >
        <label class="block">
          <span class="sr-only">Letter text</span>
          <Textarea id={`cover-text-${letter.id}`} name="text" rows={13} class="font-normal">
            {text}
          </Textarea>
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-copy-target={`cover-text-${letter.id}`}
          >
            Copy letter
          </Button>
          <Button href={`/jobs/${jobId}/cover/${letter.id}/file/pdf`} variant="secondary" size="sm">
            Save as PDF
          </Button>
          <Button href={`/jobs/${jobId}/cover/${letter.id}/file/docx`} variant="secondary" size="sm">
            Save as DOCX
          </Button>
          {/* The no-JS path: cover-letter.mjs hides this and autosaves instead. */}
          <Button variant="ghost" size="sm" data-save-button>
            Save edit
          </Button>
          <span
            class="text-xs text-ink-faint transition-colors duration-150"
            data-save-status
            role="status"
            aria-live="polite"
          ></span>
          <span class="ml-auto text-xs tabular-nums text-ink-faint">
            <span data-word-count>{words}</span> words · target {COVER_WORDS_MIN}–{COVER_WORDS_MAX}
          </span>
        </div>
        <Hint>
          Your edits save themselves and are re-checked against the resume — your own words are
          flagged, never blocked. Restoring the generated text clears the edit.
        </Hint>
      </form>

      <div class="grid gap-4 sm:grid-cols-2">
        {letter.keywordsUsed.length > 0 && (
          <div>
            <div class={SUBHEAD}>Posting keywords worked in</div>
            <div class="flex flex-wrap gap-1.5">
              {letter.keywordsUsed.map((k) => (
                <Tag tone="ok">{k}</Tag>
              ))}
            </div>
          </div>
        )}
        {letter.gapsAcknowledged.length > 0 && (
          <div>
            <div class={SUBHEAD}>Gaps conceded or left out</div>
            <div class="flex flex-wrap gap-1.5">
              {letter.gapsAcknowledged.map((g) => (
                <Tag tone="danger">{g}</Tag>
              ))}
            </div>
          </div>
        )}
      </div>
      <div class="text-xs text-ink-faint">
        Company facts: {letter.usedVerification ? 'verification snapshot + posting' : 'posting only'}
        {letter.gateNotes.length > 0 && <> · {letter.gateNotes.join(' · ')}</>}
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: COVER_BOOT }} />
    </div>
  );
};

const COVER_BOOT = `
import { init } from '/static/cover-letter.mjs';
init();
`;
