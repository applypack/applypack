/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import { Layout } from '../layout';
import {
  Button,
  Card,
  Field,
  Flash,
  Hint,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from '../ui';
import type { FlashMessage } from '../flash';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';

/*
 * The /target launcher: paste a posting, pick / upload / paste a resume,
 * one submit → classify + AI match → the existing targeted workspace at
 * /jobs/:id/target. No new analysis machinery — this page only composes
 * the manual-job and resume-match flows.
 */

export interface TargetStartProps {
  resumes: { id: number; name: string; isDefault: boolean; version: number }[];
  flash?: FlashMessage | null;
}

const FILE_INPUT_CLASS =
  'file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink';

export const TargetStartPage: FC<TargetStartProps> = ({ resumes, flash }) => {
  const hasResumes = resumes.length > 0;
  const defaultResumeId = (resumes.find((r) => r.isDefault) ?? resumes[0])?.id;
  return (
    <Layout title="Target" active="target">
      <PageHeader title="Target" meta="~1–2 min per run">
        Paste a posting and pick a resume — one run classifies the posting, scores the resume
        against it and opens the side-by-side targeted view: match score, prioritised edits,
        keyword coverage, live editor.
      </PageHeader>
      <Flash flash={flash} />

      <form method="post" action="/target" enctype="multipart/form-data" class="w-full max-w-6xl">
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Job posting</SectionTitle>
            <div class="space-y-4">
              <div class="grid gap-4 sm:grid-cols-2">
                <Field label="Company">
                  <Input type="text" name="companyName" required maxlength="200" placeholder="Acme Corp" />
                </Field>
                <Field label="Job title">
                  <Input type="text" name="title" required maxlength="200" placeholder="Senior PHP Developer" />
                </Field>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <Field label="Posting URL" hint="Optional — lets Verify find the original later.">
                  <Input type="url" name="url" placeholder="https://…" />
                </Field>
                <Field label="Location" hint='Optional: "Remote (US)", "Austin, TX (hybrid)".'>
                  <Input type="text" name="location" maxlength="200" placeholder="Remote (US)" />
                </Field>
              </div>
              <Field
                label="Job description"
                hint="Paste the posting verbatim — it is the keyword source for the analysis."
              >
                <Textarea
                  name="description"
                  rows={16}
                  required
                  minlength="200"
                  placeholder="About the role…"
                />
              </Field>
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
          <Button size="lg" variant="violet">
            Compare
          </Button>
          <Hint>
            Classifies the posting (seconds), then one resume-model call (~1 min), then opens
            the targeted view. Re-pasting the same posting reuses its job.
          </Hint>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: MODE_JS }} />
    </Layout>
  );
};

const ModeCard: FC<
  PropsWithChildren<{ value: string; label: string; checked?: boolean; disabled?: boolean }>
> = ({ value, label, checked = false, disabled = false, children }) => (
  <fieldset
    data-mode={value}
    class={`rounded-md border border-line bg-surface-raised p-3 transition-colors duration-150 has-[:checked]:border-accent/50 has-[:checked]:bg-accent/5 ${
      disabled ? 'opacity-60' : ''
    }`}
  >
    <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
      <input
        type="radio"
        name="resumeMode"
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

/** Enhancement only: focusing a field inside a mode selects that mode. */
const MODE_JS = `
  (function () {
    document.querySelectorAll('[data-mode]').forEach(function (box) {
      var radio = box.querySelector('input[type=radio][name=resumeMode]');
      if (!radio || radio.disabled) return;
      box.addEventListener('focusin', function (e) {
        if (e.target !== radio) radio.checked = true;
      });
    });
  })();
`;
