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
import { t } from '../../i18n/t';
import { tRich } from '../rich';
import { sourceLabel } from '../source-names';
import type { HideBelow } from '../table-hide';

export interface PackSegmentChoice extends PackSegment {
  count: number;
}

/** The picker that lives on /companies. */
export const StarterPackPicker: FC<{ segments: PackSegmentChoice[] }> = ({ segments }) => (
  <Card>
    <Hint class="mb-4">
      {t('packs.curatedListsOfCompaniesWhose')}
    </Hint>
    <form method="post" action="/companies/starter-pack">
      <div class="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {segments.map((s) => (
          <PillCheckbox name="segment" value={s.id}>
            {/* A segment's name and blurb are the catalog's own (starter-packs/catalog.json), in English. */}
            <span class="min-w-0" lang="en">
              <span class="block font-medium text-ink">
                {s.label}{' '}
                <span data-ui="hint" class="font-normal text-ink-faint tabular-nums">
                  · {s.count}
                </span>
              </span>
              <span data-ui="hint" class="block text-note leading-5 text-ink-faint">{s.blurb}</span>
            </span>
          </PillCheckbox>
        ))}
      </div>
      <Button>{t('packs.previewPack')}</Button>
    </form>
  </Card>
);

const BoardCell: FC<{ entry: ResolvedEntry }> = ({ entry }) => (
  <>
    <span translate="no">
      <Tag wrap>{sourceLabel(entry.atsType)}</Tag>
    </span>{' '}
    <a
      href={entry.boardUrl}
      target="_blank"
      rel="noopener"
      translate="no"
      class="font-mono text-meta text-ink-muted transition-colors duration-150 [overflow-wrap:anywhere] hover:text-accent-strong"
    >
      {entry.atsToken}
    </a>
    {!entry.pinned && (
      <>
        {' '}
        <Badge tone="warn">{t('packs.guessed')}</Badge>
      </>
    )}
  </>
);

/**
 * The pack tables' columns (#619): the company takes what is left and
 * truncates; the board keeps its widest vendor tag and joins from `sm`, where
 * a phone shows it under the company's name; the open jobs join from `sm`
 * too. table-hide.test.ts holds them inside the card's padding.
 */
export const PACK_WIDTHS = ['w-[5.25rem]', '', 'w-[9rem]', 'w-[5.5rem]'];
export const PACK_HIDE: HideBelow = ['', '', 'sm', 'sm'];
export const UNRESOLVED_WIDTHS = ['w-[40%]', ''];
export const ADDED_WIDTHS = ['', 'w-[9rem]'];

const ResolvedTable: FC<{
  entries: ResolvedEntry[];
  selectable?: boolean;
}> = ({ entries, selectable = false }) => (
  <Table
    widths={selectable ? PACK_WIDTHS : PACK_WIDTHS.slice(1)}
    hideBelow={selectable ? PACK_HIDE : PACK_HIDE.slice(1)}
    columns={[
      ...(selectable ? [t('packs.col.add')] : []),
      t('common.company'),
      t('packs.col.board'),
      <span class="block text-right">{t('packs.openJobs')}</span>,
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
              aria-label={t('packs.addNamed', { name: e.name })}
            />
          </Td>
        )}
        <Td class="font-medium text-ink">
          <div class="truncate" translate="no" title={e.name}>
            {e.name}
          </div>
          <div class="mt-0.5 font-normal sm:hidden">
            <BoardCell entry={e} />
          </div>
        </Td>
        <Td>
          <BoardCell entry={e} />
        </Td>
        <Td class="text-right tabular-nums text-ink-muted">{e.jobsCount}</Td>
      </Tr>
    ))}
  </Table>
);

const UnresolvedList: FC<{ entries: UnresolvedEntry[] }> = ({ entries }) => (
  <Table widths={UNRESOLVED_WIDTHS} columns={[t('common.company'), t('packs.col.why')]}>
    {entries.map((e) => (
      <Tr>
        <Td class="truncate font-medium text-ink">
          <span translate="no" title={e.name}>
            {e.name}
          </span>
        </Td>
        <Td class="break-words text-ink-muted">{e.reason}</Td>
      </Tr>
    ))}
  </Table>
);

/** Where the pack flow came from: the wizard's boards step, or Companies (ADR 0040). */
export type PackOrigin = 'welcome' | undefined;

/** Where "back" leads, the word for it, and the button that says so in full. */
const backFor = (next: PackOrigin) =>
  next === 'welcome'
    ? { href: '/welcome?step=sources', label: t('packs.back.setup'), backTo: t('packs.backToSetup') }
    : { href: '/companies', label: t('nav.companies'), backTo: t('packs.backToCompanies') };

export const StarterPackPreviewPage: FC<{
  preview: PackPreview;
  segmentLabels: string[];
  next?: PackOrigin;
}> = ({ preview, segmentLabels, next }) => (
  <Layout title={t('packs.starterPack')} active="companies">
    <PageHeader
      title={t('packs.starterPackPreview')}
      meta={t('packs.preview.meta', { add: preview.toAdd.length, tracked: preview.alreadyAdded.length, unresolved: preview.unresolved.length })}
      back={backFor(next)}
    >
      <span lang="en">{segmentLabels.join(' · ')}</span>
    </PageHeader>

    <form method="post" action="/companies/starter-pack/import">
      {next && <input type="hidden" name="next" value={next} />}
      <Card class="mb-4">
        <SectionTitle>{t('packs.newBoards')}</SectionTitle>
        {preview.toAdd.length === 0 ? (
          <Empty bare title={t('packs.nothingNewInThisPack')}>
            {t('packs.everyBoardInItIs')}
          </Empty>
        ) : (
          <>
            <Hint class="mb-4">
              {t('packs.eachOfTheseAnsweredWith')}
            </Hint>
            <ResolvedTable entries={preview.toAdd} selectable />
            <div class="mt-4">
              <Button>{t('packs.addN', { n: preview.toAdd.length })}</Button>
            </div>
          </>
        )}
      </Card>
    </form>

    {preview.unresolved.length > 0 && (
      <Card class="mb-4">
        <SectionTitle>{t('packs.couldNotResolve')}</SectionTitle>
        <Hint class="mb-4">
          {tRich('packs.unresolvedHint', {}, {
            link: (words) => (
              <a href="/companies" class="font-medium text-accent-strong hover:text-accent-deep">
                {words}
              </a>
            ),
          })}
        </Hint>
        <UnresolvedList entries={preview.unresolved} />
      </Card>
    )}

    {preview.alreadyAdded.length > 0 && (
      <Card>
        <SectionTitle>{t('packs.alreadyTracked')}</SectionTitle>
        <Hint class="mb-4">{t('packs.skippedReImportingAPack')}</Hint>
        <ResolvedTable entries={preview.alreadyAdded} />
      </Card>
    )}
  </Layout>
);

export const StarterPackResultPage: FC<{
  added: Array<{ id: number; name: string; atsType: string; atsToken: string }>;
  skipped: number;
  next?: PackOrigin;
}> = ({ added, skipped, next }) => (
  <Layout title={t('packs.starterPack')} active="companies">
    <PageHeader
      title={t('packs.packAdded')}
      meta={skipped > 0 ? t('packs.result.metaSkipped', { added: added.length, skipped }) : t('packs.result.meta', { added: added.length })}
      back={backFor(next)}
    />

    <Card>
      {added.length === 0 ? (
        <Empty
          bare
          title={t('packs.nothingWasAdded')}
          action={
            <Button href={backFor(next).href} variant="secondary" size="sm">
              {backFor(next).backTo}
            </Button>
          }
        >
          {t('packs.everyBoardYouTickedIs')}
        </Empty>
      ) : (
        <>
          <SectionTitle>{t('packs.addedCurrentlyDisabled')}</SectionTitle>
          <Hint class="mb-4">
            {t('packs.enableThemToIncludeTheir')}
          </Hint>
          <Table widths={ADDED_WIDTHS} columns={[t('common.company'), t('packs.col.board')]}>
            {added.map((a) => (
              <Tr>
                <Td class="truncate font-medium text-ink">
                  <span translate="no" title={a.name}>
                    {a.name}
                  </span>
                </Td>
                <Td>
                  <span translate="no">
                    <Tag wrap>{sourceLabel(a.atsType)}</Tag>{' '}
                    <span class="font-mono text-meta text-ink-muted [overflow-wrap:anywhere]">{a.atsToken}</span>
                  </span>
                </Td>
              </Tr>
            ))}
          </Table>
          <form method="post" action="/companies/starter-pack/enable" class="mt-4 flex gap-2">
            {next && <input type="hidden" name="next" value={next} />}
            {added.map((a) => (
              <input type="hidden" name="id" value={String(a.id)} />
            ))}
            <Button>{t('companies.enableAllN', { n: added.length })}</Button>
            <Button href={backFor(next).href} variant="ghost">
              {t('packs.leaveDisabled')}
            </Button>
          </form>
        </>
      )}
    </Card>
  </Layout>
);
