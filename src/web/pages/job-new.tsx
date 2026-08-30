/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Field, Flash, Hint, Input, PageHeader, Textarea } from '../ui';
import type { FlashMessage } from '../flash';

export const JobNewPage: FC<{ flash?: FlashMessage | null }> = ({ flash }) => (
  <Layout title="Paste a job" active="jobs">
    <div class="w-full max-w-3xl">
      <PageHeader title="Paste a job" back={{ href: '/jobs', label: 'All jobs' }}>
        For postings the fetchers don't see (LinkedIn, a recruiter's email, a friend's
        referral). It becomes a normal job: scored against your profile, then Verify checks the
        company is real and Compare tells you what to change in the resume.
      </PageHeader>
      <Flash flash={flash} />

      <Card>
        <form method="post" action="/jobs/new" class="grid gap-4 sm:grid-cols-2">
          <Field label="Company">
            <Input type="text" name="companyName" required maxlength="200" placeholder="Acme Corp" />
          </Field>
          <Field label="Job title">
            <Input
              type="text"
              name="title"
              required
              maxlength="200"
              placeholder="Senior Software Engineer"
            />
          </Field>
          <Field label="Posting URL" hint="Optional — helps verification find the original.">
            <Input type="url" name="url" placeholder="https://…" />
          </Field>
          <Field
            label="Location"
            hint='As written in the posting: "Remote (US)", "Austin, TX (hybrid)".'
          >
            <Input type="text" name="location" maxlength="200" placeholder="Remote (US)" />
          </Field>
          <Field
            label="Job description"
            hint="Paste the posting verbatim — it is the keyword source. Requirements, responsibilities, salary, everything."
            class="sm:col-span-2"
          >
            <Textarea
              name="description"
              rows={18}
              required
              minlength="200"
              placeholder="About the role…"
            />
          </Field>
          <div class="flex items-center gap-3 sm:col-span-2">
            <Button size="lg">Save job</Button>
            <Hint>
              Runs the classifier once (a few seconds). Verify and Compare are separate buttons
              on the job page.
            </Hint>
          </div>
        </form>
      </Card>
    </div>
  </Layout>
);
