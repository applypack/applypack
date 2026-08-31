/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  Badge,
  Button,
  Card,
  Empty,
  Hint,
  PageHeader,
  PillCheckbox,
  SectionTitle,
  Table,
  Tag,
  Td,
  Tr,
} from '../ui';
import type { PackSegment } from '../../starter-packs/catalog';
import type {
  PackPreview,
  ResolvedEntry,
  UnresolvedEntry,
} from '../../starter-packs/resolve';

export interface PackSegmentChoice extends PackSegment {
  count: number;
}

/** The picker that lives on /companies. */
export const StarterPackPicker: FC<{ segments: PackSegmentChoice[] }> = ({ segments }) => (
  <Card class="mb-4">
    <SectionTitle>Add a starter pack</SectionTitle>
    <Hint class="mb-4">
      Curated lists of companies whose board we pinned and checked by hand. We
      re-probe each one now, show you what resolved, and add nothing until you
      confirm. Companies land disabled so the next fetch does not run away.
    </Hint>
    <form method="post" action="/companies/starter-pack">
      <div class="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {segments.map((s) => (
          <PillCheckbox name="segment" value={s.id}>
            <span class="min-w-0">
              <span class="block font-medium text-ink">
                {s.label}{' '}
                <span class="font-normal text-ink-faint tabular-nums">
                  · {s.count}
                </span>
              </span>
              <span class="block text-[13px] leading-5 text-ink-faint">{s.blurb}</span>
            </span>
          </PillCheckbox>
        ))}
      </div>
      <Button>Preview pack</Button>
    </form>
  </Card>
);

const BoardCell: FC<{ entry: ResolvedEntry }> = ({ entry }) => (
  <>
    <Tag>{entry.atsType}</Tag>{' '}
    <a
      href={entry.boardUrl}
      target="_blank"
      rel="noopener"
      class="font-mono text-xs text-ink-muted transition-colors duration-150 hover:text-accent-strong"
    >
      {entry.atsToken}
    </a>
    {!entry.pinned && (
      <>
        {' '}
        <Badge tone="warn">guessed</Badge>
      </>
    )}
  </>
);

const ResolvedTable: FC<{
  entries: ResolvedEntry[];
  selectable?: boolean;
}> = ({ entries, selectable = false }) => (
  <div class="overflow-x-auto">
    <div class="min-w-[36rem]">
      <Table
        columns={[
          ...(selectable ? ['Add'] : []),
          'Company',
          'Board',
          <span class="block text-right">Open jobs</span>,
        ]}
      >
        {entries.map((e) => (
          <Tr>
            {selectable && (
              <Td>
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-accent"
                  name="pick"
                  value={`${e.segment}|${e.name}|${e.atsType}|${e.atsToken}`}
                  checked
                  aria-label={`Add ${e.name}`}
                />
              </Td>
            )}
            <Td class="font-medium text-ink">{e.name}</Td>
            <Td>
              <BoardCell entry={e} />
            </Td>
            <Td class="text-right tabular-nums text-ink-muted">{e.jobsCount}</Td>
          </Tr>
        ))}
      </Table>
    </div>
  </div>
);

const UnresolvedList: FC<{ entries: UnresolvedEntry[] }> = ({ entries }) => (
  <div class="overflow-x-auto">
    <div class="min-w-[28rem]">
      <Table columns={['Company', 'Why']}>
        {entries.map((e) => (
          <Tr>
            <Td class="font-medium text-ink">{e.name}</Td>
            <Td class="text-ink-muted">{e.reason}</Td>
          </Tr>
        ))}
      </Table>
    </div>
  </div>
);

export const StarterPackPreviewPage: FC<{
  preview: PackPreview;
  segmentLabels: string[];
}> = ({ preview, segmentLabels }) => (
  <Layout title="Starter pack" active="companies">
    <PageHeader
      title="Starter pack preview"
      meta={`${preview.toAdd.length} to add · ${preview.alreadyAdded.length} already tracked · ${preview.unresolved.length} unresolved`}
      back={{ href: '/companies', label: 'Companies' }}
    >
      {segmentLabels.join(' · ')}
    </PageHeader>

    <form method="post" action="/companies/starter-pack/import">
      <Card class="mb-4">
        <SectionTitle>New boards</SectionTitle>
        {preview.toAdd.length === 0 ? (
          <Empty>Nothing new — every board in this pack is already tracked.</Empty>
        ) : (
          <>
            <Hint class="mb-4">
              Each of these answered with at least one open job just now. They
              are added disabled; enable them on the next screen.
            </Hint>
            <ResolvedTable entries={preview.toAdd} selectable />
            <div class="mt-4">
              <Button>Add {preview.toAdd.length} companies</Button>
            </div>
          </>
        )}
      </Card>
    </form>

    {preview.unresolved.length > 0 && (
      <Card class="mb-4">
        <SectionTitle>Could not resolve</SectionTitle>
        <Hint class="mb-4">
          No public board on any ATS we support — worth a manual look, so they
          are listed rather than dropped. Add one by hand above on{' '}
          <a href="/companies" class="font-medium text-accent-strong hover:text-accent-deep">
            Companies
          </a>{' '}
          if you find its board URL.
        </Hint>
        <UnresolvedList entries={preview.unresolved} />
      </Card>
    )}

    {preview.alreadyAdded.length > 0 && (
      <Card>
        <SectionTitle>Already tracked</SectionTitle>
        <Hint class="mb-4">Skipped — re-importing a pack never duplicates a board.</Hint>
        <ResolvedTable entries={preview.alreadyAdded} />
      </Card>
    )}
  </Layout>
);

export const StarterPackResultPage: FC<{
  added: Array<{ id: number; name: string; atsType: string; atsToken: string }>;
  skipped: number;
}> = ({ added, skipped }) => (
  <Layout title="Starter pack" active="companies">
    <PageHeader
      title="Pack added"
      meta={`${added.length} added${skipped > 0 ? ` · ${skipped} skipped` : ''}`}
      back={{ href: '/companies', label: 'Companies' }}
    />

    <Card>
      {added.length === 0 ? (
        <Empty>Nothing was added.</Empty>
      ) : (
        <>
          <SectionTitle>Added, currently disabled</SectionTitle>
          <Hint class="mb-4">
            Enable them to include their boards in the next fetch tick. You can
            also enable them one by one on Companies.
          </Hint>
          <div class="overflow-x-auto">
            <div class="min-w-[28rem]">
              <Table columns={['Company', 'Board']}>
                {added.map((a) => (
                  <Tr>
                    <Td class="font-medium text-ink">{a.name}</Td>
                    <Td>
                      <Tag>{a.atsType}</Tag>{' '}
                      <span class="font-mono text-xs text-ink-muted">{a.atsToken}</span>
                    </Td>
                  </Tr>
                ))}
              </Table>
            </div>
          </div>
          <form method="post" action="/companies/starter-pack/enable" class="mt-4 flex gap-2">
            {added.map((a) => (
              <input type="hidden" name="id" value={String(a.id)} />
            ))}
            <Button>Enable all {added.length}</Button>
            <Button href="/companies" variant="ghost">
              Leave disabled
            </Button>
          </form>
        </>
      )}
    </Card>
  </Layout>
);
