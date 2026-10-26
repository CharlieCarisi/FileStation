// A writer barrier protects connector capacity, completion and deletion while
// independent part requests run together. Queued writers cannot be starved.
export class OperationGate {
  private pending: { shared: boolean; key: string; run: () => void }[] = [];
  private active = 0;
  private writer = false;
  private keys = new Set<string>();
  constructor(private limit = 3) {}
  run<T>(job: () => Promise<T>, shared = false, key = ""): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        shared,
        key,
        run: () => {
          this.active++;
          if (!shared) this.writer = true;
          if (key) this.keys.add(key);
          const finish = () => {
            this.active--;
            if (!shared) this.writer = false;
            if (key) this.keys.delete(key);
            this.drain();
          };
          Promise.resolve()
            .then(job)
            .then(
              (value) => {
                finish();
                resolve(value);
              },
              (error) => {
                finish();
                reject(error);
              },
            );
        },
      });
      this.drain();
    });
  }
  private drain() {
    while (!this.writer && this.pending.length && this.active < this.limit) {
      const next = this.pending[0];
      if (
        (!next.shared && this.active) ||
        (next.key && this.keys.has(next.key))
      )
        return;
      this.pending.shift()!.run();
    }
  }
}

export class RequestPool {
  private active = 0;
  private pending: (() => void)[] = [];
  constructor(private limit = 6) {}
  async run<T>(job: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", abort);
        this.active++;
        resolve();
      };
      const abort = () => {
        const index = this.pending.indexOf(start);
        if (index >= 0) this.pending.splice(index, 1);
        reject(signal.reason);
      };
      if (this.active < this.limit) start();
      else {
        this.pending.push(start);
        signal.addEventListener("abort", abort, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      return await job();
    } finally {
      this.active--;
      this.pending.shift()?.();
    }
  }
}

export async function parallel<T>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  job: (item: T, signal: AbortSignal) => Promise<void>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let cursor = 0,
    failure: unknown;
  try {
    await Promise.allSettled(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        try {
          while (cursor < items.length) {
            controller.signal.throwIfAborted();
            const item = items[cursor++];
            await job(item, controller.signal);
          }
        } catch (error) {
          if (!failure) failure = error;
          controller.abort(error);
        }
      }),
    );
    if (failure) throw failure;
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export const uploadConcurrency = (kind: string) =>
  kind === "onedrive" ? 1 : 3;
