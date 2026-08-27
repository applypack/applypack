/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { AtsType } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Code,
  Empty,
  Field,
  Flash,
  Hint,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Table,
  Tag,
  Td,
  Tr,
} from '../ui';
import { formatRelative } from '../format';

interface CompanyRow {
  id: number;
  name: string;
  atsType: AtsType;
  atsToken: string;
  active: boolean;
  careerUrl: string | null;
  jobsTotal: number;
  alertedTotal: number;
  lastFetchedAt: Date | null;
}

export interface CompaniesProps {
  companies: CompanyRow[];
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

const PROBEABLE_ATS: AtsType[] = [
  AtsType.GREENHOUSE,
  AtsType.LEVER,
  AtsType.ASHBY,
  AtsType.WORKABLE,
  AtsType.SMARTRECRUITERS,
];

const AGGREGATORS = ['LARAJOBS', 'REMOTEOK', 'REMOTIVE', 'JOBICY', 'WEWORKREMOTELY', 'HN_HIRING'];

export const CompaniesPage: FC<CompaniesProps> = ({ companies, flash }) => (
  <Layout title="Companies" active="companies">
    <PageHeader title="Companies" meta={`${companies.length} sources`} />
    <Flash flash={flash} />

    <Card class="mb-6 border-warn/30">
      <SectionTitle>How coverage works</SectionTitle>
      <div class="max-w-prose space-y-2 text-sm leading-6 text-ink-muted">
        <p>
          Greenhouse, Lever, Ashby, Workable and SmartRecruiters are{' '}
          <strong class="text-ink">HR vendors, not job boards</strong>. Their public
          APIs only answer <Code>/boards/&lt;slug&gt;/jobs</Code>, so this table is the
          full list of boards we can see. There is no "all Greenhouse postings"
          endpoint, and we never scrape LinkedIn / Indeed / Workday (
          <a
            href="https://github.com/nazboyko/job-hunter/blob/main/docs/adr/0005-no-linkedin-indeed-workday.md"
            class="text-accent hover:underline"
          >
            ADR 0005
          </a>
          ).
        </p>
        <p>
          The long tail comes from cross-company aggregators —{' '}
          {AGGREGATORS.map((a) => (
            <>
              <Code>{a}</Code>{' '}
            </>
          ))}
          — broad and noisy, so the profile filter does the culling. Disable them all
          in Settings → Job sources and you will only see jobs from the boards below.
        </p>
      </div>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Add company</SectionTitle>
      <Hint class="mb-3 max-w-prose">
        We probe the public ATS endpoint before saving and refuse invalid tokens.
        Aggregator feeds have no per-company token — those are seeded once via{' '}
        <Code>src/seed.ts</Code>.
      </Hint>
      <form method="post" action="/companies/new" class="grid gap-3 sm:grid-cols-12">
        <Field label="Name" class="sm:col-span-3">
          <Input type="text" name="name" required placeholder="Honeycomb.io" />
        </Field>
        <Field label="ATS" class="sm:col-span-2">
          <Select name="atsType">
            {PROBEABLE_ATS.map((t) => (
              <option value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="ATS token / slug" class="sm:col-span-3">
          <Input type="text" name="atsToken" required placeholder="honeycombio" mono />
        </Field>
        <Field label="Career URL (optional)" class="sm:col-span-3">
          <Input type="url" name="careerUrl" placeholder="https://acme.com/careers" />
        </Field>
        <div class="flex items-end sm:col-span-1">
          <Button class="w-full">Add</Button>
        </div>
      </form>
    </Card>

    {companies.length === 0 ? (
      <Empty>No companies yet. Add one above.</Empty>
    ) : (
      <Card flush>
        <Table
          columns={[
            'Name',
            'Source',
            'Token',
            'Jobs',
            'Alerted',
            'Last fetch',
            'Active',
            <span class="block text-right">Actions</span>,
          ]}
        >
          {companies.map((c) => (
            <Tr>
              <Td class="font-medium text-ink">
                {c.careerUrl ? (
                  <a href={c.careerUrl} target="_blank" rel="noopener" class="hover:text-accent">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </Td>
              <Td>
                <Tag>{c.atsType.replace('_', ' ')}</Tag>
              </Td>
              <Td class="font-mono text-xs text-ink-muted">{c.atsToken}</Td>
              <Td class="font-mono tabular-nums text-ink-muted">{c.jobsTotal}</Td>
              <Td class={`font-mono tabular-nums ${c.alertedTotal ? 'text-ok' : 'text-ink-faint'}`}>
                {c.alertedTotal}
              </Td>
              <Td class="whitespace-nowrap text-xs text-ink-faint">
                {formatRelative(c.lastFetchedAt)}
              </Td>
              <Td>
                <ActionForm action={`/companies/${c.id}/toggle-active`}>
                  <button type="submit" class="cursor-pointer rounded-full" title="Toggle">
                    <Badge tone={c.active ? 'ok' : 'neutral'}>
                      {c.active ? 'Active' : 'Disabled'}
                    </Badge>
                  </button>
                </ActionForm>
              </Td>
              <Td>
                <ActionForm
                  action={`/companies/${c.id}/delete`}
                  confirm={`Delete "${c.name}" and all its ${c.jobsTotal} jobs?`}
                  class="flex justify-end"
                >
                  <Button size="sm" variant="danger">
                    Delete
                  </Button>
                </ActionForm>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
    )}
  </Layout>
);
