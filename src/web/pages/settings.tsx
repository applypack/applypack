/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { Profile } from '@prisma/client';
import { Layout } from '../layout';
import { Card, Empty, SectionTitle, Tag } from '../ui';
import { formatRelative } from '../format';

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
  targets: MaskedTarget[];
  profiles: ProfileListItem[];
  activeProfile: Profile | null;
  availableTargets: AvailableTarget[];
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
  targets,
  profiles,
  activeProfile,
  availableTargets,
  flash,
}) => (
  <Layout title="Settings" active="settings">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
      <p class="mt-1 text-sm text-zinc-500">
        Profiles, alerts, and Telegram targets — all live in the database, so
        you can edit them from this page without touching .env.
      </p>
    </div>

    {flash && (
      <div
        class={`mb-4 rounded-md px-4 py-2 text-sm ring-1 ring-inset ${
          flash.kind === 'ok'
            ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
            : 'bg-rose-500/10 text-rose-300 ring-rose-500/30'
        }`}
      >
        {flash.text}
      </div>
    )}

    <Card class="mb-6">
      <SectionTitle>Active profile</SectionTitle>
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <form method="post" action="/settings/profiles/activate" class="flex items-center gap-2">
          <select
            name="id"
            class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
          >
            {profiles.map((p) => (
              <option value={p.id} selected={p.active}>
                {p.name}
                {p.active ? '  (active)' : ''}
              </option>
            ))}
          </select>
          <button
            type="submit"
            class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Activate
          </button>
        </form>

        <form method="post" action="/settings/profiles/new">
          <button
            type="submit"
            class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            + New profile
          </button>
        </form>

        <form
          method="post"
          action="/settings/reclassify"
          onsubmit="return confirm('Re-classify all jobs (except APPLIED) against the active profile? This may take 2-5 minutes and consumes Anthropic API credit.');"
        >
          <button
            type="submit"
            class="rounded-md border border-violet-700 bg-violet-950/40 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-900/50"
          >
            Re-classify all jobs
          </button>
        </form>
      </div>
      {activeProfile ? (
        <ProfileEditor profile={activeProfile} availableTargets={availableTargets} />
      ) : (
        <Empty>No active profile. Pick one above or create a new one.</Empty>
      )}
    </Card>

    {profiles.length > 1 && (
      <Card class="mb-6">
        <SectionTitle>Other profiles</SectionTitle>
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th class="py-2 pr-4 font-medium">Name</th>
              <th class="py-2 pr-4 font-medium">Stack</th>
              <th class="py-2 pr-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-900">
            {profiles
              .filter((p) => !p.active)
              .map((p) => (
                <tr>
                  <td class="py-2.5 pr-4 font-medium text-zinc-100">{p.name}</td>
                  <td class="py-2.5 pr-4 text-xs text-zinc-400">{p.stackPreview}</td>
                  <td class="py-2.5 pr-2">
                    <div class="flex justify-end gap-2">
                      <form method="post" action="/settings/profiles/activate">
                        <input type="hidden" name="id" value={p.id} />
                        <button
                          type="submit"
                          class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                        >
                          Activate
                        </button>
                      </form>
                      <form
                        method="post"
                        action={`/settings/profiles/${p.id}/delete`}
                        onsubmit="return confirm('Delete this profile?');"
                      >
                        <button
                          type="submit"
                          class="rounded-md border border-rose-900 bg-rose-950/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900/50"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    )}

    <Card class="mb-6">
      <SectionTitle>Classifier mode</SectionTitle>
      <form method="post" action="/settings/classifier-mode" class="space-y-2">
        <label class="flex items-start gap-3 text-sm text-zinc-200">
          <input
            type="radio"
            name="mode"
            value="single"
            checked={classifierMode === 'single'}
            class="mt-1"
          />
          <span>
            <span class="font-medium">Single stage</span>
            <span class="block text-xs text-zinc-500">
              Every job goes straight to Claude Haiku 4.5. Highest precision, full cost.
            </span>
          </span>
        </label>
        <label class="flex items-start gap-3 text-sm text-zinc-200">
          <input
            type="radio"
            name="mode"
            value="two_stage"
            checked={classifierMode === 'two_stage'}
            class="mt-1"
          />
          <span>
            <span class="font-medium">Two stage (cheaper)</span>
            <span class="block text-xs text-zinc-500">
              Quick yes/no prefilter (short prompt, ~100-token output) gates the full
              classifier. When most fetched jobs are off-target, total Anthropic spend
              drops ~30-40% with marginal precision loss.
            </span>
          </span>
        </label>
        <div class="pt-2">
          <button
            type="submit"
            class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Save mode
          </button>
        </div>
      </form>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Job sources</SectionTitle>
      <p class="mb-3 text-xs text-zinc-500">
        Disable a whole source family with one click — useful when an
        aggregator is producing too much noise, or when you only want to
        hear about jobs from specific ATSes for a while. Per-company
        toggles still work too (see /companies).
      </p>
      <form method="post" action="/settings/sources" class="space-y-2">
        <div class="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {allSources.map((s) => (
            <label class="inline-flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                name="enabled"
                value={s}
                checked={!disabledSources.includes(s)}
                class="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
              />
              <span class="font-mono text-xs">{s}</span>
            </label>
          ))}
        </div>
        <button
          type="submit"
          class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Save sources
        </button>
      </form>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Auto-discovery</SectionTitle>
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm text-zinc-300">
            Status:{' '}
            {discoveryEnabled ? (
              <Tag tone="green">Enabled</Tag>
            ) : (
              <Tag tone="zinc">Disabled</Tag>
            )}
          </div>
          <p class="mt-1 text-xs text-zinc-500">
            When the HN parser sees a Greenhouse / Lever / Ashby URL in a
            comment, record the company as a candidate on /discovery for
            review. A weekly cron re-probes pending candidates so the
            jobsSeen count stays fresh.
          </p>
        </div>
        <form method="post" action="/settings/discovery-toggle">
          <button
            type="submit"
            class={`rounded-md px-4 py-2 text-sm font-medium text-white ${
              discoveryEnabled
                ? 'bg-zinc-700 hover:bg-zinc-600'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {discoveryEnabled ? 'Disable' : 'Enable'}
          </button>
        </form>
      </div>
    </Card>

    <Card class="mb-6">
      <SectionTitle>HN "Who is Hiring" parser</SectionTitle>
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm text-zinc-300">
            Status:{' '}
            {hnParserEnabled ? (
              <Tag tone="green">Enabled</Tag>
            ) : (
              <Tag tone="zinc">Disabled</Tag>
            )}
          </div>
          <p class="mt-1 text-xs text-zinc-500">
            Monthly cron parses the latest "Ask HN: Who is hiring?" thread
            (~300-500 comments) and runs the structured ones through the
            same filter + classify + alert pipeline. Many small startups
            post here that don't show up on ATS feeds.
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <form method="post" action="/settings/hn-parser-toggle">
            <button
              type="submit"
              class={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                hnParserEnabled
                  ? 'bg-zinc-700 hover:bg-zinc-600'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {hnParserEnabled ? 'Disable' : 'Enable'}
            </button>
          </form>
          <form
            method="post"
            action="/settings/hn-run"
            onsubmit="return confirm('Pull the latest HN Who-is-hiring thread now? This may take 1-2 minutes and consumes Anthropic credit.');"
          >
            <button
              type="submit"
              disabled={!hnParserEnabled}
              class="rounded-md border border-violet-700 bg-violet-950/40 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-900/50 disabled:opacity-40 disabled:hover:bg-violet-950/40"
            >
              Run now
            </button>
          </form>
        </div>
      </div>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Application tracking</SectionTitle>
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-sm text-zinc-300">
              Status:{' '}
              {applicationTrackingEnabled ? (
                <Tag tone="green">Enabled</Tag>
              ) : (
                <Tag tone="zinc">Disabled</Tag>
              )}
            </div>
            <p class="mt-1 text-xs text-zinc-500">
              Surfaces a per-job tracking card on /jobs/:id and the Applications kanban.
              Stored fields persist whether enabled or not.
            </p>
          </div>
          <form method="post" action="/settings/application-tracking-toggle">
            <button
              type="submit"
              class={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                applicationTrackingEnabled
                  ? 'bg-zinc-700 hover:bg-zinc-600'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {applicationTrackingEnabled ? 'Disable' : 'Enable'}
            </button>
          </form>
        </div>
        <div class="flex items-center justify-between gap-4 border-t border-zinc-800 pt-3">
          <div>
            <div class="text-sm text-zinc-300">
              Stale-applications digest:{' '}
              {staleApplicationsDigestEnabled ? (
                <Tag tone="green">Enabled</Tag>
              ) : (
                <Tag tone="zinc">Disabled</Tag>
              )}
            </div>
            <p class="mt-1 text-xs text-zinc-500">
              Daily Telegram nudge for jobs in pipelineStage=applied with no recruiter
              contact for 14+ days. Honours Telegram's master switch above.
            </p>
          </div>
          <form method="post" action="/settings/stale-digest-toggle">
            <button
              type="submit"
              class={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                staleApplicationsDigestEnabled
                  ? 'bg-zinc-700 hover:bg-zinc-600'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {staleApplicationsDigestEnabled ? 'Disable' : 'Enable'}
            </button>
          </form>
        </div>
      </div>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Telegram alerts</SectionTitle>
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm text-zinc-300">
            Status:{' '}
            {telegramEnabled ? (
              <Tag tone="green">Enabled</Tag>
            ) : (
              <Tag tone="zinc">Disabled</Tag>
            )}
          </div>
          <p class="mt-1 text-xs text-zinc-500">
            When disabled, no Telegram messages are sent regardless of
            configured targets. Cron jobs still classify and store as usual.
          </p>
        </div>
        <form method="post" action="/settings/telegram-toggle">
          <button
            type="submit"
            class={`rounded-md px-4 py-2 text-sm font-medium text-white ${
              telegramEnabled
                ? 'bg-zinc-700 hover:bg-zinc-600'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {telegramEnabled ? 'Disable' : 'Enable'}
          </button>
        </form>
      </div>
    </Card>

    <Card class="mb-6">
      <SectionTitle>Targets</SectionTitle>
      {targets.length === 0 ? (
        <Empty>No targets configured. Add one below to start receiving alerts.</Empty>
      ) : (
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th class="py-2 pr-4 font-medium">Name</th>
              <th class="py-2 pr-4 font-medium">Bot token</th>
              <th class="py-2 pr-4 font-medium">Chat id</th>
              <th class="py-2 pr-4 font-medium">Last used</th>
              <th class="py-2 pr-4 font-medium">Active</th>
              <th class="py-2 pr-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-900">
            {targets.map((t) => (
              <tr class="align-middle">
                <td class="py-2.5 pr-4 font-medium text-zinc-100">{t.name}</td>
                <td class="py-2.5 pr-4 font-mono text-xs text-zinc-400">{t.maskedToken}</td>
                <td class="py-2.5 pr-4 font-mono text-xs text-zinc-400">{t.chatId}</td>
                <td class="py-2.5 pr-4 text-xs text-zinc-500">{formatRelative(t.lastUsed)}</td>
                <td class="py-2.5 pr-4">
                  <form method="post" action={`/settings/targets/${t.id}/toggle`}>
                    <button
                      type="submit"
                      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        t.active
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/25'
                          : 'bg-zinc-700/30 text-zinc-400 ring-zinc-700/50 hover:bg-zinc-700/50'
                      }`}
                    >
                      {t.active ? 'Active' : 'Disabled'}
                    </button>
                  </form>
                </td>
                <td class="py-2.5 pr-2">
                  <div class="flex justify-end gap-2">
                    <form method="post" action={`/settings/targets/${t.id}/test`}>
                      <button
                        type="submit"
                        class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        Test
                      </button>
                    </form>
                    <form
                      method="post"
                      action={`/settings/targets/${t.id}/delete`}
                      onsubmit="return confirm('Delete this target?');"
                    >
                      <button
                        type="submit"
                        class="rounded-md border border-rose-900 bg-rose-950/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900/50"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>

    <Card>
      <SectionTitle>Add target</SectionTitle>
      <form method="post" action="/settings/targets" class="grid gap-3 sm:grid-cols-12">
        <div class="sm:col-span-3">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">Name</label>
          <input
            type="text"
            name="name"
            required
            placeholder="My phone"
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="sm:col-span-5">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">Bot token</label>
          <input
            type="password"
            name="botToken"
            required
            autocomplete="off"
            placeholder="123456789:ABC..."
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="sm:col-span-3">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">Chat id</label>
          <input
            type="text"
            name="chatId"
            required
            placeholder="-100..."
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="flex items-end sm:col-span-1">
          <button
            type="submit"
            class="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Add
          </button>
        </div>
      </form>
      <p class="mt-3 text-xs text-zinc-500">
        Adding a target validates the bot token (getMe + sendMessage). On
        failure the target is not saved.
      </p>
    </Card>
  </Layout>
);

const ProfileEditor: FC<{
  profile: Profile;
  availableTargets: AvailableTarget[];
}> = ({ profile, availableTargets }) => (
  <form method="post" action={`/settings/profiles/${profile.id}/save`} class="space-y-4">
    <div>
      <label class="block text-xs uppercase tracking-wider text-zinc-500">Name</label>
      <input
        type="text"
        name="name"
        required
        value={profile.name}
        class="mt-1 w-full max-w-md rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
    </div>

    <TagListInput
      label="Stack — required (must appear in title)"
      hint="One per line, or comma-separated. Case-insensitive substring match."
      name="stackRequired"
      values={profile.stackRequired}
    />
    <TagListInput
      label="Stack — nice to have (boosts fit_score)"
      hint="Tags Claude rewards if they show up in the description."
      name="stackNiceToHave"
      values={profile.stackNiceToHave}
    />
    <TagListInput
      label="Stack — exclude (auto-reject in title)"
      hint="If the title contains any of these, the role is dropped before Claude is even called."
      name="stackExclude"
      values={profile.stackExclude}
    />

    <div>
      <label class="block text-xs uppercase tracking-wider text-zinc-500">
        Notes for Claude (free-form context)
      </label>
      <p class="mt-1 text-xs text-zinc-500">
        Anything that helps Claude judge fit — e.g. "AI-adjacent roles preferred",
        "open to first-time-manager positions", "prefer EU-friendly time zones".
      </p>
      <textarea
        name="notes"
        rows={3}
        class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      >{profile.notes ?? ''}</textarea>
    </div>

    <div>
      <label class="block text-xs uppercase tracking-wider text-zinc-500">Seniority</label>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {SENIORITY_OPTIONS.map((s) => (
          <label class="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              name="seniority"
              value={s}
              checked={profile.seniority.includes(s)}
              class="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
            />
            {s}
          </label>
        ))}
      </div>
    </div>

    <div>
      <label class="block text-xs uppercase tracking-wider text-zinc-500">Location</label>
      <div class="mt-2 space-y-2">
        <label class="inline-flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            name="remoteOk"
            value="1"
            checked={profile.remoteOk}
            class="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
          />
          Accept remote roles
        </label>

        <div>
          <span class="text-xs text-zinc-500">Acceptable remote regions:</span>
          <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {REGION_OPTIONS.map((r) => (
              <label class="inline-flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  name="remoteRegions"
                  value={r}
                  checked={profile.remoteRegions.includes(r)}
                  class="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
                />
                {r}
              </label>
            ))}
          </div>
        </div>

        <label class="inline-flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            name="hybridOk"
            value="1"
            checked={profile.hybridOk}
            class="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
          />
          Hybrid OK
        </label>

        <TagListInput
          label="On-site cities (OK to commute)"
          hint='One per line. Free-form, e.g. "Austin, TX" or "Berlin".'
          name="onsiteCities"
          values={profile.onsiteCities}
          rows={2}
        />
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <div>
        <label class="block text-xs uppercase tracking-wider text-zinc-500">
          Min salary (USD/year)
        </label>
        <input
          type="number"
          name="minSalaryUsd"
          min="0"
          step="1000"
          value={profile.minSalaryUsd}
          class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
        <p class="mt-1 text-xs text-zinc-500">0 = no salary filter.</p>
      </div>
      <div>
        <label class="block text-xs uppercase tracking-wider text-zinc-500">
          Min fit score (0-100)
        </label>
        <input
          type="number"
          name="minFitScore"
          min="0"
          max="100"
          value={profile.minFitScore}
          class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      </div>
      <div>
        <label class="block text-xs uppercase tracking-wider text-zinc-500">
          Telegram target
        </label>
        <select
          name="telegramTargetId"
          class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="" selected={profile.telegramTargetId === null}>
            (broadcast to all active)
          </option>
          {availableTargets.map((t) => (
            <option value={t.id} selected={profile.telegramTargetId === t.id}>
              {t.name}
              {t.active ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 pt-2">
      <button
        type="submit"
        class="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
      >
        Save
      </button>
      <button
        type="submit"
        name="action"
        value="save-and-reclassify"
        class="rounded-md border border-violet-700 bg-violet-950/40 px-4 py-2 text-sm text-violet-200 hover:bg-violet-900/50"
      >
        Save &amp; re-classify
      </button>
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
  <div>
    <label class="block text-xs uppercase tracking-wider text-zinc-500">{label}</label>
    <p class="mt-1 text-xs text-zinc-500">{hint}</p>
    <textarea
      name={name}
      rows={rows}
      class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
    >{values.join('\n')}</textarea>
  </div>
);
