/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { JobPickOption } from '../job-pick';
import { Hint, Input, Select } from '../ui';

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
    <Input type="search" id="job-search" placeholder="Filter by title or company…" aria-label="Filter jobs" autocomplete="off" />
    <Select name="jobId" id="job-select" size={8} aria-label="Job" class="!h-auto" data-required>
      {jobs.map((j) => (
        <option value={j.id} selected={j.id === selectedId}>
          {j.companyName} — {j.title}
          {j.note ? ` · ${j.note}` : ''} · {j.ageDays === 0 ? 'today' : `${j.ageDays}d old`}
        </option>
      ))}
    </Select>
    <Hint>
      <span id="job-count">{jobs.length}</span> {children}
    </Hint>
  </div>
);
