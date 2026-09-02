import { randomUUID } from 'node:crypto';

/*
 * A parsed re-upload waits here between the POST and the page that shows it
 * as a draft (instant-check.ts). Same shape as target-runs.ts: web-process
 * memory with a TTL, nothing persisted. Each draft is taken once — the page
 * copies it into localStorage on first render, so a reload must not bring
 * the uploaded text back over the edits made since.
 */

export interface StashedDraft {
  matchId: number;
  text: string;
}

const DRAFT_TTL_MS = 10 * 60_000;

export function createDraftStash(now: () => number = Date.now) {
  const drafts = new Map<string, StashedDraft & { at: number }>();
  return {
    put(draft: StashedDraft): string {
      const cutoff = now() - DRAFT_TTL_MS;
      for (const [id, d] of drafts) if (d.at < cutoff) drafts.delete(id);
      const id = randomUUID();
      drafts.set(id, { ...draft, at: now() });
      return id;
    },
    take(id: string): StashedDraft | null {
      const d = drafts.get(id);
      if (!d) return null;
      drafts.delete(id);
      return now() - d.at > DRAFT_TTL_MS ? null : { matchId: d.matchId, text: d.text };
    },
  };
}

export const draftStash = createDraftStash();
