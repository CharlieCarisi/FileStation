import { test, expect } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
test.use({ actionTimeout: 10000 });

test("parallel transfers survive pause/reload, resume missing chunks, and assemble out-of-order downloads", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const bytes = randomBytes(24 * 1024 * 1024 + 37),
    name = `parallel-${Date.now()}.bin`;
  const path = info.outputPath(name);
  writeFileSync(path, bytes);
  const digest = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch(`/files/api${path}`, {
      method,
      ...(data ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const challenge = await api("/auth/request", { email: "c@bychx.com" });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  await page.goto("/files/");
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }
  const uploadThree = deferred(),
    uploadPause = deferred(),
    uploadStarted = new Set<number>(),
    resumedUpload: number[] = [];
  let uploadingAgain = false;
  await page.route("**/files/api/uploads/*/parts/*", async (route) => {
    const part = Number(route.request().url().split("/").pop());
    if (uploadingAgain) {
      resumedUpload.push(part);
      await route.continue();
      return;
    }
    uploadStarted.add(part);
    if (uploadStarted.size >= 3) uploadThree.resolve();
    if (part === 1) {
      await uploadThree.promise;
      const response = await route.fetch();
      await route.fulfill({ response });
    } else {
      await uploadPause.promise;
      await route.abort().catch(() => {});
    }
  });
  await page
    .getByRole("button", { name: /Upload/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Bring your files aboard" });
  await dialog.getByLabel("Choose files").setInputFiles(path);
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/files/api/uploads") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: /^Upload / }).click();
  const created = await (await creation).json();
  async function item(direction: string) {
    return page.evaluate(
      ({ name, direction }) =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("fs-transfers:"))
          .flatMap((key) => JSON.parse(localStorage.getItem(key) || "[]"))
          .find(
            (item: any) => item.name === name && item.direction === direction,
          ),
      { name, direction },
    );
  }
  await expect
    .poll(async () => (await item("upload"))?.done)
    .toBe(8 * 1024 * 1024);
  expect(uploadStarted.size).toBeGreaterThanOrEqual(3);
  await page.getByTestId("language-selector").selectOption("fr-CA");
  expect((await item("upload")).state).toBe("running");
  expect((await item("upload")).fileId).toBe(created.file.id);
  await page.getByTestId("language-selector").selectOption("en-CA");
  await page
    .getByRole("button", { name: `Pause ${name}`, exact: true })
    .click();
  uploadPause.resolve();
  await expect.poll(async () => (await item("upload"))?.state).toBe("paused");
  expect(
    (await api(`/uploads/${created.file.id}`, undefined, "GET")).parts.map(
      (part: any) => part.part_number,
    ),
  ).toEqual([1]);
  await page.reload();
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  uploadingAgain = true;
  const chooser = page.waitForEvent("filechooser");
  await page
    .locator(".transfer-card")
    .filter({ hasText: name })
    .getByRole("button", { name: "Select original file" })
    .click();
  await (await chooser).setFiles(path);
  await expect.poll(async () => (await item("upload"))?.state).toBe("complete");
  expect(resumedUpload.sort()).toEqual([2, 3, 4]);

  const downloadThree = deferred(),
    downloadPause = deferred(),
    rangeStarts = new Set<number>(),
    resumedRanges: number[] = [];
  let downloadingAgain = false,
    truncated = false;
  await page.route(
    `**/files/api/files/${created.file.id}/download`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const start = Number(
        route
          .request()
          .headers()
          .range.match(/bytes=(\d+)-/)![1],
      );
      if (downloadingAgain) {
        resumedRanges.push(start);
        if (start === 0 && !truncated) {
          truncated = true;
          const response = await route.fetch();
          await route.fulfill({
            response,
            body: Buffer.alloc(16),
            headers: { ...response.headers(), "content-length": "16" },
          });
        } else await route.continue();
        return;
      }
      rangeStarts.add(start);
      if (rangeStarts.size >= 3) downloadThree.resolve();
      if (start === 16 * 1024 * 1024) {
        await downloadThree.promise;
        const response = await route.fetch();
        await route.fulfill({ response });
      } else {
        await downloadPause.promise;
        await route.abort().catch(() => {});
      }
    },
  );
  await page.reload();
  await page
    .getByRole("button", { name: `Resumable download ${name}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  await expect
    .poll(async () => (await item("download"))?.done)
    .toBe(8 * 1024 * 1024);
  await page
    .getByRole("button", { name: `Pause ${name}`, exact: true })
    .click();
  downloadPause.resolve();
  const partial = await item("download");
  // The file is already 24 MiB long but only its third chunk is complete.
  expect(
    await page.evaluate(
      async (id) =>
        (
          await (
            await (await navigator.storage.getDirectory()).getFileHandle(id)
          ).getFile()
        ).size,
      partial.id,
    ),
  ).toBe(24 * 1024 * 1024);
  await page.reload();
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Parallel connections" })
    .selectOption("2");
  downloadingAgain = true;
  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: `Resume ${name}`, exact: true })
    .click();
  const downloaded = await saved;
  expect(digest(readFileSync((await downloaded.path())!))).toBe(digest(bytes));
  await expect
    .poll(async () => (await item("download"))?.state)
    .toBe("complete");
  expect((await item("download")).connections).toBe(2);
  expect(resumedRanges).not.toContain(16 * 1024 * 1024);
  expect(resumedRanges.filter((start) => start === 0)).toHaveLength(2);
  expect(resumedRanges).toContain(8 * 1024 * 1024);
  expect(resumedRanges).toContain(24 * 1024 * 1024);
  // Migrate a download paused by the old sequential engine without discarding
  // its confirmed contiguous prefix or treating a sparse file as complete.
  const completedDownload = await item("download"),
    legacyName = `legacy-${name}`;
  await page.evaluate(
    async ({ completed, legacyName }) => {
      const directory = await navigator.storage.getDirectory();
      const source = await (
        await directory.getFileHandle(completed.id)
      ).getFile();
      const legacy = {
        ...completed,
        id: crypto.randomUUID(),
        name: legacyName,
        state: "paused",
        done: 8 * 1024 * 1024,
      };
      delete legacy.downloadMapVersion;
      const target = await directory.getFileHandle(legacy.id, { create: true });
      const writer = await target.createWritable();
      await writer.write(source.slice(0, 8 * 1024 * 1024));
      await writer.close();
      const key = Object.keys(localStorage).find(
        (key) =>
          key.startsWith("fs-transfers:") &&
          JSON.parse(localStorage.getItem(key) || "[]").some(
            (item: any) => item.id === completed.id,
          ),
      )!;
      const items = JSON.parse(localStorage.getItem(key)!);
      items.unshift(legacy);
      localStorage.setItem(key, JSON.stringify(items));
    },
    { completed: completedDownload, legacyName },
  );
  resumedRanges.length = 0;
  await page.reload();
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  const legacySaved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: `Resume ${legacyName}`, exact: true })
    .click();
  expect(digest(readFileSync((await (await legacySaved).path())!))).toBe(
    digest(bytes),
  );
  expect(resumedRanges).not.toContain(0);
  expect(resumedRanges.sort((a, b) => a - b)).toEqual(
    [8, 16, 24].map((value) => value * 1024 * 1024),
  );
});
