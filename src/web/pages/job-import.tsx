/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { DROP_REASONS, usableMapping, type DropReason, type MappedRows } from '../../datasets/map';
import type { PreviewCounts } from '../../datasets/preview';
import { MAX_BODY_MB, MAX_ROWS, type RowFormat } from '../../datasets/rows';
import { companyDeleteConfirm, type CompanyDeleteImpact } from '../delete-confirm';
import type { MessageKey } from '../../i18n/catalog';
import { formatNumber } from '../../i18n/format';
import { t } from '../../i18n/t';
import type { FlashMessage } from '../flash';
import type { ImportStash } from '../import-stash';
import { Layout } from '../layout';
import { MappedRowsList, MappingFields, MappingNote } from './mapping-fields';
import {
  Button,
  Card,
  ConfirmAction,
  Field,
  FILE_INPUT_CLASS,
  Flash,
  Hint,
  Input,
  NEEDS_FILE_JS,
  Notice,
  PageHeader,
  SectionTitle,
  Select,
  SUBMIT_ONCE,
  Table,
  Td,
  Tr,
  When,
} from '../ui';

export interface ImportSourceRow {
  id: number;
  name: string;
  lastImportAt: Date | null;
  impact: CompanyDeleteImpact;
}

export const JobImportPage: FC<{ sources: ImportSourceRow[]; flash?: FlashMessage | null }> = ({ sources, flash }) => (
  <Layout title={t('import.title')} active="jobs">
    <div class="w-full">
      <PageHeader title={t('import.title')} back={{ href: '/jobs', label: t('job.allJobs') }}>
        {t('import.intro')}
      </PageHeader>
      <Flash flash={flash} />

      <Card>
        <form method="post" action="/jobs/import" enctype="multipart/form-data" class="grid gap-4 sm:grid-cols-2" data-needs-file>
          <Field
            label={t('import.file')}
            hint={t('import.fileHint', { mb: MAX_BODY_MB, rows: MAX_ROWS })}
            class="sm:col-span-2"
            more={
              <>
                <p>{t('import.more.formats')}</p>
                <p>{t('import.more.needs')}</p>
                <p>{t('import.more.ai')}</p>
              </>
            }
          >
            <Input type="file" name="file" required accept=".json,.jsonl,.ndjson,.csv,.tsv" class={FILE_INPUT_CLASS} />
          </Field>
          {sources.length > 0 && (
            <Field label={t('import.addTo')} hint={t('import.addToHint')}>
              <Select name="source">
                <option value="">{t('import.newSourceOption')}</option>
                {sources.map((s) => (
                  <option value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label={t(sources.length > 0 ? 'import.orNewSource' : 'import.sourceName')}
            hint={t('import.sourceNameHint')}
          >
            <Input type="text" name="sourceName" maxlength="80" placeholder={t('import.sourcePlaceholder')} required={sources.length === 0} />
          </Field>
          <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button>{t('import.previewRows')}</Button>
            <Hint>{t('import.previewHint')}</Hint>
          </div>
        </form>
        <script dangerouslySetInnerHTML={{ __html: NEEDS_FILE_JS }} />
      </Card>

      {sources.length > 0 && (
        <Card class="mt-6" flush>
          <div class="px-5 pt-5">
            <SectionTitle>{t('import.sources')}</SectionTitle>
          </div>
          <Table
            columns={[t('import.col.source'), t('import.col.jobs'), t('import.col.lastImport'), <span class="sr-only">{t('common.actions')}</span>]}
            caption={t('import.sources')}
          >
            {sources.map((s) => (
              <Tr>
                <Td class="text-ink">{s.name}</Td>
                <Td class="font-mono tabular-nums text-ink-muted">{formatNumber(s.impact.jobs)}</Td>
                <Td class="text-ink-muted">
                  <When at={s.lastImportAt} />
                </Td>
                <Td>
                  <ConfirmAction
                    action={`/jobs/import/sources/${s.id}/delete`}
                    label={t('common.delete')}
                    ariaLabel={t('companies.deleteNamed', { name: s.name })}
                    confirm={companyDeleteConfirm(s.name, s.impact)}
                    class="flex justify-end"
                  />
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  </Layout>
);

const FORMAT_NAME: Record<RowFormat, string> = { json: 'JSON', jsonl: 'JSON Lines', csv: 'CSV', tsv: 'TSV' };

const DROPPED_AS: Record<DropReason, MessageKey> = {
  closed: 'import.dropped.closed',
  'no-title': 'import.dropped.noTitle',
  'no-identity': 'import.dropped.noIdentity',
};

export interface ImportPreviewProps {
  stash: ImportStash;
  columns: string[];
  mapped: MappedRows;
  counts: PreviewCounts;
  /** False while fetching is paused: the rows are stored unscored. */
  scoring: boolean;
  searches: { running: number; usable: number };
  /** The cost sentence for the scoring calls; '' when none would be made. */
  cost: string;
  flash?: FlashMessage | null;
}

/** Why Import is not offered, or null when it is. One reason, the first that holds. */
function blocker({ stash, mapped, counts, scoring, searches }: ImportPreviewProps): string | null {
  if (!usableMapping(stash.mapping)) return t('import.block.mapping');
  if (mapped.jobs.length === 0) return t('import.block.noJob');
  if (searches.running === 0) return t('import.block.noSearch');
  if (scoring && searches.usable === 0) return t('import.allSearchesBlank');
  if (counts.passing === 0) return t('import.block.nothing');
  return null;
}

export const JobImportPreviewPage: FC<ImportPreviewProps> = (props) => {
  const { stash, columns, mapped, counts, scoring, cost, flash } = props;
  const action = `/jobs/import/${stash.id}`;
  const dropped = DROP_REASONS.filter((r) => mapped.dropped[r] > 0).map((r) => t(DROPPED_AS[r], { n: mapped.dropped[r] }));
  if (mapped.repeated > 0) dropped.push(t('import.dropped.repeated', { n: mapped.repeated }));
  const fresh = counts.usable - counts.stored;
  const blocked = blocker(props);
  return (
    <Layout title={t('import.checkTitle')} active="jobs">
      <div class="w-full">
        <PageHeader title={t('import.checkTitle')} back={{ href: '/jobs/import', label: t('import.chooseAnother') }}>
          {t('import.preview.header', {
            file: stash.fileName,
            format: FORMAT_NAME[stash.format],
            source: stash.source.name,
            isNew: stash.source.id === null ? 'yes' : 'no',
          })}
        </PageHeader>
        <Flash flash={flash} />

        <Card>
          <SectionTitle>{t('import.whichColumn')}</SectionTitle>
          <form id="import-form" method="post" action={action} onsubmit={SUBMIT_ONCE}>
            <MappingFields mapping={stash.mapping} guessed={stash.guessed} rows={stash.rows} columns={columns} />
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" formaction={`${action}/mapping`}>
                {t('render.updateThePreview')}
              </Button>
              <MappingNote columns={columns} />
            </div>
          </form>
        </Card>

        {mapped.jobs.length > 0 && (
          <Card class="mt-6">
            <SectionTitle>{t('import.firstRows')}</SectionTitle>
            <MappedRowsList jobs={mapped.jobs} />
          </Card>
        )}

        <Card class="mt-6">
          <SectionTitle>{t('import.whatImportingDoes')}</SectionTitle>
          <ul class="space-y-1 text-sm text-ink">
            <li>
              {t('import.preview.rows', {
                rows: stash.rows.length,
                usable: counts.usable,
                hasDropped: dropped.length > 0 ? 'yes' : 'no',
                dropped: dropped.join(', '),
              })}
            </li>
            {counts.stored > 0 && <li>{t('import.preview.stored', { n: counts.stored, source: stash.source.name })}</li>}
            <li>{t('import.preview.passing', { fresh, passing: counts.passing, turnedAway: counts.turnedAway })}</li>
            {stash.mapping.employer === null && counts.passing > 0 && <li>{t('import.noCompanyColumn')}</li>}
            {counts.passing > 0 && <li>{scoring ? `${t('import.preview.cost', { n: counts.passing })} ${cost}` : t('import.preview.paused')}</li>}
            {mapped.thin > 0 && <li>{t('import.preview.thin', { n: mapped.thin })}</li>}
          </ul>
          {stash.over > 0 && (
            <Notice tone="warn" class="mt-3">
              {t('import.preview.over', { over: stash.over, max: MAX_ROWS })}
            </Notice>
          )}
          {stash.notRows > 0 && <Hint class="mt-2">{t('import.preview.notRows', { n: stash.notRows })}</Hint>}
          {blocked && (
            <Notice tone="warn" class="mt-3">
              {blocked}
            </Notice>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <Button form="import-form" disabled={blocked !== null}>
              {t('import.import')}
            </Button>
            <Hint>{t('import.changedColumn')}</Hint>
          </div>
        </Card>
      </div>
    </Layout>
  );
};
