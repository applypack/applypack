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
  ToggleRow,
  Tr,
} from '../ui';
import { formatRelative } from '../format';
import type { FlashMessage } from '../flash';
import { sourceLabel } from '../source-names';

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
  <Layout title="Discovery" active="discovery">
    <PageHeader title="Discovery">
      Company boards the HN parser spotted in comments. Promote one to fetch it from the next tick.
    </PageHeader>
    <Flash flash={flash} />

    <div class="space-y-6">
      <Card>
        <div class="space-y-5">
          <ToggleRow
            label="Auto-discovery"
            enabled={discoveryEnabled}
            action="/discovery/toggle"
            more="Pending candidates are probed again every week, so the job count beside each stays fresh."
          >
            A Greenhouse, Lever or Ashby URL in an HN comment lands its company here as a candidate.
          </ToggleRow>
          <div class="border-t border-line pt-5">
            <ToggleRow
              label={'HN "Who is hiring" parser'}
              enabled={hnParserEnabled}
              action="/discovery/hn-parser-toggle"
              extra={
                <ActionForm
                  action="/discovery/hn-run"
                  confirm="Pull the latest HN Who-is-hiring thread now? Takes 1-2 minutes and spends AI credit."
                >
                  <Button size="sm" variant="violet" disabled={!hnParserEnabled}>
                    Run now
                  </Button>
                </ActionForm>
              }
              more="The first pull (on the 1st of the month, or Run now) adds the thread as a source; from then on the hourly fetch reads it with the others, so new comments arrive through the month. It runs to 300–500 comments; the structured ones go through the same filter → classify → alert pipeline as any posting. Many small startups post only there. Switching the source off on Settings → Sources stops it too."
            >
              Reads the latest "Ask HN: Who is hiring?" thread every hour once the first pull has added it; Run now spends AI credit.
            </ToggleRow>
          </div>
        </div>
      </Card>

      <div>
        <SectionTitle level="section">Pending review ({pending.length})</SectionTitle>
        {pending.length === 0 ? (
          <Empty title="No candidates yet">
            A candidate is a company board found in a Hacker News hiring thread. Switch on the HN
            parser and auto-discovery above, then press Run now.
          </Empty>
        ) : (
          <>
            <Hint class="mb-3">
              Sorted by jobs currently visible on the board.
            </Hint>
            <CandidateTable rows={pending} actions />
          </>
        )}
      </div>

      {promoted.length > 0 && (
        <div>
          <SectionTitle level="section">Promoted ({promoted.length})</SectionTitle>
          <CandidateTable rows={promoted} />
        </div>
      )}
      {ignored.length > 0 && (
        <div>
          <SectionTitle level="section">Ignored ({ignored.length})</SectionTitle>
          <CandidateTable rows={ignored} actions />
        </div>
      )}
      {dead.length > 0 && (
        <div>
          <SectionTitle level="section">Dead ({dead.length})</SectionTitle>
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
        <Table caption="Discovered boards"
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
                <Tag>{sourceLabel(c.atsType)}</Tag>
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
