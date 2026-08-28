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

const FILE_INPUT_CLASS =
  'file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink';

export const ResumesPage: FC<{ resumes: ResumeRow[]; flash?: FlashMessage | null }> = ({
  resumes,
  flash,
}) => (
  <Layout title="Resumes" active="resumes">
    <PageHeader title="Resumes" meta={`${resumes.length} uploaded`}>
      Upload the resumes you actually send. Each one is scanned once into skills and headline,
      then compared against any job from its page.
    </PageHeader>
    <Flash flash={flash} />

    {resumes.length === 0 ? (
      <Empty>No resumes yet. Upload one below — the first becomes the default.</Empty>
    ) : (
      <Card flush class="mb-4">
        <div class="overflow-x-auto">
          <div class="min-w-[52rem]">
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
                  <Td class="max-w-[16rem]">
                    <div class="flex items-center gap-2">
                      <a
                        href={`/resumes/${r.id}`}
                        class="truncate font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                        title={r.name}
                      >
                        {r.name}
                      </a>
                      {r.isDefault && <Badge tone="ok">default</Badge>}
                    </div>
                    <div class="mt-0.5 truncate font-mono text-xs text-ink-faint">
                      {r.sourceFilename}
                    </div>
                  </Td>
                  <Td class="max-w-[16rem] text-ink-muted">
                    <div class="truncate" title={r.title ?? undefined}>
                      {r.title ?? '—'}
                    </div>
                  </Td>
                  <Td class="max-w-[18rem] text-[13px] text-ink-muted">
                    <div class="truncate">
                      {r.skills.length === 0
                        ? '—'
                        : `${r.skills.slice(0, SKILLS_PREVIEW).join(', ')}${
                            r.skills.length > SKILLS_PREVIEW
                              ? ` +${r.skills.length - SKILLS_PREVIEW}`
                              : ''
                          }`}
                    </div>
                  </Td>
                  <Td class="whitespace-nowrap text-[13px] text-ink-faint">
                    {r.scannedAt ? (
                      formatRelative(r.scannedAt)
                    ) : (
                      <Badge tone="warn">not scanned</Badge>
                    )}
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
          </div>
        </div>
      </Card>
    )}

    <Card class="max-w-3xl">
      <SectionTitle>Upload a resume</SectionTitle>
      <ResumeUploadForm />
    </Card>
  </Layout>
);

/** Shared by /resumes and the Settings card. Posts to /resumes and lands on the new resume. */
export const ResumeUploadForm: FC = () => (
  <form
    method="post"
    action="/resumes"
    enctype="multipart/form-data"
    class="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]"
  >
    <Field label="Name" hint="Blank = taken from the file name.">
      <Input type="text" name="name" placeholder="Backend PHP" maxlength="100" />
    </Field>
    <Field label="File" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to 2 MB`}>
      <Input
        type="file"
        name="file"
        required
        accept={ACCEPTED_EXTENSIONS.join(',')}
        class={FILE_INPUT_CLASS}
      />
    </Field>
    <div class="flex items-end">
      <Button class="w-full">Upload &amp; scan</Button>
    </div>
    <Hint class="sm:col-span-3">
      The scan calls the resume model once (about a minute) and stores headline, skills and
      job-agnostic issues. The file itself never leaves your Postgres.
    </Hint>
  </form>
);
