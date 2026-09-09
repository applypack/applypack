/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, FILE_INPUT_CLASS, Flash, Hint, Input, PageHeader, SectionTitle, Select, SUBMIT_ONCE, Textarea } from '../ui';
import type { FlashMessage } from '../flash';
import { ModeCard } from './target-start';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { MAX_UPLOAD_MB } from '../upload';

/*
 * /screen/new — the position. One of the jobs already stored (pasted ones
 * first, they are the likeliest), a pasted posting, or a posting as a file.
 * Nothing about applicants yet: they are added on the screening's page,
 * after the rubric has been read off the posting.
 */

export interface ScreenJobOption {
  id: number;
  title: string;
  companyName: string;
  manual: boolean;
  ageDays: number;
}

export const ScreenNewPage: FC<{ jobs: ScreenJobOption[]; flash?: FlashMessage | null }> = ({ jobs, flash }) => {
  const hasJobs = jobs.length > 0;
  return (
    <Layout title="New screening" active="screen">
      <PageHeader title="New screening" back={{ href: '/screen', label: 'Screening' }}>
        Pick the position. Its posting is read once into a rubric — the gates, the must-have and
        nice-to-have skills, the level, the years, the sector — which you edit before any resume is scored.
      </PageHeader>
      <Flash flash={flash} />

      <form id="screen-form" method="post" action="/screen" enctype="multipart/form-data" class="w-full" onsubmit={SUBMIT_ONCE}>
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>The position</SectionTitle>
            <div class="space-y-2">
              <ModeCard name="jobMode" value="existing" label="One of your jobs" checked={hasJobs} disabled={!hasJobs}>
                {hasJobs ? (
                  <div class="space-y-2">
                    <Input type="search" id="job-search" placeholder="Filter by title or company…" aria-label="Filter jobs" autocomplete="off" />
                    <Select name="jobId" id="job-select" size={8} aria-label="Job" class="!h-auto">
                      {jobs.map((j) => (
                        <option value={j.id}>
                          {j.companyName} — {j.title}
                          {j.manual ? ' · pasted' : ''} · {j.ageDays === 0 ? 'today' : `${j.ageDays}d old`}
                        </option>
                      ))}
                    </Select>
                    <Hint>
                      <span id="job-count">{jobs.length}</span> jobs, the ones you pasted yourself first.
                    </Hint>
                  </div>
                ) : (
                  <Hint>No stored jobs yet — paste the posting below.</Hint>
                )}
              </ModeCard>

              <ModeCard name="jobMode" value="new" label="A new posting" checked={!hasJobs}>
                <div class="space-y-3">
                  <div class="grid gap-3 sm:grid-cols-2">
                    <Input type="text" name="title" maxlength="200" placeholder="Position title (required)" aria-label="Position title" />
                    <Input type="text" name="companyName" maxlength="200" placeholder="Company (optional)" aria-label="Company" />
                  </div>
                  <Input type="text" name="location" maxlength="200" placeholder="Location or arrangement — Kyiv, remote, hybrid Berlin (optional)" aria-label="Location" />
                  <Textarea name="description" rows={9} placeholder="Paste the posting text here…" aria-label="Job description" />
                  <div class="flex flex-wrap items-center gap-3">
                    <input
                      type="file"
                      name="file"
                      accept={ACCEPTED_EXTENSIONS.join(',')}
                      aria-label="Posting as a file"
                      class={`text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
                    />
                    <Hint>
                      …or the posting as a file ({ACCEPTED_EXTENSIONS.join(' / ')}, up to {MAX_UPLOAD_MB} MB). At least{' '}
                      {MIN_DESCRIPTION_CHARS} characters either way.
                    </Hint>
                  </div>
                </div>
              </ModeCard>
            </div>
          </Card>

          <Card>
            <SectionTitle>What happens next</SectionTitle>
            <ol class="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
              <li>
                <span class="text-ink">The posting is read once</span> — about a minute — into a rubric draft. If
                the posting was compared with a resume before, the reading is reused and this is instant.
              </li>
              <li>
                <span class="text-ink">You edit the rubric</span>: strike a gate the posting overstated, add the
                must-have the posting forgot, set the level.
              </li>
              <li>
                <span class="text-ink">Drop the resumes in</span> — files or a zip. Names, contacts, links, dates of
                birth, family and address are removed before any model reads a word; you see the name, the model
                sees "Applicant №7".
              </li>
              <li>
                <span class="text-ink">Score</span>: one independent call per applicant, three at a time. Every mark
                comes with the quote behind it, and the score is computed from the marks — the same rule as the
                resume match on the other side of this product.
              </li>
            </ol>
            <div class="mt-5 flex items-center gap-3">
              <Button>Create the screening</Button>
              <Hint>Reads the posting; adds no applicants yet.</Hint>
            </div>
          </Card>
        </div>
      </form>
      <script type="module" dangerouslySetInnerHTML={{ __html: "import { init } from '/static/letter-start.mjs'; init();" }} />
    </Layout>
  );
};
