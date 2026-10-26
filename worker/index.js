// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { PART_SIZE, CONNECTOR_FIELDS } from "./types.js";
import {
  ensure,
  json,
  body,
  email,
  id,
  now,
  token,
  checkOrigin,
  audit,
  encrypt,
  errorResponse,
} from "./util.js";
import { currentUser, authRoute } from "./auth.js";
import { validateS3Config } from "./s3.js";
import { validateWebDavEndpoint } from "./webdav.js";
import { Storage } from "./storage.js";
import {
  validateOneDrive,
  ONEDRIVE_PART_SIZE,
  OneDriveStorage,
} from "./onedrive";
import { coordinate } from "./coordinator.js";
import { fileAccess, shareRoutes } from "./shares.js";
import { fileResponse } from "./file-response";
import { uploadConnections } from "./transfer-options";
import { SHARE_ADDRESSES } from "./share-links";
import { folderForOwner, removeUserFolders } from "./folders";
import { workspaceSpace, ownsFile } from "./workspaces";
async function connectorList(env, admin) {
  const result = await env.DB.prepare(
    `SELECT c.id,c.name,COALESCE(c.storage_adapter,c.adapter,c.kind) AS kind,c.limit_bytes,c.retention_days,c.enabled,c.config,c.encrypted_credentials IS NOT NULL AS credentials_configured,COALESCE(SUM(CASE WHEN f.state IN ('ready','deleting') THEN f.size ELSE 0 END),0) AS used_bytes,COALESCE(SUM(CASE WHEN f.state='uploading' THEN f.size ELSE 0 END),0) AS reserved_bytes,COUNT(CASE WHEN f.state='ready' THEN 1 END) AS file_count FROM connectors c LEFT JOIN files f ON f.connector_id=c.id GROUP BY c.id ORDER BY c.created_at`,
  ).all();
  return result.results
    .filter((c) => admin || c.enabled)
    .map((c) => ({ ...c, config: admin ? JSON.parse(c.config) : void 0 }));
}
__name(connectorList, "connectorList");
async function routes(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/api/health")
    return json({
      name: "File Station",
      status: "ok",
      development: env.DEV_MODE === "true",
      partSize: PART_SIZE,
    });
  checkOrigin(request, env);
  const auth = await authRoute(request, env, path);
  if (auth) return auth;
  const share = await shareRoutes(request, env, path);
  if (share) return share;
  if (path === "/api/connectors" && request.method === "GET") {
    const user = await currentUser(request, env);
    return json({
      connectors: await connectorList(env, user.role === "admin"),
    });
  }
  if (path === "/api/files" && request.method === "GET") {
    const user = await currentUser(request, env, true);
    const all = url.searchParams.get("all") === "true" && user.role === "admin";
    const selectedSpace =
      url.searchParams.get("space") ??
      (all && !url.searchParams.has("folderId") ? "all" : "private");
    ensure(
      selectedSpace === "all" || ["private", "public"].includes(selectedSpace),
      400,
      "Choose Private or Public space.",
    );
    const filters = ["f.state IN ('ready','uploading')"];
    const bindings = [now()];
    if (!all) {
      filters.push("(f.owner_id=? OR f.space='public')");
      bindings.push(user.id);
    }
    if (selectedSpace !== "all") {
      filters.push("f.space=?");
      bindings.push(selectedSpace);
    }
    if (url.searchParams.get("sharedByMe") === "true") {
      filters.push(
        "EXISTS(SELECT 1 FROM shares mine WHERE mine.file_id=f.id AND mine.created_by=? AND mine.revoked_at IS NULL AND (mine.expires_at IS NULL OR mine.expires_at>?))",
      );
      bindings.push(user.id, now());
    }
    if (url.searchParams.has("folderId")) {
      ensure(selectedSpace !== "all", 400, "Choose Private or Public space.");
      const requested = url.searchParams.get("folderId");
      let selected = null;
      if (all && requested && requested !== "root") {
        const row = await env.DB.prepare(
          "SELECT id FROM folders WHERE id=? AND space=?",
        )
          .bind(requested, selectedSpace)
          .first();
        ensure(row, 404, "The selected folder is no longer available.");
        selected = row.id;
      } else
        selected = await folderForOwner(
          env,
          user.id,
          requested,
          workspaceSpace(selectedSpace),
        );
      filters.push(selected ? "f.folder_id=?" : "f.folder_id IS NULL");
      if (selected) bindings.push(selected);
    }
    const rows = await env.DB.prepare(
      `SELECT f.*,directory.name AS folder_name,u.email AS owner_email,c.name AS connector_name,COALESCE(c.storage_adapter,c.adapter,c.kind) AS storage_kind,(SELECT COUNT(*) FROM shares s WHERE s.file_id=f.id AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?)) AS share_count FROM files f JOIN users u ON u.id=f.owner_id JOIN connectors c ON c.id=f.connector_id LEFT JOIN folders directory ON directory.id=f.folder_id WHERE ${filters.join(" AND ")} ORDER BY f.created_at DESC LIMIT 500`,
    )
      .bind(...bindings)
      .all();
    const files = rows.results.map((file) => {
      const canManage = ownsFile(user, file);
      return {
        ...file,
        can_delete: canManage,
        can_make_private: canManage,
        can_resume: canManage,
        ...(!canManage
          ? {
              provider_upload_id: undefined,
              provider_file_id: undefined,
              object_key: undefined,
            }
          : {}),
      };
    });
    return json({ files });
  }
  if (path === "/api/uploads" && request.method === "POST") {
    const user = await currentUser(request, env, true);
    const b = await body(request);
    delete b.invitationId;
    delete b.recipientEmail;
    delete b.baseRevision;
    ensure(
      typeof b.connectorId === "string",
      400,
      "Choose a storage connector.",
    );
    return coordinate(
      env,
      b.connectorId,
      "/create",
      new Request(request.url, {
        method: "POST",
        body: JSON.stringify({ ...b, ownerId: user.id }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  const upload = path.match(
    /^\/api\/uploads\/([^/]+)(?:\/(parts\/\d+|complete))?$/,
  );
  if (upload) {
    const user = await currentUser(request, env, true),
      file = await env.DB.prepare("SELECT * FROM files WHERE id=?")
        .bind(upload[1])
        .first();
    ensure(
      file && (file.owner_id === user.id || user.role === "admin"),
      404,
      "Upload not found.",
    );
    if (!upload[2] && request.method === "GET") {
      const parts = await env.DB.prepare(
        "SELECT part_number,size FROM upload_parts WHERE file_id=? ORDER BY part_number",
      )
        .bind(file.id)
        .all();
      return json({
        file,
        partSize: file.part_size || PART_SIZE,
        uploadConcurrency: await uploadConnections(env, file.connector_id),
        parts: parts.results,
      });
    }
    if (upload[2]?.startsWith("parts/") && request.method === "PUT")
      return coordinate(
        env,
        file.connector_id,
        `/part?file=${file.id}&part=${upload[2].split("/")[1]}`,
        request,
      );
    if (upload[2] === "complete" && request.method === "POST") {
      if (file.state === "ready") return json({ ok: true });
      return coordinate(env, file.connector_id, `/complete?file=${file.id}`);
    }
    if (!upload[2] && request.method === "DELETE")
      return coordinate(
        env,
        file.connector_id,
        `/delete?file=${file.id}&actor=${user.id}&reason=cancelled`,
      );
  }
  const download = path.match(/^\/api\/files\/([^/]+)\/(download|preview)$/);
  if (download && ["GET", "HEAD"].includes(request.method)) {
    const file = await env.DB.prepare("SELECT * FROM files WHERE id=?")
      .bind(download[1])
      .first();
    ensure(file, 404, "File not found.");
    await fileAccess(request, env, file);
    return fileResponse(request, env, file, download[2] === "preview");
  }
  const fileRoute = path.match(/^\/api\/files\/([^/]+)$/);
  if (fileRoute && request.method === "DELETE") {
    const user = await currentUser(request, env, true);
    const file = await env.DB.prepare("SELECT * FROM files WHERE id=?")
      .bind(fileRoute[1])
      .first();
    ensure(
      file && (file.owner_id === user.id || user.role === "admin"),
      404,
      "File not found.",
    );
    return coordinate(
      env,
      file.connector_id,
      `/delete?file=${file.id}&actor=${user.id}&reason=manual`,
    );
  }
  if (path.startsWith("/api/admin/")) return adminRoutes(request, env, path);
  return json({ error: "Endpoint not found." }, 404);
}
__name(routes, "routes");
async function adminRoutes(request, env, path) {
  const admin = await currentUser(request, env, true, true);
  const testConnector = path.match(/^\/api\/admin\/connectors\/([^/]+)\/test$/);
  if (testConnector && request.method === "POST")
    return coordinate(env, testConnector[1], "/test");
  if (path === "/api/admin/users" && request.method === "GET")
    return json({
      users: (
        await env.DB.prepare(
          "SELECT * FROM users ORDER BY created_at DESC LIMIT 1000",
        ).all()
      ).results,
    });
  const u = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (u) {
    const user = await env.DB.prepare("SELECT * FROM users WHERE id=?")
      .bind(u[1])
      .first();
    ensure(user && user.status !== "deleted", 404, "User not found.");
    ensure(
      user.id !== admin.id && user.role !== "admin",
      400,
      "Administrator accounts cannot be changed here.",
    );
    if (request.method === "PATCH") {
      const b = await body(request);
      ensure(
        ["active", "inactive"].includes(b.status),
        400,
        "Choose active or inactive.",
      );
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET status=? WHERE id=?").bind(
          b.status,
          user.id,
        ),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
      ]);
      await audit(env, admin.id, `user.${b.status}`, user.id);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET status='inactive' WHERE id=?").bind(
          user.id,
        ),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
      ]);
      const files = await env.DB.prepare(
        "SELECT * FROM files WHERE owner_id=? AND state<>'deleted' AND (space='private' OR state='uploading')",
      )
        .bind(user.id)
        .all();
      for (const file of files.results) {
        const r = await coordinate(
          env,
          file.connector_id,
          `/delete?file=${file.id}&actor=${admin.id}&reason=user_deleted`,
        );
        ensure(
          r.ok,
          502,
          "Some files could not be deleted. The account is deactivated; retry deletion to finish cleanup.",
        );
      }
      await removeUserFolders(env, user.id);
      await env.DB.prepare("UPDATE users SET status='deleted' WHERE id=?")
        .bind(user.id)
        .run();
      await audit(env, admin.id, "user.deleted", user.id);
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/settings" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT key,value FROM settings WHERE key IN ('allowed_domains','share_base_url')",
    ).all();
    const values = Object.fromEntries(
      rows.results.map((row) => [row.key, row.value]),
    );
    return json({
      allowedDomains: JSON.parse(values.allowed_domains || "[]"),
      shareBaseUrl: SHARE_ADDRESSES.includes(values.share_base_url)
        ? values.share_base_url
        : "current",
    });
  }
  if (path === "/api/admin/settings" && request.method === "PUT") {
    const b = await body(request),
      statements = [];
    if (Object.hasOwn(b, "allowedDomains")) {
      ensure(
        Array.isArray(b.allowedDomains) && b.allowedDomains.length <= 50,
        400,
        "Enter a list of allowed domains.",
      );
      const domains = [
        ...new Set(
          b.allowedDomains.map((value) => {
            ensure(typeof value === "string", 400, "Invalid domain.");
            const domain = value.trim().toLowerCase();
            ensure(
              domain.length <= 253 &&
                /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(
                  domain,
                ),
              400,
              "Enter domains such as international.gc.ca, without @ or a URL.",
            );
            return domain;
          }),
        ),
      ];
      statements.push(
        env.DB.prepare(
          "INSERT INTO settings(key,value) VALUES ('allowed_domains',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).bind(JSON.stringify(domains)),
      );
    }
    if (Object.hasOwn(b, "shareBaseUrl")) {
      ensure(
        SHARE_ADDRESSES.includes(b.shareBaseUrl),
        400,
        "Choose one of the supported File Station website addresses.",
      );
      statements.push(
        env.DB.prepare(
          "INSERT INTO settings(key,value) VALUES ('share_base_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).bind(b.shareBaseUrl),
      );
    }
    ensure(statements.length, 400, "Choose a setting to update.");
    await env.DB.batch(statements);
    await audit(
      env,
      admin.id,
      "settings.updated",
      Object.keys(b)
        .filter((key) => ["allowedDomains", "shareBaseUrl"].includes(key))
        .join(","),
    );
    return json({ ok: true });
  }

  const connectorMatch = path.match(/^\/api\/admin\/connectors(?:\/([^/]+))?$/);
  if (connectorMatch && ["POST", "PUT"].includes(request.method)) {
    const b = await body(request);
    ensure(
      typeof b.name === "string" &&
        b.name.trim().length > 0 &&
        b.name.length <= 80,
      400,
      "Enter a connector name.",
    );
    ensure(
      ["r2", "alipan", "s3", "synology", "webdav", "onedrive"].includes(b.kind),
      400,
      "Choose R2, AliPan, S3, Synology or WebDAV.",
    );
    ensure(
      Number.isSafeInteger(b.limitBytes) &&
        b.limitBytes > 0 &&
        b.limitBytes <= 5e12,
      400,
      "Enter a valid storage limit up to 5 TB.",
    );
    ensure(
      b.retentionDays === null ||
        (Number.isInteger(b.retentionDays) &&
          b.retentionDays >= 1 &&
          b.retentionDays <= 3650),
      400,
      "Retention must be 1\u20133650 days, or blank for no time limit.",
    );
    if (b.kind === "alipan")
      ensure(
        typeof b.driveId === "string" &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(b.driveId),
        400,
        "Enter a valid AliPan drive ID.",
      );
    if (b.folderId)
      ensure(
        /^[a-zA-Z0-9_-]{1,128}$/.test(b.folderId),
        400,
        "Enter a valid folder ID.",
      );
    if (b.kind === "s3") {
      ensure(
        typeof b.endpoint === "string" && typeof b.bucket === "string",
        400,
        "Enter an S3 endpoint and bucket.",
      );
      const s3 = validateS3Config({
        endpoint: b.endpoint,
        bucket: b.bucket,
        region: b.region || "auto",
      });
      b.endpoint = s3.endpoint;
      b.bucket = s3.bucket;
      b.region = s3.region;
    }
    if (["webdav", "synology"].includes(b.kind)) {
      ensure(
        typeof b.endpoint === "string",
        400,
        "Enter a WebDAV HTTPS folder URL.",
      );
      b.endpoint = validateWebDavEndpoint(b.endpoint);
    }
    if (b.kind === "onedrive") Object.assign(b, validateOneDrive(b));
    let encrypted = null;
    if (b.credentials) {
      const keys =
        b.kind === "onedrive"
          ? ["clientSecret"]
          : b.kind === "s3"
            ? ["accessKeyId", "secretAccessKey"]
            : ["webdav", "synology"].includes(b.kind)
              ? ["username", "password"]
              : ["clientId", "clientSecret", "refreshToken"];
      ensure(
        b.kind !== "r2" &&
          keys.every(
            (k) =>
              typeof b.credentials?.[k] === "string" &&
              String(b.credentials[k]).length > 0 &&
              String(b.credentials[k]).length < 4096,
          ),
        400,
        "Enter all required connector credentials.",
      );
      const values = Object.fromEntries(keys.map((k) => [k, b.credentials[k]]));
      if (["webdav", "synology"].includes(b.kind)) {
        ensure(
          !/[:\r\n]/.test(b.credentials.username),
          400,
          "WebDAV usernames cannot contain colons or newlines.",
        );
        const accessId = b.credentials.accessClientId,
          accessSecret = b.credentials.accessClientSecret;
        if (accessId || accessSecret) {
          ensure(
            typeof accessId === "string" &&
              typeof accessSecret === "string" &&
              accessId.length > 0 &&
              accessSecret.length > 0 &&
              accessId.length < 4096 &&
              accessSecret.length < 4096 &&
              !/[\r\n]/.test(accessId + accessSecret),
            400,
            "Enter both Cloudflare Access service token fields.",
          );
          values.accessClientId = accessId;
          values.accessClientSecret = accessSecret;
        }
      }
      encrypted = await encrypt(env, values);
    }
    const config = JSON.stringify(
      b.kind === "onedrive"
        ? validateOneDrive(b)
        : b.kind === "alipan"
          ? { driveId: b.driveId, folderId: b.folderId || "root" }
          : b.kind === "s3"
            ? {
                endpoint: new URL(b.endpoint).origin,
                bucket: b.bucket,
                region: b.region || "auto",
              }
            : ["webdav", "synology"].includes(b.kind)
              ? { endpoint: b.endpoint }
              : {},
    );
    const connectorId = connectorMatch[1] || id();
    if (connectorMatch[1]) {
      const old = await env.DB.prepare(
        `SELECT ${CONNECTOR_FIELDS} FROM connectors WHERE id=?`,
      )
        .bind(connectorId)
        .first();
      ensure(
        old && old.kind === b.kind,
        400,
        "Connector type cannot be changed.",
      );
      if (b.kind === "onedrive" && (old.config !== config || encrypted))
        await new OneDriveStorage(env, {
          id: connectorId,
          config,
          encrypted_credentials: encrypted || old.encrypted_credentials,
        }).test();
      const r = await coordinate(
        env,
        connectorId,
        "/configure",
        new Request(request.url, {
          method: "POST",
          body: JSON.stringify({
            name: b.name.trim(),
            limit_bytes: b.limitBytes,
            retention_days: b.retentionDays,
            enabled: b.enabled ? 1 : 0,
            config,
            encrypted_credentials: encrypted,
            confirmSameStorage: b.confirmSameStorage === true,
          }),
        }),
      );
      if (!r.ok) return r;
    } else {
      if (b.kind === "onedrive")
        await new OneDriveStorage(env, {
          id: connectorId,
          config,
          encrypted_credentials: encrypted,
        }).test();
      await env.DB.prepare(
        "INSERT INTO connectors(id,name,kind,adapter,storage_adapter,limit_bytes,retention_days,enabled,config,encrypted_credentials,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          connectorId,
          b.name.trim(),
          b.kind === "alipan" ? "alipan" : "r2",
          ["r2", "alipan", "s3"].includes(b.kind) ? b.kind : "r2",
          b.kind,
          b.limitBytes,
          b.retentionDays,
          b.enabled ? 1 : 0,
          config,
          encrypted,
          now(),
        )
        .run();
    }
    await audit(env, admin.id, "connector.configured", connectorId);
    return json({ ok: true, id: connectorId });
  }
  if (path === "/api/admin/audit" && request.method === "GET")
    return json({
      events: (
        await env.DB.prepare(
          "SELECT a.*,u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100",
        ).all()
      ).results,
    });
  return json({ error: "Endpoint not found." }, 404);
}
__name(adminRoutes, "adminRoutes");
var securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};
var index_default = {
  async fetch(request, env) {
    let response;
    try {
      response = new URL(request.url).pathname.startsWith("/api/")
        ? await routes(request, env)
        : await env.ASSETS.fetch(request);
    } catch (e) {
      response = errorResponse(e);
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(securityHeaders)) headers.set(k, v);
    if (new URL(request.url).pathname.startsWith("/api/"))
      headers.set("Cache-Control", "private, no-store");
    if (env.DEV_MODE !== "true")
      headers.set("Strict-Transport-Security", "max-age=31536000");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  async scheduled(_controller, env) {
    const connectors = await env.DB.prepare("SELECT id FROM connectors").all();
    const results = await Promise.allSettled(
      connectors.results.map(async (c) => {
        const r = await coordinate(env, c.id, "/cleanup");
        if (!r.ok) throw new Error("Storage cleanup failed");
      }),
    );
    await env.DB.batch([
      env.DB.prepare("DELETE FROM challenges WHERE expires_at<?").bind(
        now() - 864e5,
      ),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now()),
      env.DB.prepare("DELETE FROM guest_sessions WHERE expires_at<?").bind(
        now(),
      ),
      env.DB.prepare("DELETE FROM rate_limits WHERE reset_at<?").bind(now()),
    ]);
    if (results.some((r) => r.status === "rejected"))
      throw new Error(
        "One or more connectors could not complete retention cleanup.",
      );
  },
};
export { connectorList, routes, adminRoutes, securityHeaders, index_default };
export default index_default;
