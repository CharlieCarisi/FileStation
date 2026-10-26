import { getLocale } from "./i18n";
export const basePath =
  location.pathname === "/files" || location.pathname.startsWith("/files/")
    ? "/files"
    : "";
async function api(S, v = {}) {
  const T = await fetch(`${basePath}/api${S}`, {
      ...v,
      headers: {
        "X-FileStation-Language": getLocale(),
        ...(v.body && typeof v.body == "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...v.headers,
      },
      credentials: "same-origin",
    }),
    o = await T.json();
  if (!T.ok) {
    const error = new Error(o.error || "The request failed.");
    error.status = T.status;
    throw error;
  }
  return o;
}
const post = (S, v = {}, options = {}) =>
  api(S, { ...options, method: "POST", body: JSON.stringify(v) });

export { api, post };
