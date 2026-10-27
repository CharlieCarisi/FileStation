import { test, expect, type Page } from "@playwright/test";
test.use({ actionTimeout: 10000 });
test("rename a completed file, preserve verified downloads, handle conflicts, and let team members rename Public files in French and Chinese", async ({
  page,
  browser,
}) => {
  const run = Date.now(),
    oldName = `Original-${run}.txt`,
    newName = `Reviewed 合同-${run}.txt`,
    errors: string[] = [];
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.95" });
  page.on("pageerror", (error) => errors.push(error.message));
  async function api(target: Page, path: string, data?: any, method = "POST") {
    const response = await target.request.fetch("/files/api" + path, {
      method,
      ...(data ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  async function login(target: Page, email: string) {
    const challenge = await api(target, "/auth/request", { email });
    await api(target, "/auth/verify", {
      challengeId: challenge.challengeId,
      pin: challenge.developmentPin,
    });
    await target.goto("/files/");
  }
  await login(page, `rename-a-${run}@international.gc.ca`);
  const file = (
    await api(page, "/uploads", {
      name: oldName,
      connectorId: "r2-default",
      size: 8,
      fingerprint: "a".repeat(64),
    })
  ).file;
  await api(
    page,
    `/uploads/${file.id}/parts/1`,
    Buffer.from("original"),
    "PUT",
  );
  await api(page, `/uploads/${file.id}/complete`, {});
  const share = await api(page, `/files/${file.id}/shares`, {
    recipients: ["rename-partner@example.com"],
    expiresDays: 7,
    sendEmail: false,
  });
  await page.reload();
  await page
    .getByRole("button", { name: `Rename ${oldName}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Rename file", exact: true });
  await expect(dialog.getByLabel("File name", { exact: true })).toHaveValue(
    `Original-${run}`,
  );
  await expect(dialog.locator(".rename-extension")).toHaveText(".txt");
  await dialog
    .getByLabel("File name", { exact: true })
    .fill(`Reviewed 合同-${run}`);
  await dialog
    .getByRole("button", { name: "Rename file", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Rename ${newName}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Rename ${oldName}`, exact: true }),
  ).toHaveCount(0);
  // A stale dialog cannot overwrite a newer name from another session.
  await page
    .getByRole("button", { name: `Rename ${newName}`, exact: true })
    .click();
  await api(
    page,
    `/files/${file.id}`,
    { name: `Newer-${run}.txt`, expectedName: newName },
    "PATCH",
  );
  await dialog.getByLabel("File name", { exact: true }).fill("Stale edit");
  await dialog
    .getByRole("button", { name: "Rename file", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("The file changed");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const colleagueContext = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": "192.0.2.96" },
    }),
    colleague = await colleagueContext.newPage();
  colleague.on("pageerror", (error) => errors.push(error.message));
  try {
    await colleague.goto(`http://127.0.0.1:8791/files/#share=${share.code}`);
    await colleague
      .getByLabel("Your recipient email")
      .fill("rename-partner@example.com");
    await colleague
      .getByRole("button", { name: "Continue securely", exact: true })
      .click();
    const pin = (await colleague.locator(".development").innerText()).match(
      /\d{6}/,
    )![0];
    await colleague.getByLabel("Email verification PIN").fill(pin);
    await colleague
      .getByRole("button", { name: "Verify and continue", exact: true })
      .click();
    await expect(
      colleague.getByRole("region", {
        name: `Preview of Newer-${run}.txt`,
        exact: true,
      }),
    ).toContainText("original");
    await api(page, "/files/move", {
      fileIds: [file.id],
      folderId: null,
      space: "public",
    });
    await login(colleague, `rename-b-${run}@international.gc.ca`);
    await colleague
      .getByRole("button", { name: "Public files", exact: true })
      .first()
      .click();
    await colleague.getByTestId("language-selector").selectOption("fr-CA");
    await colleague
      .getByRole("button", { name: `Renommer Newer-${run}.txt`, exact: true })
      .click();
    const french = colleague.getByRole("dialog", {
      name: "Renommer le fichier",
      exact: true,
    });
    await french
      .getByLabel("Nom du fichier", { exact: true })
      .fill(`Équipe-${run}`);
    await french
      .getByRole("button", { name: "Renommer le fichier", exact: true })
      .click();
    await expect(french).toHaveCount(0);
    await colleague.getByTestId("language-selector").selectOption("zh-CN");
    await colleague
      .getByRole("button", { name: `重命名 Équipe-${run}.txt`, exact: true })
      .click();
    const chinese = colleague.getByRole("dialog", {
      name: "重命名文件",
      exact: true,
    });
    await chinese.getByLabel("文件名", { exact: true }).fill(`团队-${run}`);
    await colleague.setViewportSize({ width: 390, height: 844 });
    expect(
      await colleague.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await colleague.screenshot({
      path: "test-results/rename-mobile.png",
      animations: "disabled",
    });
    await chinese
      .getByRole("button", { name: "重命名文件", exact: true })
      .click();
    await expect(chinese).toHaveCount(0);
    await expect(
      colleague.getByRole("button", {
        name: `重命名 团队-${run}.txt`,
        exact: true,
      }),
    ).toBeVisible();
    await colleague.reload();
    await expect(
      colleague.getByRole("button", {
        name: `重命名 团队-${run}.txt`,
        exact: true,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await colleagueContext.close();
  }
});
