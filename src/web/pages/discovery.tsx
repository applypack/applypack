/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CompanyCandidate } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Button,
  Card,
  ConfirmAction,
  Empty,
  Flash,
  Hint,
  PageHeader,
  SectionTitle,
  Table,
  Tag,
  Td,
  ToggleRow,
  Tr,
  When,
} from '../ui';

import type { FlashMessage } from '../flash';
import { wordedSource } from '../source-groups';
import { sourceLabel } from '../source-names';
import { t } from '../../i18n/t';

export interface DiscoveryProps {
  discoveryEnabled: boolean;
  hnParserEnabled: boolean;
  pending: CompanyCandidate[];
  promoted: CompanyCandidate[];
  ignored: CompanyCandidate[];
  dead: CompanyCandidate[];
  flash?: FlashMessage | null;
}

export const DiscoveryPage: FC<DiscoveryProps> = ({
  discoveryEnabled,
  hnParserEnabled,
  pending,
  promoted,
  ignored,
  dead,
  flash,
}) => (
  <Layout title={t('nav.discovery')} active="discovery">
    <PageHeader title={t('nav.discovery')}>
      {t('discovery.companyBoardsTheHnParser')}
    </PageHeader>
    <Flash flash={flash} />

    <div class="space-y-6">
      <Card>
        <div class="space-y-5">
          <ToggleRow
            label={t('discovery.autoDiscovery')}
            enabled={discoveryEnabled}
            action="/discovery/toggle"
            more={t('discovery.pendingCandidatesAreProbedAgain')}
          >
            {t('discovery.aGreenhouseLeverOrAshby')}
          </ToggleRow>
          <div class="border-t border-line pt-5">
            <ToggleRow
              label={t('discovery.hnWhoIsHiringParser')}
              enabled={hnParserEnabled}
              action="/discovery/hn-parser-toggle"
              extra={
                <ConfirmAction
                  action="/discovery/hn-run"
                  label={t('discovery.runNow')}
                  variant="violet"
                  disabled={!hnParserEnabled}
                  confirm={t('discovery.pullTheLatestHnWho')}
                />
              }
              more={t('discovery.theFirstPullOnThe')}
            >
              {t('discovery.readsTheLatestAskHn')}
            </ToggleRow>
          </div>
        </div>
      </Card>

      <div>
        <SectionTitle level="section">{t('discovery.pendingN', { n: pending.length })}</SectionTitle>
        {pending.length === 0 ? (
          <Empty title={t('discovery.noCandidatesYet')}>
            {t('discovery.aCandidateIsACompany')}
          </Empty>
        ) : (
          <>
            <Hint class="mb-3">
              {t('discovery.sortedByJobsCurrentlyVisible')}
            </Hint>
            <CandidateTable rows={pending} actions />
          </>
        )}
      </div>

      {promoted.length > 0 && (
        <div>
          <SectionTitle level="section">{t('discovery.promotedN', { n: promoted.length })}</SectionTitle>
          <CandidateTable rows={promoted} />
        </div>
      )}
      {ignored.length > 0 && (
        <div>
          <SectionTitle level="section">{t('discovery.ignoredN', { n: ignored.length })}</SectionTitle>
          <CandidateTable rows={ignored} actions />
        </div>
      )}
      {dead.length > 0 && (
        <div>
          <SectionTitle level="section">{t('discovery.deadN', { n: dead.length })}</SectionTitle>
          <CandidateTable rows={dead} />
        </div>
      )}
    </div>
  </Layout>
);

const CandidateTable: FC<{ rows: CompanyCandidate[]; actions?: boolean }> = ({
  rows,
  actions,
}) => (
  <Card flush>
    <div class="overflow-x-auto">
      <div class="min-w-[52rem]">
        <Table caption={t('discovery.discoveredBoards')}
          columns={[
            t('discovery.col.nameToken'),
            t('companies.ats'),
            t('discovery.col.source'),
            <span class="block text-right">{t('discovery.jobs')}</span>,
            <span class="block text-right">{t('discovery.discovered')}</span>,
            ...(actions ? [<span class="block text-right">{t('common.actions')}</span>] : []),
          ]}
        >
          {rows.map((c) => (
            <Tr>
              <Td class="max-w-[20rem]">
                {/* The board as found: its name, its token and the words around the link in the comment. */}
                <div translate="no">
                  <div class="truncate font-medium text-ink">{c.name ?? c.atsToken}</div>
                  <div class="truncate font-mono text-meta text-ink-faint">{c.atsToken}</div>
                  {c.signal && (
                    <div class="mt-0.5 truncate text-meta italic text-ink-faint" title={c.signal}>
                      {c.signal}
                    </div>
                  )}
                </div>
              </Td>
              <Td>
                <span translate={wordedSource(c.atsType) ? undefined : 'no'}>
                  <Tag>{sourceLabel(c.atsType)}</Tag>
                </span>
              </Td>
              <Td class="text-note text-ink-muted">
                {c.sourceUrl ? (
                  <a
                    href={c.sourceUrl}
                    target="_blank"
                    rel="noopener"
                    translate="no"
                    class="transition-colors duration-150 hover:text-accent-strong"
                    title={c.source}
                  >
                    {c.source}
                  </a>
                ) : (
                  <span translate="no">{c.source}</span>
                )}
              </Td>
              <Td class="text-right tabular-nums text-ink-muted">{c.jobsSeen}</Td>
              <Td class="whitespace-nowrap text-right text-note text-ink-faint">
                <When at={c.discoveredAt} />
              </Td>
              {actions && (
                <Td>
                  <div class="flex justify-end gap-2">
                    <ActionForm action={`/discovery/${c.id}/promote`}>
                      <Button size="sm">{t('discovery.promote')}</Button>
                    </ActionForm>
                    <ActionForm action={`/discovery/${c.id}/ignore`}>
                      <Button size="sm" variant="secondary">
                        {t('discovery.ignore')}
                      </Button>
                    </ActionForm>
                    <ConfirmAction action={`/discovery/${c.id}/delete`} label={t('common.delete')} confirm={t('discovery.deleteThisCandidatePermanently')} />
                  </div>
                </Td>
              )}
            </Tr>
          ))}
        </Table>
      </div>
    </div>
  </Card>
);
