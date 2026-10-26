import english from "../locales/en-CA.json";
import french from "../locales/fr-CA.json";
import chinese from "../locales/zh-CN.json";
export type Locale = "en-CA" | "fr-CA" | "zh-CN";
export const locales = ["en-CA", "fr-CA", "zh-CN"] as const;
export function localeFor(value: unknown): Locale {
  return typeof value === "string" &&
    (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : "en-CA";
}
export const catalogs: Record<Locale, Record<string, string>> = {
  "en-CA": english,
  "fr-CA": french,
  "zh-CN": chinese,
};
const templates = Object.keys(english)
  .filter((key) => /\{\d+\}/.test(key))
  .map((key) => {
    const names: string[] = [];
    const parts = key.split(/(\{\d+\})/).map((part) => {
      if (/^\{\d+\}$/.test(part)) {
        names.push(part.slice(1, -1));
        return "([\\s\\S]*?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    return { key, names, regex: new RegExp("^" + parts.join("") + "$") };
  })
  .sort((a, b) => b.key.length - a.key.length);
export function translate(
  message: string,
  locale: Locale,
  values?: Record<string, unknown>,
): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  let key = normalized,
    args = values;
  if (!Object.hasOwn(english, key) && !args) {
    for (const template of templates) {
      const match = template.regex.exec(normalized);
      if (match) {
        key = template.key;
        args = Object.fromEntries(
          template.names.map((name, index) => [name, match[index + 1]]),
        );
        break;
      }
    }
  }
  const catalog = catalogs[locale];
  const result = Object.hasOwn(catalog, key) ? catalog[key] : key;
  const formatted = result.replace(/\{(\d+)\}/g, (whole, name) =>
    args && Object.hasOwn(args, name) ? String(args[name]) : whole,
  );
  return (
    (message.match(/^\s*/)?.[0] || "") +
    formatted +
    (message.match(/\s*$/)?.[0] || "")
  );
}
