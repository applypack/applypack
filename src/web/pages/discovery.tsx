/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CompanyCandidate } from '@prisma/client';
import { Layout } from '../layout';
import { Card, Empty, SectionTitle, Tag } from '../ui';
import { formatRelative } from '../format';

export interface DiscoveryProps {
  discoveryEnabled: boolean;
  pending: CompanyCandidate[];
  promoted: CompanyCandidate[];
  ignored: CompanyCandidate[];
  dead: CompanyCandidate[];
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

export const DiscoveryPage: FC<DiscoveryProps> = ({
  discoveryEnabled,
  pending,
  promoted,
  ignored,
  dead,
  flash,
}) => (
  <Layout title="Discovery" active="discovery">
    <div class="mb-6 flex items-baseline justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Discovery</h1>
      <span class="text-xs text-zinc-500">
        {discoveryEnabled ? 'Auto-discovery: ON' : 'Auto-discovery: OFF (toggle in /settings)'}
      </span>
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
      <SectionTitle>Pending review ({pending.length})</SectionTitle>
      <p class="mb-3 text-xs text-zinc-500">
        Companies the discovery pipeline found but haven't been promoted yet.
        Promote a candidate to start fetching its jobs on the next cron tick.
        Sorted by jobs currently visible (highest first).
      </p>
      {pending.length === 0 ? (
        <Empty>
          No candidates yet. Enable HN parser + discovery in /settings, then
          run the HN once-job to seed candidates from the latest thread.
        </Empty>
      ) : (
        <CandidateTable rows={pending} actions />
      )}
    </Card>

    {promoted.length > 0 && (
      <Card class="mb-6">
        <SectionTitle>Promoted ({promoted.length})</SectionTitle>
        <CandidateTable rows={promoted} />
      </Card>
    )}

    {ignored.length > 0 && (
      <Card class="mb-6">
        <SectionTitle>Ignored ({ignored.length})</SectionTitle>
        <CandidateTable rows={ignored} actions />
      </Card>
    )}

    {dead.length > 0 && (
      <Card class="mb-6">
        <SectionTitle>Dead ({dead.length})</SectionTitle>
        <CandidateTable rows={dead} />
      </Card>
    )}
  </Layout>
);

const CandidateTable: FC<{ rows: CompanyCandidate[]; actions?: boolean }> = ({
  rows,
  actions,
}) => (
  <div class="overflow-hidden rounded border border-zinc-800">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs uppercase tracking-wider text-zinc-500">
          <th class="px-3 py-2 font-medium">Name / token</th>
          <th class="px-3 py-2 font-medium">ATS</th>
          <th class="px-3 py-2 font-medium">Source</th>
          <th class="px-3 py-2 font-medium">Jobs</th>
          <th class="px-3 py-2 font-medium">Discovered</th>
          {actions && <th class="px-3 py-2 font-medium text-right">Actions</th>}
        </tr>
      </thead>
      <tbody class="divide-y divide-zinc-900">
        {rows.map((c) => (
          <tr class="hover:bg-zinc-900/30 align-middle">
            <td class="px-3 py-2">
              <div class="text-zinc-100">{c.name ?? c.atsToken}</div>
              <div class="font-mono text-xs text-zinc-500">{c.atsToken}</div>
              {c.signal && (
                <div class="mt-0.5 text-xs italic text-zinc-600">{c.signal}</div>
              )}
            </td>
            <td class="px-3 py-2">
              <Tag>{c.atsType}</Tag>
            </td>
            <td class="px-3 py-2 text-xs text-zinc-400">
              {c.sourceUrl ? (
                <a
                  href={c.sourceUrl}
                  target="_blank"
                  rel="noopener"
                  class="hover:text-emerald-400"
                  title={c.source}
                >
                  {c.source}
                </a>
              ) : (
                c.source
              )}
            </td>
            <td class="px-3 py-2 tabular-nums text-zinc-300">{c.jobsSeen}</td>
            <td class="px-3 py-2 text-xs text-zinc-500">
              {formatRelative(c.discoveredAt)}
            </td>
            {actions && (
              <td class="px-3 py-2">
                <div class="flex justify-end gap-2">
                  <form method="post" action={`/discovery/${c.id}/promote`}>
                    <button
                      type="submit"
                      class="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      Promote
                    </button>
                  </form>
                  <form method="post" action={`/discovery/${c.id}/ignore`}>
                    <button
                      type="submit"
                      class="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      Ignore
                    </button>
                  </form>
                  <form
                    method="post"
                    action={`/discovery/${c.id}/delete`}
                    onsubmit="return confirm('Delete this candidate permanently?');"
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
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
