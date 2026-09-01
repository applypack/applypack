/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Checkbox, FILE_INPUT_CLASS, Flash, Hint, Input, PageHeader, SectionTitle, Select, Textarea } from '../ui';
import type { FlashMessage } from '../flash';
import { ModeCard } from './target-start';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import { COVER_TONES, type CoverAngles } from '../../resume/prompts';

/*
 * The /letter launcher (F8.3): two job modes — a searchable picker over
 * tracked jobs, or one "new posting" box that takes a URL, pasted text, or
 * both. The default path is deliberately the fast one: no classification, no
 * match, no research — one model call and the letter.
 */

export interface LetterJobOption {
  id: number;
  title: string;
  companyName: string;
  fitScore: number | null;
  ageDays: number;
}

export interface LetterStartProps {
  jobs: LetterJobOption[];
  resumes: { id: number; name: string; isDefault: boolean; version: number }[];
  angles: CoverAngles;
  /** Prefilled after a failed fetch, so the URL survives the round trip. */
  presetUrl?: string;
  flash?: FlashMessage | null;
}

export const LetterStartPage: FC<LetterStartProps> = ({
  jobs,
  resumes,
  angles,
  presetUrl = '',
  flash,
}) => {
  const hasResumes = resumes.length > 0;
  const hasJobs = jobs.length > 0;
  const newPostingFirst = !hasJobs || presetUrl.length > 0;
  const defaultResumeId = (resumes.find((r) => r.isDefault) ?? resumes[0])?.id;
  return (
    <Layout title="Cover letter" active="letter">
      <PageHeader title="Cover letter" meta="~30–60 s">
        Pick a job, pick a resume, get a short letter grounded in what your resume actually says.
        One model call by default — the deeper analyses below are opt-in, and cost minutes.
      </PageHeader>
      <Flash flash={flash} />

      <form id="letter-form" method="post" action="/letter" enctype="multipart/form-data" class="w-full">
        <input type="hidden" name="saveAngles" value="1" />
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Job posting</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                name="jobMode"
                value="existing"
                label="One of your jobs"
                checked={!newPostingFirst}
                disabled={!hasJobs}
              >
                {hasJobs ? (
                  <div class="space-y-2">
                    <Input
                      type="search"
                      id="job-search"
                      placeholder="Filter by title or company…"
                      aria-label="Filter jobs"
                      autocomplete="off"
                    />
                    <Select name="jobId" id="job-select" size={8} aria-label="Job" class="!h-auto">
                      {jobs.map((j) => (
                        <option value={j.id}>
                          {j.companyName} — {j.title}
                          {j.fitScore !== null ? ` · fit ${j.fitScore}` : ''} ·{' '}
                          {j.ageDays === 0 ? 'today' : `${j.ageDays}d old`}
                        </option>
                      ))}
                    </Select>
                    <Hint>
                      <span id="job-count">{jobs.length}</span> newest jobs that clear your fit
                      threshold, freshest first.
                    </Hint>
                  </div>
                ) : (
                  <Hint>No tracked jobs yet — use the box below.</Hint>
                )}
              </ModeCard>

              <ModeCard name="jobMode" value="new" label="A new posting" checked={newPostingFirst}>
                <div class="space-y-3">
                  <Input
                    type="url"
                    name="jobUrl"
                    value={presetUrl}
                    placeholder="Posting URL — we read the page for you"
                    aria-label="Posting URL"
                  />
                  <Textarea
                    name="description"
                    rows={7}
                    placeholder="…or paste the posting text here (also use this if the URL cannot be read)"
                    aria-label="Job description"
                  />
                  <div class="grid gap-3 sm:grid-cols-2">
                    <Input type="text" name="companyName" maxlength="200" placeholder="Company (optional)" aria-label="Company" />
                    <Input type="text" name="title" maxlength="200" placeholder="Job title (optional)" aria-label="Job title" />
                  </div>
                  <Hint>
                    A URL alone is enough — we fetch the page and read the company and title out
                    of it. Sites that need JavaScript or answer with a bot check cannot be read;
                    paste the text instead. LinkedIn, Indeed, Glassdoor, Workday and Wellfound are
                    never fetched. Filling company and title yourself skips a detection call and
                    makes the run faster.
                  </Hint>
                </div>
              </ModeCard>
            </div>
          </Card>

          <Card>
            <SectionTitle>Resume</SectionTitle>
            <div class="space-y-2">
              <ModeCard value="existing" label="One of your resumes" checked={hasResumes} disabled={!hasResumes}>
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
          <div class="space-y-3">
            <div class="flex flex-wrap items-end gap-4">
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
              <Button size="lg" variant="violet">
                Write the letter
              </Button>
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
            <Hint>
              Angle values are saved for your next letters. Facts and numbers still come only from
              your resume and confirmed facts.
            </Hint>

            <details class="rounded-md border border-line px-3 py-2">
              <summary class="cursor-pointer text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
                Analyze first — slower, sharper
              </summary>
              <div class="mt-2.5 space-y-2">
                <Checkbox name="runMatch" value="1">
                  Score this resume against the posting first (+1 min) — the letter then leads with
                  the strengths that actually match and concedes the real gaps
                </Checkbox>
                <Checkbox name="runVerify" value="1">
                  Research the company first (+2–4 min, web search) — lets the letter use verified
                  company facts instead of only the posting
                </Checkbox>
                <Hint>
                  Both are stored on the job, so a later letter reuses them for free. Skipping them
                  costs the letter nothing it can prove.
                </Hint>
              </div>
            </details>
          </div>
        </Card>
      </form>
      <script type="module" dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
    </Layout>
  );
};

const BOOT_JS = `
import { init } from '/static/letter-start.mjs';
init();
`;
