import type { Env, Row } from "./model";
import { currentUser } from "./auth.js";
import { folderForOwner, folderError } from "./folders";
import {
  readsFile,
  ownsFile,
  workspaceSpace,
  shortcutAvailable,
} from "./workspaces";
import { body, ensure, json, id, now, audit, HttpError } from "./util.js";
const SELECT = `SELECT s.*,u.email AS owner_email,f.name AS target_name,f.owner_id AS target_owner_id,f.space AS target_space,f.folder_id AS target_folder_id,f.state AS target_state,f.expires_at AS target_expires_at,f.size AS target_size,f.mime AS target_mime,f.connector_id AS target_connector_id,f.created_at AS target_created_at,c.name AS target_connector_name,COALESCE(c.storage_adapter,c.adapter,c.kind) AS target_storage_kind,d.name AS target_folder_name FROM file_shortcuts s JOIN users u ON u.id=s.owner_id JOIN files f ON f.id=s.file_id JOIN connectors c ON c.id=f.connector_id LEFT JOIN folders d ON d.id=f.folder_id`;
function summary(row: Row, user: Row) {
  const target: Row = {
    id: row.file_id,
    name: row.target_name,
    owner_id: row.target_owner_id,
    space: row.target_space,
    folder_id: row.target_folder_id,
    folder_name: row.target_folder_name,
    state: row.target_state,
    expires_at: row.target_expires_at,
    size: row.target_size,
    mime: row.target_mime,
    connector_id: row.target_connector_id,
    connector_name: row.target_connector_name,
    storage_kind: row.target_storage_kind,
    created_at: row.target_created_at,
    can_open_location:
      row.target_space === "public" || row.target_owner_id === user.id,
  };
  const available = shortcutAvailable(user, row, target);
  return {
    id: row.id,
    owner_id: row.owner_id,
    owner_email: row.owner_email,
    folder_id: row.folder_id,
    space: row.space,
    name: row.name,
    created_at: row.created_at,
    available,
    can_delete: ownsFile(user, row),
    can_make_private: ownsFile(user, row),
    target: available ? target : null,
  };
}
function shortcutName(value: unknown) {
  ensure(typeof value === "string", 400, "Enter a shortcut name.");
  const name = (value as string).normalize("NFC").trim();
  ensure(
    name.length > 0 &&
      name.length <= 255 &&
      !/[\x00-\x1f\x7f/\\]/.test(name) &&
      ![".", ".."].includes(name),
    400,
    "Use a shortcut name of 1–255 characters without slashes or control characters.",
  );
  return name;
}
function shortcutError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("shortcuts_destination"))
    throw new HttpError(
      409,
      "A shortcut to this file already exists in that folder.",
    );
  if (message.includes("shortcut_limit"))
    throw new HttpError(
      409,
      "This workspace has reached the limit of 1,000 shortcuts.",
    );
  if (message.includes("shortcut_private_target"))
    throw new HttpError(
      409,
      "Move the original file to Public before creating a Public shortcut.",
    );
  folderError(error);
}
export async function shortcutRoutes(request: Request, env: Env, path: string) {
  const match = path.match(/^\/api\/shortcuts(?:\/([^/]+))?$/);
  if (!match) return null;
  const user = await currentUser(request, env, true),
    shortcutId = match[1];
  try {
    if (!shortcutId && request.method === "GET") {
      const query = new URL(request.url).searchParams,
        space = workspaceSpace(query.get("space") ?? "private");
      const ownerId = query.get("ownerId") || user.id;
      ensure(
        ownerId === user.id || user.role === "admin",
        403,
        "You can only organize your own workspace.",
      );
      const filters = ["s.space=?", "(s.space='public' OR s.owner_id=?)"],
        values: any[] = [space, ownerId];
      if (query.has("folderId")) {
        const folder = await folderForOwner(
          env,
          ownerId,
          query.get("folderId"),
          space,
        );
        filters.push(folder ? "s.folder_id=?" : "s.folder_id IS NULL");
        if (folder) values.push(folder);
      }
      const rows = (
        await env.DB.prepare(
          `${SELECT} WHERE ${filters.join(" AND ")} ORDER BY s.name COLLATE NOCASE,s.id LIMIT 1000`,
        )
          .bind(...values)
          .all<Row>()
      ).results;
      return json({ shortcuts: rows.map((row) => summary(row, user)) });
    }
    if (!shortcutId && request.method === "POST") {
      const input = await body(request);
      ensure(
        typeof input.fileId === "string" && input.fileId.length <= 128,
        400,
        "Choose a file for this shortcut.",
      );
      const file = await env.DB.prepare(
        "SELECT id,owner_id,space,state,expires_at,name FROM files WHERE id=?",
      )
        .bind(input.fileId)
        .first<Row>();
      ensure(file && readsFile(user, file), 404, "File not found.");
      ensure(
        file!.state === "ready" &&
          (!file!.expires_at || file!.expires_at > now()),
        410,
        "This file is no longer available.",
      );
      const space = workspaceSpace(input.space),
        folder = await folderForOwner(env, user.id, input.folderId, space);
      ensure(
        space !== "public" || file!.space === "public",
        409,
        "Move the original file to Public before creating a Public shortcut.",
      );
      const shortcut = id(),
        name = shortcutName(
          input.name ?? file!.name.replace(/[\x00-\x1f\x7f/\\]/g, "_"),
        );
      const saved = await env.DB.prepare(
        `INSERT INTO file_shortcuts(id,owner_id,file_id,folder_id,space,name,created_at) SELECT ?,?,f.id,?,?,?,? FROM files f WHERE f.id=? AND f.state='ready' AND (f.expires_at IS NULL OR f.expires_at>?) AND (f.owner_id=? OR ?=1 OR f.space='public') AND (?<>'public' OR f.space='public') RETURNING id`,
      )
        .bind(
          shortcut,
          user.id,
          folder,
          space,
          name,
          now(),
          file!.id,
          now(),
          user.id,
          user.role === "admin" ? 1 : 0,
          space,
        )
        .first();
      ensure(saved, 409, "The original file changed. Refresh and try again.");
      await audit(env, user.id, "shortcut.created", shortcut);
      return json(
        {
          shortcut: summary(
            (await env.DB.prepare(`${SELECT} WHERE s.id=?`)
              .bind(shortcut)
              .first<Row>())!,
            user,
          ),
        },
        201,
      );
    }
    const row = await env.DB.prepare(`${SELECT} WHERE s.id=?`)
      .bind(shortcutId || "")
      .first<Row>();
    ensure(row && readsFile(user, row), 404, "Shortcut not found.");
    if (request.method === "GET")
      return json({ shortcut: summary(row!, user) });
    if (request.method === "DELETE") {
      ensure(
        ownsFile(user, row!),
        403,
        "Only the shortcut creator or an administrator can remove this shortcut.",
      );
      await env.DB.prepare(
        "DELETE FROM file_shortcuts WHERE id=? AND (owner_id=? OR ?=1)",
      )
        .bind(row!.id, user.id, user.role === "admin" ? 1 : 0)
        .run();
      await audit(env, user.id, "shortcut.deleted", row!.id);
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const input = await body(request),
        space = workspaceSpace(input.space ?? row!.space);
      ensure(
        space !== "private" || ownsFile(user, row!),
        403,
        "Only the shortcut creator or an administrator can move this shortcut to Private.",
      );
      const folder = Object.hasOwn(input, "folderId")
        ? await folderForOwner(env, row!.owner_id, input.folderId, space)
        : row!.folder_id;
      ensure(
        space === row!.space || Object.hasOwn(input, "folderId"),
        400,
        "Choose a destination folder.",
      );
      const name = Object.hasOwn(input, "name")
        ? shortcutName(input.name)
        : row!.name;
      const saved = await env.DB.prepare(
        "UPDATE file_shortcuts SET name=?,folder_id=?,space=? WHERE id=? AND (owner_id=? OR ?=1 OR (space='public' AND ?='public')) RETURNING id",
      )
        .bind(
          name,
          folder,
          space,
          row!.id,
          user.id,
          user.role === "admin" ? 1 : 0,
          space,
        )
        .first();
      ensure(saved, 409, "This shortcut changed. Refresh and try again.");
      await audit(env, user.id, "shortcut.updated", row!.id);
      return json({
        shortcut: summary(
          (await env.DB.prepare(`${SELECT} WHERE s.id=?`)
            .bind(row!.id)
            .first<Row>())!,
          user,
        ),
      });
    }
    return json({ error: "Endpoint not found." }, 404);
  } catch (error) {
    shortcutError(error);
  }
}
