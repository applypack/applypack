/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { Profile } from '@prisma/client';
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
  PillCheckbox,
  Radio,
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

export interface AiProviderOption {
  id: string;
  label: string;
  desc: string;
  ok: boolean;
  detail: string;
  selected: boolean;
}

const AI_MODEL_SUGGESTIONS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5',
  'claude-opus-5',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

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
  aiProviders: AiProviderOption[];
  aiModelClassifier: string | null;
  aiModelResume: string | null;
  aiDefaults: { classifier: string; resume: string };
  targets: MaskedTarget[];
  profiles: ProfileListItem[];
  activeProfile: Profile | null;
  availableTargets: AvailableTarget[];
  resumes: ResumeListItem[];
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

/** Stripe-style settings section: title + description left, controls right. */
const Section: FC<PropsWithChildren<{ title: string; desc?: string | Child }>> = ({
  title,
  desc,
  children,
}) => (
  <section class="grid gap-3 border-t border-line py-7 first:border-t-0 first:pt-0 lg:grid-cols-[220px_1fr] lg:gap-8">
    <div>
      <h2 class="text-sm font-semibold text-ink">{title}</h2>
      {desc && <p class="mt-1 text-[13px] leading-5 text-ink-faint">{desc}</p>}
    </div>
    <div class="min-w-0 space-y-4">{children}</div>
  </section>
);

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
  aiProviders,
  aiModelClassifier,
  aiModelResume,
  aiDefaults,
  targets,
  profiles,
  activeProfile,
  availableTargets,
  resumes,
  flash,
}) => (
  <Layout title="Settings" active="settings">
    <div class="w-full max-w-5xl">
      <PageHeader title="Settings">
        Everything here lives in Postgres — no .env edits, no restarts. Toggles take effect on
        the next cron tick.
      </PageHeader>
      <Flash flash={flash} />

      <Section
        title="Job fetching"
        desc="The master switch for new-job ingestion. Everything else keeps running while paused."
      >
        <Card>
          <ToggleRow
            label="Pipeline"
            enabled={fetchingEnabled}
            action="/settings/fetching-toggle"
            onLabel="Running"
            offLabel="Paused"
            enableText="Resume"
            disableText="Pause"
          >
            Hourly fetch + monthly HN pull. Pausing stops new jobs and alerts without touching
            Docker; the dashboard, digest, cleanup and discovery probe keep running.
          </ToggleRow>
        </Card>
      </Section>

      <Section
        title="Active profile"
        desc="What a matching job looks like: stack, role types, regions, salary floor. The classifier scores every job against this."
      >
        <div class="flex flex-wrap items-center gap-2">
          <form
            method="post"
            action="/settings/profiles/activate"
            class="flex min-w-0 max-w-full flex-wrap items-center gap-2"
          >
            <Select name="id" class="!w-auto min-w-0 max-w-full" aria-label="Profile to activate">
              {profiles.map((p) => (
                <option value={p.id} selected={p.active}>
                  {p.name}
                  {p.active ? ' (active)' : ''}
                </option>
              ))}
            </Select>
            <Button variant="secondary">Activate</Button>
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
          <Card>
            <ProfileEditor profile={activeProfile} availableTargets={availableTargets} />
          </Card>
        ) : (
          <Empty>No active profile. Pick one above or create a new one.</Empty>
        )}
        {profiles.length > 1 && (
          <Card flush>
            <div class="border-b border-line px-5 py-3 text-[13px] font-medium text-ink">
              Other profiles
            </div>
            <Table columns={['Name', 'Stack', <span class="block text-right">Actions</span>]}>
              {profiles
                .filter((p) => !p.active)
                .map((p) => (
                  <Tr>
                    <Td class="font-medium text-ink">{p.name}</Td>
                    <Td class="text-[13px] text-ink-muted">{p.stackPreview}</Td>
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
      </Section>

      <Section
        title="AI engine"
        desc="Which AI backend runs the pipeline and which models it uses. Dashboard actions switch immediately; the worker follows on its next tick."
      >
        <Card>
          <form method="post" action="/settings/ai" class="space-y-4">
            <div class="space-y-2">
              {aiProviders.map((p) => (
                <Radio
                  name="provider"
                  value={p.id}
                  checked={p.selected}
                  disabled={!p.ok}
                  title={
                    <>
                      {p.label}{' '}
                      <Badge tone={p.ok ? 'ok' : 'neutral'} class="ml-1 align-middle">
                        {p.ok ? 'available' : 'not detected'}
                      </Badge>
                    </>
                  }
                >
                  {p.desc} <span class="text-ink-faint">({p.detail})</span>
                </Radio>
              ))}
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field
                label="Classifier model"
                hint={`Scores every fetched job — cheap and frequent. Empty = ${aiDefaults.classifier}.`}
              >
                <Input
                  type="text"
                  name="classifierModel"
                  value={aiModelClassifier ?? ''}
                  placeholder={aiDefaults.classifier}
                  list="ai-model-ids"
                  mono
                />
              </Field>
              <Field
                label="Resume model"
                hint={`Resume scan, match and job verification — a few calls a day where judgment matters. Empty = ${aiDefaults.resume}.`}
              >
                <Input
                  type="text"
                  name="resumeModel"
                  value={aiModelResume ?? ''}
                  placeholder={aiDefaults.resume}
                  list="ai-model-ids"
                  mono
                />
              </Field>
            </div>
            <datalist id="ai-model-ids">
              {AI_MODEL_SUGGESTIONS.map((m) => (
                <option value={m} />
              ))}
            </datalist>
            <Button variant="secondary">Save AI engine</Button>
          </form>
        </Card>
      </Section>

      <Section
        title="Classifier"
        desc="How much AI spend each fetched job gets before it reaches you."
      >
        <Card>
          <form method="post" action="/settings/classifier-mode" class="space-y-2">
            <Radio
              name="mode"
              value="single"
              checked={classifierMode === 'single'}
              title="Single stage"
            >
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
              <Button variant="secondary">Save mode</Button>
            </div>
          </form>
        </Card>
      </Section>

      <Section
        title="Job sources"
        desc="Disable a whole source family with one click — handy when an aggregator gets noisy. Per-company toggles on the Companies page still apply."
      >
        <Card>
          <form method="post" action="/settings/sources" class="space-y-4">
            <div class="flex flex-wrap gap-1.5">
              {allSources.map((s) => (
                <PillCheckbox name="enabled" value={s} checked={!disabledSources.includes(s)}>
                  {s}
                </PillCheckbox>
              ))}
            </div>
            <Button variant="secondary">Save sources</Button>
          </form>
        </Card>
      </Section>

      <Section
        title="Resumes"
        desc="Upload the resumes you send out. Every job page can then compare one against the posting."
      >
        <Card>
          {resumes.length > 0 && (
            <ul class="mb-4 divide-y divide-line rounded-md border border-line">
              {resumes.map((r) => (
                <li class="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm">
                  <a
                    href={`/resumes/${r.id}`}
                    class="font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                  >
                    {r.name}
                  </a>
                  {r.isDefault && <Badge tone="ok">default</Badge>}
                  {!r.scannedAt && <Badge tone="warn">not scanned</Badge>}
                </li>
              ))}
            </ul>
          )}
          <ResumeUploadForm />
          <Hint class="mt-3">
            <a
              href="/resumes"
              class="font-medium text-accent-strong hover:text-accent-deep"
            >
              Manage resumes →
            </a>
          </Hint>
        </Card>
      </Section>

      <Section
        title="Discovery"
        desc="Finding new company boards automatically from HN threads."
      >
        <Card>
          <div class="space-y-5">
            <ToggleRow
              label="Auto-discovery"
              enabled={discoveryEnabled}
              action="/settings/discovery-toggle"
            >
              When the HN parser sees a Greenhouse / Lever / Ashby URL in a comment, the company
              lands on the Discovery page as a candidate. A weekly cron re-probes pending
              candidates so the job count stays fresh.
            </ToggleRow>
            <div class="border-t border-line pt-5">
              <ToggleRow
                label={'HN "Who is hiring" parser'}
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
                Monthly cron parses the latest "Ask HN: Who is hiring?" thread (300-500 comments)
                and runs the structured ones through the same filter → classify → alert pipeline.
                Many small startups only post there.
              </ToggleRow>
            </div>
          </div>
        </Card>
      </Section>

      <Section
        title="Application tracking"
        desc="The funnel board and the nudge that keeps it honest."
      >
        <Card>
          <div class="space-y-5">
            <ToggleRow
              label="Tracking"
              enabled={applicationTrackingEnabled}
              action="/settings/application-tracking-toggle"
            >
              Shows the tracking card on each job and the Applications funnel. Stored fields
              persist either way.
            </ToggleRow>
            <div class="border-t border-line pt-5">
              <ToggleRow
                label="Stale digest"
                enabled={staleApplicationsDigestEnabled}
                action="/settings/stale-digest-toggle"
              >
                Daily Telegram nudge for jobs stuck in "applied" with no recruiter contact for
                14+ days. Honours the Telegram master switch.
              </ToggleRow>
            </div>
          </div>
        </Card>
      </Section>

      <Section
        title="Notifications"
        desc="Telegram bots and chats that receive job alerts."
      >
        <Card>
          <ToggleRow
            label="Telegram alerts"
            enabled={telegramEnabled}
            action="/settings/telegram-toggle"
          >
            When off, nothing is sent regardless of targets. Jobs are still classified and
            stored.
          </ToggleRow>
        </Card>

        {targets.length === 0 ? (
          <Empty>No targets yet. Add one below to start receiving alerts.</Empty>
        ) : (
          <Card flush>
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
                  <Td class="whitespace-nowrap text-[13px] text-ink-faint">
                    {formatRelative(t.lastUsed)}
                  </Td>
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
          </Card>
        )}

        <Card>
          <div class="mb-3 text-[13px] font-medium text-ink">Add target</div>
          <form method="post" action="/settings/targets" class="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input type="text" name="name" required placeholder="My phone" />
            </Field>
            <Field label="Chat id">
              <Input type="text" name="chatId" required placeholder="-100…" mono />
            </Field>
            <Field label="Bot token" class="sm:col-span-2">
              <Input
                type="password"
                name="botToken"
                required
                autocomplete="off"
                placeholder="123456789:ABC…"
                mono
              />
            </Field>
            <div class="sm:col-span-2">
              <Button>Add target</Button>
            </div>
          </form>
          <Hint class="mt-3">
            The bot token is validated (getMe + sendMessage) before saving.
          </Hint>
        </Card>
      </Section>
    </div>
    <script dangerouslySetInnerHTML={{ __html: SETTINGS_JS }} />
  </Layout>
);

const ProfileEditor: FC<{
  profile: Profile;
  availableTargets: AvailableTarget[];
}> = ({ profile, availableTargets }) => (
  <form
    method="post"
    action={`/settings/profiles/${profile.id}/save`}
    class="space-y-5"
    data-dirty-watch
  >
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
      <legend class="text-[13px] font-medium text-ink">Seniority</legend>
      <div class="mt-2 flex flex-wrap gap-1.5">
        {SENIORITY_OPTIONS.map((s) => (
          <PillCheckbox name="seniority" value={s} checked={profile.seniority.includes(s)}>
            {s}
          </PillCheckbox>
        ))}
      </div>
    </fieldset>

    <fieldset class="space-y-3">
      <legend class="text-[13px] font-medium text-ink">Location</legend>
      <div class="mt-2 flex flex-wrap gap-x-6 gap-y-1.5">
        <PillCheckbox name="remoteOk" value="1" checked={profile.remoteOk}>
          Accept remote roles
        </PillCheckbox>
        <PillCheckbox name="hybridOk" value="1" checked={profile.hybridOk}>
          Hybrid OK
        </PillCheckbox>
      </div>
      <div>
        <Hint>Acceptable remote regions</Hint>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {REGION_OPTIONS.map((r) => (
            <PillCheckbox name="remoteRegions" value={r} checked={profile.remoteRegions.includes(r)}>
              {r}
            </PillCheckbox>
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

    <div class="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button size="lg">Save profile</Button>
      <Button size="lg" variant="violet" name="action" value="save-and-reclassify">
        Save &amp; re-classify
      </Button>
      <span data-dirty-indicator hidden class="text-[13px] font-medium text-warn">
        Unsaved changes
      </span>
    </div>
  </form>
);

/**
 * Newline-joined list in a textarea — the transport the backend already
 * parses. SETTINGS_JS upgrades it into a chip editor; without JS the plain
 * textarea still works.
 */
const TagListInput: FC<{
  label: string;
  hint: string;
  name: string;
  values: string[];
  rows?: number;
}> = ({ label, hint, name, values, rows = 3 }) => (
  <Field label={label} hint={hint}>
    <div data-chips data-label={label}>
      <Textarea name={name} rows={rows} mono>
        {values.join('\n')}
      </Textarea>
    </div>
  </Field>
);

const PriorityRulesEditor: FC<{ profile: Profile }> = ({ profile }) => {
  const rules = parsePriorityRules(profile.priorityRules);
  const text = formatPriorityRulesText(rules);
  return (
    <div>
      <label class="block text-[13px] font-medium text-ink" for="priorityRules">
        Priority rules (post-classifier overrides)
      </label>
      <Hint class="mt-0.5 max-w-prose">
        One rule per line: <Code>LABEL | techs,csv | regions,csv | MIN_FIT</Code>. If the title
        or description contains any tech and the location matches any region phrase, fit is
        clamped up to MIN_FIT and the location check passes. Empty regions match anywhere.{' '}
        <Code>#</Code> starts a comment. A bad line stops the save.
      </Hint>
      <Hint class="mt-1 max-w-prose text-warn">
        Region entries are phrases — every word must appear in the location.{' '}
        <Code>Remote US</Code> matches "Dallas (Remote US)" but not "Remote · Germany". Avoid a
        bare <Code>Remote</Code>; prefer <Code>Remote US,United States,USA,Worldwide</Code>.
      </Hint>
      <Textarea
        id="priorityRules"
        name="priorityRules"
        rows={Math.max(3, rules.length + 1)}
        placeholder="PHP remote-US | php | Remote US,United States,USA,Worldwide | 90"
        class="mt-1.5"
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

/**
 * Progressive enhancement only: chip editors write back into their hidden
 * textarea (newline-joined), so the POST body the routes parse is unchanged.
 */
const SETTINGS_JS = `
  (function () {
    function enhance(host) {
      var ta = host.querySelector('textarea');
      if (!ta) return;
      var box = document.createElement('div');
      box.className = 'flex min-h-[38px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised px-2 py-1.5 shadow-sm transition-colors duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15';
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'min-w-[8rem] flex-1 border-0 bg-transparent p-0.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-0';
      input.placeholder = 'Add and press Enter…';
      input.setAttribute('aria-label', (host.dataset.label || 'Tags') + ' — add item');

      function items() {
        return ta.value.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
      }
      function sync(list) {
        ta.value = list.join('\\n');
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        renderChips(list);
      }
      function renderChips(list) {
        box.querySelectorAll('[data-chip]').forEach(function (c) { c.remove(); });
        list.forEach(function (value, i) {
          var chip = document.createElement('span');
          chip.setAttribute('data-chip', '');
          chip.className = 'inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 text-[13px] text-ink ring-1 ring-inset ring-line';
          var text = document.createElement('span');
          text.textContent = value;
          var del = document.createElement('button');
          del.type = 'button';
          del.setAttribute('aria-label', 'Remove ' + value);
          del.className = 'grid h-4 w-4 cursor-pointer place-items-center rounded text-ink-faint hover:bg-line hover:text-ink';
          del.textContent = '\\u00d7';
          del.addEventListener('click', function () {
            var list = items(); list.splice(i, 1); sync(list); input.focus();
          });
          chip.appendChild(text);
          chip.appendChild(del);
          box.insertBefore(chip, input);
        });
      }
      function commit() {
        var v = input.value.trim();
        if (!v) return;
        var list = items();
        if (list.indexOf(v) === -1) list.push(v);
        input.value = '';
        sync(list);
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Backspace' && input.value === '') {
          var list = items();
          if (list.length) { list.pop(); sync(list); }
        }
      });
      input.addEventListener('blur', commit);
      input.addEventListener('paste', function (e) {
        var data = (e.clipboardData || window.clipboardData).getData('text');
        if (data && data.indexOf('\\n') !== -1) {
          e.preventDefault();
          var list = items();
          data.split('\\n').forEach(function (s) {
            var v = s.trim();
            if (v && list.indexOf(v) === -1) list.push(v);
          });
          sync(list);
        }
      });
      box.addEventListener('mousedown', function (e) {
        if (e.target === box) { e.preventDefault(); input.focus(); }
      });
      box.appendChild(input);
      ta.hidden = true;
      ta.setAttribute('aria-hidden', 'true');
      ta.tabIndex = -1;
      host.appendChild(box);
      renderChips(items());
    }
    document.querySelectorAll('[data-chips]').forEach(enhance);

    document.querySelectorAll('[data-dirty-watch]').forEach(function (form) {
      var indicator = form.querySelector('[data-dirty-indicator]');
      if (!indicator) return;
      function markDirty() { indicator.hidden = false; }
      form.addEventListener('input', markDirty);
      form.addEventListener('change', markDirty);
    });
  })();
`;
