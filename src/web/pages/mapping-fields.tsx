/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { sampleValue, type Mapping, type MappingField } from '../../datasets/map';
import { MAX_COLUMNS, type Row } from '../../datasets/rows';
import type { NormalizedJob } from '../../types';
import { formatDateShort } from '../format';
import { Disclosure, Field, Hint, Select } from '../ui';

/*
 * The two halves of a preview every source of rows shares (ADR 0062): which
 * column was taken for what, with a select to correct each, and the first
 * rows as they would be stored. The selects are named after the fields, so
 * the form they sit in posts a mapping (datasets/map.ts:MappingSchema).
 */

/** What a column can be, in the user's words. The first eight are what most files have; the rest fold. */
const FIELD_LABEL: Record<MappingField, string> = {
  title: 'Job title',
  url: 'Link to the posting',
  applyUrl: 'Link to apply',
  employer: 'Company',
  description: 'Description',
  location: 'Location',
  postedAt: 'Date posted',
  id: 'Id of the row',
  country: 'Country',
  workplace: 'Remote, hybrid or on-site',
  salary: 'Pay, as the row writes it',
  salaryMin: 'Pay from',
  salaryMax: 'Pay to',
  salaryCurrency: 'Pay currency',
  salaryPeriod: 'Pay period',
  closed: 'Closed or expired',
};
const MAIN_FIELDS: MappingField[] = ['title', 'url', 'applyUrl', 'employer', 'description', 'location', 'postedAt', 'id'];
const MORE_FIELDS: MappingField[] = ['country', 'workplace', 'salary', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod', 'closed'];

export interface MappingFieldsProps {
  mapping: Mapping;
  /** Fields read off the values rather than the names: marked as a guess. */
  guessed: readonly MappingField[];
  /** The rows the samples are read from. */
  rows: readonly Row[];
  columns: readonly string[];
}

const MappingSelect: FC<{ field: MappingField } & MappingFieldsProps> = ({ field, mapping, guessed, rows, columns }) => {
  const column = mapping[field];
  const sample = column === null ? '' : sampleValue(rows, column);
  const hint =
    column === null
      ? 'Not found in this file.'
      : `${guessed.includes(field) ? 'Guessed from the values, so check it. ' : ''}${sample ? `For example: ${sample}` : 'Empty in the first rows.'}`;
  return (
    <Field label={field === 'title' ? `${FIELD_LABEL[field]} (needed)` : FIELD_LABEL[field]} hint={hint}>
      <Select name={field}>
        <option value="">— not in this file —</option>
        {columns.map((c) => (
          <option value={c} selected={c === column}>
            {c}
          </option>
        ))}
      </Select>
    </Field>
  );
};

export const MappingFields: FC<MappingFieldsProps> = (props) => (
  <>
    <div class="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {MAIN_FIELDS.map((field) => (
        <MappingSelect field={field} {...props} />
      ))}
    </div>
    <Disclosure summary="Country, arrangement, pay and closed rows" count={MORE_FIELDS.filter((f) => props.mapping[f] !== null).length} class="mt-4">
      <div class="mt-3 grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {MORE_FIELDS.map((field) => (
          <MappingSelect field={field} {...props} />
        ))}
      </div>
    </Disclosure>
  </>
);

/** What stands beside the button that re-reads the mapping. */
export const MappingNote: FC<{ columns: readonly string[] }> = ({ columns }) => (
  <Hint>
    Columns about people are not offered: they are never read.
    {columns.length >= MAX_COLUMNS ? ` Only the first ${MAX_COLUMNS} columns are offered.` : ''}
  </Hint>
);

const EXCERPT_CHARS = 280;

/** The head of a description on one paragraph: enough to see the text was read, and read clean. */
function excerpt(description: string): string {
  const text = description.replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text;
}

/** The first three rows as they would be stored. A link is shown as text: it came from a file. */
export const MappedRowsList: FC<{ jobs: readonly NormalizedJob[] }> = ({ jobs }) => (
  <ul class="divide-y divide-line">
    {jobs.slice(0, 3).map((job) => (
      <li class="py-3 first:pt-0 last:pb-0">
        <div class="text-label text-ink">{job.title}</div>
        <div class="text-note text-ink-muted">
          {[job.employer ?? 'company not named', job.location || 'no location', formatDateShort(job.postedAt)].join(' · ')}
        </div>
        <div class="break-all text-meta text-ink-faint">{job.url || 'no link'}</div>
        <p class="mt-1 text-note text-ink-muted">{excerpt(job.description)}</p>
      </li>
    ))}
  </ul>
);
