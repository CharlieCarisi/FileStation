import { test, expect, type Page } from "@playwright/test";
test.use({ actionTimeout: 10000 });

test("file and folder menus support right click, keyboard, touch and shortcuts without duplicating storage", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.150" });
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
    email: `menus-${Date.now()}@international.gc.ca`,
  });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  const references = (await api("/folders", { name: "References" })).folder,
    originals = (await api("/folders", { name: "Originals" })).folder;
  const records: any[] = [];
  for (const name of ["Report.txt", "Second.txt", "Pending.txt"]) {
    const bytes = Buffer.from(`Contents of ${name}`);
    const created = await api("/uploads", {
      connectorId: "r2-default",
      name,
      size: bytes.length,
      fingerprint: "a".repeat(64),
    });
    records.push(created.file);
    if (name !== "Pending.txt") {
      await api(`/uploads/${created.file.id}/parts/1`, bytes, "PUT");
      await api(`/uploads/${created.file.id}/complete`, {});
    }
  }
  const row = (name: string) =>
    page
      .locator(".files-table tbody tr")
      .filter({ has: page.getByText(name, { exact: true }) });
  await page.goto("/files/");
  await row("Report.txt").click({ button: "right" });
  let menu = page.getByRole("menu", {
    name: "Actions for Report.txt",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Share file", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "Delete file", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(
    menu.getByRole("menuitem", {
      name: "Open preview in a new window",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row("Report.txt")).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await menu
    .getByRole("menuitem", { name: "Rename file", exact: true })
    .click();
  const rename = page.getByRole("dialog", { name: "Rename file", exact: true });
  await rename.getByLabel("File name", { exact: true }).fill("Renamed");
  await rename
    .getByRole("button", { name: "Rename file", exact: true })
    .click();
  await expect(rename).toHaveCount(0);
  // Shift keeps the browser context menu, and menu coordinates stay on-screen.
  expect(
    await row("Renamed.txt").evaluate((element) =>
      element.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }),
      ),
    ),
  ).toBe(true);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await row("Renamed.txt").evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: innerWidth - 1,
        clientY: innerHeight - 1,
      }),
    ),
  );
  menu = page.getByRole("menu", {
    name: "Actions for Renamed.txt",
    exact: true,
  });
  const bounds = await menu.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "More actions for Pending.txt", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Go to transfers", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Share file", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Rename file", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "More actions for Renamed.txt", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Create shortcut", exact: true })
    .click();
  const create = page.getByRole("dialog", {
    name: "Create shortcut",
    exact: true,
  });
  await create
    .getByLabel("Shortcut name", { exact: true })
    .fill("Reference.txt");
  await create.getByLabel("Workspace", { exact: true }).selectOption("public");
  await create
    .getByRole("button", { name: "Create shortcut", exact: true })
    .click();
  await expect(create.getByRole("alert")).toContainText(
    "Move the original file to Public",
  );
  await create.getByLabel("Workspace", { exact: true }).selectOption("private");
  await create
    .getByLabel("Destination folder", { exact: true })
    .selectOption(references.id);
  await create
    .getByRole("button", { name: "Create shortcut", exact: true })
    .click();
  await expect(create).toHaveCount(0);
  expect((await api("/files", undefined, "GET")).files).toHaveLength(3);
  await page
    .getByRole("button", { name: "More actions for References", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "New subfolder", exact: true })
    .click();
  const newFolder = page.getByRole("dialog", {
    name: "New folder",
    exact: true,
  });
  await newFolder.getByLabel("Folder name", { exact: true }).fill("Nested");
  await expect(
    newFolder.getByLabel("Parent folder", { exact: true }),
  ).toHaveValue(references.id);
  await newFolder
    .getByRole("button", { name: "Save folder", exact: true })
    .click();
  await expect(newFolder).toHaveCount(0);
  await page
    .getByRole("button", { name: "Folder list view", exact: true })
    .click();
  await row("References").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Create folder ZIP", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Open folder", exact: true })
    .click();
  await expect(row("Reference.txt")).toHaveClass(/shortcut-row/);
  await expect(
    page.getByRole("checkbox", { name: "Select Reference.txt", exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("language-selector").selectOption("fr-CA");
  await page
    .getByRole("button", {
      name: "Autres actions pour Reference.txt",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Supprimer le raccourci", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("language-selector").selectOption("zh-CN");
  await page
    .getByRole("button", { name: "Reference.txt 的更多操作", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "重命名或移动快捷方式", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("language-selector").selectOption("en-CA");
  await page
    .getByRole("button", {
      name: "More actions for Reference.txt",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Share file", exact: true }).click();
  const share = page.getByRole("dialog", {
    name: "A file. The right people.",
    exact: true,
  });
  await expect(share).toContainText("Renamed.txt");
  await share.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", {
      name: "More actions for Reference.txt",
      exact: true,
    })
    .click();
  const opening = page.waitForEvent("popup");
  await page
    .getByRole("menuitem", {
      name: "Open preview in a new window",
      exact: true,
    })
    .click();
  const viewer = await opening;
  await expect(viewer.locator("pre.preview-text")).toHaveText(
    "Contents of Report.txt",
  );
  await viewer.close();
  await page
    .getByRole("button", {
      name: "More actions for Reference.txt",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Open original location", exact: true })
    .click();
  await expect(row("Renamed.txt")).toBeVisible();
  await page
    .getByRole("button", { name: "More actions for Renamed.txt", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Move files", exact: true }).click();
  const move = page.getByRole("dialog", { name: "Move files", exact: true });
  await move
    .getByLabel("Destination folder", { exact: true })
    .selectOption(originals.id);
  await move.getByRole("button", { name: "Move files", exact: true }).click();
  await expect(move).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open folder References", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "More actions for Reference.txt",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Open original location", exact: true })
    .click();
  expect(new URL(page.url()).searchParams.get("folder")).toBe(originals.id);
  await page
    .getByRole("button", { name: "Go to root folder", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open folder References", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "More actions for Reference.txt",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Rename or move shortcut", exact: true })
    .click();
  const manage = page.getByRole("dialog", {
    name: "Manage shortcut",
    exact: true,
  });
  await manage
    .getByLabel("Shortcut name", { exact: true })
    .fill("Updated reference.txt");
  await manage
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await expect(manage).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "More actions for Updated reference.txt",
      exact: true,
    })
    .click();
  await page.screenshot({ path: "test-results/shortcut-context-menu.png" });
  await page.keyboard.press("Escape");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Remove shortcut Updated reference.txt",
      exact: true,
    })
    .click();
  await expect(row("Updated reference.txt")).toHaveCount(0);
  expect(
    (await api(`/files/${records[0].id}`, undefined, "GET")).file.name,
  ).toBe("Renamed.txt");
  await api("/shortcuts", {
    fileId: records[0].id,
    name: "Broken reference.txt",
    folderId: references.id,
  });
  await api(`/files/${records[0].id}`, undefined, "DELETE");
  await page.reload();
  await expect(row("Broken reference.txt")).toContainText(
    "The original file was deleted, expired or is no longer accessible.",
  );
  await page
    .getByRole("button", {
      name: "More actions for Broken reference.txt",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Share file", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", {
      name: "Open preview in a new window",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Delete file", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Remove shortcut", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // More actions and long press work without a mouse on touch devices.
  const mobile = await browser.newContext({
    baseURL: "http://127.0.0.1:8791",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await page.context().storageState(),
    extraHTTPHeaders: { "CF-Connecting-IP": "192.0.2.152" },
  });
  const touch = await mobile.newPage();
  touch.on("pageerror", (error) => errors.push(error.message));
  await touch.goto("/files/");
  await touch
    .getByRole("button", { name: "Folder tile view", exact: true })
    .tap();
  await touch
    .getByRole("button", { name: "More actions for References", exact: true })
    .tap();
  await expect(
    touch.getByRole("menuitem", { name: "New subfolder", exact: true }),
  ).toBeVisible();
  await touch.keyboard.press("Escape");
  const card = touch.locator(".folder-card").filter({
    has: touch.getByRole("button", {
      name: "Open folder References",
      exact: true,
    }),
  });
  await card.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 100,
    clientY: 350,
  });
  await expect(
    touch.getByRole("menu", { name: "Actions for References", exact: true }),
  ).toBeVisible();
  await card.dispatchEvent("pointerup", {
    pointerType: "touch",
    clientX: 100,
    clientY: 350,
  });
  await card
    .getByRole("button", { name: "Open folder References", exact: true })
    .dispatchEvent("click");
  expect(new URL(touch.url()).searchParams.get("folder")).toBeNull();
  await touch.screenshot({
    path: "test-results/folder-context-menu-mobile.png",
  });
  expect(
    await touch.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mobile.close();
  expect(errors).toEqual([]);
});

test("Public file menus expose team actions and hide uploader-only deletion", async ({
  page,
}) => {
  await page
    .context()
    .setExtraHTTPHeaders({ "CF-Connecting-IP": "192.0.2.151" });
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/api" + path, {
      method,
      ...(data !== undefined ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  async function login(email: string) {
    const pin = await api("/auth/request", { email });
    await api("/auth/verify", {
      challengeId: pin.challengeId,
      pin: pin.developmentPin,
    });
  }
  const stamp = Date.now();
  await login(`menu-owner-${stamp}@international.gc.ca`);
  const bytes = Buffer.from("Public content");
  const file = (
    await api("/uploads", {
      connectorId: "r2-default",
      name: `Team-${stamp}.txt`,
      size: bytes.length,
      space: "public",
      fingerprint: "b".repeat(64),
    })
  ).file;
  await api(`/uploads/${file.id}/parts/1`, bytes, "PUT");
  await api(`/uploads/${file.id}/complete`, {});
  await api("/auth/logout", {});
  await login(`menu-member-${stamp}@international.gc.ca`);
  await page.goto("/files/?space=public");
  await page
    .getByRole("button", {
      name: `More actions for Team-${stamp}.txt`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Share file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Rename file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Delete file", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Move files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move files", exact: true });
  await expect(
    dialog
      .getByLabel("Workspace", { exact: true })
      .locator('option[value="private"]'),
  ).toHaveAttribute("disabled", "");
});
