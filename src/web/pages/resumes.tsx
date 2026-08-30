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
import { MAX_UPLOAD_MB } from '../upload';

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

export interface FactRow {
  term: string;
  status: string; // confirmed | denied
  note: string | null;
}

const SKILLS_PREVIEW = 6;

const FILE_INPUT_CLASS =
  'file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink';

export const ResumesPage: FC<{
  resumes: ResumeRow[];
  facts: FactRow[];
  flash?: FlashMessage | null;
}> = ({
  resumes,
  facts,
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

    <Card>
      <SectionTitle>Upload a resume</SectionTitle>
      <ResumeUploadForm />
    </Card>

    {facts.length > 0 && (
      <Card class="mt-4">
        <SectionTitle>Confirmed facts</SectionTitle>
        <Hint class="mb-3">
          Your answers to "do you have this?" questions from comparisons. They feed every future
          match — delete one if it's wrong.
        </Hint>
        <ul class="divide-y divide-line">
          {facts.map((f) => (
            <li class="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
              <Badge tone={f.status === 'confirmed' ? 'ok' : 'neutral'}>
                {f.status === 'confirmed' ? 'have it' : "don't"}
              </Badge>
              <span class="text-sm font-medium text-ink">{f.term}</span>
              {f.note && <span class="min-w-0 text-xs text-ink-faint">— {f.note}</span>}
              <ActionForm action="/facts/delete" hidden={{ term: f.term, back: '/resumes' }} class="ml-auto">
                <Button size="sm" variant="ghost">
                  Forget
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
    )}
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
      <Input type="text" name="name" placeholder="Senior Backend" maxlength="100" />
    </Field>
    <Field label="File" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to ${MAX_UPLOAD_MB} MB`}>
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
