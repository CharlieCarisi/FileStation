// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { sharingEmail } from "./email.js";
import {
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
  rate,
  audit,
  mail,
} from "./util.js";
import { currentUser, createChallenge, consumeChallenge } from "./auth.js";
async function validShare(env, shareId) {
  const s = await env.DB.prepare(
    "SELECT s.* FROM shares s JOIN files f ON f.id=s.file_id WHERE s.id=? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?) AND f.state='ready' AND (f.expires_at IS NULL OR f.expires_at>?)",
  )
    .bind(shareId, now(), now())
    .first();
  ensure(
    s,
    410,
    "This access code is invalid or the file is no longer available.",
  );
  return s;
}
__name(validShare, "validShare");
async function fileAccess(request, env, file) {
  ensure(
    file.state === "ready" && (!file.expires_at || file.expires_at > now()),
    410,
    "This file is no longer available.",
  );
  let user;
  try {
    user = await currentUser(request, env, true);
  } catch {}
  if (user && (user.id === file.owner_id || user.role === "admin")) return;
  const t = cookie(request, "fs_guest");
  ensure(t, 401, "Verify your email to download this file.");
  const g = await env.DB.prepare(
    "SELECT * FROM guest_sessions WHERE token_hash=? AND expires_at>?",
  )
    .bind(await hash(t), now())
    .first();
  ensure(g, 401, "Your download session expired. Verify your email again.");
  const share = await validShare(env, g.share_id);
  ensure(
    share.file_id === file.id,
    403,
    "This access code does not authorize this file.",
  );
  ensure(
    await env.DB.prepare(
      "SELECT email FROM share_recipients WHERE share_id=? AND email=?",
    )
      .bind(share.id, g.email)
      .first(),
    403,
    "This recipient is no longer authorized.",
  );
}
__name(fileAccess, "fileAccess");
async function shareRoutes(request, env, path) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (path === "/api/shares/access" && request.method === "POST") {
    await rate(env, `share-ip:${ip}`, 30, 15 * 6e4);
    const b = await body(request);
    const address = email(b.email);
    const code =
      typeof b.code === "string"
        ? b.code.replace(/[\s-]/g, "").toUpperCase()
        : "";
    ensure(
      /^[A-Z2-9]{12}$/.test(code),
      400,
      "Enter the 12-character access code.",
    );
    const s = await env.DB.prepare(
      "SELECT s.id FROM shares s JOIN share_recipients r ON r.share_id=s.id WHERE s.code_hash=? AND r.email=?",
    )
      .bind(await hash(code), address)
      .first();
    ensure(s, 400, "Invalid access code or recipient email.");
    await validShare(env, s.id);
    return json(await createChallenge(env, address, "share", s.id, ip));
  }
  if (path === "/api/shares/verify" && request.method === "POST") {
    const b = await body(request),
      c = await consumeChallenge(env, b.challengeId, b.pin, "share", ip);
    const s = await validShare(env, c.share_id);
    ensure(
      await env.DB.prepare(
        "SELECT email FROM share_recipients WHERE share_id=? AND email=?",
      )
        .bind(s.id, c.email)
        .first(),
      403,
      "This recipient is no longer authorized.",
    );
    const f = await env.DB.prepare(
      "SELECT f.id,f.name,f.size,f.mime,f.expires_at,COALESCE(c.storage_adapter,c.adapter,c.kind) AS storage_kind FROM files f JOIN connectors c ON c.id=f.connector_id WHERE f.id=?",
    )
      .bind(s.file_id)
      .first();
    const t = token();
    await env.DB.prepare(
      "INSERT INTO guest_sessions(token_hash,share_id,email,expires_at) VALUES (?,?,?,?)",
    )
      .bind(await hash(t), s.id, c.email, now() + 864e5)
      .run();
    return new Response(JSON.stringify({ file: f }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": sessionCookie(env, "fs_guest", t, 86400),
      },
    });
  }
  const match = path.match(/^\/api\/files\/([^/]+)\/shares$/);
  if (match) {
    const user = await currentUser(request, env, true),
      file = await env.DB.prepare("SELECT * FROM files WHERE id=?")
        .bind(match[1])
        .first();
    ensure(
      file && (file.owner_id === user.id || user.role === "admin"),
      404,
      "File not found.",
    );
    if (request.method === "GET") {
      const shares = await env.DB.prepare(
        "SELECT id,created_at,expires_at,revoked_at FROM shares WHERE file_id=? ORDER BY created_at DESC",
      )
        .bind(file.id)
        .all();
      return json({
        shares: await Promise.all(
          shares.results.map(async (s) => ({
            ...s,
            recipients: (
              await env.DB.prepare(
                "SELECT email FROM share_recipients WHERE share_id=?",
              )
                .bind(s.id)
                .all()
            ).results.map((r) => r.email),
          })),
        ),
      });
    }
    if (request.method === "POST") {
      ensure(
        file.state === "ready" && (!file.expires_at || file.expires_at > now()),
        410,
        "This file is no longer available.",
      );
      const b = await body(request);
      ensure(
        Array.isArray(b.recipients) &&
          b.recipients.length > 0 &&
          b.recipients.length <= 20,
        400,
        "Enter between 1 and 20 recipient email addresses.",
      );
      const recipients = [...new Set(b.recipients.map(email))];
      ensure(
        Number.isInteger(b.expiresDays) &&
          b.expiresDays >= 1 &&
          b.expiresDays <= 365,
        400,
        "Share lifetime must be between 1 and 365 days.",
      );
      await rate(env, `share-create:${user.id}`, 60, 36e5);
      const shareId = id(),
        code = randomCode(),
        expiresAt = Math.min(
          now() + b.expiresDays * 864e5,
          file.expires_at || Infinity,
        );
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO shares(id,file_id,code_hash,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)",
        ).bind(shareId, file.id, await hash(code), user.id, now(), expiresAt),
        ...recipients.map((e) =>
          env.DB.prepare(
            "INSERT INTO share_recipients(share_id,email) VALUES (?,?)",
          ).bind(shareId, e),
        ),
      ]);
      const origin = env.APP_ORIGIN || new URL(request.url).origin;
      const link = `${origin}${env.BASE_PATH || ""}/#share=${code}`;
      let emailSent = false,
        emailError;
      if (b.sendEmail) {
        try {
          await mail(
            env,
            recipients,
            `${user.email} shared a file with you`,
            `${user.email} shared ${file.name} with you.

Open File Station: ${link}
Access code: ${code}

Use your recipient email address to verify access. This share expires on ${new Date(expiresAt).toISOString()} and may become unavailable earlier if its owner deletes it or storage retention removes it.`,
            sharingEmail(user.email, file.name, link, code, expiresAt),
          );
          emailSent = true;
        } catch {
          emailError =
            "Share created, but email delivery failed. Copy the link to send it manually.";
        }
      }
      await audit(env, user.id, "share.created", shareId);
      return json(
        {
          id: shareId,
          code,
          link,
          expiresAt,
          emailSent,
          emailError,
          developmentEmail: env.DEV_MODE === "true" && b.sendEmail,
        },
        201,
      );
    }
  }
  const revoke = path.match(/^\/api\/shares\/([^/]+)$/);
  if (revoke && request.method === "DELETE") {
    const user = await currentUser(request, env, true);
    const s = await env.DB.prepare(
      "SELECT s.id,f.owner_id FROM shares s JOIN files f ON f.id=s.file_id WHERE s.id=?",
    )
      .bind(revoke[1])
      .first();
    ensure(
      s && (s.owner_id === user.id || user.role === "admin"),
      404,
      "Share not found.",
    );
    await env.DB.prepare("UPDATE shares SET revoked_at=? WHERE id=?")
      .bind(now(), s.id)
      .run();
    await audit(env, user.id, "share.revoked", s.id);
    return json({ ok: true });
  }
  return null;
}
__name(shareRoutes, "shareRoutes");

export { validShare, fileAccess, shareRoutes };
