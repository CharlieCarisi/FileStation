// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { verificationEmail } from "./email.js";
import {
  ensure,
  json,
  body,
  email,
  id,
  now,
  hash,
  pin,
  token,
  cookie,
  sessionCookie,
  rate,
  mail,
} from "./util.js";
async function currentUser(request, env, active = false, admin = false) {
  const t = cookie(request, "fs_session");
  ensure(t, 401, "Sign in to continue.");
  const u = await env.DB.prepare(
    "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
  )
    .bind(await hash(t), now())
    .first();
  ensure(
    u && !["inactive", "deleted"].includes(u.status),
    401,
    "Your session has ended. Please sign in again.",
  );
  ensure(
    !active || u.status === "active",
    403,
    "Your account is awaiting administrator approval.",
  );
  ensure(
    !admin || u.role === "admin",
    403,
    "Administrator access is required.",
  );
  return u;
}
__name(currentUser, "currentUser");
async function createChallenge(env, address, purpose, shareId, ip) {
  await rate(env, `email:${address}`, 5, 15 * 6e4);
  await rate(env, `mail-ip:${ip}`, 20, 15 * 6e4);
  const challengeId = id(),
    code = pin();
  await env.DB.prepare(
    "INSERT INTO challenges(id,email,purpose,share_id,code_hash,expires_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      challengeId,
      address,
      purpose,
      shareId,
      await hash(`${challengeId}:${code}`),
      now() + 10 * 6e4,
    )
    .run();
  try {
    await mail(
      env,
      [address],
      `Your File Station ${purpose === "login" ? "sign-in" : "access"} code`,
      `Your verification code is ${code}.

It expires in 10 minutes. If you did not request it, ignore this email.`,
      verificationEmail(code, purpose),
    );
  } catch (e) {
    await env.DB.prepare("DELETE FROM challenges WHERE id=?")
      .bind(challengeId)
      .run();
    throw e;
  }
  return {
    challengeId,
    expiresIn: 600,
    ...(env.DEV_MODE === "true" ? { developmentPin: code } : {}),
  };
}
__name(createChallenge, "createChallenge");
async function consumeChallenge(env, challengeId, code, purpose, ip) {
  ensure(
    typeof challengeId === "string" &&
      typeof code === "string" &&
      /^\d{6}$/.test(code),
    400,
    "Enter the six-digit verification code.",
  );
  await rate(env, `verify-ip:${ip}`, 40, 15 * 6e4);
  const c = await env.DB.prepare(
    "UPDATE challenges SET attempts=attempts+1 WHERE id=? AND purpose=? AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING *",
  )
    .bind(challengeId, purpose, now())
    .first();
  ensure(
    c && c.code_hash === (await hash(`${challengeId}:${code}`)),
    400,
    "Invalid or expired verification code.",
  );
  const result = await env.DB.prepare(
    "UPDATE challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL",
  )
    .bind(now(), challengeId)
    .run();
  ensure(
    result.meta.changes === 1,
    400,
    "This verification code has already been used.",
  );
  return c;
}
__name(consumeChallenge, "consumeChallenge");
async function authRoute(request, env, path) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (path === "/api/auth/request" && request.method === "POST") {
    const b = await body(request);
    return json(await createChallenge(env, email(b.email), "login", null, ip));
  }
  if (path === "/api/auth/verify" && request.method === "POST") {
    const b = await body(request),
      c = await consumeChallenge(env, b.challengeId, b.pin, "login", ip);
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE key='allowed_domains'",
    ).first();
    const domains = JSON.parse(setting?.value || "[]");
    const isAdmin =
      !!env.ADMIN_EMAIL && c.email === env.ADMIN_EMAIL.trim().toLowerCase();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users(id,email,role,status,created_at) VALUES (?,?,?,?,?)",
    )
      .bind(
        id(),
        c.email,
        isAdmin ? "admin" : "user",
        isAdmin || domains.includes(c.email.split("@")[1])
          ? "active"
          : "pending",
        now(),
      )
      .run();
    const user = await env.DB.prepare("SELECT * FROM users WHERE email=?")
      .bind(c.email)
      .first();
    ensure(
      user && !["inactive", "deleted"].includes(user.status),
      403,
      "This account is deactivated. Contact an administrator.",
    );
    const t = token();
    await env.DB.prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",
    )
      .bind(await hash(t), user.id, now() + 7 * 864e5)
      .run();
    return new Response(JSON.stringify({ user }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": sessionCookie(env, "fs_session", t, 7 * 86400),
      },
    });
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const t = cookie(request, "fs_session");
    if (t)
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await hash(t))
        .run();
    return new Response("{}", {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": sessionCookie(env, "fs_session", "", 0),
      },
    });
  }
  if (path === "/api/me" && request.method === "GET") {
    try {
      return json({ user: await currentUser(request, env) });
    } catch {
      return json({ user: null });
    }
  }
  return null;
}
__name(authRoute, "authRoute");

export { currentUser, createChallenge, consumeChallenge, authRoute };
