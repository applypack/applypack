/** @jsxImportSource hono/jsx */
import type { CareerNote } from '@prisma/client';
import type { FC } from 'hono/jsx';
import type { MessageKey } from '../../i18n/catalog';
import { formatList, formatNumber } from '../../i18n/format';
import { t } from '../../i18n/t';
import { INTERVIEW_LANGUAGES, type InterviewLanguage } from '../../interview/languages';
import { FROM_RESUME, MAX_NOTE_CHARS, type PrepQuestion, type QuestionKind } from '../../interview/prompts';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { Badge, Button, Card, CardHeader, ConfirmAction, Empty, FILE_INPUT_CLASS, Hint, Input, Notice, Select, Textarea, When } from '../ui';
import { MAX_UPLOAD_MB } from '../upload';

/*
 * The job page's Interview tab (ADR 0065): the questions this posting is
 * likely to bring with what the person can answer from their own history,
 * and under it the history itself. What a model wrote is marked with the
 * language it was written in; a note is the person's own text.
 */

export interface InterviewCardProps {
  jobId: number;
  resumes: { id: number; label: string }[];
  suggestedResumeId: number | null;
  /** The language the select starts on: this job's last preparation, else the last one anywhere. */
  languageCode: string;
  prep: {
    /** Null for a stored code this version does not offer. */
    language: InterviewLanguage | null;
    questions: PrepQuestion[];
    createdAt: Date;
    /** The history or the posting changed after it was written. */
    stale: boolean;
  } | null;
  notes: CareerNote[];
  /** How many of the notes one preparation reads, newest first. */
  notesRead: number;
  costHint: string;
}

const KIND_LABEL = {
  about_you: 'interview.kind.aboutYou',
  technical: 'interview.kind.technical',
  behavioral: 'interview.kind.behavioral',
  company: 'interview.kind.company',
} as const satisfies Record<QuestionKind, MessageKey>;

const SUBHEAD = 'text-note font-medium text-ink-muted';

export const InterviewCard: FC<InterviewCardProps> = ({ jobId, resumes, suggestedResumeId, languageCode, prep, notes, notesRead, costHint }) => {
  const nothingToReadFrom = resumes.length === 0 && notes.length === 0;
  return (
    <div class="space-y-4">
      <Card id="interview">
        <CardHeader title={t('interview.title')} />
        <Hint class="mb-3">{t('interview.intro')}</Hint>
        {nothingToReadFrom ? (
          <Notice tone="warn">{t('interview.nothingToReadFrom')}</Notice>
        ) : (
          <form method="post" action={`/jobs/${jobId}/interview`} class="space-y-2">
            <div class="flex flex-wrap items-end gap-3">
              <label class="block">
                <span class="block text-label text-ink">{t('interview.language')}</span>
                <Select name="language" class="mt-1.5 !w-auto">
                  {INTERVIEW_LANGUAGES.map((l) => (
                    <option value={l.code} selected={l.code === languageCode} lang={l.code} translate="no">
                      {l.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label class="block min-w-0 max-w-full">
                <span class="block text-label text-ink">{t('interview.resume')}</span>
                <Select name="resumeId" class="mt-1.5 !w-auto max-w-full">
                  {resumes.map((r) => (
                    <option value={r.id} selected={r.id === (suggestedResumeId ?? resumes[0]?.id)} translate="no">
                      {r.label}
                    </option>
                  ))}
                  {notes.length > 0 && <option value="">{t('interview.noResume')}</option>}
                </Select>
              </label>
              <Button variant="violet">{t(prep ? 'interview.prepareAgain' : 'interview.prepare')}</Button>
            </div>
            <Hint>{t('interview.languageHint')}</Hint>
            {costHint && <Hint>{costHint}</Hint>}
          </form>
        )}

        {prep && (
          <div class="mt-5 border-t border-line pt-4">
            <div class="mb-3 flex flex-wrap items-baseline gap-x-2 text-meta text-ink-faint">
              <span>{t('interview.preparedCount', { n: prep.questions.length })}</span>
              {prep.language && (
                <span lang={prep.language.code} translate="no">
                  {prep.language.name}
                </span>
              )}
              <When at={prep.createdAt} />
            </div>
            {prep.stale && (
              <Notice tone="warn" class="mb-3">
                {t('interview.stale')}
              </Notice>
            )}
            <ol class="space-y-5">
              {prep.questions.map((q, i) => (
                <Question q={q} index={i + 1} lang={prep.language?.code} />
              ))}
            </ol>
          </div>
        )}
      </Card>

      <Card id="history">
        <CardHeader title={t('interview.history.title')} />
        <Hint class="mb-3">{t('interview.history.intro')}</Hint>
        {notes.length === 0 ? (
          <Empty bare title={t('interview.history.emptyTitle')}>
            {t('interview.history.empty')}
          </Empty>
        ) : (
          <ul class="mb-4 divide-y divide-line border-y border-line">
            {notes.map((note) => (
              <li>
                <Note note={note} jobId={jobId} />
              </li>
            ))}
          </ul>
        )}
        {notesRead < notes.length && (
          <Notice tone="warn" class="mb-4">
            {t('interview.history.tooMuch', { read: notesRead, all: notes.length })}
          </Notice>
        )}
        <form method="post" action="/career/notes" enctype="multipart/form-data" class="space-y-3">
          <input type="hidden" name="jobId" value={jobId} />
          <div class={SUBHEAD}>{t('interview.history.add')}</div>
          <label class="block">
            <span class="block text-label text-ink">{t('interview.history.noteTitle')}</span>
            <Input name="title" maxlength="120" class="mt-1.5" placeholder={t('interview.history.titlePlaceholder')} />
          </label>
          <label class="block">
            <span class="block text-label text-ink">{t('interview.history.noteText')}</span>
            <Textarea name="text" rows={6} maxlength={MAX_NOTE_CHARS} class="mt-1.5" placeholder={t('interview.history.textPlaceholder')} />
          </label>
          <label class="block">
            <span class="block text-label text-ink">{t('interview.history.file')}</span>
            <Hint class="mt-0.5">{t('interview.history.fileHint', { types: ACCEPTED_EXTENSIONS.join(', '), mb: MAX_UPLOAD_MB })}</Hint>
            <Input type="file" name="file" accept={ACCEPTED_EXTENSIONS.join(',')} class={`mt-1.5 ${FILE_INPUT_CLASS}`} />
          </label>
          <Button>{t('interview.history.addButton')}</Button>
        </form>
      </Card>
    </div>
  );
};

/** One likely question: why it is likely, the points to make, where they come from, what is missing. */
const Question: FC<{ q: PrepQuestion; index: number; lang: string | undefined }> = ({ q, index, lang }) => {
  const sources = q.based_on.map((name) => (name === FROM_RESUME ? t('interview.fromResume') : name));
  return (
    <li>
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="font-mono text-meta text-ink-faint">{formatNumber(index)}</span>
        <Badge>{t(KIND_LABEL[q.kind])}</Badge>
      </div>
      {/* A model wrote these, in the language of the interview. */}
      <div lang={lang} translate="no">
        <div class="mt-1 text-entity text-ink">{q.question}</div>
        {q.why && <div class="mt-0.5 text-note text-ink-muted">{q.why}</div>}
        {q.answer.length > 0 && (
          <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {q.answer.map((point) => (
              <li>{point}</li>
            ))}
          </ul>
        )}
      </div>
      {sources.length > 0 && (
        <div class="mt-2 text-meta text-ink-faint">
          {t('interview.basedOn')} <span translate="no">{formatList(sources)}</span>
        </div>
      )}
      {q.missing && (
        <div class="mt-2 text-note text-ink-muted">
          <span class="font-medium text-ink">{t('interview.missing')}</span>{' '}
          <span lang={lang} translate="no">
            {q.missing}
          </span>
        </div>
      )}
      {q.posted.length > 0 && (
        <p data-ui="hint" class="mt-2 text-meta text-ink-faint">
          {t('interview.posted')} <span translate="no">{formatList(q.posted)}</span>
        </p>
      )}
      {q.unbacked.length > 0 && (
        <Notice tone="warn" class="mt-2">
          {t('interview.unbacked')} <span translate="no">{formatList(q.unbacked)}</span>
        </Notice>
      )}
    </li>
  );
};

/** A note of the history, folded: its text is edited in place, and deleting asks first. */
const Note: FC<{ note: CareerNote; jobId: number }> = ({ note, jobId }) => (
  <details class="group py-2">
    <summary class="flex cursor-pointer flex-wrap items-baseline gap-x-2 text-sm text-ink transition-colors duration-150 hover:text-accent-strong">
      <span translate="no" class="font-medium">
        {note.title}
      </span>
      <span class="text-meta text-ink-faint">
        {t('interview.history.chars', { n: note.text.length })} · <When at={note.updatedAt} />
      </span>
    </summary>
    <form method="post" action={`/career/notes/${note.id}`} class="mt-2 space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Input name="title" maxlength="120" value={note.title} aria-label={t('interview.history.noteTitle')} />
      <Textarea name="text" rows={10} maxlength={MAX_NOTE_CHARS} aria-label={t('interview.history.noteText')}>
        {note.text}
      </Textarea>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm">{t('interview.history.save')}</Button>
        <ConfirmAction
          action={`/career/notes/${note.id}/delete`}
          label={t('interview.history.delete')}
          confirm={t('interview.history.deleteConfirm')}
          variant="ghost"
          hidden={{ jobId }}
        />
      </div>
    </form>
  </details>
);
