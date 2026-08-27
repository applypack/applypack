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
    />
    <Flash flash={flash} />

    <Card class="mb-6">
      <SectionTitle>Pending review ({pending.length})</SectionTitle>
      <Hint class="mb-3 max-w-prose">
        Companies the HN parser spotted but nobody has promoted yet. Promote one to
        start fetching its board on the next tick. Sorted by jobs currently visible.
      </Hint>
      {pending.length === 0 ? (
        <Empty>
          No candidates yet. Enable the HN parser and discovery in Settings, then run
          the HN once-job to seed candidates from the latest thread.
        </Empty>
      ) : (
        <CandidateTable rows={pending} actions />
      )}
    </Card>

    {promoted.length > 0 && (
      <Card class="mb-6">
        <SectionTitle>Promoted ({promoted.length})</SectionTitle>
        <CandidateTable rows={promoted} />
      </Card>
    )}
    {ignored.length > 0 && (
      <Card class="mb-6">
        <SectionTitle>Ignored ({ignored.length})</SectionTitle>
        <CandidateTable rows={ignored} actions />
      </Card>
    )}
    {dead.length > 0 && (
      <Card class="mb-6">
        <SectionTitle>Dead ({dead.length})</SectionTitle>
        <CandidateTable rows={dead} />
      </Card>
    )}
  </Layout>
);

const CandidateTable: FC<{ rows: CompanyCandidate[]; actions?: boolean }> = ({
  rows,
  actions,
}) => (
  <div class="overflow-hidden rounded-md border border-line">
    <Table
      columns={[
        'Name / token',
        'ATS',
        'Source',
        'Jobs',
        'Discovered',
        ...(actions ? [<span class="block text-right">Actions</span>] : []),
      ]}
    >
      {rows.map((c) => (
        <Tr>
          <Td>
            <div class="text-ink">{c.name ?? c.atsToken}</div>
            <div class="font-mono text-xs text-ink-faint">{c.atsToken}</div>
            {c.signal && <div class="mt-0.5 text-xs italic text-ink-faint">{c.signal}</div>}
          </Td>
          <Td>
            <Tag>{c.atsType}</Tag>
          </Td>
          <Td class="text-xs text-ink-muted">
            {c.sourceUrl ? (
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener"
                class="hover:text-accent"
                title={c.source}
              >
                {c.source}
              </a>
            ) : (
              c.source
            )}
          </Td>
          <Td class="font-mono tabular-nums text-ink-muted">{c.jobsSeen}</Td>
          <Td class="whitespace-nowrap text-xs text-ink-faint">
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
);
