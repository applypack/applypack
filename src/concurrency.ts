/**
 * Minimal concurrency limiter: `limit(fn)` runs `fn` as soon as fewer than
 * `max` tasks are in flight, otherwise queues it. Tasks start in call order.
 */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`createLimiter: max must be a positive integer, got ${max}`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    active--;
    queue.shift()?.();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        // `new Promise` turns a synchronous throw in fn into a rejection.
        new Promise<T>((r) => r(fn())).then(resolve, reject).finally(next);
      };
      if (active < max) run();
      else queue.push(run);
    });
}
