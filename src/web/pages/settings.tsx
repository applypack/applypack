/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { Profile } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Empty,
  Field,
  Flash,
  Hint,
  Input,
  PageHeader,
  Radio,
  SectionTitle,
  Select,
  Table,
  Tag,
  Td,
  Textarea,
  ToggleRow,
  Tr,
} from '../ui';
import { formatRelative } from '../format';
import { formatPriorityRulesText, parsePriorityRules } from '../../priority-rules';
import { ResumeUploadForm } from './resumes';

interface MaskedTarget {
  id: number;
  name: string;
  maskedToken: string;
  chatId: string;
  active: boolean;
  createdAt: Date;
  lastUsed: Date | null;
}

interface ProfileListItem {
  id: number;
  name: string;
  stackPreview: string; // first 3 required tags
  active: boolean;
}

interface AvailableTarget {
  id: number;
  name: string;
  active: boolean;
}

interface ResumeListItem {
  id: number;
  name: string;
  isDefault: boolean;
  scannedAt: Date | null;
}

const REGION_OPTIONS = ['US', 'Americas', 'EU', 'UK', 'APAC', 'Worldwide'];
const SENIORITY_OPTIONS = ['junior', 'mid', 'senior', 'staff', 'lead', 'principal'];

export interface SettingsProps {
  telegramEnabled: boolean;
  classifierMode: 'single' | 'two_stage';
  applicationTrackingEnabled: boolean;
  staleApplicationsDigestEnabled: boolean;
  hnParserEnabled: boolean;
  disabledSources: string[];
  allSources: string[];
  discoveryEnabled: boolean;
  fetchingEnabled: boolean;
  targets: MaskedTarget[];
  profiles: ProfileListItem[];
  activeProfile: Profile | null;
  availableTargets: AvailableTarget[];
  resumes: ResumeListItem[];
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

export const SettingsPage: FC<SettingsProps> = ({
  telegramEnabled,
  classifierMode,
  applicationTrackingEnabled,
  staleApplicationsDigestEnabled,
  hnParserEnabled,
  disabledSources,
  allSources,
  discoveryEnabled,
  fetchingEnabled,
  targets,
  profiles,
  activeProfile,
  availableTargets,
  resumes,
  flash,
}) => (
  <Layout title="Settings" active="settings">
    <PageHeader title="Settings">
      <p class="mt-1 text-sm text-ink-faint">
        Everything here lives in Postgres — no .env edits, no restarts. Toggles take
        effect on the next cron tick.
      </p>
    </PageHeader>
    <Flash flash={flash} />

    <Card class="mb-6">
      <SectionTitle>Job fetching</SectionTitle>
      <ToggleRow
        label="Pipeline"
        enabled={fetchingEnabled}
        action="/settings/fetching-toggle"
        onLabel="Running"
        offLabel="Paused"
        enableText="Resume"
        disableText="Pause"
      >
        Master switch for new-job ingestion (hourly fetch + monthly HN pull). Off by
        default. Pausing stops new jobs and alerts without touching Docker; the
        dashboard, digest, cleanup and discovery probe keep running.
      </ToggleRow>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Active profile</SectionTitle>
      <div class="mb-5 flex flex-wrap items-center gap-2">
        <form method="post" action="/settings/profiles/activate" class="flex items-center gap-2">
          <Select name="id" class="!w-auto">
            {profiles.map((p) => (
              <option value={p.id} selected={p.active}>
                {p.name}
                {p.active ? ' (active)' : ''}
              </option>
            ))}
          </Select>
          <Button>Activate</Button>
        </form>
        <ActionForm action="/settings/profiles/new">
          <Button variant="secondary">+ New profile</Button>
        </ActionForm>
        <ActionForm
          action="/settings/reclassify"
          confirm="Re-classify all jobs (except APPLIED) against the active profile? Takes 2-5 minutes and spends AI credit."
        >
          <Button variant="violet">Re-classify all jobs</Button>
        </ActionForm>
      </div>
      {activeProfile ? (
        <ProfileEditor profile={activeProfile} availableTargets={availableTargets} />
      ) : (
        <Empty>No active profile. Pick one above or create a new one.</Empty>
      )}
    </Card>

    {profiles.length > 1 && (
      <Card class="mb-6" flush>
        <div class="px-5 pt-5">
          <SectionTitle>Other profiles</SectionTitle>
        </div>
        <Table columns={['Name', 'Stack', <span class="block text-right">Actions</span>]}>
          {profiles
            .filter((p) => !p.active)
            .map((p) => (
              <Tr>
                <Td class="font-medium text-ink">{p.name}</Td>
                <Td class="font-mono text-xs text-ink-muted">{p.stackPreview}</Td>
                <Td>
                  <div class="flex justify-end gap-2">
                    <ActionForm action="/settings/profiles/activate" hidden={{ id: p.id }}>
                      <Button size="sm" variant="secondary">
                        Activate
                      </Button>
                    </ActionForm>
                    <ActionForm
                      action={`/settings/profiles/${p.id}/delete`}
                      confirm="Delete this profile?"
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
      </Card>
    )}

    <Card class="mb-6">
      <SectionTitle>Resumes</SectionTitle>
      <Hint class="mb-4 max-w-prose">
        Upload the resumes you send out. Every job page can then compare one against the
        posting and list what to add and where.{' '}
        <a href="/resumes" class="text-accent hover:underline">
          Manage resumes →
        </a>
      </Hint>
      {resumes.length > 0 && (
        <ul class="mb-4 divide-y divide-line rounded-md border border-line">
          {resumes.map((r) => (
            <li class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <a href={`/resumes/${r.id}`} class="font-medium text-ink hover:text-accent">
                {r.name}
              </a>
              {r.isDefault && <Badge tone="ok">default</Badge>}
              {!r.scannedAt && <Badge tone="warn">not scanned</Badge>}
            </li>
          ))}
        </ul>
      )}
      <ResumeUploadForm />
    </Card>

    <Card class="mb-6">
      <SectionTitle>Classifier mode</SectionTitle>
      <form method="post" action="/settings/classifier-mode" class="space-y-2">
        <Radio name="mode" value="single" checked={classifierMode === 'single'} title="Single stage">
          Every job goes straight to the full classifier. Highest precision, full cost.
        </Radio>
        <Radio
          name="mode"
          value="two_stage"
          checked={classifierMode === 'two_stage'}
          title="Two stage (cheaper)"
        >
          A short yes/no prefilter gates the full classifier. When most fetched jobs are
          off-target, spend drops ~30-40% with marginal precision loss.
        </Radio>
        <div class="pt-2">
          <Button>Save mode</Button>
        </div>
      </form>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Job sources</SectionTitle>
      <Hint class="mb-3 max-w-prose">
        Disable a whole source family with one click — handy when an aggregator gets
        noisy. Per-company toggles on the Companies page still apply.
      </Hint>
      <form method="post" action="/settings/sources" class="space-y-3">
        <div class="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {allSources.map((s) => (
            <Checkbox name="enabled" value={s} checked={!disabledSources.includes(s)}>
              <span class="font-mono text-xs">{s}</span>
            </Checkbox>
          ))}
        </div>
        <Button>Save sources</Button>
      </form>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Auto-discovery</SectionTitle>
      <ToggleRow label="Status" enabled={discoveryEnabled} action="/settings/discovery-toggle">
        When the HN parser sees a Greenhouse / Lever / Ashby URL in a comment, the
        company is recorded as a candidate on the Discovery page. A weekly cron
        re-probes pending candidates so the job count stays fresh.
      </ToggleRow>
    </Card>

    <Card class="mb-6">
      <SectionTitle>HN "Who is hiring" parser</SectionTitle>
      <ToggleRow
        label="Status"
        enabled={hnParserEnabled}
        action="/settings/hn-parser-toggle"
        extra={
          <ActionForm
            action="/settings/hn-run"
            confirm="Pull the latest HN Who-is-hiring thread now? Takes 1-2 minutes and spends AI credit."
          >
            <Button size="sm" variant="violet" disabled={!hnParserEnabled}>
              Run now
            </Button>
          </ActionForm>
        }
      >
        Monthly cron parses the latest "Ask HN: Who is hiring?" thread (300-500
        comments) and runs the structured ones through the same filter → classify →
        alert pipeline. Many small startups only post there.
      </ToggleRow>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Application tracking</SectionTitle>
      <div class="space-y-4">
        <ToggleRow
          label="Tracking"
          enabled={applicationTrackingEnabled}
          action="/settings/application-tracking-toggle"
        >
          Shows the tracking card on each job and the Applications funnel. Stored
          fields persist either way.
        </ToggleRow>
        <div class="border-t border-line pt-4">
          <ToggleRow
            label="Stale digest"
            enabled={staleApplicationsDigestEnabled}
            action="/settings/stale-digest-toggle"
          >
            Daily Telegram nudge for jobs stuck in "applied" with no recruiter contact
            for 14+ days. Honours the Telegram master switch.
          </ToggleRow>
        </div>
      </div>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Telegram alerts</SectionTitle>
      <ToggleRow label="Status" enabled={telegramEnabled} action="/settings/telegram-toggle">
        When off, nothing is sent regardless of targets. Jobs are still classified and
        stored.
      </ToggleRow>
    </Card>

    <Card class="mb-6" flush>
      <div class="px-5 pt-5">
        <SectionTitle>Targets</SectionTitle>
      </div>
      {targets.length === 0 ? (
        <div class="px-5 pb-5">
          <Empty>No targets yet. Add one below to start receiving alerts.</Empty>
        </div>
      ) : (
        <Table
          columns={[
            'Name',
            'Bot token',
            'Chat id',
            'Last used',
            'Active',
            <span class="block text-right">Actions</span>,
          ]}
        >
          {targets.map((t) => (
            <Tr>
              <Td class="font-medium text-ink">{t.name}</Td>
              <Td class="font-mono text-xs text-ink-muted">{t.maskedToken}</Td>
              <Td class="font-mono text-xs text-ink-muted">{t.chatId}</Td>
              <Td class="whitespace-nowrap text-xs text-ink-faint">{formatRelative(t.lastUsed)}</Td>
              <Td>
                <ActionForm action={`/settings/targets/${t.id}/toggle`}>
                  <button type="submit" class="cursor-pointer rounded-full" title="Toggle">
                    <Badge tone={t.active ? 'ok' : 'neutral'}>
                      {t.active ? 'Active' : 'Disabled'}
                    </Badge>
                  </button>
                </ActionForm>
              </Td>
              <Td>
                <div class="flex justify-end gap-2">
                  <ActionForm action={`/settings/targets/${t.id}/test`}>
                    <Button size="sm" variant="secondary">
                      Test
                    </Button>
                  </ActionForm>
                  <ActionForm
                    action={`/settings/targets/${t.id}/delete`}
                    confirm="Delete this target?"
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
      <SectionTitle>Add target</SectionTitle>
      <form method="post" action="/settings/targets" class="grid gap-3 sm:grid-cols-12">
        <Field label="Name" class="sm:col-span-3">
          <Input type="text" name="name" required placeholder="My phone" />
        </Field>
        <Field label="Bot token" class="sm:col-span-5">
          <Input
            type="password"
            name="botToken"
            required
            autocomplete="off"
            placeholder="123456789:ABC…"
            mono
          />
        </Field>
        <Field label="Chat id" class="sm:col-span-3">
          <Input type="text" name="chatId" required placeholder="-100…" mono />
        </Field>
        <div class="flex items-end sm:col-span-1">
          <Button class="w-full">Add</Button>
        </div>
      </form>
      <Hint class="mt-3">
        The bot token is validated (getMe + sendMessage) before saving.
      </Hint>
    </Card>
  </Layout>
);

const ProfileEditor: FC<{
  profile: Profile;
  availableTargets: AvailableTarget[];
}> = ({ profile, availableTargets }) => (
  <form method="post" action={`/settings/profiles/${profile.id}/save`} class="space-y-5">
    <Field label="Name" class="max-w-md">
      <Input type="text" name="name" required value={profile.name} />
    </Field>

    <TagListInput
      label="Tech stack — required (real technologies)"
      hint="Languages / frameworks the role must actually use: php, laravel, typescript, react, go. Not role types."
      name="stackRequired"
      values={profile.stackRequired}
    />
    <TagListInput
      label="Role types (job category hints)"
      hint='Title shapes you accept: "full-stack", "backend", "platform". Admits jobs to the classifier, but a role type alone is never a tech match.'
      name="roleTypes"
      values={profile.roleTypes}
    />
    <TagListInput
      label="Stack — nice to have (boosts fit score)"
      hint="Tags the classifier rewards when they show up in the description."
      name="stackNiceToHave"
      values={profile.stackNiceToHave}
    />
    <TagListInput
      label="Stack — exclude (auto-reject in title)"
      hint="If the title contains any of these, the job is dropped before the classifier runs."
      name="stackExclude"
      values={profile.stackExclude}
    />

    <Field
      label="Notes for the classifier"
      hint='Free-form context: "AI-adjacent roles preferred", "open to first-time-manager positions", "EU-friendly time zones".'
    >
      <Textarea name="notes" rows={3}>
        {profile.notes ?? ''}
      </Textarea>
    </Field>

    <fieldset>
      <legend class="text-xs uppercase tracking-wider text-ink-faint">Seniority</legend>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {SENIORITY_OPTIONS.map((s) => (
          <Checkbox name="seniority" value={s} checked={profile.seniority.includes(s)}>
            {s}
          </Checkbox>
        ))}
      </div>
    </fieldset>

    <fieldset class="space-y-3">
      <legend class="text-xs uppercase tracking-wider text-ink-faint">Location</legend>
      <div class="flex flex-wrap gap-x-6 gap-y-1">
        <Checkbox name="remoteOk" value="1" checked={profile.remoteOk}>
          Accept remote roles
        </Checkbox>
        <Checkbox name="hybridOk" value="1" checked={profile.hybridOk}>
          Hybrid OK
        </Checkbox>
      </div>
      <div>
        <Hint>Acceptable remote regions</Hint>
        <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {REGION_OPTIONS.map((r) => (
            <Checkbox name="remoteRegions" value={r} checked={profile.remoteRegions.includes(r)}>
              {r}
            </Checkbox>
          ))}
        </div>
      </div>
      <TagListInput
        label="On-site cities (OK to commute)"
        hint='One per line: "Austin, TX", "Berlin".'
        name="onsiteCities"
        values={profile.onsiteCities}
        rows={2}
      />
    </fieldset>

    <PriorityRulesEditor profile={profile} />

    <div class="grid gap-4 sm:grid-cols-3">
      <Field label="Min salary (USD/year)" hint="0 = no salary filter.">
        <Input type="number" name="minSalaryUsd" min="0" step="1000" value={profile.minSalaryUsd} />
      </Field>
      <Field label="Min fit score (0-100)">
        <Input type="number" name="minFitScore" min="0" max="100" value={profile.minFitScore} />
      </Field>
      <Field label="Telegram target">
        <Select name="telegramTargetId">
          <option value="" selected={profile.telegramTargetId === null}>
            (broadcast to all active)
          </option>
          {availableTargets.map((t) => (
            <option value={t.id} selected={profile.telegramTargetId === t.id}>
              {t.name}
              {t.active ? '' : ' (inactive)'}
            </option>
          ))}
        </Select>
      </Field>
    </div>

    <div class="flex flex-wrap gap-2 border-t border-line pt-4">
      <Button size="lg">Save</Button>
      <Button size="lg" variant="violet" name="action" value="save-and-reclassify">
        Save &amp; re-classify
      </Button>
    </div>
  </form>
);

const TagListInput: FC<{
  label: string;
  hint: string;
  name: string;
  values: string[];
  rows?: number;
}> = ({ label, hint, name, values, rows = 3 }) => (
  <Field label={label} hint={hint}>
    <Textarea name={name} rows={rows} mono>
      {values.join('\n')}
    </Textarea>
  </Field>
);

const PriorityRulesEditor: FC<{ profile: Profile }> = ({ profile }) => {
  const rules = parsePriorityRules(profile.priorityRules);
  const text = formatPriorityRulesText(rules);
  return (
    <div>
      <label class="block text-xs uppercase tracking-wider text-ink-faint" for="priorityRules">
        Priority rules (post-classifier overrides)
      </label>
      <Hint class="mt-1 max-w-prose">
        One rule per line: <Code>LABEL | techs,csv | regions,csv | MIN_FIT</Code>. If the
        title or description contains any tech and the location matches any region
        phrase, fit is clamped up to MIN_FIT and the location check passes. Empty
        regions match anywhere. <Code>#</Code> starts a comment. A bad line stops the
        save.
      </Hint>
      <Hint class="mt-1 max-w-prose text-warn/90">
        Region entries are phrases — every word must appear in the location.{' '}
        <Code>Remote US</Code> matches "Dallas (Remote US)" but not "Remote · Germany".
        Avoid a bare <Code>Remote</Code>; prefer{' '}
        <Code>Remote US,United States,USA,Worldwide</Code>.
      </Hint>
      <Textarea
        id="priorityRules"
        name="priorityRules"
        rows={Math.max(3, rules.length + 1)}
        placeholder="PHP remote-US | php | Remote US,United States,USA,Worldwide | 90"
        class="mt-1"
        mono
      >
        {text}
      </Textarea>
      {rules.length > 0 && (
        <div class="mt-2 flex flex-wrap gap-1.5">
          {rules.map((r) => (
            <Tag tone="violet">
              {r.label} → ≥{r.minFitFloor}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
};
