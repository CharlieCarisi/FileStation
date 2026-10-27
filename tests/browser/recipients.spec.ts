import { test, expect } from "@playwright/test";
test.use({ actionTimeout: 10000 });
test("one request accepts two recipients, reports mail success accurately, and both guests submit under the same code; sharing and collaboration use the same recipient input", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const run = Date.now(),
    first = `first-${run}@example.com`,
    second = `second-${run}@example.com`,
    title = `Team submissions ${run}`,
    errors: string[] = [];
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.100" });
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
    email: `recipient-owner-${run}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  await page.goto("/files/");
  let createdRequests = 0;
  // The local server simulates mail. Show its successful result as production UI
  // would; the SMTP2GO acceptance contract is independently covered in integration tests.
  await page.route("**/files/api/invitations", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createdRequests++;
    const response = await route.fetch(),
      data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, developmentEmail: false },
    });
  });
  await page
    .getByRole("button", { name: "File requests", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "New file request", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Request documents.",
    exact: true,
  });
  await form.getByLabel("Invitation title").fill(title);
  await form
    .getByLabel("Invited email addresses", { exact: true })
    .fill(`${first};invalid-email`);
  await form
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText(
    "Check this email address: invalid-email",
  );
  expect(createdRequests).toBe(0);
  await form
    .getByLabel("Invited email addresses", { exact: true })
    .fill(`${first.toUpperCase()}; ${second}\n${first}，${second}`);
  await expect(
    form.getByLabel("Invited email addresses", { exact: true }),
  ).toHaveAccessibleDescription(/2 recipients$/);
  await form
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const result = page.getByRole("dialog", {
    name: "Your invitation is ready.",
    exact: true,
  });
  await expect(result).toContainText("Invitation email sent to 2 recipients.");
  await expect(result.getByRole("alert")).toHaveCount(0);
  expect(createdRequests).toBe(1);
  const link = await result.getByLabel("Invitation link").inputValue(),
    code = await result.locator(".share-code strong").innerText();
  const contexts = [];
  try {
    const partners = [];
    for (const [index, address] of [first, second].entries()) {
      const context = await browser.newContext({
        extraHTTPHeaders: { "CF-Connecting-IP": `192.0.2.${101 + index}` },
      });
      contexts.push(context);
      const partner = await context.newPage();
      partners.push(partner);
      partner.on("pageerror", (error) => errors.push(error.message));
      await partner.goto(link);
      await expect(partner.getByLabel("File access code")).toHaveValue(code);
      await partner.getByLabel("Your recipient email").fill(address);
      await partner
        .getByRole("button", { name: "Continue securely", exact: true })
        .click();
      const pin = (await partner.locator(".development").innerText()).match(
        /\d{6}/,
      )![0];
      await partner.getByLabel("Email verification PIN").fill(pin);
      await partner
        .getByRole("button", { name: "Verify and continue", exact: true })
        .click();
      await partner
        .locator(".submission-drop input")
        .setInputFiles({
          name: `partner-${index + 1}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from(`Document from partner ${index + 1}`),
        });
      await expect(
        partner.getByText(new RegExp(`partner-${index + 1}\\.txt.*Saved`)),
      ).toBeVisible();
    }
    await expect(partners[0].getByText("partner-2.txt")).toHaveCount(0);
    await expect(partners[1].getByText("partner-1.txt")).toHaveCount(0);
    const listing = await api("/invitations", undefined, "GET");
    expect(listing.invitations).toHaveLength(1);
    expect(listing.invitations[0]).toMatchObject({
      code,
      recipients: [first, second],
    });
    expect(listing.invitations[0].files).toHaveLength(2);
    await result.getByRole("button", { name: "Close", exact: true }).click();
    const source = (
      await api("/uploads", {
        connectorId: "r2-default",
        name: "Source.txt",
        size: 8,
        fingerprint: "a".repeat(64),
      })
    ).file;
    await api(`/uploads/${source.id}/parts/1`, Buffer.from("original"), "PUT");
    await api(`/uploads/${source.id}/complete`, {});
    await page
      .getByRole("button", { name: "Private files", exact: true })
      .first()
      .click();
    await page.route("**/files/api/files/*/shares", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const response = await route.fetch(),
        data = await response.json();
      await route.fulfill({
        response,
        json: { ...data, developmentEmail: false },
      });
    });
    await page
      .getByRole("button", { name: "Share Source.txt", exact: true })
      .click();
    const share = page.getByRole("dialog");
    await share
      .getByLabel("Recipient email addresses", { exact: true })
      .fill(`${first};${second}\n${first}`);
    await expect(
      share.getByLabel("Recipient email addresses", { exact: true }),
    ).toHaveAccessibleDescription(/2 recipients$/);
    await share
      .getByRole("button", { name: "Create share", exact: true })
      .click();
    await expect(share).toContainText("Email sent to 2 recipients.");
    await expect(share.getByRole("alert")).toHaveCount(0);
    await share.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByTestId("language-selector").selectOption("zh-CN");
    await page
      .getByRole("button", { name: "共享 Source.txt", exact: true })
      .click();
    await page
      .getByRole("button", { name: "改为协作共享", exact: true })
      .click();
    const collaboration = page.getByRole("dialog");
    await collaboration.getByLabel("邀请标题").fill("团队协作");
    await collaboration
      .getByLabel("受邀邮箱地址", { exact: true })
      .fill(`${first}；${second}、${first}`);
    await expect(
      collaboration.getByLabel("受邀邮箱地址", { exact: true }),
    ).toHaveAccessibleDescription(/2 位收件人$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await collaboration
      .getByLabel("受邀邮箱地址", { exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/multiple-recipients-mobile.png",
      animations: "disabled",
    });
    await collaboration
      .getByRole("button", { name: "创建邀请", exact: true })
      .click();
    await expect(collaboration).toContainText("邀请邮件已发送给 2 位收件人。");
    await expect(collaboration.getByRole("alert")).toHaveCount(0);
    expect(createdRequests).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
