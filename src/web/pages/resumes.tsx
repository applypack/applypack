/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Flash,
  Hint,
  Input,
  PageHeader,
  SectionTitle,
  Table,
  Td,
  Tr,
} from '../ui';
import type { FlashMessage } from '../flash';
import { formatRelative } from '../format';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';

export interface ResumeRow {
  id: number;
  name: string;
  sourceFilename: string;
  isDefault: boolean;
  scannedAt: Date | null;
  title: string | null;
  skills: string[];
  createdAt: Date;
}

const SKILLS_PREVIEW = 6;

export const ResumesPage: FC<{ resumes: ResumeRow[]; flash?: FlashMessage | null }> = ({
  resumes,
  flash,
}) => (
  <Layout title="Resumes" active="resumes">
    <PageHeader title="Resumes" meta={`${resumes.length} uploaded`}>
      <p class="mt-1 text-sm text-ink-faint">
        Upload the resumes you actually send. Each one is scanned once into skills and
        headline, then compared against any job from its page.
      </p>
    </PageHeader>
    <Flash flash={flash} />

    <Card class="mb-6" flush>
      {resumes.length === 0 ? (
        <div class="p-5">
          <Empty>No resumes yet. Upload one below — the first becomes the default.</Empty>
        </div>
      ) : (
        <Table
          columns={[
            'Name',
            'Headline',
            'Skills',
            'Scanned',
            <span class="block text-right">Actions</span>,
          ]}
        >
          {resumes.map((r) => (
            <Tr>
              <Td>
                <a href={`/resumes/${r.id}`} class="font-medium text-ink hover:text-accent">
                  {r.name}
                </a>
                {r.isDefault && (
                  <Badge tone="ok" class="ml-2">
                    default
                  </Badge>
                )}
                <div class="mt-0.5 font-mono text-xs text-ink-faint">{r.sourceFilename}</div>
              </Td>
              <Td class="text-ink-muted">{r.title ?? '—'}</Td>
              <Td class="font-mono text-xs text-ink-muted">
                {r.skills.length === 0
                  ? '—'
                  : `${r.skills.slice(0, SKILLS_PREVIEW).join(', ')}${
                      r.skills.length > SKILLS_PREVIEW ? ` +${r.skills.length - SKILLS_PREVIEW}` : ''
                    }`}
              </Td>
              <Td class="whitespace-nowrap text-xs text-ink-faint">
                {r.scannedAt ? formatRelative(r.scannedAt) : <Badge tone="warn">not scanned</Badge>}
              </Td>
              <Td>
                <div class="flex justify-end gap-2">
                  {!r.isDefault && (
                    <ActionForm action={`/resumes/${r.id}/default`}>
                      <Button size="sm" variant="secondary">
                        Set default
                      </Button>
                    </ActionForm>
                  )}
                  <ActionForm
                    action={`/resumes/${r.id}/delete`}
                    confirm="Delete this resume and its comparisons?"
                  >
                    <Button size="sm" variant="danger">
                      Delete
                    </Button>
                  </ActionForm>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>

    <Card>
      <SectionTitle>Upload a resume</SectionTitle>
      <ResumeUploadForm />
    </Card>
  </Layout>
);

/** Shared by /resumes and the Settings card. Posts to /resumes and lands on the new resume. */
export const ResumeUploadForm: FC = () => (
  <form method="post" action="/resumes" enctype="multipart/form-data" class="grid gap-3 sm:grid-cols-12">
    <Field label="Name" hint="Blank = taken from the file name." class="sm:col-span-4">
      <Input type="text" name="name" placeholder="Backend PHP" maxlength="100" />
    </Field>
    <Field label="File" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to 2 MB`} class="sm:col-span-6">
      <Input type="file" name="file" required accept={ACCEPTED_EXTENSIONS.join(',')} class="file:mr-3 file:rounded file:border-0 file:bg-surface-overlay file:px-2 file:py-1 file:text-xs file:text-ink" />
    </Field>
    <div class="flex items-end sm:col-span-2">
      <Button class="w-full">Upload &amp; scan</Button>
    </div>
    <Hint class="sm:col-span-12">
      The scan calls the resume model once (about a minute) and stores headline, skills and
      job-agnostic issues. The file itself never leaves your Postgres.
    </Hint>
  </form>
);
