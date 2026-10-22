import { env, applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, afterEach, inject, vi } from "vitest";
beforeEach(async () => {
  await applyD1Migrations((env as any).DB, inject("migrations") as any);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw Error("Unexpected outbound request in test.");
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
