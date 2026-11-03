import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js/index-native.js";
test.use({ actionTimeout: 10000 });

for (const [index, prefix] of ["", "/files"].entries()) {
  test(`folder ZIP downloads work in tiles, rows and menus without browser staging at ${prefix || "/"}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .context()
      .setExtraHTTPHeaders({ "CF-Connecting-IP": `192.0.2.${171 + index}` });
    await page.addInitScript(() => {
      (window as any).storageCalls = 0;
      Object.defineProperty(navigator.storage, "getDirectory", {
        configurable: true,
        value: async () => {
          (window as any).storageCalls++;
          throw new DOMException("No browser storage", "QuotaExceededError");
        },
      });
      Object.defineProperty(navigator.storage, "estimate", {
        configurable: true,
        value: async () => ({ quota: 1, usage: 0 }),
      });
    });
    async function api(path: string, data?: any, method = "POST") {
      const response = await page.request.fetch(`${prefix}/api${path}`, {
        method,
        ...(data !== undefined ? { data } : {}),
        headers: {
          Origin: "http://127.0.0.1:8791",
          ...(Buffer.isBuffer(data)
            ? { "Content-Type": "application/octet-stream" }
            : {}),
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    }
    const login = await api("/auth/request", {
      email: `folder-download-${index}-${Date.now()}@international.gc.ca`,
    });
    await api("/auth/verify", {
      challengeId: login.challengeId,
      pin: login.developmentPin,
    });
    const folder = (await api("/folders", { name: "Reports 合同" })).folder;
    const child = (
      await api("/folders", { name: "Nested", parentId: folder.id })
    ).folder;
    await api("/folders", { name: "Empty", parentId: folder.id });
    const bytes = Buffer.alloc(1024 * 1024 + 37, "Native ZIP download 合同\n");
    const created = await api("/uploads", {
      name: "Document.txt",
      folderId: child.id,
      connectorId: "r2-default",
      size: bytes.length,
      fingerprint: "a".repeat(64),
    });
    await api(`/uploads/${created.file.id}/parts/1`, bytes, "PUT");
    await api(`/uploads/${created.file.id}/complete`, {});
    const pending = (
      await api("/uploads", {
        name: "Pending.txt",
        folderId: child.id,
        connectorId: "r2-default",
        size: 8,
        fingerprint: "b".repeat(64),
      })
    ).file;
    await page.goto(`${prefix}/`);
    await page
      .getByRole("button", {
        name: "Download folder Reports 合同",
        exact: true,
      })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Download folder",
      exact: true,
    });
    await expect(dialog).toContainText("1 files");
    await expect(dialog).toContainText("Unfinished uploads are skipped");
    const downloadPromise = page.waitForEvent("download");
    await dialog
      .getByRole("link", { name: "Download ZIP", exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Reports 合同.zip");
    expect(download.url()).toContain(
      `${prefix}/api/folders/${folder.id}/download`,
    );
    const savedPath = await download.path();
    expect(savedPath).not.toBeNull();
    expect(await download.failure()).toBeNull();
    const reader = new ZipReader(
      new Uint8ArrayReader(new Uint8Array(await readFile(savedPath!))),
      { useWebWorkers: false, checkSignature: true },
    );
    const entries = await reader.getEntries();
    expect(entries.map((entry) => entry.filename).sort()).toEqual(
      [
        "Reports 合同/",
        "Reports 合同/Empty/",
        "Reports 合同/Nested/",
        "Reports 合同/Nested/Document.txt",
      ].sort(),
    );
    const document = entries.find((entry) => !entry.directory)!;
    if (document.directory) throw Error("Expected document");
    expect(Buffer.from(await document.getData(new Uint8ArrayWriter()))).toEqual(
      bytes,
    );
    await reader.close();
    await expect(dialog.getByRole("status")).toContainText(
      "Check your browser’s downloads",
    );
    expect(await page.evaluate(() => (window as any).storageCalls)).toBe(0);
    expect(
      (await api(`/uploads/${pending.id}`, undefined, "GET")).file.state,
    ).toBe("uploading");
    expect((await api("/files", undefined, "GET")).files).toHaveLength(2);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Folder list view", exact: true })
      .click();
    await page.getByTestId("language-selector").selectOption("fr-CA");
    await page
      .getByRole("button", {
        name: "Télécharger le dossier Reports 合同",
        exact: true,
      })
      .click();
    const french = page.getByRole("dialog", {
      name: "Télécharger le dossier",
      exact: true,
    });
    await expect(french).toContainText("Aucune copie n’est enregistrée");
    await french.locator(".modal-close").click();
    await page.getByTestId("language-selector").selectOption("zh-CN");
    await page
      .getByRole("button", { name: "下载文件夹 Reports 合同", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "下载文件夹", exact: true }),
    ).toContainText("未完成的上传会被跳过");
    await page.getByRole("dialog").locator(".modal-close").click();
    await page.getByTestId("language-selector").selectOption("en-CA");
    await page.locator(".folder-row").click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Download folder", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Download folder", exact: true });
    await expect(
      dialog.getByRole("link", { name: "Download ZIP", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
