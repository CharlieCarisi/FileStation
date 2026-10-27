import { test, expect } from "@playwright/test";
import {
  createDocumentWithText,
  createDocx,
  parseDocx,
} from "@eigenpal/docx-editor-core";

test("under /files, verify an external submission and edit text and DOCX working copies", async ({
  page,
  browser,
}) => {
  const run = crypto.randomUUID().slice(0, 8);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/files/");
  await expect(page.getByRole("heading", { name: /Good files/ })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const login = page.getByRole("dialog");
  await login.getByLabel("Email address").fill("c@bychx.com");
  await login.getByRole("button", { name: "Email me a sign-in code" }).click();
  const development = await login.locator(".development").innerText();
  await login
    .locator("input[inputmode=numeric]")
    .fill(development.match(/\d{6}/)![0]);
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "File requests", exact: true }).first(),
  ).toBeVisible();
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/files/api" + path, {
      method,
      ...(data ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  await page
    .getByRole("button", { name: "File requests", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "New file request", exact: true })
    .click();
  await page.getByLabel("Invitation title").fill("External partner submission");
  await page
    .getByLabel("Invited email addresses")
    .fill("partner-browser@example.com");
  await page.getByLabel("Email the invitation automatically").uncheck();
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:8791\/files\/#share=/);
  const external = await browser.newContext(),
    partner = await external.newPage();
  await partner.goto(link);
  await partner
    .getByLabel("Your recipient email")
    .fill("partner-browser@example.com");
  await partner.getByRole("button", { name: "Continue securely" }).click();
  const partnerPin = (await partner.locator(".development").innerText()).match(
    /\d{6}/,
  )![0];
  await partner.getByLabel("Email verification PIN").fill(partnerPin);
  await partner.getByRole("button", { name: "Verify and continue" }).click();
  await partner.locator(".submission-drop input").setInputFiles({
    name: "submitted.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("External partner document."),
  });
  await expect(partner.getByText(/submitted.txt.*Saved/)).toBeVisible();
  await external.close();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  for (const extension of ["txt", "docx"]) {
    const bytes =
      extension === "docx"
        ? Buffer.from(
            await createDocx(createDocumentWithText("Original DOCX text.")),
          )
        : Buffer.from("Original text.");
    const source = await api("/uploads", {
      connectorId: "r2-default",
      name: `original.${extension}`,
      size: bytes.length,
      fingerprint: "a".repeat(64),
    });
    await api(`/uploads/${source.file.id}/parts/1`, bytes, "PUT");
    await api(`/uploads/${source.file.id}/complete`, {});
    const invitation = await api("/invitations", {
      kind: "collaboration",
      title: `Edit ${extension} ${run}`,
      sourceFileId: source.file.id,
      connectorId: "r2-default",
      targetName: `working.${extension}`,
      recipients: ["partner-browser@example.com"],
      expiresDays: 7,
      maxFileBytes: 1000000,
      maxFiles: 10,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Collaborations", exact: true })
      .first()
      .click();
    const card = page.locator(".invitation-card").filter({
      has: page.getByRole("heading", {
        name: `Edit ${extension} ${run}`,
        exact: true,
      }),
    });
    await card.getByRole("button", { name: "Open document" }).click();
    const preview = page.getByRole("region", {
      name: `Preview of working.${extension}`,
    });
    await expect(preview).toContainText(
      extension === "txt" ? "Original text." : "Original DOCX text.",
      { timeout: 30000 },
    );
    const openingPreview = page.waitForEvent("popup");
    await preview
      .getByRole("link", {
        name: `Preview working.${extension} in a new window`,
        exact: true,
      })
      .click();
    const previewWindow = await openingPreview;
    previewWindow.on("pageerror", (error) => errors.push(error.message));
    await expect(previewWindow).toHaveURL(
      new RegExp(`/files/\\?previewInvitation=${invitation.id}&lang=en-CA$`),
    );
    await expect(
      previewWindow.getByRole("region", {
        name: `Preview of working.${extension}`,
        exact: true,
      }),
    ).toContainText(
      extension === "txt" ? "Original text." : "Original DOCX text.",
      { timeout: 30000 },
    );
    await expect(previewWindow.locator('[contenteditable="true"]')).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Edit online", exact: true })
      .click();
    const editor = page.locator(".document-editor-overlay");
    if (extension === "txt")
      await editor.getByLabel("Document text").fill("Edited in File Station.");
    else {
      const content = editor.getByText("Original DOCX text.", { exact: true });
      await expect(content).toBeVisible({ timeout: 30000 });
      await editor.getByTestId("language-selector").selectOption("fr-CA");
      await expect(
        editor.getByText("Fichier", { exact: true }).first(),
      ).toBeVisible();
      await editor.getByTestId("language-selector").selectOption("zh-CN");
      await expect(
        editor.getByText("文件", { exact: true }).first(),
      ).toBeVisible();
      await expect(content).toBeVisible();
      await editor.getByTestId("language-selector").selectOption("en-CA");
      await content.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" Edited in browser.");
    }
    await editor
      .getByRole("button", { name: "Save working copy", exact: true })
      .click();
    await expect(editor).not.toBeVisible({ timeout: 30000 });
    await expect(preview).toContainText(
      extension === "txt" ? "Edited in File Station." : "Edited in browser.",
      { timeout: 30000 },
    );
    const separatePreview = previewWindow.getByRole("region", {
      name: `Preview of working.${extension}`,
      exact: true,
    });
    await separatePreview
      .getByRole("button", { name: "Hide preview", exact: true })
      .click();
    await separatePreview
      .getByRole("button", { name: "Show preview", exact: true })
      .click();
    await expect(separatePreview.getByRole("alert")).toContainText(
      "working copy changed",
    );
    await previewWindow
      .getByRole("button", { name: "Refresh preview", exact: true })
      .click();
    await expect(separatePreview).toContainText(
      extension === "txt" ? "Edited in File Station." : "Edited in browser.",
      { timeout: 30000 },
    );
    await previewWindow.close();
    const download = await page.request.get(
      `/files/api/invitations/${invitation.id}/download`,
    );
    expect(download.ok()).toBeTruthy();
    if (extension === "txt")
      expect(await download.text()).toBe("Edited in File Station.");
    else {
      const document = await parseDocx(new Uint8Array(await download.body()));
      expect(JSON.stringify(document)).toContain("Edited in browser.");
      expect(
        JSON.stringify(document).replaceAll(" Edited in browser.", ""),
      ).toContain("Original DOCX text.");
    }
    const original = await page.request.get(
      `/files/api/files/${source.file.id}/download`,
    );
    expect(await original.body()).toEqual(bytes);
    const view = await api(
      `/invitations/${invitation.id}/view`,
      undefined,
      "GET",
    );
    expect(view.invitation.revision).toBe(1);
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Storage", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Add connector", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Provider" })
    .selectOption("onedrive");
  await expect(page.getByLabel("Tenant ID", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
