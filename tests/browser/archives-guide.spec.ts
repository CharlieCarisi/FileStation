import { test, expect } from "@playwright/test";
import {
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js/index-native.js";
test.use({ actionTimeout: 10000 });

test("cancelling a ZIP during its upload reservation removes the transfer and local archive", async ({
  page,
}) => {
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.112" });
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/files/api" + path, {
      method,
      ...(data ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const challenge = await api("/auth/request", {
    email: `archive-cancel-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  await api("/folders", { name: "Cancelled" });
  await page.goto("/files/");
  let reserved = false,
    release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/files/api/uploads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    reserved = true;
    await responseGate;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Create ZIP of Cancelled", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create folder ZIP",
    exact: true,
  });
  await expect(dialog).toContainText("0 files");
  await dialog
    .getByRole("button", { name: "Create and save ZIP", exact: true })
    .click();
  await expect.poll(() => reserved).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  release();
  await expect
    .poll(async () => (await api("/files", undefined, "GET")).files.length)
    .toBe(0);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const directory = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("fs-archives");
        const keys: string[] = [];
        for await (const key of (directory as any).keys()) keys.push(key);
        return keys.length;
      }),
    )
    .toBe(0);
});

test("folder rows persist, a nested ZIP saves with exact contents and resumes after reload, and guests get an upload tutorial", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.110" });
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/files/api" + path, {
      method,
      ...(data !== undefined ? { data } : {}),
      headers: {
        Origin: "http://127.0.0.1:8791",
        ...(Buffer.isBuffer(data)
          ? { "Content-Type": "application/octet-stream" }
          : {}),
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const challenge = await api("/auth/request", {
    email: `archive-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  const root = (await api("/folders", { name: "Reports 合同" })).folder;
  const nested = (
    await api("/folders", { name: "Receipts", parentId: root.id })
  ).folder;
  await api("/folders", { name: "Empty", parentId: root.id });
  const large = Buffer.alloc(9 * 1024 * 1024 + 7, "Archive content 合同\n");
  const fixtures = [
    {
      name: "Large.txt",
      folder: root.id,
      bytes: large,
      path: "Reports 合同/Large.txt",
    },
    {
      name: "same.txt",
      folder: root.id,
      bytes: Buffer.from("first"),
      path: "Reports 合同/same.txt",
    },
    {
      name: "same.txt",
      folder: root.id,
      bytes: Buffer.from("second"),
      path: "Reports 合同/same (2).txt",
    },
    {
      name: "../escape.txt",
      folder: nested.id,
      bytes: Buffer.from("safe relative filename"),
      path: "Reports 合同/Receipts/.._escape.txt",
    },
  ];
  for (const fixture of fixtures) {
    const upload = await api("/uploads", {
      connectorId: "r2-default",
      folderId: fixture.folder,
      name: fixture.name,
      size: fixture.bytes.length,
      mime: "text/plain",
      fingerprint: "a".repeat(64),
    });
    for (
      let offset = 0;
      offset < fixture.bytes.length;
      offset += upload.partSize
    )
      await api(
        `/uploads/${upload.file.id}/parts/${offset / upload.partSize + 1}`,
        fixture.bytes.subarray(offset, offset + upload.partSize),
        "PUT",
      );
    await api(`/uploads/${upload.file.id}/complete`, {});
  }
  await page.goto("/files/");
  await expect(page.locator(".folder-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Folder list view", exact: true })
    .click();
  await expect(page.locator(".folder-card")).toHaveCount(0);
  await expect(page.locator(".files-table tbody .folder-row")).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Folder list view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("language-selector").selectOption("fr-CA");
  await expect(
    page.getByRole("button", {
      name: "Afficher les dossiers en liste",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("language-selector").selectOption("zh-CN");
  await expect(
    page.getByRole("button", { name: "文件夹列表视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("language-selector").selectOption("en-CA");
  await page
    .getByRole("button", { name: "Open folder Reports 合同", exact: true })
    .click();
  await expect(page.locator(".files-table tbody .folder-row")).toHaveCount(2);
  await expect(page.locator(".files-table tbody tr")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Go to root folder", exact: true })
    .click();
  // A pending upload in a nested folder must not block the ZIP or be included.
  const pending = (
    await api("/uploads", {
      connectorId: "r2-default",
      folderId: nested.id,
      name: "Pending.txt",
      size: 8,
      fingerprint: "b".repeat(64),
    })
  ).file;
  // Block archive transfer parts, then pause and reload. Its disk-backed source
  // must be restored without requiring a ZIP that exists on the user's desktop.
  let block = true;
  const ranges: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/download") && request.headers().range)
      ranges.push(request.headers().range);
  });
  await page.route("**/files/api/uploads/*/parts/*", (route) =>
    block ? route.abort("failed") : route.continue(),
  );
  await page
    .getByRole("button", { name: "Create ZIP of Reports 合同", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create folder ZIP",
    exact: true,
  });
  await expect(dialog).toContainText("4 files");
  await dialog
    .getByLabel("ZIP filename", { exact: true })
    .fill("Reports package.zip");
  await dialog
    .getByRole("button", { name: "Create and save ZIP", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await api(`/uploads/${pending.id}`, undefined, "GET")).file.state,
  ).toBe("uploading");
  expect(ranges).toContain("bytes=0-8388607");
  expect(ranges).toContain(`bytes=8388608-${large.length - 1}`);
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Pause Reports package.zip", exact: true })
    .click();
  await page.reload();
  block = false;
  await page
    .getByRole("button", { name: /^Transfers/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Resume Reports package.zip", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await api("/files", undefined, "GET")).files.some(
        (file: any) =>
          file.name === "Reports package.zip" && file.state === "ready",
      ),
    )
    .toBe(true);
  const saved = (await api("/files", undefined, "GET")).files.find(
    (file: any) => file.name === "Reports package.zip",
  );
  expect(saved.folder_id).toBeNull();
  const response = await page.request.get(
    `/files/api/files/${saved.id}/download`,
  );
  expect(response.ok()).toBe(true);
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await response.body())),
    { useWebWorkers: false },
  );
  const entries = await reader.getEntries();
  expect(entries.map((entry) => entry.filename).sort()).toEqual(
    [
      "Reports 合同/",
      "Reports 合同/Empty/",
      "Reports 合同/Receipts/",
      ...fixtures.map((fixture) => fixture.path),
    ].sort(),
  );
  for (const fixture of fixtures) {
    const entry = entries.find((entry) => entry.filename === fixture.path)!;
    if (!entry.directory)
      expect(Buffer.from(await entry.getData(new Uint8ArrayWriter()))).toEqual(
        fixture.bytes,
      );
  }
  await reader.close();
  // A source snapshot is an ordinary shareable file; originals remain present.
  expect(
    (await api(`/folders/${root.id}/archive`, undefined, "GET")).fileCount,
  ).toBe(4);
  const invitation = await api("/invitations", {
    kind: "submission",
    title: "Partner documents",
    connectorId: "r2-default",
    recipients: ["guest@example.com"],
    expiresDays: 7,
    maxFileBytes: 1000000,
    maxFiles: 10,
    sendEmail: false,
  });
  const guest = await browser.newContext({
    baseURL: "http://127.0.0.1:8791",
    extraHTTPHeaders: { "CF-Connecting-IP": "192.0.2.111" },
  });
  const recipient = await guest.newPage();
  recipient.on("pageerror", (error) => errors.push(error.message));
  await recipient.goto(`/files/#share=${invitation.code}`);
  await expect(
    recipient.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(1);
  await expect(
    recipient.getByRole("button", { name: "Sign in to upload", exact: true }),
  ).toHaveCount(0);
  await expect(
    recipient.getByText("No account needed", { exact: true }),
  ).toBeVisible();
  await recipient.getByText("How to upload files", { exact: true }).click();
  await expect(
    recipient.getByText("Choose your documents", { exact: true }),
  ).toBeVisible();
  await recipient.getByLabel("Your recipient email").fill("guest@example.com");
  await recipient
    .getByRole("button", { name: "Continue securely", exact: true })
    .click();
  await expect(
    recipient.locator('.access-steps [aria-current="step"]'),
  ).toContainText("Verify email");
  const pin = await recipient.locator(".development strong").innerText();
  await recipient
    .getByLabel("Email verification PIN", { exact: true })
    .fill(pin);
  await recipient
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  const portal = recipient.getByRole("dialog", {
    name: "Partner documents",
    exact: true,
  });
  await expect(portal).toContainText("You’re ready to upload");
  await expect(
    portal.getByText("How to upload files", { exact: true }),
  ).toBeVisible();
  await portal.locator('.submission-drop input[type="file"]').setInputFiles({
    name: "Partner.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("submitted without an account"),
  });
  await expect(portal.locator(".completion-badge").first()).toContainText(
    "Done",
  );
  await portal.getByRole("button", { name: "Close", exact: true }).click();
  await recipient.goto("/files/");
  await expect(
    recipient.getByRole("heading", {
      name: "Have an access code?",
      exact: true,
    }),
  ).toBeVisible();
  await recipient.screenshot({
    path: "test-results/guest-access-desktop.png",
    fullPage: true,
  });
  await recipient.setViewportSize({ width: 390, height: 844 });
  await expect(recipient.locator(".receive-card")).toBeInViewport();
  expect(
    await recipient.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await recipient.screenshot({
    path: "test-results/guest-upload-guide-mobile.png",
    fullPage: true,
  });
  await guest.close();
  expect(errors).toEqual([]);
});
