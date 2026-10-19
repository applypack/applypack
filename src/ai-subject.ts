import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * The application pack a run of AI calls is made for (ADR 0063, #487): set
 * once around a pack's preparation, read by the runtime when it writes each
 * call's ledger row. Ambient rather than passed, as the language of a run is
 * (i18n/locale.ts): a pack reaches the AI through the brief, the comparison,
 * the company check and the letter, and through what those call in turn —
 * the suggestion floor, a refused summary written again. A call none of them
 * was told about would cost the pack nothing on AI usage.
 */

const pack = new AsyncLocalStorage<number>();

/** Run `work` with every AI call inside it filed under this pack. */
export function forPack<T>(packId: number, work: () => Promise<T>): Promise<T> {
  return pack.run(packId, work);
}

/** The pack the current call is made for, or undefined outside one. */
export function currentPack(): number | undefined {
  return pack.getStore();
}
