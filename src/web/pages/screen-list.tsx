/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Button, Card, ConfirmAction, Empty, Flash, Hint, PageHeader, Table, Td, Tr, When } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDateShort } from '../format';
import type { ScreeningSummary } from '../../screening/store';
import { t } from '../../i18n/t';

/*
 * /screen — every screening this install holds. The first sentence on the
 * page is the product rule (hr-screening-plan.md ground rules): the tool
 * ranks, a person decides.
 */

export const ScreenListPage: FC<{ screenings: ScreeningSummary[]; flash?: FlashMessage | null }> = ({ screenings, flash }) => (
  <Layout title={t('nav.screen')} active="screen">
    <PageHeader
      title={t('nav.screen')}
      meta={t('screen.list.count', { n: screenings.length })}
      actions={<Button href="/screen/new">{t('screen.list.new')}</Button>}
    >
      {t('screen.list.intro')}
    </PageHeader>
    <Flash flash={flash} />

    {screenings.length === 0 ? (
      <Empty title={t('screen.list.empty')}>{t('screen.list.emptyBody')}</Empty>
    ) : (
      <Card flush>
        <Table caption={t('screen.list.caption')}
          columns={[
            t('screen.list.col.screening'),
            t('screen.list.col.position'),
            t('screen.list.col.applicants'),
            t('screen.list.col.scored'),
            t('screen.list.col.created'),
            t('screen.list.col.keptUntil'),
            '',
          ]}
          hideBelow={['', 'md', '', '', 'lg', 'sm', '']}
        >
          {screenings.map((s) => (
            <Tr>
              <Td>
                <a href={`/screen/${s.id}`} class="font-medium text-ink hover:underline" translate="no">
                  {s.title}
                </a>
              </Td>
              <Td class="text-ink-muted">
                <a href={`/jobs/${s.jobId}`} class="hover:underline" translate="no">
                  {s.jobTitle}
                </a>{' '}
                <span class="text-ink-faint" translate="no">· {s.companyName}</span>
              </Td>
              <Td class="tabular-nums">
                {s.applicants}
                {s.unread > 0 && (
                  <span class="text-ink-faint" title={t('screen.list.unreadTitle')}>
                    {' '}
                    {t('screen.list.notScored', { n: s.unread })}
                  </span>
                )}
              </Td>
              <Td>
                {s.applicants === 0 ? (
                  <span class="text-ink-faint">—</span>
                ) : s.scored === s.applicants - s.unread ? (
                  <Badge tone="ok">{t('screen.list.allScored', { n: s.scored })}</Badge>
                ) : (
                  <Badge tone="neutral">{t('screen.list.scoredOf', { scored: s.scored, total: s.applicants - s.unread })}</Badge>
                )}
              </Td>
              <Td class="text-ink-faint" title={s.createdAt.toISOString()}>
                <When at={s.createdAt} />
              </Td>
              <Td class="text-ink-faint">{formatDateShort(s.retainUntil)}</Td>
              <Td class="text-right">
                <ConfirmAction
                  action={`/screen/${s.id}/delete`}
                  label={t('common.delete')}
                  variant="ghost"
                  ariaLabel={t('screen.list.deleteNamed', { title: s.title })}
                  confirm={t('screen.list.deleteConfirm', { title: s.title })}
                  class="inline-block"
                />
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
    )}
    <Hint class="mt-4">{t('screen.list.retentionHint')}</Hint>
  </Layout>
);
