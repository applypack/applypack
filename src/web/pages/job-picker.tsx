/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { JobPickOption } from '../job-pick';
import { Hint, Input, Select } from '../ui';
import { t } from '../../i18n/t';

/*
 * "One of your jobs" on every launcher (/target, /letter, /screen/new): a
 * filter box over a listbox of stored jobs. launcher.mjs filters the options
 * in place, keeps the count in step, and requires a pick while this box is
 * the chosen one; without JS the listbox still submits `jobId`. The children
 * finish the count's sentence.
 */

export const JobPicker: FC<PropsWithChildren<{ jobs: JobPickOption[]; selectedId?: number | null }>> = ({
  jobs,
  selectedId = null,
  children,
}) => (
  <div class="space-y-2">
    <Input type="search" id="job-search" placeholder={t('job.picker.filterByTitleOrCompany')} aria-label={t('job.picker.filterJobs')} autocomplete="off" />
    <Select name="jobId" id="job-select" size={8} aria-label={t('job.picker.job')} class="!h-auto" data-required>
      {jobs.map((j) => (
        // The company and the title are the posting's own, the note and the age the catalog's. An option holds text
        // alone, so it is marked whole: translate="no" only keeps a browser's translator off the posting's words —
        // ours are already in the reader's language.
        <option value={j.id} selected={j.id === selectedId} translate="no">
          {j.companyName} — {j.title}
          {j.note ? ` · ${j.note}` : ''} · {j.ageDays === 0 ? t('job.picker.today') : t('job.picker.daysOld', { n: j.ageDays })}
        </option>
      ))}
    </Select>
    <Hint>
      <span id="job-count">{jobs.length}</span> {children}
    </Hint>
  </div>
);
