import french from "@eigenpal/docx-editor-i18n/fr";
import chinese from "@eigenpal/docx-editor-i18n/zh-CN";
import { getLocale } from "./i18n";
export const docxLocale = () =>
  getLocale() === "fr-CA"
    ? french
    : getLocale() === "zh-CN"
      ? chinese
      : undefined;
