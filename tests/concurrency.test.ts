import { expect, it, vi } from "vitest";
import { OperationGate, RequestPool, parallel } from "../shared/concurrency";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

it("overlaps independent parts, serializes duplicate parts, and gives completion/deletion an exclusive barrier", async () => {
  const gate = new OperationGate(3),
    blocked = deferred(),
    events: string[] = [];
  const parts = [1, 2, 3].map((part) =>
    gate.run(
      async () => {
        events.push(`start${part}`);
        await blocked.promise;
        events.push(`end${part}`);
      },
      true,
      `file:${part}`,
    ),
  );
  const finish = gate.run(async () => {
    events.push("complete");
  });
  const later = gate.run(
    async () => {
      events.push("later");
    },
    true,
    "other:1",
  );
  await vi.waitFor(() =>
    expect(events).toEqual(["start1", "start2", "start3"]),
  );
  blocked.resolve();
  await Promise.all([...parts, finish, later]);
  expect(events.slice(-2)).toEqual(["complete", "later"]);
  const first = deferred(),
    calls: number[] = [];
  const one = gate.run(
    async () => {
      calls.push(1);
      await first.promise;
    },
    true,
    "same:1",
  );
  const two = gate.run(
    async () => {
      calls.push(2);
    },
    true,
    "same:1",
  );
  await vi.waitFor(() => expect(calls).toEqual([1]));
  first.resolve();
  await Promise.all([one, two]);
  expect(calls).toEqual([1, 2]);
});
it("removes paused requests from the global queue without leaking a connection", async () => {
  const pool = new RequestPool(1),
    first = deferred(),
    controller = new AbortController();
  const active = pool.run(() => first.promise, new AbortController().signal);
  const queued = pool.run(async () => {
    throw Error("Paused job must not start");
  }, controller.signal);
  const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  first.resolve();
  await active;
  expect(await pool.run(async () => "next", new AbortController().signal)).toBe(
    "next",
  );
});
it("stops scheduling on failure and waits for sibling work to drain before returning", async () => {
  const drain = deferred(),
    started = deferred(),
    events: string[] = [];
  const result = parallel(
    [1, 2, 3, 4],
    2,
    new AbortController().signal,
    async (part, signal) => {
      events.push(`start${part}`);
      if (part === 1) {
        await started.promise;
        throw Error("failed chunk");
      }
      started.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      await drain.promise;
      events.push("drained");
    },
  );
  const rejected = expect(result).rejects.toThrow("failed chunk");
  await vi.waitFor(() => expect(events).toEqual(["start1", "start2"]));
  drain.resolve();
  await rejected;
  expect(events).toEqual(["start1", "start2", "drained"]);
});
