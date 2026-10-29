/*
 * A reading that takes long and changes seldom, kept per key (#649: the AI
 * engine probe spawns four CLIs and takes over half a second). Younger than
 * `ttlMs`, the kept reading answers. Older, a caller that can live with it
 * gets it at once and a new reading is taken behind it; a caller that asks
 * for a fresh one waits for it, as does anyone with nothing kept. One reading
 * per key at a time, shared by whoever asks meanwhile. `forget` drops every
 * reading, and one that began before it is not kept. Pure apart from the read
 * each caller hands in.
 */

interface Kept<V> {
  at: number;
  value: V;
}

export interface RefreshingCache<K, V> {
  get(key: K, read: () => Promise<V>, opts?: { fresh?: boolean }): Promise<V>;
  forget(): void;
}

export function refreshingCache<K, V>(ttlMs: number, now: () => number = Date.now): RefreshingCache<K, V> {
  const kept = new Map<K, Kept<V>>();
  const reading = new Map<K, Promise<V>>();
  let generation = 0;

  const readNow = (key: K, read: () => Promise<V>): Promise<V> => {
    const running = reading.get(key);
    if (running) return running;
    const started = generation;
    const next = read().then((value) => {
      if (started === generation) kept.set(key, { at: now(), value });
      return value;
    });
    const settled = next.finally(() => {
      if (reading.get(key) === settled) reading.delete(key);
    });
    reading.set(key, settled);
    return settled;
  };

  return {
    async get(key, read, opts = {}) {
      const last = kept.get(key);
      if (last && now() - last.at < ttlMs) return last.value;
      if (last && !opts.fresh) {
        // Behind the answer: a failed reading keeps the last one, and nobody waits on it.
        readNow(key, read).catch(() => undefined);
        return last.value;
      }
      return readNow(key, read);
    },
    forget() {
      generation += 1;
      kept.clear();
      reading.clear();
    },
  };
}
