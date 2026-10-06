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
import { t } from '../../i18n/t';

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
    <Layout title={t('nav.target')} active="target">
      <PageHeader title={t('nav.target')} meta={t('target.start.duration')}>
        {t('target.start.intro')}
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
            <SectionTitle>{t('target.start.jobPosting')}</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                name="jobMode"
                value="existing"
                label={t('target.start.oneOfYourJobs')}
                checked={hasJobs}
                disabled={!hasJobs}
              >
                {hasJobs ? (
                  <JobPicker jobs={jobs} selectedId={selectedJobId}>
                    {t('target.start.pickerTail')}
                  </JobPicker>
                ) : (
                  <Hint>{t('target.start.noJobsYet')}</Hint>
                )}
              </ModeCard>

              <ModeCard name="jobMode" value="new" label={t('target.start.newPosting')} checked={!hasJobs}>
                <div class="space-y-4">
                  <Field
                    label={t('target.jobDescription')}
                    hint={t('target.start.descriptionHint')}
                  >
                    <Textarea name="description" rows={12} placeholder={t('target.sample.description')} data-required />
                  </Field>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <Field label={t('common.company')}>
                      <Input type="text" name="companyName" maxlength="200" placeholder={t('target.sample.company')} />
                    </Field>
                    <Field label={t('target.start.jobTitle')}>
                      <Input type="text" name="title" maxlength="200" placeholder={t('target.sample.title')} />
                    </Field>
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <Field label={t('target.start.postingUrl')} hint={t('target.start.postingUrlHint')}>
                      <Input type="url" name="url" placeholder="https://…" />
                    </Field>
                    <Field label={t('common.location')}>
                      <Input type="text" name="location" maxlength="200" placeholder={t('target.sample.location')} />
                    </Field>
                  </div>
                </div>
              </ModeCard>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t('target.resume')}</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                value="existing"
                label={t('target.start.oneOfYourResumes')}
                checked={hasResumes}
                disabled={!hasResumes}
              >
                {hasResumes ? (
                  <Select name="resumeId" aria-label={t('target.resume')}>
                    {resumes.map((r) => (
                      <option value={r.id} selected={r.id === defaultResumeId}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Hint>{t('target.start.noResumesYet')}</Hint>
                )}
              </ModeCard>

              <ModeCard value="upload" label={t('target.start.uploadFile')} checked={!hasResumes}>
                <div class="space-y-3">
                  <Input
                    type="file"
                    name="file"
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    aria-label={t('target.resumeFile')}
                    class={FILE_INPUT_CLASS}
                    data-required
                  />
                  <Input
                    type="text"
                    name="uploadName"
                    maxlength="100"
                    placeholder={t('target.start.uploadNamePlaceholder')}
                    aria-label={t('target.start.resumeName')}
                  />
                  <Hint>{t('target.start.uploadHint', { formats: ACCEPTED_EXTENSIONS.join(', '), mb: MAX_UPLOAD_MB })}</Hint>
                </div>
              </ModeCard>

              <ModeCard value="paste" label={t('target.start.pasteText')}>
                <div class="space-y-3">
                  <Input
                    type="text"
                    name="pasteName"
                    maxlength="100"
                    placeholder={t('target.start.pasteNamePlaceholder')}
                    aria-label={t('target.start.resumeName')}
                  />
                  <Textarea
                    name="resumeText"
                    rows={8}
                    placeholder={t('target.start.pastePlaceholder')}
                    aria-label={t('target.start.resumeText')}
                    data-required
                  />
                  <Hint>{t('target.start.pasteHint')}</Hint>
                </div>
              </ModeCard>
            </div>
            <MineCheckbox />
          </Card>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          {/* One button. The pair before it — "Compare" and "Full analysis" —
              differed only in whether the advice was written now or on a second
              press, and the only way to tell was to read both tooltips. */}
          <input type="hidden" name="mode" value="full" />
          <Button size="lg" variant="violet" title={t('target.start.compareTitle')}>
            {t('target.start.compare')}
          </Button>
          <Hint>{t('target.start.oneRun')}</Hint>
          <More class="basis-full">
            {t('target.start.more')}
          </More>
        </div>
      </form>
      <script type="module" dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
    </Layout>
  );
};

/**
 * R1 (the 2026-09 plan's Q4): a file or a paste is judged on its own text —
 * it may be a friend's resume or an old one — unless the person says it is
 * theirs; then it gets their confirmed facts and other resumes, as their saved
 * resumes do. Ignored for "One of your resumes". Shared with /letter.
 */
export const MineCheckbox: FC = () => (
  <div class="mt-3 border-t border-line pt-3">
    <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input type="checkbox" name="mine" value="1" class="h-4 w-4 accent-accent" />
      {t('target.start.mine')}
    </label>
    <Hint class="mt-1">
      {t('target.start.mineHint')}
    </Hint>
  </div>
);

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
