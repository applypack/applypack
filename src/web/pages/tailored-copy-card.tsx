/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { TailoredCopy } from '../../resume/store';
import { t } from '../../i18n/t';
import { tRich } from '../rich';
import { Button, Card, ConfirmAction, Hint, SectionTitle, When } from '../ui';

/**
 * The resume as tailored for this posting (ADR 0066): what Save on the Tailor
 * page kept. The file is here a month later; the person's own resume was not
 * written to, and one press makes this copy the resume when that is wanted.
 * `onTailor` is the Tailor page itself, where "go on from it" would lead back
 * to the page the reader is on.
 */
export const TailoredCopyCard: FC<{ jobId: number; copy: TailoredCopy; onTailor?: boolean; class?: string }> = ({ jobId, copy, onTailor = false, class: className = '' }) => (
  <Card class={className}>
    <SectionTitle>{t('copy.title')}</SectionTitle>
    <p class="mt-1 text-sm text-ink">
      <span class="font-medium" translate="no">
        {copy.resumeName}
      </span>{' '}
      <span class="text-ink-faint">· {tRich('copy.savedWhen', {}, { when: () => <When at={copy.updatedAt} /> })}</span>
    </p>
    <Hint class="mt-1">{t('copy.hint')}</Hint>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <Button href={`/jobs/${jobId}/copy/file`} variant="secondary" size="sm">
        {t(copy.document === 'text' ? 'copy.downloadText' : 'copy.download')}
      </Button>
      {!onTailor && copy.matchId !== null && (
        <Button href={`/jobs/${jobId}/target?match=${copy.matchId}`} variant="secondary" size="sm">
          {t('copy.goOn')}
        </Button>
      )}
      <ConfirmAction
        action={`/jobs/${jobId}/copy/promote`}
        label={t('copy.promote')}
        confirm={t('copy.promote.confirm')}
        yes={t('copy.promote.yes')}
        variant="ghost"
      />
    </div>
  </Card>
);
