import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("anyone links hide email fields, open directly in a signed-out browser, and can be copied and revoked from Shared by me", async ({
  page,
  browser,
}) => {
  const origin = "http://127.0.0.1:8791";
  const content = "Link-only preview and download.";
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.180" });
  async function post(path: string, data: object | Buffer, method = "POST") {
    const response = await page.request.fetch(`/files/api${path}`, {
      method,
      data,
      headers: {
        Origin: origin,
        ...(Buffer.isBuffer(data)
          ? { "Content-Type": "application/octet-stream" }
          : {}),
      },
    });
    expect(response.ok(), `HTTP ${response.status()} ${path}`).toBeTruthy();
    return response.json();
  }
  const challenge = await post("/auth/request", {
    email: `anyone-share-${Date.now()}@international.gc.ca`,
  });
  await post("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  const name = "Link-only document.txt";
  const { file } = await post("/uploads", {
    name,
    connectorId: "r2-default",
    size: Buffer.byteLength(content),
    fingerprint: "a".repeat(64),
  });
  await post(`/uploads/${file.id}/parts/1`, Buffer.from(content), "PUT");
  await post(`/uploads/${file.id}/complete`, {});
  await page.goto("/files/");
  await page
    .getByRole("button", { name: `Share ${name}`, exact: true })
    .click();
  const share = page.getByRole("dialog");
  const mode = share.getByRole("combobox", {
    name: "Who can access this file?",
  });
  await expect(mode).toHaveValue("recipients");
  await share
    .getByLabel("Recipient email addresses", { exact: true })
    .fill("unused@example.invalid");
  await mode.selectOption("anyone");
  await expect(
    share.getByLabel("Recipient email addresses", { exact: true }),
  ).toHaveCount(0);
  await expect(
    share.getByRole("checkbox", { name: /Email the link automatically/ }),
  ).toHaveCount(0);
  const creation = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith(`/files/${file.id}/shares`),
  );
  await share
    .getByRole("button", { name: "Create share", exact: true })
    .click();
  expect((await creation).postDataJSON()).toEqual({
    accessMode: "anyone",
    expiresDays: 7,
  });
  const link = await share
    .getByLabel("Share link", { exact: true })
    .inputValue();
  expect(link).toContain(`${origin}/files/#link=`);
  await expect(
    share.getByText("FILE ACCESS CODE", { exact: true }),
  ).toHaveCount(0);
  await share.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Shared by me", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText(
    "Anyone with the link",
  );
  await page
    .getByRole("button", { name: `Share ${name}`, exact: true })
    .click();
  await expect(share.getByLabel("Share link", { exact: true })).toHaveValue(
    link,
  );

  const context = await browser.newContext({
    extraHTTPHeaders: { "CF-Connecting-IP": "192.0.2.181" },
  });
  try {
    const guest = await context.newPage();
    const verificationRequests: string[] = [];
    guest.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/\/api\/(?:access\/|shares\/(?:access|verify))/.test(path))
        verificationRequests.push(path);
    });
    await guest.goto(link);
    const download = guest.getByRole("dialog", {
      name: "A file for you.",
      exact: true,
    });
    await expect(download.locator("pre.preview-text")).toHaveText(content);
    await expect(
      download.getByLabel("Your recipient email", { exact: true }),
    ).toHaveCount(0);
    const started = guest.waitForEvent("download");
    await download
      .getByRole("link", { name: "Direct browser download" })
      .click();
    const saved = await started;
    expect(saved.suggestedFilename()).toBe(name);
    expect(await readFile((await saved.path())!, "utf8")).toBe(content);
    expect(verificationRequests).toEqual([]);
    await share.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(share.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(share.getByLabel("Share link", { exact: true })).toHaveCount(
      0,
    );
    expect(
      (
        await guest.request.get(`/files/api/files/${file.id}/download`)
      ).status(),
    ).toBe(410);
    await guest.goto(link);
    await expect(guest.getByRole("alert")).toHaveText(
      "This shared link is invalid or has expired.",
    );
  } finally {
    await context.close();
  }
});
