import { test, expect } from "@playwright/test";
import { createDocumentWithText, createDocx } from "@eigenpal/docx-editor-core";
import { readFileSync } from "node:fs";
test.use({ actionTimeout: 10000 });

function pdfFixture() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["First preview page", "Second preview page"].map((text) => {
      const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body +=
    `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("");
  return Buffer.from(
    body +
      `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  );
}

function wavFixture(samples = 16000) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

test("verified download previews render documents and media under /files without exposing markup", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  async function api(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch("/files/api" + path, {
      method,
      ...(data ? { data } : {}),
      headers: { Origin: "http://127.0.0.1:8791" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const challenge = await api("/auth/request", { email: "c@bychx.com" });
  await api("/auth/verify", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  const external = await browser.newContext(),
    partner = await external.newPage();
  partner.on("pageerror", (error) => errors.push(error.message));
  const requests: string[] = [];
  partner.on("request", (request) => {
    if (request.url().includes("/preview?")) requests.push(request.url());
  });
  const fixtures = [
    { name: "message.txt", bytes: Buffer.from("Hello preview recipient.") },
    {
      name: "unsafe.svg",
      bytes: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="window.previewExecuted=true"><script>window.previewExecuted=true</script></svg>',
      ),
    },
    {
      name: "picture.png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    },
    { name: "document.pdf", bytes: pdfFixture() },
    {
      name: "document.docx",
      bytes: Buffer.from(
        await createDocx(createDocumentWithText("Read-only Word preview.")),
      ),
    },
    { name: "sound.wav", bytes: wavFixture() },
    { name: "large-sound.wav", bytes: wavFixture(6 * 1024 * 1024) },
    {
      name: "movie.webm",
      bytes: readFileSync(new URL("./fixtures/preview.webm", import.meta.url)),
    },
    { name: "archive.zip", bytes: Buffer.from("unsupported") },
    { name: "broken.pdf", bytes: Buffer.from("This is not a valid PDF.") },
  ];
  for (const fixture of fixtures) {
    const email = `preview-${fixture.name.replaceAll(".", "-")}@example.com`;
    const created = await api("/uploads", {
      connectorId: "r2-default",
      name: fixture.name,
      size: fixture.bytes.length,
      fingerprint: "b".repeat(64),
    });
    for (
      let offset = 0, part = 1;
      offset < fixture.bytes.length;
      offset += 8 * 1024 * 1024, part++
    )
      await api(
        `/uploads/${created.file.id}/parts/${part}`,
        fixture.bytes.subarray(offset, offset + 8 * 1024 * 1024),
        "PUT",
      );
    await api(`/uploads/${created.file.id}/complete`, {});
    const share = await api(`/files/${created.file.id}/shares`, {
      recipients: [email],
      expiresDays: 1,
      sendEmail: false,
    });
    await partner.goto("about:blank");
    await partner.goto(share.link);
    await partner.getByLabel("Your recipient email").fill(email);
    await partner.getByRole("button", { name: "Continue securely" }).click();
    const pin = (await partner.locator(".development").innerText()).match(
      /\d{6}/,
    )![0];
    await partner.getByLabel("Email verification PIN").fill(pin);
    await partner.getByRole("button", { name: "Verify and continue" }).click();
    const dialog = partner.getByRole("dialog", { name: "A file for you." }),
      preview = dialog.getByRole("region", {
        name: `Preview of ${fixture.name}`,
      });
    await expect(preview).toBeVisible();
    if (fixture.name === "large-sound.wav") {
      await expect(
        preview.getByRole("button", { name: "Show preview" }),
      ).toBeVisible();
      expect(requests.some((url) => url.includes(created.file.id))).toBeFalsy();
      await preview.getByRole("button", { name: "Show preview" }).click();
    }
    if (fixture.name === "message.txt")
      await expect(preview.locator("pre")).toHaveText(
        "Hello preview recipient.",
      );
    if (fixture.name === "unsafe.svg") {
      await expect(preview.locator("pre")).toContainText("<svg");
      expect(
        await partner.evaluate(() => (window as any).previewExecuted),
      ).toBeUndefined();
      await expect(preview.locator("svg[onload]")).toHaveCount(0);
    }
    if (fixture.name === "picture.png")
      await expect
        .poll(() =>
          preview
            .locator("img")
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBe(1);
    if (fixture.name === "document.pdf") {
      await expect(preview.getByText("Page 1 of 2")).toBeVisible();
      await preview.getByText("Read page text").click();
      await expect(preview.locator("pre")).toContainText("First preview page");
      await preview.getByRole("button", { name: "Next page" }).click();
      await expect(preview.locator("pre")).toContainText("Second preview page");
      await preview.getByLabel("PDF zoom").selectOption("1.5");
      await expect(preview.locator("canvas")).toBeVisible();
      expect(
        await preview
          .locator("canvas")
          .evaluate((canvas: HTMLCanvasElement) => canvas.width),
      ).toBeGreaterThan(100);
      await partner.setViewportSize({ width: 390, height: 844 });
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBeTruthy();
      await partner.screenshot({ path: "test-results/preview-mobile.png" });
      await partner.setViewportSize({ width: 1280, height: 720 });
    }
    if (fixture.name === "document.docx") {
      await expect(
        preview.getByText("Read-only Word preview.", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0);
    }
    if (["sound.wav", "large-sound.wav", "movie.webm"].includes(fixture.name)) {
      const media = preview.locator("video,audio");
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.readyState),
        )
        .toBeGreaterThanOrEqual(1);
      await media.evaluate((element: HTMLMediaElement) => {
        element.currentTime = element.duration - 0.5;
      });
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.currentTime),
        )
        .toBeGreaterThanOrEqual(0.9);
      await media.evaluate((element: HTMLMediaElement) =>
        Promise.race([
          element.play(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(Error("Media playback did not start")),
              10000,
            ),
          ),
        ]),
      );
      await media.evaluate((element: HTMLMediaElement) => element.pause());
      expect(
        await media.evaluate((element: HTMLMediaElement) => element.paused),
      ).toBeTruthy();
    }
    if (fixture.name === "archive.zip")
      await expect(preview).toContainText("Preview isn’t available");
    if (fixture.name === "broken.pdf")
      await expect(preview.getByRole("alert")).toContainText(
        "could not be previewed",
      );
    await expect(
      dialog.getByRole("link", { name: "Direct browser download" }),
    ).toBeVisible();
    if (fixture.name === "message.txt") {
      await api(`/shares/${share.id}`, undefined, "DELETE");
      await preview.getByRole("button", { name: "Hide preview" }).click();
      await preview.getByRole("button", { name: "Show preview" }).click();
      await expect(preview.getByRole("alert")).toContainText(
        /no longer available|expired|revoked/,
      );
    }
  }
  expect(requests.length).toBeGreaterThan(5);
  expect(
    requests.every((url) => url.includes("/files/api/files/")),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await external.close();
});
