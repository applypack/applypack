/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  Button,
  Card,
  Checkbox,
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
import { ModeCard } from './target-start';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import { COVER_TONES, type CoverAngles } from '../../resume/prompts';

/*
 * The /letter launcher (F8.2): everything the job-page card does, but as an
 * entry point — pick a tracked job, fetch a posting URL, or paste the text;
 * pick / upload / paste a resume; optionally run the resume match and the
 * company research first; one run ends in a fact-checked letter on the
 * job's page.
 */

export interface LetterStartProps {
  jobs: { id: number; title: string; companyName: string; fitScore: number | null }[];
  resumes: { id: number; name: string; isDefault: boolean; version: number }[];
  angles: CoverAngles;
  flash?: FlashMessage | null;
}

const FILE_INPUT_CLASS =
  'file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink';

export const LetterStartPage: FC<LetterStartProps> = ({ jobs, resumes, angles, flash }) => {
  const hasResumes = resumes.length > 0;
  const hasJobs = jobs.length > 0;
  const defaultResumeId = (resumes.find((r) => r.isDefault) ?? resumes[0])?.id;
  return (
    <Layout title="Cover letter" active="letter">
      <PageHeader title="Cover letter" meta="~1–4 min per run">
        Pick a tracked job — or bring a new posting by URL or pasted text — choose a resume, and
        one run analyzes everything and writes a short, fact-checked letter. Every claim must
        trace to the resume or your confirmed facts; an invented number is rejected, not shown.
      </PageHeader>
      <Flash flash={flash} />

      <form method="post" action="/letter" enctype="multipart/form-data" class="w-full">
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Job posting</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                name="jobMode"
                value="existing"
                label="Pick a tracked job"
                checked={hasJobs}
                disabled={!hasJobs}
              >
                {hasJobs ? (
                  <Select name="jobId" aria-label="Job">
                    {jobs.map((j) => (
                      <option value={j.id}>
                        {j.fitScore !== null ? `${j.fitScore} · ` : ''}
                        {j.companyName} — {j.title}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Hint>No tracked jobs yet — use one of the options below.</Hint>
                )}
              </ModeCard>

              <ModeCard name="jobMode" value="url" label="Fetch a posting URL">
                <div class="space-y-2">
                  <Input type="url" name="jobUrl" placeholder="https://boards.greenhouse.io/…" aria-label="Posting URL" />
                  <Hint>
                    One page fetch at your request. Pages that need JavaScript or answer with a
                    bot check fail honestly — paste the text instead. LinkedIn / Indeed /
                    Glassdoor / Workday / Wellfound are never fetched (ADR 0005).
                  </Hint>
                </div>
              </ModeCard>

              <ModeCard name="jobMode" value="paste" label="Paste the posting" checked={!hasJobs}>
                <div class="space-y-3">
                  <Textarea
                    name="description"
                    rows={8}
                    minlength="200"
                    placeholder="About the role… (at least 200 characters)"
                    aria-label="Job description"
                  />
                  <div class="grid gap-3 sm:grid-cols-2">
                    <Input type="text" name="companyName" maxlength="200" placeholder="Company (optional — detected)" aria-label="Company" />
                    <Input type="text" name="title" maxlength="200" placeholder="Job title (optional — detected)" aria-label="Job title" />
                  </div>
                </div>
              </ModeCard>
            </div>
          </Card>

          <Card>
            <SectionTitle>Resume</SectionTitle>
            <div class="space-y-2">
              <ModeCard value="existing" label="Use an uploaded resume" checked={hasResumes} disabled={!hasResumes}>
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
                  <Input type="text" name="uploadName" maxlength="100" placeholder="Name (optional — taken from the file name)" aria-label="Resume name" />
                  <Hint>
                    {ACCEPTED_EXTENSIONS.join(', ')} · up to {MAX_UPLOAD_MB} MB. Used for this
                    letter only — nothing lands in your Resumes list.
                  </Hint>
                </div>
              </ModeCard>

              <ModeCard value="paste" label="Paste resume text">
                <div class="space-y-3">
                  <Input type="text" name="pasteName" maxlength="100" placeholder="Name (optional)" aria-label="Resume name" />
                  <Textarea name="resumeText" rows={6} placeholder="Plain resume text, at least 200 characters…" aria-label="Resume text" />
                </div>
              </ModeCard>
            </div>
          </Card>
        </div>

        <Card class="mt-4">
          <SectionTitle>The letter</SectionTitle>
          <input type="hidden" name="saveAngles" value="1" />
          <div class="space-y-3">
            <div class="flex flex-wrap items-end gap-3">
              <label class="block">
                <span class="block text-[13px] font-medium text-ink">Tone</span>
                <Select name="tone" class="mt-1.5 !w-auto">
                  {COVER_TONES.map((t) => (
                    <option value={t} selected={t === 'warm'}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
              <Checkbox name="runMatch" value="1" checked>
                Run the resume match first — a sharper letter, about a minute more
              </Checkbox>
              <Checkbox name="runVerify" value="1">
                Research the company first — web search, 2–4 minutes (stored research is reused
                automatically)
              </Checkbox>
            </div>
            <div class="grid gap-2.5 sm:grid-cols-3">
              <label class="block">
                <span class="block text-xs text-ink-muted">Why this company</span>
                <Input name="whyCompany" maxlength="300" class="mt-1 !text-xs" value={angles.whyCompany ?? ''} />
              </label>
              <label class="block">
                <span class="block text-xs text-ink-muted">What problem you'd solve</span>
                <Input name="problem" maxlength="300" class="mt-1 !text-xs" value={angles.problem ?? ''} />
              </label>
              <label class="block">
                <span class="block text-xs text-ink-muted">Your approach</span>
                <Input name="approach" maxlength="300" class="mt-1 !text-xs" value={angles.approach ?? ''} />
              </label>
            </div>
            <label class="block">
              <span class="block text-xs text-ink-muted">Anything every letter should mention</span>
              <Textarea name="notes" rows={2} maxlength="500" class="mt-1 !text-xs" placeholder="e.g. my open-source work matters to me; I can start immediately">
                {angles.notes ?? ''}
              </Textarea>
            </label>
            <div class="flex flex-wrap items-center gap-3">
              <Button size="lg" variant="violet">
                Write the letter
              </Button>
              <Hint>
                Angle values are saved for your next letters. Facts and numbers still come only
                from the resume and confirmed facts.
              </Hint>
            </div>
          </div>
        </Card>
      </form>
    </Layout>
  );
};
