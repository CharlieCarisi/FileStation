import { test, expect } from "@playwright/test";
test.use({ actionTimeout: 10000 });

test("browse folders, upload inside a subfolder, move a selection to root and reorganize folders in three languages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
    email: `folders-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  await page.goto("/files/");
  async function create(name: string) {
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "New folder",
      exact: true,
    });
    await dialog.getByLabel("Folder name", { exact: true }).fill(name);
    await dialog
      .getByRole("button", { name: "Save folder", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  }
  await create("Projects");
  await page
    .getByRole("button", { name: "Open folder Projects", exact: true })
    .click();
  await create("Contracts 合同");
  await page
    .getByRole("button", { name: "Open folder Contracts 合同", exact: true })
    .click();
  const folderURL = page.url();
  expect(folderURL).toContain("?folder=");
  await page.getByRole("button", { name: "Upload files", exact: true }).click();
  const upload = page.getByRole("dialog", { name: "Bring your files aboard" });
  await expect(upload.getByLabel("Destination folder")).toHaveValue(
    new URL(folderURL).searchParams.get("folder")!,
  );
  await upload.getByLabel("Choose files").setInputFiles([
    {
      name: "Contract.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Contract content"),
    },
    {
      name: "Schedule.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Schedule content"),
    },
  ]);
  await upload.getByRole("button", { name: /^Upload / }).click();
  await expect
    .poll(async () => {
      const rows = (await api("/files", undefined, "GET")).files;
      return rows.filter((file: any) => file.state === "ready").length;
    })
    .toBe(2);
  await page
    .getByRole("button", { name: "Private files", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Move Contract.txt", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Move Schedule.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Folder navigation" }),
  ).toContainText("Projects");
  await page
    .getByRole("checkbox", { name: "Select all files", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Move selected files", exact: true })
    .click();
  const move = page.getByRole("dialog", { name: "Move files", exact: true });
  await move.getByLabel("Destination folder").selectOption("");
  await move.getByRole("button", { name: "Move files", exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(page.locator(".files-table tbody tr")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Go to root folder", exact: true })
    .click();
  await expect(page.locator(".files-table tbody tr")).toHaveCount(2);
  // Move one file back into the nested folder.
  await page
    .getByRole("button", { name: "Move Contract.txt", exact: true })
    .click();
  await move
    .getByLabel("Destination folder")
    .selectOption({ label: "Root / Projects / Contracts 合同" });
  await move.getByRole("button", { name: "Move files", exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(page.locator(".files-table tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Open folder Projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage folder Contracts 合同", exact: true })
    .click();
  const manage = page.getByRole("dialog", {
    name: "Manage folder",
    exact: true,
  });
  await manage.getByLabel("Folder name", { exact: true }).fill("Reviewed 合同");
  await manage.getByLabel("Parent folder").selectOption("");
  await manage
    .getByRole("button", { name: "Save folder", exact: true })
    .click();
  await expect(manage).toHaveCount(0);
  await page
    .getByRole("button", { name: "Go to root folder", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open folder Reviewed 合同",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByTestId("language-selector").selectOption("fr-CA");
  await expect(
    page.getByRole("button", { name: "Nouveau dossier", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Ouvrir le dossier Reviewed 合同",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByTestId("language-selector").selectOption("zh-CN");
  await expect(
    page.getByRole("button", { name: "新建文件夹", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/folders-mobile.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "打开文件夹 Reviewed 合同", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "移动 Contract.txt", exact: true }),
  ).toBeVisible();
  await page.getByTestId("language-selector").selectOption("en-CA");
  await page
    .getByRole("button", { name: "Go to root folder", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete folder Projects", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open folder Projects", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
