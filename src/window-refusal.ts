import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * A prompt the local engine refused as too large for its context window
 * (ADR 0057), told to the work it was made for (#523): a run on the progress
 * page listens, and its failed state links to the setting that fixes it.
 * Ambient, as ai-subject.ts is: the refusal happens calls deep — the brief,
 * the comparison, the suggestion floor — and only the run knows the page.
 */

const listener = new AsyncLocalStorage<() => void>();

/** Runs `work`, calling `heard` for each prompt the local engine refuses inside it. */
export function onWindowRefusal<T>(heard: () => void, work: () => Promise<T>): Promise<T> {
  return listener.run(heard, work);
}

/** The local engine refused a prompt as too large; nobody listening, nothing happens. */
export function windowRefused(): void {
  listener.getStore()?.();
}
