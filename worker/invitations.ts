import type { Env, Row } from "./model";
import { currentUser, createChallenge, consumeChallenge } from "./auth.js";
import { coordinate } from "./coordinator.js";
import { shareRoutes } from "./shares.js";
import {
  ensure,
  HttpError,
  json,
  body,
  email,
  recipientEmails,
  id,
  now,
  hash,
  randomCode,
  token,
  cookie,
  sessionCookie,
  encrypt,
  decrypt,
  rate,
  audit,
  mail,
} from "./util.js";
import { emailLayout } from "./email.js";
import { fileResponse } from "./file-response";
import { uploadConnections } from "./transfer-options";
import { shareLink } from "./share-links";
import { translate, localeFor } from "../shared/i18n";
import { folderForOwner, folderError } from "./folders";
import { workspaceSpace, readsFile } from "./workspaces";

const fail = () =>
  new HttpError(
    410,
    "This invitation expired, was revoked, or its file is no longer available.",
  );
export async function activeInvitation(env: Env, invitationId: string) {
  const invite = await env.DB.prepare(
    "SELECT i.* FROM invitations i JOIN users u ON u.id=i.owner_id WHERE i.id=? AND i.revoked_at IS NULL AND i.expires_at>? AND u.status='active'",
  )
    .bind(invitationId, now())
    .first<Row>();
  if (!invite) throw fail();
  if (invite.kind === "collaboration") {
    for (const fileId of new Set(
      [invite.source_file_id, invite.current_file_id].filter(Boolean),
    )) {
      const file = await env.DB.prepare(
        "SELECT id FROM files WHERE id=? AND state='ready' AND (expires_at IS NULL OR expires_at>?)",
      )
        .bind(fileId, now())
        .first();
      if (!file) throw fail();
    }
  }
  return invite;
}
async function manage(request: Request, env: Env, invite: Row) {
  const user = await currentUser(request, env, true);
  ensure(
    user.id === invite.owner_id || user.role === "admin",
    404,
    "Invitation not found.",
  );
  return user;
}
async function access(request: Request, env: Env, invite: Row) {
  let user;
  try {
    user = await currentUser(request, env, true);
  } catch {
    /* External users have separate sessions. */
  }
  if (user && (user.id === invite.owner_id || user.role === "admin"))
    return user.email as string;
  const session = cookie(request, "fs_invitation");
  ensure(
    session,
    401,
    "Enter your invitation code and verify your recipient email.",
  );
  const verified = await env.DB.prepare(
    "SELECT s.email FROM invitation_sessions s JOIN invitation_recipients r ON r.invitation_id=s.invitation_id AND r.email=s.email WHERE s.token_hash=? AND s.invitation_id=? AND s.expires_at>?",
  )
    .bind(await hash(session!), invite.id, now())
    .first<Row>();
  ensure(
    verified,
    401,
    "Your invitation session expired. Verify your email again.",
  );
  return verified!.email as string;
}
function fileSummary(file: Row) {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mime: file.mime,
    state: file.state,
    part_size: file.part_size,
    fingerprint: file.fingerprint,
    created_at: file.created_at,
    expires_at: file.expires_at,
    storage_kind: file.storage_kind,
  };
}
async function view(env: Env, invite: Row, address: string) {
  let file = null;
  if (invite.kind === "collaboration") {
    const row = await env.DB.prepare(
      "SELECT f.*,COALESCE(c.storage_adapter,c.adapter,c.kind) AS storage_kind FROM files f JOIN connectors c ON c.id=f.connector_id WHERE f.id=?",
    )
      .bind(invite.current_file_id || invite.source_file_id)
      .first<Row>();
    file = { ...fileSummary(row!), name: invite.target_name };
  }
  const submitted = await env.DB.prepare(
    "SELECT f.id,f.name,f.size,f.state,x.published_at FROM invitation_files x JOIN files f ON f.id=x.file_id WHERE x.invitation_id=? AND x.recipient_email=? AND f.state<>'deleted' ORDER BY x.created_at DESC",
  )
    .bind(invite.id, address)
    .all();
  return {
    invitation: {
      id: invite.id,
      title: invite.title,
      kind: invite.kind,
      target_name: invite.target_name,
      expires_at: invite.expires_at,
      max_file_bytes: invite.max_file_bytes,
      max_files: invite.max_files,
      revision: invite.revision,
    },
    file,
    submitted: submitted.results,
  };
}
export async function guardInvitationUpload(
  env: Env,
  connector: Row,
  input: Row,
) {
  const invite = await activeInvitation(env, input.invitationId);
  ensure(
    invite.connector_id === connector.id && invite.owner_id === input.ownerId,
    403,
    "This invitation does not allow the selected destination.",
  );
  input.folderId = invite.folder_id;
  input.space = invite.space;
  if (
    invite.kind === "collaboration" &&
    invite.current_file_id &&
    invite.current_file_id !== invite.source_file_id
  ) {
    const current = await env.DB.prepare(
      "SELECT folder_id,space FROM files WHERE id=? AND owner_id=?",
    )
      .bind(invite.current_file_id, invite.owner_id)
      .first<Row>();
    if (current) {
      input.folderId = current.folder_id;
      input.space = current.space;
    }
  }
  const owner = await env.DB.prepare("SELECT email FROM users WHERE id=?")
    .bind(invite.owner_id)
    .first<Row>();
  const recipient = await env.DB.prepare(
    "SELECT email FROM invitation_recipients WHERE invitation_id=? AND email=?",
  )
    .bind(invite.id, input.recipientEmail)
    .first();
  ensure(
    recipient || owner?.email === input.recipientEmail,
    403,
    "This email is not invited.",
  );
  ensure(
    Number.isSafeInteger(input.size) &&
      input.size > 0 &&
      input.size <= invite.max_file_bytes,
    413,
    "This file exceeds the invitation’s per-file limit.",
  );
  if (invite.kind === "collaboration") {
    ensure(
      input.baseRevision === invite.revision,
      409,
      "The document changed. Download the latest working copy before saving your edits.",
    );
    input.name = invite.target_name;
  } else {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) count FROM invitation_files x JOIN files f ON f.id=x.file_id WHERE x.invitation_id=? AND f.state IN ('uploading','ready','deleting')",
    )
      .bind(invite.id)
      .first<Row>();
    ensure(
      (count?.count || 0) < invite.max_files,
      409,
      "This invitation has reached its file limit.",
    );
  }
  return invite;
}
export async function recordInvitationUpload(
  env: Env,
  invite: Row,
  file: Row,
  input: Row,
) {
  await env.DB.prepare(
    "INSERT INTO invitation_files(file_id,invitation_id,recipient_email,base_revision,created_at) VALUES (?,?,?,?,?)",
  )
    .bind(
      file.id,
      invite.id,
      input.recipientEmail,
      input.baseRevision || 0,
      now(),
    )
    .run();
}
export async function guardAttachedInvitation(env: Env, fileId: string) {
  const relation = await env.DB.prepare(
    "SELECT invitation_id FROM invitation_files WHERE file_id=?",
  )
    .bind(fileId)
    .first<Row>();
  if (relation) await activeInvitation(env, relation.invitation_id);
}
async function download(
  request: Request,
  env: Env,
  invite: Row,
  preview = false,
) {
  ensure(
    invite.kind === "collaboration",
    403,
    "Submission invitations do not allow browsing or downloading other submissions.",
  );
  const file = await env.DB.prepare("SELECT * FROM files WHERE id=?")
    .bind(invite.current_file_id || invite.source_file_id)
    .first<Row>();
  if (!file || file.state !== "ready") throw fail();
  return fileResponse(
    request,
    env,
    { ...file, name: invite.target_name },
    preview,
  );
}
function legacyRequest(request: Request, value: Row) {
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(value),
  });
}
export async function invitationRoutes(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (path === "/api/access/request" && request.method === "POST") {
    await rate(env, `invitation-access:${ip}`, 30, 15 * 60000);
    const value = await body(request),
      address = email(value.email),
      code = String(value.code || "")
        .replace(/[\s-]/g, "")
        .toUpperCase();
    if (/^[A-Z2-9]{12}$/.test(code)) {
      const response = await shareRoutes(
        legacyRequest(request, { code, email: address }),
        env,
        "/api/shares/access",
      );
      return json(
        { ...((await response!.json()) as Row), kind: "download" },
        response!.status,
      );
    }
    ensure(
      /^[UC][A-Z2-9]{12}$/.test(code),
      400,
      "Enter a valid download, submission or collaboration access code.",
    );
    const row = await env.DB.prepare(
      "SELECT i.id FROM invitations i JOIN invitation_recipients r ON r.invitation_id=i.id WHERE i.code_hash=? AND r.email=?",
    )
      .bind(await hash(code), address)
      .first<Row>();
    ensure(row, 400, "Invalid access code or recipient email.");
    const invite = await activeInvitation(env, row!.id);
    return json({
      ...(await createChallenge(env, address, "share", invite.id, ip)),
      kind: invite.kind,
    });
  }
  if (path === "/api/access/verify" && request.method === "POST") {
    const value = await body(request);
    if (value.kind === "download") {
      const response = await shareRoutes(
        legacyRequest(request, value),
        env,
        "/api/shares/verify",
      );
      return new Response(
        JSON.stringify({
          ...((await response!.json()) as Row),
          kind: "download",
        }),
        { status: response!.status, headers: response!.headers },
      );
    }
    const challenge = await consumeChallenge(
      env,
      value.challengeId,
      value.pin,
      "share",
      ip,
    );
    const invite = await activeInvitation(env, challenge.share_id);
    ensure(
      await env.DB.prepare(
        "SELECT email FROM invitation_recipients WHERE invitation_id=? AND email=?",
      )
        .bind(invite.id, challenge.email)
        .first(),
      403,
      "This recipient is no longer invited.",
    );
    const session = token(),
      expires = Math.min(invite.expires_at, now() + 86400000);
    await env.DB.prepare(
      "INSERT INTO invitation_sessions(token_hash,invitation_id,email,expires_at) VALUES (?,?,?,?)",
    )
      .bind(await hash(session), invite.id, challenge.email, expires)
      .run();
    return new Response(
      JSON.stringify({
        ...(await view(env, invite, challenge.email)),
        kind: invite.kind,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": sessionCookie(
            env,
            "fs_invitation",
            session,
            Math.floor((expires - now()) / 1000),
          ),
        },
      },
    );
  }
  if (path === "/api/invitations" && request.method === "GET") {
    const user = await currentUser(request, env, true);
    const all =
      user.role === "admin" &&
      new URL(request.url).searchParams.get("all") === "true";
    const rows = await env.DB.prepare(
      `SELECT i.*,directory.name folder_name,c.name connector_name,u.email owner_email FROM invitations i JOIN connectors c ON c.id=i.connector_id JOIN users u ON u.id=i.owner_id LEFT JOIN folders directory ON directory.id=i.folder_id ${all ? "" : "WHERE i.owner_id=?"} ORDER BY i.created_at DESC LIMIT 500`,
    )
      .bind(...(all ? [] : [user.id]))
      .all<Row>();
    const invitations = await Promise.all(
      rows.results.map(async (row) => {
        const recipients = (
          await env.DB.prepare(
            "SELECT email FROM invitation_recipients WHERE invitation_id=?",
          )
            .bind(row.id)
            .all<Row>()
        ).results.map((r) => r.email);
        const code = (await decrypt(env, row.encrypted_code)).code;
        const { code_hash, encrypted_code, ...safe } = row;
        const files = (
          await env.DB.prepare(
            "SELECT f.id,f.name,f.state,f.size,x.recipient_email,x.published_at FROM invitation_files x JOIN files f ON f.id=x.file_id WHERE x.invitation_id=? ORDER BY x.created_at DESC LIMIT 100",
          )
            .bind(row.id)
            .all()
        ).results;
        return {
          ...safe,
          recipients,
          code,
          link: await shareLink(request, env, code),
          files,
        };
      }),
    );
    return json({ invitations });
  }
  if (path === "/api/invitations" && request.method === "POST") {
    const user = await currentUser(request, env, true),
      value = await body(request);
    await rate(env, `invitation-create:${user.id}`, 60, 3600000);
    ensure(
      ["submission", "collaboration"].includes(value.kind),
      400,
      "Choose submission or collaboration.",
    );
    ensure(
      typeof value.title === "string" &&
        value.title.trim().length > 0 &&
        value.title.length <= 160,
      400,
      "Enter an invitation title up to 160 characters.",
    );
    const recipients = recipientEmails(value.recipients);
    ensure(
      Number.isInteger(value.expiresDays) &&
        value.expiresDays >= 1 &&
        value.expiresDays <= 365,
      400,
      "Expiry must be 1–365 days.",
    );
    const connector = await env.DB.prepare(
      "SELECT id,limit_bytes FROM connectors WHERE id=? AND enabled=1",
    )
      .bind(value.connectorId)
      .first<Row>();
    ensure(connector, 400, "Choose an enabled storage connector.");
    ensure(
      Number.isSafeInteger(value.maxFileBytes) &&
        value.maxFileBytes > 0 &&
        value.maxFileBytes <= connector!.limit_bytes,
      400,
      "Choose a per-file limit within the connector capacity.",
    );
    ensure(
      Number.isInteger(value.maxFiles) &&
        value.maxFiles >= 1 &&
        value.maxFiles <= 100,
      400,
      "The file limit must be 1–100.",
    );
    let source: Row | null = null;
    if (value.kind === "collaboration") {
      source = await env.DB.prepare(
        "SELECT * FROM files WHERE id=? AND state='ready' AND (expires_at IS NULL OR expires_at>?)",
      )
        .bind(value.sourceFileId, now())
        .first<Row>();
      ensure(source && readsFile(user, source), 404, "Source file not found.");
      ensure(
        typeof value.targetName === "string" &&
          value.targetName.trim().length > 0 &&
          value.targetName.length <= 255 &&
          !/[\x00-\x1f/\\]/.test(value.targetName),
        400,
        "Enter a target filename without folder paths.",
      );
      const ext = (name: string) =>
        name.includes(".")
          ? name.slice(name.lastIndexOf(".")).toLowerCase()
          : "";
      ensure(
        ext(value.targetName) === ext(source!.name),
        400,
        "The target filename must keep the original file extension.",
      );
    }
    const space = workspaceSpace(
      value.space ??
        (source && source.owner_id === user.id ? source.space : "private"),
    );
    const folderId = await folderForOwner(
      env,
      user.id,
      Object.hasOwn(value, "folderId")
        ? value.folderId
        : source &&
            source.space === space &&
            (space === "public" || source.owner_id === user.id)
          ? source.folder_id
          : null,
      space,
    );
    const invitationId = id(),
      code = (value.kind === "submission" ? "U" : "C") + randomCode(),
      expiresAt = Math.min(
        now() + value.expiresDays * 86400000,
        source?.expires_at || Infinity,
      );
    const created = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO invitations(id,owner_id,kind,title,code_hash,encrypted_code,connector_id,source_file_id,target_name,max_file_bytes,max_files,created_at,expires_at,folder_id,space) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM files WHERE id=? AND state='ready' AND (expires_at IS NULL OR expires_at>?) AND (owner_id=? OR space='public' OR ?=1)) RETURNING id",
      ).bind(
        invitationId,
        user.id,
        value.kind,
        value.title.trim(),
        await hash(code),
        await encrypt(env, { code }),
        connector!.id,
        source?.id || null,
        source ? value.targetName.trim() : null,
        value.maxFileBytes,
        value.maxFiles,
        now(),
        expiresAt,
        folderId,
        space,
        source?.id || null,
        source?.id || null,
        now(),
        user.id,
        user.role === "admin" ? 1 : 0,
      ),
      ...recipients.map((address) =>
        env.DB.prepare(
          "INSERT INTO invitation_recipients(invitation_id,email) SELECT ?,? WHERE EXISTS(SELECT 1 FROM invitations WHERE id=?)",
        ).bind(invitationId, address, invitationId),
      ),
    ]).catch(folderError);
    ensure(
      created[0].results.length,
      409,
      "The file changed. Refresh and try again.",
    );
    const link = await shareLink(request, env, code);
    let emailSent = false,
      emailError;
    if (value.sendEmail) {
      try {
        const language = localeFor(env.LANGUAGE),
          text = (key: string, values?: Record<string, unknown>) =>
            translate(key, language, values);
        const action = text(
          value.kind === "submission"
            ? "Submit your documents"
            : "Collaborate on a document",
        );
        const intro =
          value.kind === "submission"
            ? text("{0} invited you to submit documents: {1}.", {
                0: user.email,
                1: value.title.trim(),
              })
            : text("{0} invited you to edit {1}: {2}.", {
                0: user.email,
                1: value.targetName,
                2: value.title.trim(),
              });
        const expiry =
          new Intl.DateTimeFormat(language, {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "UTC",
          }).format(expiresAt) + " UTC";
        const details =
          text("Verify your recipient email. Expires {0}.", { 0: expiry }) +
          " " +
          text(
            source
              ? "The original is kept. Edits and re-uploads replace the working copy; there is no version history."
              : "Your submissions are visible to the requester, not other recipients.",
          );
        await mail(
          env,
          recipients,
          `File Station: ${action}`,
          `${intro}\n\n${link}\n${text("Access code: {0}", { 0: code })}\n\n${details}`,
          emailLayout(
            {
              eyebrow: text("YOU ARE INVITED"),
              title: action,
              intro,
              code,
              codeLabel: text("YOUR ACCESS CODE"),
              link,
              button: action,
              details,
              footer: text("Sent by File Station."),
            },
            language,
          ),
        );
        emailSent = true;
      } catch {
        emailError =
          "Invitation created, but email delivery failed. Copy the link to send it manually.";
      }
    }
    await audit(env, user.id, `invitation.${value.kind}.created`, invitationId);
    return json(
      {
        id: invitationId,
        code,
        link,
        expiresAt,
        emailSent,
        emailError,
        recipientCount: recipients.length,
        developmentEmail: env.DEV_MODE === "true" && !!value.sendEmail,
      },
      201,
    );
  }
  const match = path.match(
    /^\/api\/invitations\/([^/]+)(?:\/(view|download|preview|uploads)(?:\/([^/]+)(?:\/(parts\/\d+|complete|publish))?)?)?$/,
  );
  if (!match) return null;
  const [, invitationId, action, fileId, fileAction] = match;
  if (!action && request.method === "DELETE") {
    const invite = await env.DB.prepare("SELECT * FROM invitations WHERE id=?")
      .bind(invitationId)
      .first<Row>();
    ensure(invite, 404, "Invitation not found.");
    const user = await manage(request, env, invite!);
    await env.DB.prepare("UPDATE invitations SET revoked_at=? WHERE id=?")
      .bind(now(), invitationId)
      .run();
    await audit(env, user.id, "invitation.revoked", invitationId);
    return json({ ok: true });
  }
  const invite = await activeInvitation(env, invitationId),
    address = await access(request, env, invite);
  if (action === "view" && request.method === "GET")
    return json(await view(env, invite, address));
  if (
    (action === "download" || action === "preview") &&
    ["GET", "HEAD"].includes(request.method)
  )
    return download(request, env, invite, action === "preview");
  if (action !== "uploads") return null;
  if (!fileId && request.method === "POST") {
    await rate(
      env,
      `invitation-upload:${invitationId}:${address}`,
      100,
      3600000,
    );
    const input = await body(request);
    const response = await coordinate(
      env,
      invite.connector_id,
      "/create",
      new Request(request.url, {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          mime: input.mime,
          size: input.size,
          fingerprint: input.fingerprint,
          ownerId: invite.owner_id,
          invitationId,
          recipientEmail: address,
          baseRevision: input.baseRevision,
        }),
      }),
    );
    const result = (await response.json()) as Row;
    return json(
      result.file ? { ...result, file: fileSummary(result.file) } : result,
      response.status,
    );
  }
  const relation = await env.DB.prepare(
    "SELECT x.*,f.* FROM invitation_files x JOIN files f ON f.id=x.file_id WHERE x.file_id=? AND x.invitation_id=? AND x.recipient_email=?",
  )
    .bind(fileId, invitationId, address)
    .first<Row>();
  ensure(relation, 404, "Upload not found.");
  const file = relation!;
  if (!fileAction && request.method === "GET") {
    const parts = await env.DB.prepare(
      "SELECT part_number,size FROM upload_parts WHERE file_id=? ORDER BY part_number",
    )
      .bind(file.id)
      .all();
    return json({
      file: fileSummary(file),
      partSize: file.part_size,
      uploadConcurrency: await uploadConnections(env, file.connector_id),
      parts: parts.results,
    });
  }
  if (!fileAction && request.method === "DELETE") {
    ensure(
      !file.published_at,
      409,
      "A published working copy cannot be cancelled.",
    );
    return coordinate(
      env,
      file.connector_id,
      `/delete?file=${file.id}&reason=cancelled&actor=${invite.owner_id}`,
    );
  }
  if (fileAction?.startsWith("parts/") && request.method === "PUT")
    return coordinate(
      env,
      file.connector_id,
      `/part?file=${file.id}&part=${fileAction.split("/")[1]}`,
      request,
    );
  if (fileAction === "complete" && request.method === "POST")
    return file.state === "ready"
      ? json({ ok: true })
      : coordinate(env, file.connector_id, `/complete?file=${file.id}`);
  if (fileAction === "publish" && request.method === "POST") {
    ensure(
      file.state === "ready",
      409,
      "Complete the upload before saving it.",
    );
    if (file.published_at) return json({ ok: true, revision: invite.revision });
    const time = now();
    if (invite.kind === "collaboration") {
      if (invite.current_file_id !== file.id) {
        const results = await env.DB.batch([
          env.DB.prepare(
            "UPDATE invitations SET space=CASE WHEN current_file_id IS NOT NULL AND current_file_id<>source_file_id THEN (SELECT f.space FROM files f WHERE f.id=invitations.current_file_id) ELSE space END,folder_id=CASE WHEN current_file_id IS NOT NULL AND current_file_id<>source_file_id THEN (SELECT f.folder_id FROM files f WHERE f.id=invitations.current_file_id) ELSE folder_id END,current_file_id=?,revision=revision+1 WHERE id=? AND revision=? AND revoked_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM files WHERE id=invitations.source_file_id AND state='ready' AND (expires_at IS NULL OR expires_at>?)) RETURNING revision",
          ).bind(file.id, invite.id, file.base_revision, time, time),
          env.DB.prepare(
            "UPDATE files SET name=(SELECT target_name FROM invitations WHERE id=?),folder_id=(SELECT folder_id FROM invitations WHERE id=?),space=(SELECT space FROM invitations WHERE id=?) WHERE id=? AND EXISTS(SELECT 1 FROM invitations WHERE id=? AND current_file_id=?)",
          ).bind(invite.id, invite.id, invite.id, file.id, invite.id, file.id),
          env.DB.prepare(
            "UPDATE invitation_files SET published_at=? WHERE file_id=? AND EXISTS (SELECT 1 FROM invitations WHERE id=? AND current_file_id=?)",
          ).bind(time, file.id, invite.id, file.id),
        ]);
        ensure(
          results[0].results.length,
          409,
          "Someone saved a newer working copy. Your upload has not replaced it. Download the latest document and merge your edits.",
        );
      } else
        await env.DB.prepare(
          "UPDATE invitation_files SET published_at=COALESCE(published_at,?) WHERE file_id=?",
        )
          .bind(time, file.id)
          .run();
      if (
        invite.current_file_id &&
        invite.current_file_id !== invite.source_file_id &&
        invite.current_file_id !== file.id
      ) {
        const previous = await env.DB.prepare(
          "SELECT connector_id FROM files WHERE id=?",
        )
          .bind(invite.current_file_id)
          .first<Row>();
        const removed = await coordinate(
          env,
          previous!.connector_id,
          `/delete?file=${invite.current_file_id}&reason=replaced&actor=${invite.owner_id}`,
        );
        // Failed provider deletion stays in 'deleting' for the scheduled cleanup; access is already revoked.
        if (!removed.ok)
          console.warn("Collaboration working-copy cleanup deferred.");
      }
    } else
      await env.DB.prepare(
        "UPDATE invitation_files SET published_at=? WHERE file_id=?",
      )
        .bind(time, file.id)
        .run();
    await audit(
      env,
      invite.owner_id,
      `invitation.${invite.kind}.saved`,
      file.id,
    );
    return json({
      ok: true,
      revision: invite.revision + (invite.kind === "collaboration" ? 1 : 0),
    });
  }
  return null;
}
