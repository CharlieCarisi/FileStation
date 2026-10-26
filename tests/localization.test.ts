import { expect, it } from "vitest";
import { catalogs, translate, localeFor } from "../shared/i18n";
import { verificationEmail, sharingEmail } from "../worker/email.js";

it("has complete French/Chinese catalogs with valid interpolation variables", () => {
  const keys = Object.keys(catalogs["en-CA"]).sort();
  expect(keys.length).toBeGreaterThan(700);
  for (const locale of ["fr-CA", "zh-CN"] as const) {
    expect(Object.keys(catalogs[locale]).sort()).toEqual(keys);
    for (const key of keys) {
      const source = new Set(key.match(/\{\d+\}/g) || []),
        target = new Set(catalogs[locale][key].match(/\{\d+\}/g) || []);
      expect(target, `${locale}: ${key}`).toEqual(source);
      if (key !== "s")
        expect(
          catalogs[locale][key].trim().length,
          `${locale}: ${key}`,
        ).toBeGreaterThan(0);
    }
  }
});
it("preserves dynamic filenames, codes, whitespace and unknown messages", () => {
  expect(translate("Download {0}", "fr-CA", { 0: "Sign in" })).toBe(
    "Télécharger Sign in",
  );
  expect(translate("Access code: {0}", "zh-CN", { 0: "ABC123" })).toBe(
    "访问码：ABC123",
  );
  expect(translate(" Preview of report.docx ", "fr-CA")).toBe(
    " Aperçu de report.docx ",
  );
  expect(translate("constructor", "fr-CA")).toBe("constructor");
  expect(translate("unrecognized provider message", "zh-CN")).toBe(
    "unrecognized provider message",
  );
  expect(localeFor("<script>")).toBe("en-CA");
});
it("localizes branded verification and sharing emails without translating or injecting user data", () => {
  const french = verificationEmail("123456", "login", "fr-CA");
  expect(french).toContain('lang="fr-CA"');
  expect(french).toContain("Votre code de connexion.");
  expect(french).toContain("123456");
  expect(french).toContain("10 minutes");
  const chinese = sharingEmail(
    "owner@example.com",
    "<img src=x>Sign in",
    "https://utils.bychx.com/files/?lang=zh-CN#share=ABC123",
    "ABC123",
    Date.now() + 60000,
    "zh-CN",
  );
  expect(chinese).toContain('lang="zh-CN"');
  expect(chinese).toContain("您的文件已共享。");
  expect(chinese).toContain("owner@example.com");
  expect(chinese).toContain("&lt;img src=x&gt;Sign in");
  expect(chinese).not.toContain("<img src=x>");
  expect(chinese).toContain("/files/?lang=zh-CN#share=ABC123");
});
