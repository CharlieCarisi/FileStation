import { test, expect } from "@playwright/test";
test.use({ actionTimeout: 10000 });
test.afterEach(async ({ page }) => {
  const response = await page.request.get("/files/api/me");
  if ((await response.json()).user?.role === "admin")
    await page.request.put("/files/api/admin/settings", {
      data: { shareBaseUrl: "current" },
      headers: { Origin: "http://127.0.0.1:8791" },
    });
});

test("French and Chinese public pages preserve inputs, localize errors, and persist language", async ({
  page,
}) => {
  await page.goto("/files/?lang=fr-CA");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
  await expect(
    page.getByRole("heading", { name: "Vous avez un code d’accès?" }),
  ).toBeVisible();
  await page
    .getByLabel("Votre adresse courriel de destinataire")
    .fill("partner@example.com");
  await page.getByLabel("Code d’accès au fichier").fill("BADCODE");
  await page.getByTestId("language-selector").selectOption("zh-CN");
  await expect(page.getByLabel("您的接收邮箱")).toHaveValue(
    "partner@example.com",
  );
  await page.getByRole("button", { name: "安全继续" }).click();
  await expect(page.getByRole("alert")).toContainText("请输入有效的下载");
  await page.getByTestId("language-selector").selectOption("fr-CA");
  await expect(page.getByRole("alert")).toContainText(
    "Entrez un code d’accès valide",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/french-mobile.png",
    animations: "disabled",
  });
  await page.getByTestId("language-selector").selectOption("zh-CN");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "有访问码？" })).toBeVisible();
  await page.screenshot({
    path: "test-results/chinese-mobile.png",
    animations: "disabled",
  });
});

test("admin address toggle affects localized share/invitation links and recipients keep original filenames", async ({
  page,
  browser,
}) => {
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
  await page.goto("/files/");
  await page.getByTestId("language-selector").selectOption("fr-CA");
  await page
    .getByRole("button", { name: "Paramètres et activité", exact: true })
    .click();
  const address = page.getByRole("combobox", {
    name: "Adresse des liens de partage",
  });
  await expect(address).toBeEnabled();
  await address.selectOption("https://utils.bychx.com/files");
  await page
    .getByRole("button", {
      name: "Enregistrer l’adresse de partage",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Adresse des liens de partage enregistrée.",
  );
  expect(await api("/admin/settings", undefined, "GET")).toMatchObject({
    shareBaseUrl: "https://utils.bychx.com/files",
    allowedDomains: ["international.gc.ca"],
  });
  const created = await api("/uploads", {
    connectorId: "r2-default",
    name: "Sign in",
    size: 1,
    fingerprint: "a".repeat(64),
  });
  await api(`/uploads/${created.file.id}/parts/1`, Buffer.from("A"), "PUT");
  await api(`/uploads/${created.file.id}/complete`, {});
  await page.reload();
  await page
    .getByRole("button", { name: "Partager Sign in", exact: true })
    .click();
  const share = page.getByRole("dialog");
  await share
    .getByLabel("Adresses courriel des destinataires")
    .fill("partner-lang@example.com");
  await share
    .getByLabel("Envoyer le lien automatiquement par courriel")
    .uncheck();
  await share
    .getByRole("button", { name: "Créer le partage", exact: true })
    .click();
  const link = await share
    .getByLabel("Lien de partage", { exact: true })
    .inputValue();
  expect(link).toMatch(
    /^https:\/\/utils\.bychx\.com\/files\/\?lang=fr-CA#share=/,
  );
  const external = await browser.newContext(),
    partner = await external.newPage(),
    url = new URL(link);
  await partner.goto("http://127.0.0.1:8791/files/" + url.search + url.hash);
  await partner
    .getByLabel("Votre adresse courriel de destinataire")
    .fill("partner-lang@example.com");
  await partner
    .getByRole("button", { name: "Continuer de façon sécuritaire" })
    .click();
  const pin = (await partner.locator(".development").innerText()).match(
    /\d{6}/,
  )![0];
  await partner.getByLabel("NIP de vérification du courriel").fill(pin);
  await partner.getByRole("button", { name: "Vérifier et continuer" }).click();
  await expect(
    partner
      .getByRole("dialog", { name: "Un fichier pour vous." })
      .locator(".received-file strong"),
  ).toHaveText("Sign in");
  await external.close();
  await share.getByRole("button", { name: "Fermer", exact: true }).click();
  await page
    .getByRole("button", { name: "Demandes de fichiers", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Nouvelle demande de fichiers", exact: true })
    .click();
  const invitation = page.getByRole("dialog");
  await invitation
    .getByLabel("Titre de l’invitation")
    .fill("Do not translate this title");
  await invitation
    .getByLabel("Adresses courriel invitées")
    .fill("partner-lang@example.com");
  await invitation
    .getByLabel("Envoyer l’invitation automatiquement par courriel")
    .uncheck();
  await invitation
    .getByRole("button", { name: "Créer l’invitation", exact: true })
    .click();
  expect(await invitation.getByLabel("Lien d’invitation").inputValue()).toMatch(
    /^https:\/\/utils\.bychx\.com\/files\/\?lang=fr-CA#share=U/,
  );
  await invitation.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByTestId("language-selector").selectOption("zh-CN");
  await expect(
    page.getByText("Do not translate this title", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "设置与操作记录", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "共享链接地址" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/chinese-settings-mobile.png",
    animations: "disabled",
  });
});
