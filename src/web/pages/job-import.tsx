/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { DROP_REASONS, usableMapping, type DropReason, type MappedRows } from '../../datasets/map';
import type { PreviewCounts } from '../../datasets/preview';
import { MAX_BODY_MB, MAX_ROWS, type RowFormat } from '../../datasets/rows';
import { companyDeleteConfirm, type CompanyDeleteImpact } from '../delete-confirm';
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

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export const JobImportPage: FC<{ sources: ImportSourceRow[]; flash?: FlashMessage | null }> = ({ sources, flash }) => (
  <Layout title="Import a file of jobs" active="jobs">
    <div class="w-full">
      <PageHeader title="Import a file of jobs" back={{ href: '/jobs', label: 'All jobs' }}>
        Rows you already have — an export, a spreadsheet, the output of a tool you run — become jobs here: filtered by
        your searches, scored and tracked like every other job. ApplyPack reads the file and requests nothing.
      </PageHeader>
      <Flash flash={flash} />

      <Card>
        <form method="post" action="/jobs/import" enctype="multipart/form-data" class="grid gap-4 sm:grid-cols-2" data-needs-file>
          <Field
            label="File"
            hint={`.json, .jsonl, .csv or .tsv — up to ${MAX_BODY_MB} MB, and the first ${MAX_ROWS.toLocaleString('en-US')} rows of it.`}
            class="sm:col-span-2"
            more={
              <>
                <p>
                  A JSON array of objects, an object holding one list (under data, items, results, records or jobs),
                  JSON Lines, or CSV / TSV with a header row. The next page shows which column was taken for the
                  title, the link and the text, and lets you correct it.
                </p>
                <p>
                  A row needs a title and a link or an id. Columns about people — who posted, who recruits, an email,
                  a phone — are never read. Nothing is fetched from the links in the file.
                </p>
                <p>
                  When a row is scored, its title, place and description go to the AI engine you chose, as for every
                  job; a local engine keeps them on this computer.
                </p>
              </>
            }
          >
            <Input type="file" name="file" required accept=".json,.jsonl,.ndjson,.csv,.tsv" class={FILE_INPUT_CLASS} />
          </Field>
          {sources.length > 0 && (
            <Field label="Add to a source you imported before" hint="A newer export of the same source adds only the rows that are new.">
              <Select name="source">
                <option value="">— a new source —</option>
                {sources.map((s) => (
                  <option value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label={sources.length > 0 ? 'Or name a new source' : 'Source name'}
            hint="Your own words for where these rows come from, such as “September export”."
          >
            <Input type="text" name="sourceName" maxlength="80" placeholder="September export" required={sources.length === 0} />
          </Field>
          <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button>Preview the rows</Button>
            <Hint>Nothing is stored and no AI is spent until you press Import on the next page.</Hint>
          </div>
        </form>
        <script dangerouslySetInnerHTML={{ __html: NEEDS_FILE_JS }} />
      </Card>

      {sources.length > 0 && (
        <Card class="mt-6" flush>
          <div class="px-5 pt-5">
            <SectionTitle>Sources you imported</SectionTitle>
          </div>
          <Table columns={['Source', 'Jobs', 'Last import', <span class="sr-only">Actions</span>]} caption="Sources you imported">
            {sources.map((s) => (
              <Tr>
                <Td class="text-ink">{s.name}</Td>
                <Td class="font-mono tabular-nums text-ink-muted">{s.impact.jobs.toLocaleString('en-US')}</Td>
                <Td class="text-ink-muted">
                  <When at={s.lastImportAt} />
                </Td>
                <Td>
                  <ConfirmAction
                    action={`/jobs/import/sources/${s.id}/delete`}
                    label="Delete"
                    ariaLabel={`Delete ${s.name}`}
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

const DROPPED_AS: Record<DropReason, string> = {
  closed: 'marked closed by the file',
  'no-title': 'without a title',
  'no-identity': 'with neither an id nor a link',
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
  if (!usableMapping(stash.mapping)) return 'Choose the column that holds the job title, and one that holds a link or an id, then update the preview.';
  if (mapped.jobs.length === 0) return 'With these columns no row of the file is a job. Check the title and the link, then update the preview.';
  if (searches.running === 0) return 'No search is running, so nothing would be stored. Switch one on under Settings → Searches.';
  if (scoring && searches.usable === 0) return 'Every running search is empty, so nothing would be scored or stored. Give one a required stack or role types on Settings → Searches.';
  if (counts.passing === 0) return 'Nothing here is both new and wanted by a running search, so there is nothing to import.';
  return null;
}

export const JobImportPreviewPage: FC<ImportPreviewProps> = (props) => {
  const { stash, columns, mapped, counts, scoring, cost, flash } = props;
  const action = `/jobs/import/${stash.id}`;
  const dropped = DROP_REASONS.filter((r) => mapped.dropped[r] > 0).map((r) => `${mapped.dropped[r]} ${DROPPED_AS[r]}`);
  if (mapped.repeated > 0) dropped.push(`${mapped.repeated} repeating a row above`);
  const fresh = counts.usable - counts.stored;
  const blocked = blocker(props);
  return (
    <Layout title="Check the import" active="jobs">
      <div class="w-full">
        <PageHeader title="Check the import" back={{ href: '/jobs/import', label: 'Choose another file' }}>
          {stash.fileName}, read as {FORMAT_NAME[stash.format]}, into “{stash.source.name}”
          {stash.source.id === null ? ', a new source' : ''}. Nothing is stored yet.
        </PageHeader>
        <Flash flash={flash} />

        <Card>
          <SectionTitle>Which column is which</SectionTitle>
          <form id="import-form" method="post" action={action} onsubmit={SUBMIT_ONCE}>
            <MappingFields mapping={stash.mapping} guessed={stash.guessed} rows={stash.rows} columns={columns} />
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" formaction={`${action}/mapping`}>
                Update the preview
              </Button>
              <MappingNote columns={columns} />
            </div>
          </form>
        </Card>

        {mapped.jobs.length > 0 && (
          <Card class="mt-6">
            <SectionTitle>The first rows as they would be stored</SectionTitle>
            <MappedRowsList jobs={mapped.jobs} />
          </Card>
        )}

        <Card class="mt-6">
          <SectionTitle>What importing does</SectionTitle>
          <ul class="space-y-1 text-sm text-ink">
            <li>
              {count(stash.rows.length, 'row')} read from the file, {count(counts.usable, 'of them a job', 'of them jobs')}
              {dropped.length > 0 ? `; left out: ${dropped.join(', ')}` : ''}.
            </li>
            {counts.stored > 0 && (
              <li>
                {count(counts.stored, 'is', 'are')} already in “{stash.source.name}” and {counts.stored === 1 ? 'stays as it is' : 'stay as they are'}.
              </li>
            )}
            <li>
              Of the {count(fresh, 'new row')}, {count(counts.passing, 'passes', 'pass')} your running searches’ filter and would be
              stored; the rest are set aside without any AI
              {counts.turnedAway > 0 ? `, ${counts.turnedAway} of them at a company you muted or applied to recently` : ''}.
            </li>
            {stash.mapping.employer === null && counts.passing > 0 && (
              <li>No column is read as the company, so where a company is shown these rows will carry the source’s name.</li>
            )}
            {counts.passing > 0 && (
              <li>
                {scoring
                  ? `Each stored row is scored: about ${count(counts.passing, 'AI call')}. ${cost}`
                  : 'Fetching is paused, so they are stored unscored and no AI is spent. Score them later with Save & re-classify on Settings → Searches.'}
              </li>
            )}
            {mapped.thin > 0 && (
              <li>{count(mapped.thin, 'row comes', 'rows come')} with little or no description, and {mapped.thin === 1 ? 'is' : 'are'} judged on what there is.</li>
            )}
          </ul>
          {stash.over > 0 && (
            <Notice tone="warn" class="mt-3">
              The file holds {count(stash.over, 'more row')} than the {MAX_ROWS.toLocaleString('en-US')} read at a time. Those are not
              in this preview and will not be imported; split the file to bring them in.
            </Notice>
          )}
          {stash.notRows > 0 && (
            <Hint class="mt-2">{count(stash.notRows, 'entry of the file is', 'entries of the file are')} not a row and skipped.</Hint>
          )}
          {blocked && (
            <Notice tone="warn" class="mt-3">
              {blocked}
            </Notice>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <Button form="import-form" disabled={blocked !== null}>
              Import
            </Button>
            <Hint>Changed a column? Update the preview first to see these numbers again.</Hint>
          </div>
        </Card>
      </div>
    </Layout>
  );
};
