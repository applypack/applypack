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
import {
  QUIET_STREAK,
  SILENT_DAYS,
  describeStatus,
  type HealthTone,
  type QuietReason,
} from '../../fetchers/source-health';
import type { FlashMessage } from '../flash';
import { StarterPackPicker, type PackSegmentChoice } from './starter-pack';

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
  lastFetchStatus: string | null;
  consecutiveFailures: number;
  lastOkAt: Date | null;
  quiet: QuietReason | null;
}

export interface CompaniesProps {
  companies: CompanyRow[];
  packs: PackSegmentChoice[];
  flash?: FlashMessage | null;
  fetchingEnabled: boolean;
}

const DOT_TONE: Record<HealthTone, string> = {
  good: 'bg-ok',
  idle: 'bg-ink-faint',
  bad: 'bg-danger',
  warn: 'bg-warn',
  none: 'bg-line',
};

/** Status dot + label, the per-row half of ADR 0019. */
const HealthDot: FC<{ status: string | null; streak: number }> = ({ status, streak }) => {
  const { label, tone } = describeStatus(status);
  // The label is already text, so the dot is decorative and the streak is the
  // only part a screen reader would otherwise miss.
  const streakText = streak > 0 ? `${streak} tick${streak === 1 ? '' : 's'} in a row` : '';
  return (
    <span
      class="inline-flex items-center gap-2 whitespace-nowrap"
      title={streakText ? `${label} — ${streakText}` : label}
    >
      <span class={`h-2 w-2 shrink-0 rounded-full ${DOT_TONE[tone]}`} aria-hidden="true" />
      <span class="text-[13px] text-ink-muted">{label}</span>
      {streakText && <span class="sr-only">, {streakText}</span>}
    </span>
  );
};

const QuietSources: FC<{ companies: CompanyRow[]; fetchingEnabled: boolean }> = ({
  companies,
  fetchingEnabled,
}) => {
  const quiet = companies.filter((c) => c.quiet !== null);
  if (quiet.length === 0) return null;
  return (
    <Card class="mb-4">
      <SectionTitle>
        Quiet sources <Badge tone="warn">{quiet.length}</Badge>
      </SectionTitle>
      <Hint class="mb-4">
        A board that stopped answering is usually a rotated slug. <em>Failing</em> means{' '}
        {QUIET_STREAK} consecutive ticks ended in an error; <em>silent</em> means the board is
        reachable but has returned no posting for {SILENT_DAYS} days — the only signal that
        catches a vendor answering 200 with an empty list. Re-probe runs the same public check
        the add-company form uses.
        {!fetchingEnabled && (
          <>
            {' '}
            <strong class="font-medium text-ink">Fetching is paused</strong>, so these numbers
            are frozen where the last tick left them.
          </>
        )}
      </Hint>
      <div class="flex flex-col gap-2">
        {quiet.map((c) => (
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3">
            <div class="min-w-0">
              <div class="truncate font-medium text-ink">{c.name}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                <Tag>{c.atsType.replace('_', ' ')}</Tag>
                <Code>{c.atsToken}</Code>
                <Badge tone={c.quiet === 'failing' ? 'danger' : 'warn'}>
                  {c.quiet === 'failing' ? 'Failing' : 'Silent'}
                </Badge>
                <span>
                  {c.quiet === 'failing'
                    ? `${describeStatus(c.lastFetchStatus).label.toLowerCase()} — ${c.consecutiveFailures} ticks in a row`
                    : c.lastOkAt
                      ? `last posting ${formatRelative(c.lastOkAt)}`
                      : 'no posting since we started tracking it'}
                </span>
              </div>
            </div>
            <ActionForm action={`/companies/${c.id}/reprobe`}>
              <Button size="sm" variant="secondary">
                Re-probe
              </Button>
            </ActionForm>
          </div>
        ))}
      </div>
    </Card>
  );
};

const PROBEABLE_ATS: AtsType[] = [
  AtsType.GREENHOUSE,
  AtsType.LEVER,
  AtsType.ASHBY,
  AtsType.WORKABLE,
  AtsType.SMARTRECRUITERS,
  AtsType.RECRUITEE,
  AtsType.BREEZY,
  AtsType.BAMBOOHR,
  AtsType.PINPOINT,
  AtsType.RIPPLING,
];

const AGGREGATORS = ['LARAJOBS', 'REMOTEOK', 'REMOTIVE', 'JOBICY', 'WEWORKREMOTELY', 'HN_HIRING'];

export const CompaniesPage: FC<CompaniesProps> = ({
  companies,
  packs,
  flash,
  fetchingEnabled,
}) => (
  <Layout title="Companies" active="companies">
    <PageHeader title="Companies" meta={`${companies.length} sources`} />
    <Flash flash={flash} />

    <QuietSources companies={companies} fetchingEnabled={fetchingEnabled} />

    <details class="mb-4 rounded-lg border border-line bg-surface-raised shadow-sm">
      <summary class="cursor-pointer select-none px-5 py-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-overlay/50">
        How coverage works
      </summary>
      {/* Two columns keep a readable measure while filling the panel. */}
      <div class="grid gap-x-8 gap-y-2 border-t border-line px-5 py-4 text-sm leading-6 text-ink-muted sm:grid-cols-2">
        <p>
          Greenhouse, Lever, Ashby, Workable and SmartRecruiters are{' '}
          <strong class="font-medium text-ink">HR vendors, not job boards</strong>. Their public
          APIs only answer <Code>/boards/&lt;slug&gt;/jobs</Code>, so this table is the full
          list of boards we can see. There is no "all Greenhouse postings" endpoint, and we
          never scrape LinkedIn / Indeed / Workday (
          <a
            href="https://github.com/nazboyko/applypack/blob/main/docs/adr/0005-no-linkedin-indeed-workday.md"
            class="font-medium text-accent-strong hover:text-accent-deep"
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
          — broad and noisy, so the profile filter does the culling. Disable them all in
          Settings → Job sources and you will only see jobs from the boards below.
        </p>
      </div>
    </details>

    <StarterPackPicker segments={packs} />

    <Card class="mb-4">
      <SectionTitle>Add company</SectionTitle>
      <Hint class="mb-4">
        We probe the public ATS endpoint before saving and refuse invalid tokens. Aggregator
        feeds have no per-company token — those are seeded once via <Code>src/seed.ts</Code>.
      </Hint>
      <form
        method="post"
        action="/companies/new"
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.9fr_1fr_1.2fr_auto]"
      >
        <Field label="Name">
          <Input type="text" name="name" required placeholder="Honeycomb.io" />
        </Field>
        <Field label="ATS">
          <Select name="atsType">
            {PROBEABLE_ATS.map((t) => (
              <option value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="ATS token / slug">
          <Input type="text" name="atsToken" required placeholder="honeycombio" mono />
        </Field>
        <Field label="Career URL (optional)">
          <Input type="url" name="careerUrl" placeholder="https://acme.com/careers" />
        </Field>
        <div class="flex items-end">
          <Button class="w-full">Add</Button>
        </div>
      </form>
    </Card>

    {companies.length === 0 ? (
      <Empty>No companies yet. Add one above.</Empty>
    ) : (
      <Card flush>
        <div class="overflow-x-auto">
          <div class="min-w-[56rem]">
            <Table
              columns={[
                'Name',
                'Source',
                'Token',
                'Health',
                <span class="block text-right">Jobs</span>,
                <span class="block text-right">Alerted</span>,
                <span class="block text-right">Last fetch</span>,
                'Active',
                <span class="block text-right">Actions</span>,
              ]}
            >
              {companies.map((c) => (
                <Tr>
                  <Td class="max-w-[16rem] font-medium text-ink">
                    <div class="truncate" title={c.name}>
                      {c.careerUrl ? (
                        <a
                          href={c.careerUrl}
                          target="_blank"
                          rel="noopener"
                          class="transition-colors duration-150 hover:text-accent-strong"
                        >
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Tag>{c.atsType.replace('_', ' ')}</Tag>
                  </Td>
                  <Td class="font-mono text-xs text-ink-muted">{c.atsToken}</Td>
                  <Td>
                    <HealthDot status={c.lastFetchStatus} streak={c.consecutiveFailures} />
                  </Td>
                  <Td class="text-right tabular-nums text-ink-muted">{c.jobsTotal}</Td>
                  <Td
                    class={`text-right tabular-nums ${
                      c.alertedTotal ? 'font-medium text-ok' : 'text-ink-faint'
                    }`}
                  >
                    {c.alertedTotal}
                  </Td>
                  <Td class="whitespace-nowrap text-right text-[13px] text-ink-faint">
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
          </div>
        </div>
      </Card>
    )}
  </Layout>
);
