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
  PageHeader,
  SectionTitle,
  Select,
  SUBMIT_ONCE,
  Textarea,
} from '../ui';
import type { FlashMessage } from '../flash';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';

/*
 * The /target launcher: paste a posting, pick / upload / paste a resume,
 * one submit → detect posting facts (when fields are empty) + classify +
 * AI match → the targeted workspace at /jobs/:id/target. Detection happens
 * INSIDE the run as a visible step and never blocks: unfound facts fall
 * back to defaults. The paste itself gets page chrome trimmed in place
 * (posting-clean.mjs).
 */

export interface TargetStartProps {
  resumes: { id: number; name: string; isDefault: boolean; version: number }[];
  flash?: FlashMessage | null;
}

export const TargetStartPage: FC<TargetStartProps> = ({ resumes, flash }) => {
  const hasResumes = resumes.length > 0;
  const defaultResumeId = (resumes.find((r) => r.isDefault) ?? resumes[0])?.id;
  return (
    <Layout title="Compare" active="target">
      <PageHeader title="Compare" meta="~½ min quick · ~2 min full">
        Paste a posting — the description alone is enough, company / title / location are
        detected during the run — and pick a resume. One run classifies the posting, scores the
        resume against it and opens the side-by-side targeted view.
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
            <div class="space-y-4">
              <Field
                label="Job description"
                hint="Paste the posting verbatim — page chrome is trimmed automatically, and empty fields below are detected from it during the run."
              >
                <Textarea
                  name="description"
                  rows={16}
                  required
                  minlength="200"
                  placeholder="About the role…"
                />
              </Field>
              <div class="grid gap-4 sm:grid-cols-2">
                <Field label="Company" hint="Optional — detected during the run.">
                  <Input type="text" name="companyName" maxlength="200" placeholder="Acme Corp" />
                </Field>
                <Field label="Job title" hint="Optional — detected during the run.">
                  <Input type="text" name="title" maxlength="200" placeholder="Senior Software Engineer" />
                </Field>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <Field label="Posting URL" hint="Optional — lets Verify find the original later.">
                  <Input type="url" name="url" placeholder="https://…" />
                </Field>
                <Field label="Location" hint="Optional — detected during the run when stated.">
                  <Input type="text" name="location" maxlength="200" placeholder="Remote (US)" />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle>Resume</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                value="existing"
                label="Use an uploaded resume"
                checked={hasResumes}
                disabled={!hasResumes}
              >
                {hasResumes ? (
                  <Select name="resumeId" aria-label="Resume">
                    {resumes.map((r) => (
                      <option value={r.id} selected={r.id === defaultResumeId}>
                        {r.name} · v{r.version}
                        {r.isDefault ? ' · default' : ''}
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
                  />
                  <Input
                    type="text"
                    name="uploadName"
                    maxlength="100"
                    placeholder="Name (optional — taken from the file name)"
                    aria-label="Resume name"
                  />
                  <Hint>
                    {ACCEPTED_EXTENSIONS.join(', ')} · up to {MAX_UPLOAD_MB} MB. Lands in
                    Resumes; run Scan from its page later for the job-agnostic ATS check.
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
                  />
                  <Hint>Saved to Resumes as a text file, so you can iterate on it later.</Hint>
                </div>
              </ModeCard>
            </div>
          </Card>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          {/* Set by the second button's click: SUBMIT_ONCE disables the buttons in the
              submit event, and a disabled submitter is left out of the form data. */}
          <input type="hidden" name="mode" value="fast" />
          <Button size="lg" variant="violet" title="Keywords, hard requirements and the score — no edit suggestions">
            Compare
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onclick="this.form.elements.mode.value='full'"
            title="The same check plus what to change and what to remove"
          >
            Full analysis
          </Button>
          <Hint>
            Detects missing fields (seconds), classifies the posting, then one resume-model call
            and the targeted view opens. Compare is the quick check — keywords, gates and the
            score, about half a minute on Opus; Full analysis also writes the edit suggestions and
            takes 1½ to 2 minutes. Either way you can ask for the suggestions later.
            Re-pasting the same posting reuses its job.
          </Hint>
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
    data-mode={value}
    class={`rounded-md border border-line bg-surface-raised p-3 transition-colors duration-150 has-[:checked]:border-accent/50 has-[:checked]:bg-accent/5 ${
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
    <div class="mt-2.5">{children}</div>
  </fieldset>
);

/* Mode selection + paste cleaning live in the served module. */
const BOOT_JS = `
import { init } from '/static/target-start.mjs';
init();
`;
