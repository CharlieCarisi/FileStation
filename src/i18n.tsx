import React, { createContext, useContext, useState } from "react";
import { translate, localeFor, type Locale } from "../shared/i18n";
function initialLocale(): Locale {
  try {
    const query = new URLSearchParams(location.search).get("lang");
    if (query && ["en-CA", "fr-CA", "zh-CN"].includes(query))
      return localeFor(query);
    const stored = localStorage.getItem("fs-language");
    if (stored) return localeFor(stored);
  } catch {
    /* Browser privacy settings can disable preferences. */
  }
  const language = navigator.language.toLowerCase();
  return language.startsWith("fr")
    ? "fr-CA"
    : language.startsWith("zh")
      ? "zh-CN"
      : "en-CA";
}
let current: Locale = initialLocale();
export const getLocale = () => current;
export const t = (message: string, values?: Record<string, unknown>) =>
  translate(message, current, values);
const Context = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>({ locale: current, setLocale: () => {} });
export const useLanguage = () => useContext(Context);
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, update] = useState(current);
  function setLocale(value: Locale) {
    current = localeFor(value);
    update(current);
    document.documentElement.lang = current;
    try {
      localStorage.setItem("fs-language", current);
      const url = new URL(location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.set("lang", current);
        history.replaceState(null, "", url);
      }
    } catch {}
  }
  document.documentElement.lang = locale;
  return (
    <Context.Provider value={{ locale, setLocale }}>
      {children}
    </Context.Provider>
  );
}
export function LanguageSelector() {
  const { locale, setLocale } = useLanguage();
  return (
    <label className="language-selector">
      <span className="sr-only">{t("Language")}</span>
      <select
        data-testid="language-selector"
        aria-label={t("Language")}
        value={locale}
        onChange={(event) => setLocale(localeFor(event.target.value))}
      >
        <option value="en-CA" lang="en-CA">
          English (Canada)
        </option>
        <option value="fr-CA" lang="fr-CA">
          Français (Canada)
        </option>
        <option value="zh-CN" lang="zh-CN">
          简体中文
        </option>
      </select>
    </label>
  );
}
