/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import { Hint, Input, Select } from '../ui';

/*
 * "One of your jobs" on every launcher (/target, /letter, /screen/new): a
 * filter box over a listbox of stored jobs. letter-start.mjs filters the
 * options in place and keeps the count in step; without JS the listbox still
 * submits `jobId`. The children finish the count's sentence.
 */

export interface JobPickOption {
  id: number;
  title: string;
  companyName: string;
  /** Between the title and the age: "fit 72", "pasted". */
  note: string | null;
  ageDays: number;
}

export const JobPicker: FC<PropsWithChildren<{ jobs: JobPickOption[]; selectedId?: number | null }>> = ({
  jobs,
  selectedId = null,
  children,
}) => (
  <div class="space-y-2">
    <Input type="search" id="job-search" placeholder="Filter by title or company…" aria-label="Filter jobs" autocomplete="off" />
    <Select name="jobId" id="job-select" size={8} aria-label="Job" class="!h-auto">
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
