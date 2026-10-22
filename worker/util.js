// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { emailLayout } from "./email.js";
import { base64, smtpMail } from "./smtp.js";
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
  static {
    __name(this, "HttpError");
  }
};
function ensure(value, status, message) {
  if (!value) throw new HttpError(status, message);
}
__name(ensure, "ensure");
function json(value, status = 200) {
  return Response.json(value, { status });
}
__name(json, "json");
async function body(request) {
  ensure(
    Number(request.headers.get("content-length") || 0) <= 65536,
    413,
    "Request is too large.",
  );
  const raw = await request.text();
  ensure(raw.length <= 65536, 413, "Request is too large.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
__name(body, "body");
function email(value) {
  ensure(typeof value === "string", 400, "Enter an email address.");
  const e = value.trim().toLowerCase();
  ensure(
    e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
    400,
    "Enter a valid email address.",
  );
  return e;
}
__name(email, "email");
var id = /* @__PURE__ */ __name(() => crypto.randomUUID(), "id");
var now = /* @__PURE__ */ __name(() => Date.now(), "now");
async function hash(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    typeof value === "string" ? new TextEncoder().encode(value) : value,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
__name(hash, "hash");
function randomCode(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (b) => chars[b % chars.length],
  ).join("");
}
__name(randomCode, "randomCode");
function pin() {
  const a = new Uint32Array(1);
  do {
    crypto.getRandomValues(a);
  } while (a[0] >= 4294e6);
  return String(a[0] % 1e6).padStart(6, "0");
}
__name(pin, "pin");
var token = /* @__PURE__ */ __name(() => randomCode(48), "token");
function cookie(request, name) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
__name(cookie, "cookie");
function sessionCookie(env, name, value, seconds) {
  return `${name}=${value}; Path=${env.BASE_PATH || "/"}; HttpOnly; SameSite=Strict; Max-Age=${seconds}${env.DEV_MODE === "true" ? "" : "; Secure"}`;
}
__name(sessionCookie, "sessionCookie");
function checkOrigin(request, env) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = env.APP_ORIGIN || new URL(request.url).origin;
  ensure(
    request.headers.get("origin") === expected,
    403,
    "Request origin is not allowed.",
  );
}
__name(checkOrigin, "checkOrigin");
async function rate(env, key, limit, windowMs) {
  const time = now();
  const r = await env.DB.prepare(
    `INSERT INTO rate_limits(key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count`,
  )
    .bind(key, time + windowMs, time, time, time + windowMs)
    .first();
  ensure(
    r && r.count <= limit,
    429,
    "Too many attempts. Please try again later.",
  );
}
__name(rate, "rate");
async function audit(env, actor, action, target) {
  await env.DB.prepare(
    "INSERT INTO audit_log(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
  )
    .bind(id(), actor, action, target, now())
    .run();
}
__name(audit, "audit");
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
__name(escapeHtml, "escapeHtml");
async function mail(env, to, subject, text, html) {
  if (env.DEV_MODE === "true") return;
  html ||= emailLayout({
    eyebrow: "FILE STATION",
    title: subject,
    intro: text,
    details: "",
    footer: "Sent securely by File Station.",
  });
  if (!env.SMTP2GO_API_KEY && env.SMTP2GO_USERNAME && env.SMTP2GO_PASSWORD) {
    await smtpMail(env, to, subject, text, html);
    return;
  }
  ensure(
    env.SMTP2GO_API_KEY && env.SMTP_FROM,
    503,
    "Email delivery is not configured.",
  );
  const r = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.SMTP2GO_API_KEY,
      sender: env.SMTP_FROM,
      to,
      subject,
      text_body: text,
      html_body: html,
    }),
  });
  const result = await r.json();
  ensure(
    r.ok &&
      result.data?.succeeded === to.length &&
      !result.data?.failed &&
      !result.data?.error_code,
    502,
    "The email provider could not deliver the message. Please try again.",
  );
}
__name(mail, "mail");
function bytes64(data) {
  return btoa(String.fromCharCode(...data));
}
__name(bytes64, "bytes64");
function from64(data) {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
__name(from64, "from64");
async function encryptionKey(env) {
  ensure(
    env.CONNECTOR_ENCRYPTION_KEY,
    503,
    "Connector encryption key is not configured.",
  );
  let key;
  try {
    key = from64(env.CONNECTOR_ENCRYPTION_KEY);
  } catch {
    throw new HttpError(
      503,
      "Connector encryption key must be base64 encoded.",
    );
  }
  ensure(
    key.byteLength === 32,
    503,
    "Connector encryption key must contain 32 random bytes.",
  );
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
__name(encryptionKey, "encryptionKey");
async function encrypt(env, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return `${bytes64(iv)}.${bytes64(new Uint8Array(ciphertext))}`;
}
__name(encrypt, "encrypt");
async function decrypt(env, data) {
  const [iv, value] = data.split(".");
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: from64(iv) },
        await encryptionKey(env),
        from64(value),
      ),
    ),
  );
}
__name(decrypt, "decrypt");
function errorResponse(error) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  const frames =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .filter((line) => /^\s*at /.test(line))
          .slice(0, 4)
      : [];
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "unknown",
    frames,
  );
  return json(
    { error: "The operation could not be completed. Please try again." },
    500,
  );
}
__name(errorResponse, "errorResponse");

export {
  HttpError,
  ensure,
  json,
  body,
  email,
  id,
  now,
  hash,
  randomCode,
  pin,
  token,
  cookie,
  sessionCookie,
  checkOrigin,
  rate,
  audit,
  escapeHtml,
  mail,
  bytes64,
  from64,
  encryptionKey,
  encrypt,
  decrypt,
  errorResponse,
};
