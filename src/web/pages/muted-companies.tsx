/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { ActionForm, Button, Card, Field, Hint, Input, SectionTitle, Table, Td, Tr } from '../ui';
import { formatDate } from '../format';
import { formatNumber } from '../../i18n/format';
import { t } from '../../i18n/t';

/** One mute as the section lists it (ADR 0056). */
export interface MutedRow {
  key: string;
  name: string;
  reason: string | null;
  createdAt: Date;
  /** Stored postings the job list hides because of it. */
  hidden: number;
}

const BACK = '/companies#muted';

/**
 * The companies the user does not want to see, and a way to mute one by name
 * — a company met on a job board before any posting of theirs arrived here.
 */
export const MutedCompaniesSection: FC<{ rows: MutedRow[] }> = ({ rows }) => (
  <section id="muted" class="mt-8 scroll-mt-4">
    <SectionTitle level="section">{t('mute.mutedCompanies')}</SectionTitle>
    <Card>
      <Hint>
        {t('mute.aMutedCompanysNewPostings')}
      </Hint>
      {rows.length > 0 && (
        <div class="mt-4 overflow-x-auto">
          <Table caption={t('mute.mutedCompanies')} columns={[t('common.company'), t('mute.col.why'), t('mute.col.since'), t('mute.col.hidden'), '']}>
            {rows.map((m) => (
              <Tr>
                <Td class="font-medium text-ink">
                  <span translate="no">{m.name}</span>
                </Td>
                {/* The reason is the user's own note, in whatever language they wrote it. */}
                <Td class="text-ink-muted">
                  <span translate="no">{m.reason ?? '—'}</span>
                </Td>
                <Td class="whitespace-nowrap text-ink-muted">{formatDate(m.createdAt)}</Td>
                <Td class="tabular-nums text-ink-muted">
                  {m.hidden > 0 ? (
                    <a href="/jobs?muted=1" class="font-medium text-accent-strong hover:text-accent-deep">
                      {formatNumber(m.hidden)}
                    </a>
                  ) : (
                    '0'
                  )}
                </Td>
                <Td class="text-right">
                  <ActionForm action="/companies/mutes/delete" hidden={{ key: m.key, back: BACK }} class="justify-end">
                    <Button size="sm" variant="ghost">
                      {t('mute.unmute')}
                    </Button>
                  </ActionForm>
                </Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
      <form method="post" action="/companies/mutes" class="mt-4 grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
        <input type="hidden" name="back" value={BACK} />
        <Field label={t('common.company')}>
          <Input type="text" name="name" required maxlength="120" placeholder="Acme" translate="no" />
        </Field>
        <Field label={t('mute.whyOptional')}>
          <Input type="text" name="reason" maxlength="300" placeholder={t('mute.rejectedInSeptember')} />
        </Field>
        <div class="flex items-end">
          <Button variant="secondary" class="w-full">
            {t('mute.mute')}
          </Button>
        </div>
      </form>
    </Card>
  </section>
);
