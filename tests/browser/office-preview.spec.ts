import { test, expect, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
test.use({ actionTimeout: 10000 });

function workbook() {
  const book = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([
    ["Name", "Amount", "Date", "Formula", "Markup"],
    [
      "Mission",
      1234.5,
      new Date("2026-10-27T00:00:00Z"),
      2469,
      '<img src=x onerror="window.previewExecuted=true">',
    ],
    ["Travel", 1234.5],
    ["Merged heading"],
  ]);
  summary.B2.z = "$#,##0.00";
  summary.C2.z = "yyyy-mm-dd";
  summary.D2 = { t: "n", f: "SUM(B2,B3)", v: 2469, z: "0.00" };
  summary["!merges"] = [XLSX.utils.decode_range("A4:B4")];
  XLSX.utils.book_append_sheet(book, summary, "Summary");
  const details = XLSX.utils.aoa_to_sheet([["Second worksheet"]]);
  details.A101 = { t: "s", v: "Second page row" };
  details.AA1 = { t: "s", v: "Far column" };
  details["!ref"] = "A1:AA101";
  XLSX.utils.book_append_sheet(book, details, "Details 合同");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "Empty");
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Hidden content"]]),
    "Hidden",
  );
  book.Workbook = {
    Sheets: book.SheetNames.map((name) => ({
      name,
      Hidden: name === "Hidden" ? 1 : 0,
    })),
  };
  return book;
}

test("Excel and PowerPoint preview in separate windows, paginate locally and keep external content isolated", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [],
    externalRequests: string[] = [];
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.130" });
  function observe(viewer: Page) {
    viewer.on("pageerror", (error) => errors.push(error.message));
    viewer.on("request", (request) => {
      if (request.url().includes("preview-external.invalid"))
        externalRequests.push(request.url());
    });
  }
  observe(page);
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/api" + path, {
      method,
      ...(data !== undefined ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const challenge = await api("/auth/request", {
    email: `office-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  const large = XLSX.utils.book_new(),
    sparse = XLSX.utils.aoa_to_sheet([["Visible first row"]]);
  sparse.A20001 = { t: "s", v: "Beyond preview limit" };
  sparse["!ref"] = "A1:A20001";
  XLSX.utils.book_append_sheet(large, sparse, "Large");
  const fixtures = [
    {
      name: "Budget.xlsx",
      bytes: XLSX.write(workbook(), {
        type: "buffer",
        bookType: "xlsx",
      }) as Buffer,
    },
    {
      name: "Legacy.xls",
      bytes: XLSX.write(workbook(), {
        type: "buffer",
        bookType: "biff8",
      }) as Buffer,
    },
    {
      name: "Briefing.pptx",
      bytes: readFileSync(
        new URL("./fixtures/office-preview.pptx", import.meta.url),
      ),
    },
    {
      name: "Large.xlsx",
      bytes: XLSX.write(large, { type: "buffer", bookType: "xlsx" }) as Buffer,
    },
    { name: "Broken.xlsx", bytes: Buffer.from("Not an Office document") },
    { name: "Broken.pptx", bytes: Buffer.from("Not an Office document") },
    {
      name: "Old.ppt",
      bytes: Buffer.from("Legacy PowerPoint needs conversion"),
    },
  ];
  const ids = new Map<string, string>();
  for (const fixture of fixtures) {
    const created = await api("/uploads", {
      connectorId: "r2-default",
      name: fixture.name,
      size: fixture.bytes.length,
      fingerprint: "a".repeat(64),
    });
    await api(`/uploads/${created.file.id}/parts/1`, fixture.bytes, "PUT");
    await api(`/uploads/${created.file.id}/complete`, {});
    ids.set(fixture.name, created.file.id);
  }
  async function open(name: string, prefix = "/files") {
    await page.goto(`${prefix}/`);
    const opening = page.waitForEvent("popup");
    await page
      .getByRole("link", {
        name: `Preview ${name} in a new window`,
        exact: true,
      })
      .click();
    const viewer = await opening;
    observe(viewer);
    return viewer;
  }
  for (const name of ["Budget.xlsx", "Legacy.xls"]) {
    const viewer = await open(name, name.endsWith("xlsx") ? "" : "/files");
    const sheet = viewer.getByLabel("Worksheet", { exact: true });
    await expect(sheet).toBeEnabled();
    await expect(sheet.locator("option")).toHaveCount(3);
    await expect(
      viewer.getByRole("cell", { name: "$1,234.50", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("cell", { name: "2469.00", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("cell", { name: "2026-10-27", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("cell", { name: "Merged heading", exact: true }),
    ).toHaveAttribute("colspan", "2");
    await expect(
      viewer.getByRole("cell", { name: /<img src=x/ }),
    ).toBeVisible();
    await expect(viewer.locator(".spreadsheet-preview img")).toHaveCount(0);
    expect(
      await viewer.evaluate(() => (window as any).previewExecuted),
    ).toBeUndefined();
    await sheet.selectOption({ label: "Details 合同" });
    await expect(
      viewer.getByRole("cell", { name: "Second worksheet", exact: true }),
    ).toBeVisible();
    await viewer
      .getByRole("button", { name: "Next rows", exact: true })
      .click();
    await expect(
      viewer.getByRole("cell", { name: "Second page row", exact: true }),
    ).toBeVisible();
    await viewer
      .getByRole("button", { name: "Previous rows", exact: true })
      .click();
    await viewer
      .getByRole("button", { name: "Next columns", exact: true })
      .click();
    await expect(
      viewer.getByRole("cell", { name: "Far column", exact: true }),
    ).toBeVisible();
    await sheet.selectOption({ label: "Empty" });
    await expect(
      viewer.getByText("This worksheet is empty.", { exact: true }),
    ).toBeVisible();
    await sheet.selectOption({ label: "Summary" });
    await viewer.getByTestId("language-selector").selectOption("fr-CA");
    await expect(
      viewer.getByLabel("Feuille de calcul", { exact: true }),
    ).toBeVisible();
    await viewer.getByTestId("language-selector").selectOption("zh-CN");
    await expect(viewer.getByLabel("工作表", { exact: true })).toBeVisible();
    await viewer.getByTestId("language-selector").selectOption("en-CA");
    await viewer.screenshot({ path: `test-results/excel-${name}.png` });
    await viewer.setViewportSize({ width: 390, height: 844 });
    expect(
      await viewer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await viewer.close();
  }
  const deck = await open("Briefing.pptx");
  await expect(deck.getByText("Slide 1 of 2", { exact: true })).toBeVisible({ timeout: 30000 });
  const frame = deck.frameLocator('iframe[title="PowerPoint slide preview"]');
  await expect(
    frame.getByText("Quarterly briefing 合同", { exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByText('<img src=x onerror="parent.previewExecuted=true">', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await deck.evaluate(
      () =>
        (document.querySelector("iframe") as HTMLIFrameElement).contentDocument,
    ),
  ).toBeNull();
  expect(
    await deck.evaluate(() => (window as any).previewExecuted),
  ).toBeUndefined();
  await deck.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(deck.getByText("Slide 2 of 2", { exact: true })).toBeVisible();
  await expect(
    frame.getByText("Budget summary", { exact: true }),
  ).toBeVisible();
  await expect(frame.getByText("Mission", { exact: true })).toBeVisible();
  await deck.screenshot({ path: "test-results/powerpoint-preview.png" });
  await deck.getByLabel("Go to slide", { exact: true }).selectOption("0");
  await expect(
    frame.getByText("Quarterly briefing 合同", { exact: true }),
  ).toBeVisible();
  await deck.getByTestId("language-selector").selectOption("fr-CA");
  await expect(
    deck.getByRole("button", { name: "Diapositive suivante", exact: true }),
  ).toBeVisible();
  await deck.getByTestId("language-selector").selectOption("zh-CN");
  await expect(
    deck.getByRole("button", { name: "下一张幻灯片", exact: true }),
  ).toBeVisible();
  await deck.getByTestId("language-selector").selectOption("en-CA");
  await deck.setViewportSize({ width: 390, height: 844 });
  expect(
    await deck.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await deck.close();
  const limited = await open("Large.xlsx");
  await expect(
    limited.getByText(
      "Preview shows the first 20,000 rows and 200 columns per sheet. Download the workbook to see everything.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await limited.locator(".spreadsheet-grid tbody tr").count(),
  ).toBeLessThanOrEqual(100);
  await limited.close();
  for (const name of ["Broken.xlsx", "Broken.pptx"]) {
    const viewer = await open(name);
    await expect(viewer.getByRole("alert")).toContainText(
      "could not be previewed",
      { timeout: 30000 },
    );
    await expect(
      viewer.getByRole("link", { name: "Direct download", exact: true }),
    ).toBeVisible();
    await viewer.close();
  }
  await expect(
    page.getByRole("link", {
      name: "Preview Old.ppt in a new window",
      exact: true,
    }),
  ).toHaveCount(0);
  // Both Office viewers remain available to verified external recipients.
  const guest = await browser.newContext({
    extraHTTPHeaders: { "CF-Connecting-IP": "192.0.2.131" },
  });
  const recipient = await guest.newPage();
  observe(recipient);
  for (const name of ["Budget.xlsx", "Briefing.pptx"]) {
    const share = await api(`/files/${ids.get(name)}/shares`, {
      recipients: ["office-guest@example.com"],
      expiresDays: 1,
      sendEmail: false,
    });
    await recipient.goto("about:blank");
    await recipient.goto(share.link);
    await recipient
      .getByLabel("Your recipient email")
      .fill("office-guest@example.com");
    await recipient
      .getByRole("button", { name: "Continue securely", exact: true })
      .click();
    const pin = await recipient.locator(".development strong").innerText();
    await recipient
      .getByLabel("Email verification PIN", { exact: true })
      .fill(pin);
    await recipient
      .getByRole("button", { name: "Verify and continue", exact: true })
      .click();
    const preview = recipient.getByRole("region", {
      name: `Preview of ${name}`,
      exact: true,
    });
    if (name.endsWith("xlsx"))
      await expect(
        preview.getByLabel("Worksheet", { exact: true }),
      ).toBeVisible();
    else
      await expect(
        preview.getByText("Slide 1 of 2", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
    await api(`/shares/${share.id}`, undefined, "DELETE");
    await preview
      .getByRole("button", { name: "Hide preview", exact: true })
      .click();
    await preview
      .getByRole("button", { name: "Show preview", exact: true })
      .click();
    await expect(preview.getByRole("alert")).toContainText(
      "no longer available",
    );
  }
  const collaboration = await api("/invitations", {
    kind: "collaboration",
    title: "Workbook collaboration",
    sourceFileId: ids.get("Budget.xlsx"),
    targetName: "Working.xlsx",
    connectorId: "r2-default",
    recipients: ["office-guest@example.com"],
    expiresDays: 1,
    maxFileBytes: 1000000,
    maxFiles: 10,
    sendEmail: false,
  });
  await recipient.goto("about:blank");
  await recipient.goto(collaboration.link);
  await recipient
    .getByLabel("Your recipient email")
    .fill("office-guest@example.com");
  await recipient
    .getByRole("button", { name: "Continue securely", exact: true })
    .click();
  const collaborationPin = await recipient
    .locator(".development strong")
    .innerText();
  await recipient
    .getByLabel("Email verification PIN", { exact: true })
    .fill(collaborationPin);
  await recipient
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  const portal = recipient.getByRole("dialog", {
    name: "Workbook collaboration",
    exact: true,
  });
  await expect(
    portal.getByRole("cell", { name: "Mission", exact: true }),
  ).toBeVisible();
  await expect(
    portal.getByRole("button", { name: "Edit online", exact: true }),
  ).toBeDisabled();
  const changed = workbook();
  changed.Sheets.Summary.A2 = { t: "s", v: "Updated mission" };
  await portal
    .locator(".submission-drop input")
    .setInputFiles({
      name: "Working.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: XLSX.write(changed, { type: "buffer", bookType: "xlsx" }),
    });
  await expect(
    portal.getByRole("cell", { name: "Updated mission", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await guest.close();
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
