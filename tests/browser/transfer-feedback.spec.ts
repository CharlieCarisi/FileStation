import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.use({ actionTimeout: 10000 });

test("upload Done waits for confirmation, survives reload, localizes, and never appears for a failed upload; download modes stay distinct", async ({
  page,
}, info) => {
  // Isolate this flow from other tests sharing the local authentication limits.
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.90" });
  const run = Date.now(),
    name = `Completed-${run}.txt`,
    failedName = `Retry-${run}.txt`,
    bytes = Buffer.from("Confirmed upload."),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch(`/files/api${path}`, {
      method,
      ...(data ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const challenge = await api("/auth/request", {
    email: `feedback-${run}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  await page.goto("/files/");
  let release!: () => void;
  const pendingResponse = new Promise<void>((resolve) => (release = resolve));
  let completions = 0;
  await page.route("**/files/api/uploads/*/complete", async (route) => {
    completions++;
    if (completions === 1) {
      const response = await route.fetch();
      await pendingResponse;
      await route.fulfill({ response });
    } else if (completions === 2)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "The operation could not be completed. Please try again.",
        }),
      });
    else await route.continue();
  });
  async function upload(fileName: string) {
    await page
      .getByRole("button", { name: "Upload files", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Bring your files aboard",
    });
    await dialog
      .getByLabel("Choose files")
      .setInputFiles({ name: fileName, mimeType: "text/plain", buffer: bytes });
    await dialog.getByRole("button", { name: /^Upload / }).click();
  }
  try {
    await upload(name);
    const card = page.getByRole("article", { name, exact: true });
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    await expect(card).toContainText("Finalizing upload…");
    await expect(card.getByRole("status")).toHaveCount(0);
    release();
    await expect(
      card.getByRole("status", {
        name: `Upload complete for ${name}`,
        exact: true,
      }),
    ).toHaveText("Done");
    await expect(card).toContainText("Uploaded");
    await expect(card).not.toContainText("Uploading");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    const row = page
      .getByRole("row")
      .filter({ has: page.locator("strong", { hasText: name }) });
    await expect(
      row.getByLabel(`Upload complete for ${name}`, { exact: true }),
    ).toHaveText("Done");
    const resumable = row.getByRole("button", {
        name: `Resumable download ${name}`,
        exact: true,
      }),
      direct = row.getByRole("link", {
        name: `Direct browser download ${name}`,
        exact: true,
      });
    await expect(resumable).toHaveText("Resumable");
    await expect(direct).toHaveText("Direct");
    const browserDownload = page.waitForEvent("download");
    await direct.click();
    const downloaded = await browserDownload;
    const path = info.outputPath("direct.txt");
    await downloaded.saveAs(path);
    expect(readFileSync(path)).toEqual(bytes);
    const managedDownload = page.waitForEvent("download");
    await resumable.click();
    await managedDownload;
    await page
      .getByRole("button", { name: /^Transfers/ })
      .first()
      .click();
    await expect(
      page.getByRole("status", {
        name: `Download complete for ${name}`,
        exact: true,
      }),
    ).toHaveText("Done");
    await page
      .getByRole("button", { name: "Private files", exact: true })
      .first()
      .click();
    await upload(failedName);
    const failed = page.getByRole("article", { name: failedName, exact: true });
    await expect(failed.getByRole("alert")).toContainText(
      "The operation could not be completed",
    );
    await expect(failed.getByRole("status")).toHaveCount(0);
    await failed
      .getByRole("button", { name: `Resume ${failedName}`, exact: true })
      .click();
    await expect(
      failed.getByRole("status", {
        name: `Upload complete for ${failedName}`,
        exact: true,
      }),
    ).toHaveText("Done");
    await page.getByTestId("language-selector").selectOption("fr-CA");
    await expect(
      page.getByRole("status", {
        name: `Téléversement terminé pour ${failedName}`,
        exact: true,
      }),
    ).toHaveText("Terminé");
    await page.getByTestId("language-selector").selectOption("zh-CN");
    await expect(
      page.getByRole("status", { name: `${failedName} 上传完成`, exact: true }),
    ).toHaveText("完成");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/upload-done-mobile.png",
      animations: "disabled",
    });
    await page.getByTestId("language-selector").selectOption("en-CA");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "test-results/upload-done-desktop.png",
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Private files", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", {
        name: `Resumable download ${failedName}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/download-actions-desktop.png",
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
