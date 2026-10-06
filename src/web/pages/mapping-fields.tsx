/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { sampleValue, type Mapping, type MappingField } from '../../datasets/map';
import { MAX_COLUMNS, type Row } from '../../datasets/rows';
import type { NormalizedJob } from '../../types';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { formatDateShort } from '../format';
import { Disclosure, Field, Hint, Select } from '../ui';

/*
 * The two halves of a preview every source of rows shares (ADR 0062): which
 * column was taken for what, with a select to correct each, and the first
 * rows as they would be stored. The selects are named after the fields, so
 * the form they sit in posts a mapping (datasets/map.ts:MappingSchema).
 */

/** What a column can be, in the user's words. The first eight are what most files have; the rest fold. */
const FIELD_LABEL: Record<MappingField, MessageKey> = {
  title: 'import.field.title',
  url: 'import.field.url',
  applyUrl: 'import.field.applyUrl',
  employer: 'common.company',
  description: 'import.field.description',
  location: 'common.location',
  postedAt: 'import.field.postedAt',
  id: 'import.field.id',
  country: 'import.field.country',
  workplace: 'import.field.workplace',
  salary: 'import.field.salary',
  salaryMin: 'import.field.salaryMin',
  salaryMax: 'import.field.salaryMax',
  salaryCurrency: 'import.field.salaryCurrency',
  salaryPeriod: 'import.field.salaryPeriod',
  closed: 'import.field.closed',
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
      ? t('import.field.notFound')
      : [guessed.includes(field) ? t('import.field.guessed') : '', sample ? t('import.field.example', { sample }) : t('import.field.emptyFirstRows')].filter(Boolean).join(' ');
  const label = t(FIELD_LABEL[field]);
  return (
    <Field label={field === 'title' ? t('import.field.needed', { label }) : label} hint={hint}>
      <Select name={field}>
        <option value="">{t('import.field.none')}</option>
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
    <Disclosure summary={t('import.moreFields')} count={MORE_FIELDS.filter((f) => props.mapping[f] !== null).length} class="mt-4">
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
    {t('import.peopleColumns')}
    {columns.length >= MAX_COLUMNS ? ` ${t('import.firstColumnsOnly', { n: MAX_COLUMNS })}` : ''}
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
        <div class="text-label text-ink" translate="no">{job.title}</div>
        <div class="text-note text-ink-muted">
          {[job.employer ?? t('import.row.noCompany'), job.location || t('import.row.noLocation'), formatDateShort(job.postedAt)].join(' · ')}
        </div>
        <div class="break-all text-meta text-ink-faint">{job.url || t('import.row.noLink')}</div>
        <p class="mt-1 text-note text-ink-muted" translate="no">{excerpt(job.description)}</p>
      </li>
    ))}
  </ul>
);
