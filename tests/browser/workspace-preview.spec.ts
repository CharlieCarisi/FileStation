import { test, expect } from "@playwright/test";
test.use({ actionTimeout: 10000 });

test("workspace Preview opens a read-only window on both paths and respects Public access changes", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.120" });
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
    email: `preview-owner-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  const fixtures = [
    {
      name: "Workspace 合同.txt",
      text: "Read-only preview from the workspace.",
    },
    { name: "Archive.zip", text: "Not a preview format" },
    { name: "Pending.txt", text: "Not uploaded yet" },
  ];
  let fileId = "";
  for (const fixture of fixtures) {
    const bytes = Buffer.from(fixture.text);
    const created = await api("/uploads", {
      connectorId: "r2-default",
      name: fixture.name,
      size: bytes.length,
      fingerprint: "a".repeat(64),
    });
    if (fixture.name === "Pending.txt") continue;
    await api(`/uploads/${created.file.id}/parts/1`, bytes, "PUT");
    await api(`/uploads/${created.file.id}/complete`, {});
    if (fixture.name.endsWith(".txt")) fileId = created.file.id;
  }
  for (const prefix of ["", "/files"]) {
    await page.goto(`${prefix}/`);
    await expect(
      page.getByRole("link", {
        name: "Preview Archive.zip in a new window",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: "Preview Pending.txt in a new window",
        exact: true,
      }),
    ).toHaveCount(0);
    const originalURL = page.url(),
      opening = page.waitForEvent("popup");
    await page
      .getByRole("link", {
        name: "Preview Workspace 合同.txt in a new window",
        exact: true,
      })
      .click();
    const viewer = await opening;
    viewer.on("pageerror", (error) => errors.push(error.message));
    await expect(viewer).toHaveURL(
      `http://127.0.0.1:8791${prefix}/?preview=${fileId}&lang=en-CA`,
    );
    await expect(viewer.locator("pre.preview-text")).toHaveText(fixtures[0].text);
    expect(await viewer.evaluate(() => window.opener)).toBeNull();
    expect(page.url()).toBe(originalURL);
    await expect(
      page.getByRole("heading", { name: "Private files", exact: true }),
    ).toBeVisible();
    await viewer.getByTestId("language-selector").selectOption("fr-CA");
    await expect(
      viewer.getByRole("button", { name: "Actualiser l’aperçu", exact: true }),
    ).toBeVisible();
    await viewer.getByTestId("language-selector").selectOption("zh-CN");
    await expect(
      viewer.getByRole("button", { name: "刷新预览", exact: true }),
    ).toBeVisible();
    await viewer.getByTestId("language-selector").selectOption("en-CA");
    await viewer.screenshot({
      path: `test-results/workspace-preview${prefix ? "-prefix" : "-root"}.png`,
    });
    await viewer.reload();
    await expect(viewer.locator("pre.preview-text")).toHaveText(fixtures[0].text);
    const closed = viewer.waitForEvent("close");
    await viewer
      .getByRole("button", { name: "Close preview", exact: true })
      .click();
    await closed;
  }
  await api("/files/move", {
    fileIds: [fileId],
    space: "public",
    folderId: null,
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8791",
    extraHTTPHeaders: { "CF-Connecting-IP": "192.0.2.121" },
  });
  const member = await context.newPage();
  const signIn = await context.request.post("/api/auth/request", {
    data: { email: `preview-member-${Date.now()}@international.gc.ca` },
    headers: { Origin: "http://127.0.0.1:8791" },
  });
  const pin = await signIn.json();
  const signedIn = await context.request.post("/api/auth/verify", {
    data: { challengeId: pin.challengeId, pin: pin.developmentPin },
    headers: { Origin: "http://127.0.0.1:8791" },
  });
  expect(signedIn.ok()).toBe(true);
  await member.goto("/files/?space=public");
  const popup = member.waitForEvent("popup");
  await member
    .getByRole("link", {
      name: "Preview Workspace 合同.txt in a new window",
      exact: true,
    })
    .click();
  const viewer = await popup;
  viewer.on("pageerror", (error) => errors.push(error.message));
  await expect(viewer.locator("pre.preview-text")).toHaveText(fixtures[0].text);
  await api(`/files/${fileId}`, { name: "Renamed preview.txt" }, "PATCH");
  await viewer
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    viewer.getByRole("heading", { name: "Renamed preview.txt", exact: true }),
  ).toBeVisible();
  await api("/files/move", {
    fileIds: [fileId],
    space: "private",
    folderId: null,
  });
  await viewer
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(viewer.getByRole("alert")).toContainText("Verify your email");
  await expect(viewer.locator("pre.preview-text")).toHaveCount(0);
  await expect(
    viewer.getByRole("heading", { name: "Renamed preview.txt", exact: true }),
  ).toHaveCount(0);
  await context.close();
  expect(errors).toEqual([]);
});
