import { test, expect, type Page } from "@playwright/test";
test.use({ actionTimeout: 10000 });
test("two team members use Public folders, share and upload while Private files and uploader-only controls stay protected", async ({
  page,
  browser,
}) => {
  const run = Date.now(),
    name = `Personal-${run}.txt`,
    team = `Team-${run}`,
    uploaded = `Team-upload-${run}.txt`,
    errors: string[] = [];
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
  async function signIn(target: Page, email: string) {
    const challenge = await api(target, "/auth/request", { email });
    await api(target, "/auth/verify", {
      challengeId: challenge.challengeId,
      pin: challenge.developmentPin,
    });
    await target.goto("/files/");
  }
  await signIn(page, `workspace-a-${run}@international.gc.ca`);
  const created = await api(page, "/uploads", {
    name,
    connectorId: "r2-default",
    size: 8,
    fingerprint: "a".repeat(64),
  });
  await api(
    page,
    `/uploads/${created.file.id}/parts/1`,
    Buffer.from("original"),
    "PUT",
  );
  await api(page, `/uploads/${created.file.id}/complete`, {});
  const folder = (await api(page, "/folders", { name: team, space: "public" }))
    .folder;
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Share ${name}`, exact: true }),
  ).toBeVisible();
  const otherContext = await browser.newContext(),
    colleague = await otherContext.newPage();
  colleague.on("pageerror", (error) => errors.push(error.message));
  try {
    await signIn(colleague, `workspace-b-${run}@international.gc.ca`);
    await expect(
      colleague.getByRole("heading", { name: "Private files", exact: true }),
    ).toBeVisible();
    await expect(
      colleague.getByRole("button", { name: `Share ${name}`, exact: true }),
    ).toHaveCount(0);
    await colleague
      .getByRole("button", { name: "Public files", exact: true })
      .first()
      .click();
    await colleague
      .getByRole("button", { name: `Open folder ${team}`, exact: true })
      .click();
    await expect(colleague.locator(".files-table tbody tr")).toHaveCount(0);
    await page
      .getByRole("button", { name: `Move ${name}`, exact: true })
      .click();
    const move = page.getByRole("dialog", { name: "Move files", exact: true });
    await move.getByLabel("Workspace", { exact: true }).selectOption("public");
    await move.getByLabel("Destination folder").selectOption(folder.id);
    await move.getByRole("button", { name: "Move files", exact: true }).click();
    await expect(move).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Share ${name}`, exact: true }),
    ).toHaveCount(0);
    await colleague.reload();
    await expect(
      colleague.getByRole("button", { name: `Share ${name}`, exact: true }),
    ).toBeVisible();
    await expect(
      colleague.getByRole("button", { name: `Delete ${name}`, exact: true }),
    ).toHaveCount(0);
    await colleague
      .getByRole("button", { name: `Share ${name}`, exact: true })
      .click();
    const share = colleague.getByRole("dialog");
    await share
      .getByLabel("Recipient email addresses")
      .fill("workspace-partner@example.com");
    await share.getByLabel("Email the link automatically").uncheck();
    await share
      .getByRole("button", { name: "Create share", exact: true })
      .click();
    await expect(share.getByLabel("Share link", { exact: true })).toHaveValue(
      /#share=/,
    );
    await share.getByRole("button", { name: "Close", exact: true }).click();
    await colleague
      .getByRole("button", { name: `Move ${name}`, exact: true })
      .click();
    const colleagueMove = colleague.getByRole("dialog", {
      name: "Move files",
      exact: true,
    });
    await expect(
      colleagueMove
        .getByLabel("Workspace", { exact: true })
        .locator("option[value=private]"),
    ).toHaveAttribute("disabled", "");
    await colleagueMove.getByLabel("Destination folder").selectOption("");
    await colleagueMove
      .getByRole("button", { name: "Move files", exact: true })
      .click();
    await expect(colleagueMove).toHaveCount(0);
    await colleague
      .getByRole("button", { name: "Upload files", exact: true })
      .click();
    const upload = colleague.getByRole("dialog", {
      name: "Bring your files aboard",
    });
    await expect(upload.getByLabel("Workspace", { exact: true })).toHaveValue(
      "public",
    );
    await expect(upload.getByLabel("Destination folder")).toHaveValue(
      folder.id,
    );
    await upload.getByLabel("Choose files").setInputFiles({
      name: uploaded,
      mimeType: "text/plain",
      buffer: Buffer.from("Team document"),
    });
    await upload.getByRole("button", { name: /^Upload / }).click();
    await expect
      .poll(async () => {
        const rows = (
          await api(colleague, "/files?space=public", undefined, "GET")
        ).files;
        return rows.find((row: any) => row.name === uploaded)?.state;
      })
      .toBe("ready");
    await page
      .getByRole("button", { name: "Public files", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: `Open folder ${team}`, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `Share ${uploaded}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Delete ${uploaded}`, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Go to root folder", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Move ${name}`, exact: true })
      .click();
    await move.getByLabel("Workspace", { exact: true }).selectOption("private");
    await move.getByRole("button", { name: "Move files", exact: true }).click();
    await expect(move).toHaveCount(0);
    await colleague
      .getByRole("button", { name: "Public files", exact: true })
      .first()
      .click();
    await colleague
      .getByRole("button", { name: "Go to root folder", exact: true })
      .click();
    await expect(
      colleague.getByRole("button", { name: `Share ${name}`, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Private files", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: `Share ${name}`, exact: true }),
    ).toBeVisible();
    await colleague.getByTestId("language-selector").selectOption("fr-CA");
    await expect(
      colleague.getByRole("heading", { name: "Fichiers communs", exact: true }),
    ).toBeVisible();
    await colleague.getByTestId("language-selector").selectOption("zh-CN");
    await expect(
      colleague.getByRole("heading", { name: "公共文件", exact: true }),
    ).toBeVisible();
    await colleague.setViewportSize({ width: 390, height: 844 });
    expect(
      await colleague.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await colleague.screenshot({
      path: "test-results/public-workspace-mobile.png",
      animations: "disabled",
    });
    // Sign out from Public, then sign in without reloading the React app.
    await page
      .getByRole("button", { name: "Public files", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const login = page.getByRole("dialog");
    await login
      .getByLabel("Email address")
      .fill(`workspace-c-${run}@international.gc.ca`);
    await login
      .getByRole("button", { name: "Email me a sign-in code", exact: true })
      .click();
    const development = await login.locator(".development").innerText();
    await login
      .locator("input[inputmode=numeric]")
      .fill(development.match(/\d{6}/)![0]);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Private files", exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.has("space")).toBe(false);
    await expect(page.locator(".files-table tbody tr")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
  }
});
