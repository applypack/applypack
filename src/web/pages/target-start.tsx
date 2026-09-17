/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import { Layout } from '../layout';
import {
  Button,
  Card,
  Field,
  FILE_INPUT_CLASS,
  Flash,
  Hint,
  Input,
  More,
  PageHeader,
  SectionTitle,
  Select,
  SUBMIT_ONCE,
  Textarea,
} from '../ui';
import type { FlashMessage } from '../flash';
import type { ResumeOption } from '../resume-source';
import type { JobPickOption } from '../job-pick';
import { JobPicker } from './job-picker';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';

/*
 * The /target launcher: one of your jobs or a pasted posting, and a resume
 * picked / uploaded / pasted, one submit → the targeted workspace at
 * /jobs/:id/target. A stored job goes straight to the job page's own
 * comparison; a pasted one is detected (when fields are empty), stored and
 * then compared. Detection happens INSIDE the run as a visible step and never
 * blocks: unfound facts fall back to defaults. The paste itself gets page
 * chrome trimmed in place (posting-clean.mjs).
 */

export interface TargetStartProps {
  jobs: JobPickOption[];
  /** The job the page was opened for (`?job=`), preselected in the picker. */
  selectedJobId: number | null;
  resumes: ResumeOption[];
  flash?: FlashMessage | null;
}

export const TargetStartPage: FC<TargetStartProps> = ({ jobs, selectedJobId, resumes, flash }) => {
  const hasJobs = jobs.length > 0;
  const hasResumes = resumes.length > 0;
  const defaultResumeId = (resumes.find((r) => r.isDefault) ?? resumes[0])?.id;
  return (
    <Layout title="Compare" active="target">
      <PageHeader title="Compare" meta="1–2 min">
        A posting and a resume: one run scores the resume against the posting and opens the editor
        beside it.
      </PageHeader>
      <Flash flash={flash} />

      <form
        id="target-form"
        method="post"
        action="/target"
        enctype="multipart/form-data"
        class="w-full"
        onsubmit={SUBMIT_ONCE}
      >
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Job posting</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                name="jobMode"
                value="existing"
                label="One of your jobs"
                checked={hasJobs}
                disabled={!hasJobs}
              >
                {hasJobs ? (
                  <JobPicker jobs={jobs} selectedId={selectedJobId}>
                    newest jobs that clear your fit threshold, freshest first.
                  </JobPicker>
                ) : (
                  <Hint>No tracked jobs yet — paste the posting below.</Hint>
                )}
              </ModeCard>

              <ModeCard name="jobMode" value="new" label="A new posting" checked={!hasJobs}>
                <div class="space-y-4">
                  <Field
                    label="Job description"
                    hint="Paste the posting as it is; page chrome is trimmed, and the fields below are detected from it when left empty."
                  >
                    <Textarea name="description" rows={12} placeholder="About the role…" data-required />
                  </Field>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="Company">
                      <Input type="text" name="companyName" maxlength="200" placeholder="Acme Corp" />
                    </Field>
                    <Field label="Job title">
                      <Input type="text" name="title" maxlength="200" placeholder="Senior Software Engineer" />
                    </Field>
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="Posting URL" hint="Lets Verify find the original later.">
                      <Input type="url" name="url" placeholder="https://…" />
                    </Field>
                    <Field label="Location">
                      <Input type="text" name="location" maxlength="200" placeholder="Remote (US)" />
                    </Field>
                  </div>
                </div>
              </ModeCard>
            </div>
          </Card>

          <Card>
            <SectionTitle>Resume</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                value="existing"
                label="One of your resumes"
                checked={hasResumes}
                disabled={!hasResumes}
              >
                {hasResumes ? (
                  <Select name="resumeId" aria-label="Resume">
                    {resumes.map((r) => (
                      <option value={r.id} selected={r.id === defaultResumeId}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Hint>Nothing uploaded yet — use one of the options below.</Hint>
                )}
              </ModeCard>

              <ModeCard value="upload" label="Upload a file" checked={!hasResumes}>
                <div class="space-y-3">
                  <Input
                    type="file"
                    name="file"
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    aria-label="Resume file"
                    class={FILE_INPUT_CLASS}
                    data-required
                  />
                  <Input
                    type="text"
                    name="uploadName"
                    maxlength="100"
                    placeholder="Name (optional — taken from the file name)"
                    aria-label="Resume name"
                  />
                  <Hint>
                    {ACCEPTED_EXTENSIONS.join(', ')} · up to {MAX_UPLOAD_MB} MB. A one-off check:
                    nothing is added to your Resumes.
                  </Hint>
                </div>
              </ModeCard>

              <ModeCard value="paste" label="Paste resume text">
                <div class="space-y-3">
                  <Input
                    type="text"
                    name="pasteName"
                    maxlength="100"
                    placeholder="Name (optional)"
                    aria-label="Resume name"
                  />
                  <Textarea
                    name="resumeText"
                    rows={8}
                    placeholder="Plain resume text, at least 200 characters…"
                    aria-label="Resume text"
                    data-required
                  />
                  <Hint>A one-off check, like a file: nothing is added to your Resumes.</Hint>
                </div>
              </ModeCard>
            </div>
          </Card>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          {/* One button. The pair before it — "Compare" and "Full analysis" —
              differed only in whether the advice was written now or on a second
              press, and the only way to tell was to read both tooltips. */}
          <input type="hidden" name="mode" value="full" />
          <Button size="lg" variant="violet" title="Reads the posting, judges your resume against it and writes what to change">
            Compare
          </Button>
          <Hint>One AI run, one to two minutes, with the steps on screen.</Hint>
          <More class="basis-full">
            ApplyPack reads the posting once and keeps it, so comparing another resume against it is
            quick. It detects a pasted posting's empty fields first, and pasting the same one again
            reuses its job.
          </More>
        </div>
      </form>
      <script type="module" dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
    </Layout>
  );
};

/** Radio-headed option card — shared with the /letter launcher. */
export const ModeCard: FC<
  PropsWithChildren<{
    value: string;
    label: string;
    checked?: boolean;
    disabled?: boolean;
    name?: string;
  }>
> = ({ value, label, checked = false, disabled = false, name = 'resumeMode', children }) => (
  <fieldset
    data-ui="mode-card"
    data-mode={value}
    // min-w-0: a fieldset's default min-inline-size is min-content, which let a
    // long option or a file input push the page sideways at 375 px.
    class={`min-w-0 rounded-md border border-line bg-surface-raised p-3 transition-colors duration-150 has-[:checked]:border-accent/50 has-[:checked]:bg-surface-selected ${
      disabled ? 'opacity-60' : ''
    }`}
  >
    <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        class="h-4 w-4 accent-accent"
      />
      {label}
    </label>
    {/* A disabled mode can never be chosen, so what it holds is its one-line reason: always in sight. */}
    <div data-ui={disabled ? undefined : 'mode-body'} class="mt-2.5">
      {children}
    </div>
  </fieldset>
);

/* Mode selection + paste cleaning live in the served module. */
const BOOT_JS = `
import { init } from '/static/target-start.mjs';
init();
`;
