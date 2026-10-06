/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { ActionForm, Badge, Button, Card, Hint, HistoryChip, Input, SectionTitle, Select, Tag, Textarea, When } from '../ui';
import { greetingOf } from '../../resume/addressee';
import type { Tone } from '../format';

import type { CoverLetterWithResume } from '../../resume/store';
import {
  countWords,
  COVER_TONES,
  COVER_WORDS_MAX,
  COVER_WORDS_MIN,
  type CoverAngles,
  type CoverTone,
} from '../../resume/prompts';
import { jobHref } from '../job-tabs';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

export interface CoverLetterCardProps {
  jobId: number;
  /** `label` is `resume-label.ts:resumeOptionLabel`, the preselect's reason included. */
  resumes: { id: number; label: string }[];
  /** Preselected, same as the match card. */
  suggestedResumeId: number | null;
  letters: CoverLetterWithResume[];
  selected: CoverLetterWithResume | null;
  /** A stored verification snapshot exists — company facts beyond the posting. */
  hasCompanyFacts: boolean;
  /** Saved on every generation, prefilled here — typed once, remembered (F8.1). */
  angles: CoverAngles;
  /** Who the letter greets: the person the verifier found, editable; the finding shown beside it (#162 stage 4). */
  addressee: { suggested: string | null; finding: string | null };
  /**
   * The latest comparison with the preselected resume is a quick check — no
   * strengths for the letter to draw on (ADR 0029, #89). Null when it is a
   * full analysis or there is none.
   */
  quickCheck: { matchId: number; resumeName: string } | null;
  /** What a letter usually costs here (ai-spend.ts:costHintText); null until there are three. */
  costHint: string | null;
}

/** The out-of-form "Get suggestions" button posts through this form (a form cannot nest). */
const COVER_SUGGESTIONS_FORM = 'cover-suggestions';

/**
 * `block` is reachable only through a manual edit — generation never persists one.
 * `label` is the badge on the open letter, `word` the short one on a chip in "All letters".
 */
const GATE_VIEW: Record<string, { label: MessageKey; word: MessageKey; tone: Tone }> = {
  pass: { label: 'letter.gate.pass', word: 'letter.verdict.pass', tone: 'ok' },
  warn: { label: 'letter.gate.warn', word: 'letter.verdict.warn', tone: 'warn' },
  block: { label: 'letter.gate.block', word: 'letter.verdict.block', tone: 'danger' },
};

const TONE_LABEL = {
  neutral: 'letter.tones.neutral',
  warm: 'letter.tones.warm',
  direct: 'letter.tones.direct',
} as const satisfies Record<CoverTone, MessageKey>;

/** A letter's tone as the page names it; the value a form posts and a row stores stays the English word. */
export function toneLabel(tone: string): string {
  return Object.hasOwn(TONE_LABEL, tone) ? t(TONE_LABEL[tone as CoverTone]) : tone;
}

const LINK = 'font-medium text-accent-strong hover:text-accent-deep';

/** How much of the verifier's finding is shown beside the field. */
const FINDING_SHOWN_CHARS = 200;

const SUBHEAD = 'mb-2 text-note font-medium text-ink-muted';

export const CoverLetterCard: FC<CoverLetterCardProps> = ({
  jobId,
  resumes,
  suggestedResumeId,
  letters,
  selected,
  hasCompanyFacts,
  angles,
  quickCheck,
  addressee,
  costHint,
}) => (
  <div id="cover-letter">
    <Card>
      <SectionTitle>{t('nav.letter')}</SectionTitle>
      {resumes.length === 0 ? (
        <Hint>
          {tRich('letter.noResumes', {}, {
            link: (words) => (
              <a href="/resumes" class={LINK}>
                {words}
              </a>
            ),
          })}
        </Hint>
      ) : (
        <form method="post" action={`/jobs/${jobId}/cover`} class="space-y-3">
          <input type="hidden" name="saveAngles" value="1" />
          <div class="flex flex-wrap items-end gap-3">
            <label class="block min-w-0 max-w-full">
              <span class="block text-label text-ink">{t('letter.resume')}</span>
              <Select name="resumeId" class="mt-1.5 !w-auto max-w-full">
                {resumes.map((r) => (
                  <option value={r.id} selected={r.id === (suggestedResumeId ?? resumes[0]?.id)}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
            <label class="block">
              <span class="block text-label text-ink">{t('letter.tone')}</span>
              <Select name="tone" class="mt-1.5 !w-auto">
                {COVER_TONES.map((tone) => (
                  <option value={tone} selected={tone === 'warm'}>
                    {toneLabel(tone)}
                  </option>
                ))}
              </Select>
            </label>
            <label class="block">
              <span class="block text-label text-ink">{t('letter.addressedTo')}</span>
              <Input
                name="addressee"
                maxlength="80"
                class="mt-1.5 !w-auto"
                value={addressee.suggested ?? ''}
                placeholder={t('letter.theTeam')}
                title={t('letter.aPersonsNameGreetsThem')}
              />
            </label>
            <Button variant="violet">{t('letter.generateLetter')}</Button>
          </div>
          {costHint && <Hint>{costHint}</Hint>}
          {addressee.finding && (
            <Hint>
              {tRich(addressee.suggested ? 'letter.named.prefilled' : 'letter.named.noName', {}, {
                // The verifier's own sentence: a model wrote it.
                finding: () => <span lang="en">{shortFinding(addressee.finding ?? '')}</span>,
              })}
            </Hint>
          )}
          {quickCheck && (
            <Hint>
              {tRich('letter.quickCheck', { name: quickCheck.resumeName }, { file: (words) => <span translate="no">{words}</span> })}{' '}
              <Button variant="secondary" size="sm" form={COVER_SUGGESTIONS_FORM}>
                {t('letter.getSuggestionsFirst')}
              </Button>
            </Hint>
          )}
          <details class="rounded-md border border-line px-3 py-2" open={hasAngles(angles)}>
            <summary class="cursor-pointer text-note font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
              {t('letter.angleOptionalSavedForYour')}
            </summary>
            <div class="mt-2.5 grid gap-2.5 sm:grid-cols-3">
              <label class="block">
                <span class="block text-meta text-ink-muted">{t('letter.whyThisCompany')}</span>
                <Input name="whyCompany" maxlength="300" class="mt-1 !text-meta" value={angles.whyCompany ?? ''} />
              </label>
              <label class="block">
                <span class="block text-meta text-ink-muted">{t('letter.whatProblemYoudSolve')}</span>
                <Input name="problem" maxlength="300" class="mt-1 !text-meta" value={angles.problem ?? ''} />
              </label>
              <label class="block">
                <span class="block text-meta text-ink-muted">{t('letter.yourApproach')}</span>
                <Input name="approach" maxlength="300" class="mt-1 !text-meta" value={angles.approach ?? ''} />
              </label>
            </div>
            <label class="mt-2.5 block">
              <span class="block text-meta text-ink-muted">
                {t('letter.anythingEveryLetterShouldMention')}
              </span>
              <Textarea name="notes" rows={2} maxlength="500" class="mt-1 !text-meta" placeholder={t('letter.notesPlaceholder')}>
                {angles.notes ?? ''}
              </Textarea>
            </label>
            <Hint class="mt-2">
              {t('letter.theseSteerWhatTheLetter')}
            </Hint>
          </details>
          <Hint>
            {t('letter.howItWorks')}
            {!hasCompanyFacts && (
              <>
                {' '}
                {tRich('letter.noCompanyResearch', {}, {
                  link: (words) => (
                    <a href={jobHref(jobId, 'verify', {}, 'verification')} class={LINK}>
                      {words}
                    </a>
                  ),
                })}
              </>
            )}
          </Hint>
        </form>
      )}

      {quickCheck && (
        <form
          id={COVER_SUGGESTIONS_FORM}
          method="post"
          action={`/jobs/${jobId}/matches/${quickCheck.matchId}/suggestions`}
        >
          <input type="hidden" name="next" value="cover" />
        </form>
      )}

      {selected && <LetterReport jobId={jobId} letter={selected} />}

      {letters.length > 1 && (
        <div class="mt-5 border-t border-line pt-4">
          <div class={SUBHEAD}>{t('letter.allLetters')}</div>
          <ul class="flex flex-wrap gap-2">
            {letters.map((l) => {
              const gate = GATE_VIEW[l.gateVerdict];
              return (
                <li>
                  <HistoryChip href={`/jobs/${jobId}?letter=${l.id}#cover-letter`} current={selected?.id === l.id}>
                    <Badge tone={(gate ?? GATE_VIEW.pass!).tone}>{gate ? t(gate.word) : l.gateVerdict}</Badge>
                    <span translate="no">{l.resume.name}</span>
                    <span class="font-mono font-normal text-ink-faint">v{l.resumeVersion}</span>
                    <span class="font-normal text-ink-faint"><When at={l.createdAt} /></span>
                  </HistoryChip>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  </div>
);

function shortFinding(finding: string): string {
  return finding.length > FINDING_SHOWN_CHARS ? `${finding.slice(0, FINDING_SHOWN_CHARS)}…` : finding;
}

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
        <Badge tone={gate.tone}>{t(gate.label)}</Badge>
        <span class="text-sm text-ink">
          <span translate="no">{letter.resume.name}</span>{' '}
          <span class="font-mono text-meta text-ink-faint">v{letter.resumeVersion}</span>
        </span>
        <Badge tone="neutral">{toneLabel(letter.tone)}</Badge>
        {letter.editedText && <Badge tone="info">{t('letter.edited')}</Badge>}
        <span class="text-meta text-ink-faint">
          <When at={letter.createdAt} /> ·{' '}
          <span class="font-mono" translate="no">
            {letter.model}
          </span>
        </span>
        <ActionForm
          action={`/jobs/${jobId}/cover`}
          hidden={{ resumeId: letter.resumeId, tone: letter.tone, addressee: greetingOf(letter.text) ?? '' }}
          class="ml-auto"
        >
          <Button
            variant="ghost"
            size="sm"
            title={t('letter.freshDraftSameResumeAnd')}
          >
            {t('letter.regenerate')}
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
          <span class="sr-only">{t('letter.letterText')}</span>
          {/* A model wrote the letter in English and the person edits it: the page never translates it. */}
          <Textarea id={`cover-text-${letter.id}`} name="text" rows={13} class="font-normal" lang="en">
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
            {t('letter.copyLetter')}
          </Button>
          <Button href={`/jobs/${jobId}/cover/${letter.id}/file/pdf`} variant="secondary" size="sm">
            {t('letter.saveAsPdf')}
          </Button>
          <Button href={`/jobs/${jobId}/cover/${letter.id}/file/docx`} variant="secondary" size="sm">
            {t('letter.saveAsDocx')}
          </Button>
          {/* The no-JS path: cover-letter.mjs hides this and autosaves instead. */}
          <Button variant="ghost" size="sm" data-save-button>
            {t('letter.saveEdit')}
          </Button>
          <span
            class="text-meta text-ink-faint transition-colors duration-150"
            data-save-status
            role="status"
            aria-live="polite"
          ></span>
          <span class="ml-auto text-meta tabular-nums text-ink-faint">
            {/* cover-letter.mjs rewrites the count as the person types, so the words around it name no plural. */}
            {tRich('letter.wordCount', { min: COVER_WORDS_MIN, max: COVER_WORDS_MAX }, { count: () => <span data-word-count>{words}</span> })}
          </span>
        </div>
        <Hint>
          {t('letter.yourEditsSaveThemselvesAnd')}
        </Hint>
      </form>

      <div class="grid gap-4 sm:grid-cols-2">
        {letter.keywordsUsed.length > 0 && (
          <div>
            <div class={SUBHEAD}>{t('letter.postingKeywordsWorkedIn')}</div>
            <div class="flex flex-wrap gap-1.5" translate="no">
              {letter.keywordsUsed.map((k) => (
                <Tag tone="ok">{k}</Tag>
              ))}
            </div>
          </div>
        )}
        {letter.gapsAcknowledged.length > 0 && (
          <div>
            <div class={SUBHEAD}>{t('letter.gapsConcededOrLeftOut')}</div>
            <div class="flex flex-wrap gap-1.5" lang="en">
              {letter.gapsAcknowledged.map((g) => (
                <Tag tone="danger">{g}</Tag>
              ))}
            </div>
          </div>
        )}
      </div>
      <div class="text-meta text-ink-faint">
        {t(letter.usedVerification ? 'letter.companyFacts.verified' : 'letter.companyFacts.posting')}
        {/* The gate's notes were worded when the letter was checked, and quote the letter. */}
        {letter.gateNotes.length > 0 && <span lang="en"> · {letter.gateNotes.join(' · ')}</span>}
      </div>
      <script type="module" dangerouslySetInnerHTML={{ __html: COVER_BOOT }} />
    </div>
  );
};

const COVER_BOOT = `
import { init } from '/static/cover-letter.mjs';
init();
`;
