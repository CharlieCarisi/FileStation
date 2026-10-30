import { test, expect } from "@playwright/test";
import {
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js/index-native.js";
test.use({ actionTimeout: 10000 });

test("large ZIP mode bypasses browser disk quota and resumes after reload without repeating accepted parts or source ranges", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.160" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      value: async () => ({ quota: 1, usage: 0 }),
      configurable: true,
    });
    Object.defineProperty(navigator.storage, "getDirectory", {
      value: async () => {
        throw Error("Streaming ZIP must not access browser disk storage.");
      },
      configurable: true,
    });
  });
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/files/api" + path, {
      method,
      ...(data !== undefined ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const login = await api("/auth/request", {
    email: `streaming-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: login.challengeId,
    pin: login.developmentPin,
  });
  const folder = (
    await api("/folders", { name: "Videos 合同", space: "public" })
  ).folder;
  const nested = (
    await api("/folders", {
      name: "Footage",
      parentId: folder.id,
      space: "public",
    })
  ).folder;
  const bytes = Buffer.alloc(9 * 1024 * 1024 + 17);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = (index * 37 + (index % 19)) & 255;
  const original = await api("/uploads", {
    connectorId: "r2-default",
    folderId: nested.id,
    space: "public",
    name: "Video.mp4",
    size: bytes.length,
    fingerprint: "a".repeat(64),
  });
  for (let start = 0; start < bytes.length; start += original.partSize)
    await api(
      `/uploads/${original.file.id}/parts/${start / original.partSize + 1}`,
      bytes.subarray(start, start + original.partSize),
      "PUT",
    );
  await api(`/uploads/${original.file.id}/complete`, {});
  const pending = (
    await api("/uploads", {
      connectorId: "r2-default",
      folderId: nested.id,
      space: "public",
      name: "Pending.mp4",
      size: 8,
      fingerprint: "b".repeat(64),
    })
  ).file;
  await page.goto("/files/?space=public");
  await page
    .getByRole("button", { name: "Create ZIP of Videos 合同", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("ZIP method", { exact: true })).toHaveValue(
    "stream",
  );
  await dialog
    .getByLabel("ZIP method", { exact: true })
    .selectOption("compress");
  await dialog
    .getByRole("button", { name: "Create and save ZIP", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Choose Stream to storage",
  );
  await page.getByTestId("language-selector").selectOption("zh-CN");
  await expect(
    dialog.getByLabel("ZIP 创建方式", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("请选择流式保存到存储");
  await page.getByTestId("language-selector").selectOption("fr-CA");
  await expect(
    dialog.getByLabel("Méthode de création du ZIP", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("language-selector").selectOption("en-CA");
  await dialog.getByLabel("ZIP method", { exact: true }).selectOption("stream");
  await dialog.getByLabel("ZIP filename", { exact: true }).fill("Streamed.zip");
  let block = true;
  await page.route("**/files/api/uploads/*/parts/2", (route) =>
    block ? route.abort("failed") : route.continue(),
  );
  await dialog
    .getByRole("button", { name: "Create and save ZIP", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  let archiveId = "";
  await expect
    .poll(async () => {
      const files = (await api("/files?space=public", undefined, "GET")).files;
      archiveId =
        files.find((file: any) => file.name === "Streamed.zip")?.id || "";
      if (!archiveId) return false;
      return (await api(`/uploads/${archiveId}`, undefined, "GET")).parts.some(
        (part: any) => part.part_number === 1,
      );
    })
    .toBe(true);
  await page
    .getByRole("button", { name: "Pause Streamed.zip", exact: true })
    .click();
  const before = await api(`/uploads/${archiveId}`, undefined, "GET");
  expect(before.parts.map((part: any) => part.part_number)).toEqual([1]);
  await page.reload();
  block = false;
  const ranges: string[] = [],
    parts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(`/files/${original.file.id}/download`))
      ranges.push(request.headers().range);
    if (request.url().includes(`/uploads/${archiveId}/parts/`))
      parts.push(request.url());
  });
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Select original file", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Resume Streamed.zip", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await api(`/uploads/${archiveId}`, undefined, "GET")).file.state,
    )
    .toBe("ready");
  expect(parts.every((path) => !path.endsWith("/parts/1"))).toBe(true);
  expect(ranges.length).toBeGreaterThan(0);
  expect(ranges.every((range) => !range.startsWith("bytes=0-"))).toBe(true);
  const response = await page.request.get(
    `/files/api/files/${archiveId}/download`,
  );
  expect(response.ok()).toBe(true);
  const archive = await response.body();
  expect(archive.length).toBeGreaterThan(bytes.length);
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(archive)), {
    useWebWorkers: false,
    checkSignature: true,
  });
  const entries = await reader.getEntries();
  expect(entries.map((entry) => entry.filename)).toEqual([
    "Videos 合同/",
    "Videos 合同/Footage/",
    "Videos 合同/Footage/Video.mp4",
  ]);
  const video = entries[2];
  if (video.directory) throw Error("Expected the original video file.");
  expect(video.compressionMethod).toBe(0);
  expect(Buffer.from(await video.getData(new Uint8ArrayWriter()))).toEqual(
    bytes,
  );
  await reader.close();
  expect(
    (await api(`/uploads/${pending.id}`, undefined, "GET")).file.state,
  ).toBe("uploading");
  expect(
    (await api(`/uploads/${original.file.id}`, undefined, "GET")).file.state,
  ).toBe("ready");
  const saved = (await api("/files?space=public", undefined, "GET")).files.find(
    (file: any) => file.id === archiveId,
  );
  expect(saved.space).toBe("public");
  expect(saved.folder_id).toBeNull();
  await expect(
    page.getByRole("article", { name: "Streamed.zip", exact: true }),
  ).toHaveClass(/is-complete/);
  await page.screenshot({ path: "test-results/streamed-zip-complete.png" });
  expect(errors).toEqual([]);
});

test("streamed ZIP reservations can be cancelled and large-folder mode is selected without accessing browser storage", async ({
  page,
}) => {
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.161" });
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/api" + path, {
      method,
      ...(data !== undefined ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const login = await api("/auth/request", {
    email: `stream-cancel-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: login.challengeId,
    pin: login.developmentPin,
  });
  const folder = (await api("/folders", { name: "Large" })).folder;
  // A 10 GiB manifest selects streaming based on size even with a large quota.
  await page.route(`**/api/folders/${folder.id}/archive`, async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.totalSize = 10 * 1024 ** 3;
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create ZIP of Large", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create folder ZIP",
    exact: true,
  });
  await expect(dialog.getByLabel("ZIP method", { exact: true })).toHaveValue(
    "stream",
  );
  let reserved = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/uploads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    reserved = true;
    await gate;
    await route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "Create and save ZIP", exact: true })
    .click();
  await expect.poll(() => reserved).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await api("/files", undefined, "GET")).files.length)
    .toBe(0);
});
