import type { Env } from "./model";
export const SHARE_ADDRESSES = [
  "current",
  "https://files.bychx.com",
  "https://utils.bychx.com/files",
] as const;
const requestBases = new WeakMap<Request, Promise<string>>();
async function resolveBase(request: Request, env: Env) {
  const setting = await env.DB.prepare(
    "SELECT value FROM settings WHERE key='share_base_url'",
  ).first<{ value: string }>();
  const selected = setting?.value;
  return selected &&
    selected !== "current" &&
    (SHARE_ADDRESSES as readonly string[]).includes(selected)
    ? selected
    : `${env.APP_ORIGIN || new URL(request.url).origin}${env.BASE_PATH || ""}`;
}
export async function shareLink(request: Request, env: Env, code: string) {
  // One settings snapshot per request keeps invitation lists consistent without
  // adding a database lookup for each row. Later requests see new settings.
  let pending = requestBases.get(request);
  if (!pending) {
    pending = resolveBase(request, env);
    requestBases.set(request, pending);
  }
  const base = await pending;
  const language = request.headers.get("X-FileStation-Language");
  const query =
    language === "fr-CA" || language === "zh-CN" ? `?lang=${language}` : "";
  return `${base}/${query}#share=${encodeURIComponent(code)}`;
}
