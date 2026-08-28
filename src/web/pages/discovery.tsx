/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CompanyCandidate } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Button,
  Card,
  Empty,
  Flash,
  Hint,
  PageHeader,
  SectionTitle,
  Table,
  Tag,
  Td,
  Tr,
} from '../ui';
import { formatRelative } from '../format';

export interface DiscoveryProps {
  discoveryEnabled: boolean;
  pending: CompanyCandidate[];
  promoted: CompanyCandidate[];
  ignored: CompanyCandidate[];
  dead: CompanyCandidate[];
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

export const DiscoveryPage: FC<DiscoveryProps> = ({
  discoveryEnabled,
  pending,
  promoted,
  ignored,
  dead,
  flash,
}) => (
  <Layout title="Discovery" active="discovery">
    <PageHeader
      title="Discovery"
      meta={discoveryEnabled ? 'Auto-discovery on' : 'Auto-discovery off — toggle in Settings'}
    >
      Company boards the HN parser spotted in comments. Promote one to start fetching it on the
      next tick.
    </PageHeader>
    <Flash flash={flash} />

    <div class="space-y-6">
      <div>
        <SectionTitle>Pending review ({pending.length})</SectionTitle>
        {pending.length === 0 ? (
          <Empty>
            No candidates yet. Enable the HN parser and discovery in Settings, then run the HN
            once-job to seed candidates from the latest thread.
          </Empty>
        ) : (
          <>
            <Hint class="mb-3 max-w-prose">
              Sorted by jobs currently visible on the board.
            </Hint>
            <CandidateTable rows={pending} actions />
          </>
        )}
      </div>

      {promoted.length > 0 && (
        <div>
          <SectionTitle>Promoted ({promoted.length})</SectionTitle>
          <CandidateTable rows={promoted} />
        </div>
      )}
      {ignored.length > 0 && (
        <div>
          <SectionTitle>Ignored ({ignored.length})</SectionTitle>
          <CandidateTable rows={ignored} actions />
        </div>
      )}
      {dead.length > 0 && (
        <div>
          <SectionTitle>Dead ({dead.length})</SectionTitle>
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
        <Table
          columns={[
            'Name / token',
            'ATS',
            'Source',
            <span class="block text-right">Jobs</span>,
            <span class="block text-right">Discovered</span>,
            ...(actions ? [<span class="block text-right">Actions</span>] : []),
          ]}
        >
          {rows.map((c) => (
            <Tr>
              <Td class="max-w-[20rem]">
                <div class="truncate font-medium text-ink">{c.name ?? c.atsToken}</div>
                <div class="truncate font-mono text-xs text-ink-faint">{c.atsToken}</div>
                {c.signal && (
                  <div class="mt-0.5 truncate text-xs italic text-ink-faint" title={c.signal}>
                    {c.signal}
                  </div>
                )}
              </Td>
              <Td>
                <Tag>{c.atsType}</Tag>
              </Td>
              <Td class="text-[13px] text-ink-muted">
                {c.sourceUrl ? (
                  <a
                    href={c.sourceUrl}
                    target="_blank"
                    rel="noopener"
                    class="transition-colors duration-150 hover:text-accent-strong"
                    title={c.source}
                  >
                    {c.source}
                  </a>
                ) : (
                  c.source
                )}
              </Td>
              <Td class="text-right tabular-nums text-ink-muted">{c.jobsSeen}</Td>
              <Td class="whitespace-nowrap text-right text-[13px] text-ink-faint">
                {formatRelative(c.discoveredAt)}
              </Td>
              {actions && (
                <Td>
                  <div class="flex justify-end gap-2">
                    <ActionForm action={`/discovery/${c.id}/promote`}>
                      <Button size="sm">Promote</Button>
                    </ActionForm>
                    <ActionForm action={`/discovery/${c.id}/ignore`}>
                      <Button size="sm" variant="secondary">
                        Ignore
                      </Button>
                    </ActionForm>
                    <ActionForm
                      action={`/discovery/${c.id}/delete`}
                      confirm="Delete this candidate permanently?"
                    >
                      <Button size="sm" variant="danger">
                        Delete
                      </Button>
                    </ActionForm>
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
