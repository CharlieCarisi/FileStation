// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { shareLink } from "./share-links";
import { translate, localeFor } from "../shared/i18n";
import { sharingEmail } from "./email.js";
import {
  ensure,
  json,
  body,
  email,
  recipientEmails,
  id,
  now,
  hash,
  randomCode,
  token,
  encrypt,
  decrypt,
  cookie,
  sessionCookie,
  rate,
  audit,
  mail,
} from "./util.js";
import { currentUser, createChallenge, consumeChallenge } from "./auth.js";
import { readsFile, ownsFile } from "./workspaces";

const linkTokenPattern = /^[A-HJ-NP-Z2-9]{48}$/;
const unavailableLink = "This shared link is invalid or has expired.";

async function sharedFile(env, fileId) {
  return env.DB.prepare(
    "SELECT f.id,f.name,f.size,f.mime,f.expires_at,COALESCE(c.storage_adapter,c.adapter,c.kind) AS storage_kind FROM files f JOIN connectors c ON c.id=f.connector_id WHERE f.id=?",
  )
    .bind(fileId)
    .first();
}
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
  if (user && readsFile(user, file)) return;
  const linkToken = cookie(request, "fs_link");
  if (linkToken && linkTokenPattern.test(linkToken)) {
    const link = await env.DB.prepare(
      "SELECT id FROM shares WHERE code_hash=? AND file_id=? AND access_mode='anyone' AND revoked_at IS NULL AND expires_at>?",
    )
      .bind(await hash(linkToken), file.id, now())
      .first();
    if (link) return;
  }
  const t = cookie(request, "fs_guest");
  ensure(
    t,
    linkToken ? 410 : 401,
    linkToken
      ? unavailableLink
      : "Sign in or open a share link to download this file.",
  );
  const g = await env.DB.prepare(
    "SELECT * FROM guest_sessions WHERE token_hash=? AND expires_at>?",
  )
    .bind(await hash(t), now())
    .first();
  ensure(g, 401, "Your download session expired. Verify your email again.");
  const share = await validShare(env, g.share_id);
  ensure(
    share.file_id === file.id && share.access_mode === "recipients",
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
  if (path === "/api/shares/open" && request.method === "POST") {
    await rate(env, `share-open:${ip}`, 60, 15 * 6e4);
    const { token: linkToken } = await body(request);
    ensure(
      typeof linkToken === "string" && linkTokenPattern.test(linkToken),
      410,
      unavailableLink,
    );
    const share = await env.DB.prepare(
      "SELECT s.file_id,s.expires_at FROM shares s JOIN files f ON f.id=s.file_id WHERE s.code_hash=? AND s.access_mode='anyone' AND s.revoked_at IS NULL AND s.expires_at>? AND f.state='ready' AND (f.expires_at IS NULL OR f.expires_at>?)",
    )
      .bind(await hash(linkToken), now(), now())
      .first();
    ensure(share, 410, unavailableLink);
    const file = await sharedFile(env, share.file_id);
    ensure(file, 410, unavailableLink);
    // Browsers send this credential only to the routes for this file. Another
    // link opened in the same browser does not replace access to other files.
    const response = json({ file, expiresAt: share.expires_at });
    response.headers.set(
      "Set-Cookie",
      sessionCookie(
        env,
        "fs_link",
        linkToken,
        Math.max(
          1,
          Math.min(86400, Math.ceil((share.expires_at - now()) / 1000)),
        ),
        `${env.BASE_PATH || ""}/api/files/${encodeURIComponent(file.id)}`,
      ),
    );
    return response;
  }
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
      "SELECT s.id FROM shares s JOIN share_recipients r ON r.share_id=s.id WHERE s.code_hash=? AND r.email=? AND s.access_mode='recipients'",
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
      s.access_mode === "recipients" &&
        (await env.DB.prepare(
          "SELECT email FROM share_recipients WHERE share_id=? AND email=?",
        )
          .bind(s.id, c.email)
          .first()),
      403,
      "This recipient is no longer authorized.",
    );
    const f = await sharedFile(env, s.file_id);
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
    ensure(file && readsFile(user, file), 404, "File not found.");
    if (request.method === "GET") {
      const shares = await env.DB.prepare(
        `SELECT id,created_at,expires_at,revoked_at,access_mode,encrypted_link_token FROM shares WHERE file_id=? ${ownsFile(user, file) ? "" : "AND created_by=?"} ORDER BY created_at DESC`,
      )
        .bind(...(ownsFile(user, file) ? [file.id] : [file.id, user.id]))
        .all();
      return json({
        shares: await Promise.all(
          shares.results.map(async ({ encrypted_link_token, ...share }) => {
            if (share.access_mode === "anyone") {
              const active =
                !share.revoked_at &&
                share.expires_at > now() &&
                file.state === "ready" &&
                (!file.expires_at || file.expires_at > now());
              const link =
                active && encrypted_link_token
                  ? await shareLink(
                      request,
                      env,
                      (await decrypt(env, encrypted_link_token)).token,
                      "link",
                    )
                  : undefined;
              return { ...share, recipients: [], link };
            }
            const recipients = (
              await env.DB.prepare(
                "SELECT email FROM share_recipients WHERE share_id=?",
              )
                .bind(share.id)
                .all()
            ).results.map((r) => r.email);
            return { ...share, recipients };
          }),
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
      const accessMode =
        b.accessMode === undefined ? "recipients" : b.accessMode;
      ensure(
        accessMode === "recipients" || accessMode === "anyone",
        400,
        "Choose a valid share access type.",
      );
      const anyone = accessMode === "anyone";
      const recipients = anyone ? [] : recipientEmails(b.recipients);
      const sendEmail = !anyone && b.sendEmail;
      ensure(
        Number.isInteger(b.expiresDays) &&
          b.expiresDays >= 1 &&
          b.expiresDays <= 365,
        400,
        "Share lifetime must be between 1 and 365 days.",
      );
      await rate(env, `share-create:${user.id}`, 60, 36e5);
      const shareId = id(),
        code = anyone ? token() : randomCode(),
        expiresAt = Math.min(
          now() + b.expiresDays * 864e5,
          file.expires_at || Infinity,
        );
      const created = await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO shares(id,file_id,code_hash,created_by,created_at,expires_at,access_mode,encrypted_link_token) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM files WHERE id=? AND state='ready' AND (expires_at IS NULL OR expires_at>?) AND (owner_id=? OR space='public' OR ?=1)) RETURNING id",
        ).bind(
          shareId,
          file.id,
          await hash(code),
          user.id,
          now(),
          expiresAt,
          accessMode,
          anyone ? await encrypt(env, { token: code }) : null,
          file.id,
          now(),
          user.id,
          user.role === "admin" ? 1 : 0,
        ),
        ...recipients.map((e) =>
          env.DB.prepare(
            "INSERT INTO share_recipients(share_id,email) SELECT ?,? WHERE EXISTS(SELECT 1 FROM shares WHERE id=?)",
          ).bind(shareId, e, shareId),
        ),
      ]);
      ensure(
        created[0].results.length,
        409,
        "The file changed. Refresh and try again.",
      );
      const link = await shareLink(
        request,
        env,
        code,
        anyone ? "link" : "share",
      );
      let emailSent = false,
        emailError;
      const language = localeFor(env.LANGUAGE),
        text = (key, values) => translate(key, language, values);
      if (sendEmail) {
        try {
          await mail(
            env,
            recipients,
            text("{0} shared a file with you", { 0: user.email }),
            text("{0} shared {1} with you.", { 0: user.email, 1: file.name }) +
              "\n\n" +
              text("Open File Station: {0}", { 0: link }) +
              "\n" +
              text("Access code: {0}", { 0: code }) +
              "\n\n" +
              text(
                "This share expires {0}. It may expire earlier if the owner deletes the file or storage retention removes it.",
                { 0: new Date(expiresAt).toISOString() },
              ),
            sharingEmail(
              user.email,
              file.name,
              link,
              code,
              expiresAt,
              language,
            ),
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
          code: anyone ? undefined : code,
          link,
          accessMode,
          expiresAt,
          emailSent,
          emailError,
          recipientCount: recipients.length,
          developmentEmail: env.DEV_MODE === "true" && !!sendEmail,
        },
        201,
      );
    }
  }
  const revoke = path.match(/^\/api\/shares\/([^/]+)$/);
  if (revoke && request.method === "DELETE") {
    const user = await currentUser(request, env, true);
    const s = await env.DB.prepare(
      "SELECT s.id,s.created_by,f.owner_id FROM shares s JOIN files f ON f.id=s.file_id WHERE s.id=?",
    )
      .bind(revoke[1])
      .first();
    ensure(
      s &&
        (s.owner_id === user.id ||
          s.created_by === user.id ||
          user.role === "admin"),
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
