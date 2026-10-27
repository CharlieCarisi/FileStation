import type { Env, Row } from "./model";
import { currentUser } from "./auth.js";
import { workspaceSpace, ownsFile, readsFile, type Space } from "./workspaces";
import { body, ensure, json, id, now, audit, HttpError } from "./util.js";
import { folderArchive } from "./archives";

export async function folderForOwner(
  env: Env,
  ownerId: string,
  value: unknown,
  space: Space = "private",
): Promise<string | null> {
  if (value === null || value === undefined || value === "" || value === "root")
    return null;
  ensure(
    typeof value === "string" && value.length <= 128,
    400,
    "Choose a valid folder.",
  );
  const folder = await env.DB.prepare(
    "SELECT id FROM folders WHERE id=? AND space=? AND (space='public' OR owner_id=?)",
  )
    .bind(value, space, ownerId)
    .first<Row>();
  ensure(folder, 404, "The selected folder is no longer available.");
  return folder!.id;
}
export function folderError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("folder_cycle"))
    throw new HttpError(
      409,
      "A folder cannot be moved into itself or one of its subfolders.",
    );
  if (message.includes("folder_depth"))
    throw new HttpError(409, "Folders can be nested up to 20 levels deep.");
  if (message.includes("folder_limit"))
    throw new HttpError(
      409,
      "This workspace has reached the limit of 1,000 folders.",
    );
  if (message.includes("folder_not_empty"))
    throw new HttpError(
      409,
      "Move the files and subfolders, and revoke active invitations before deleting this folder.",
    );
  if (message.includes("folders_sibling_name"))
    throw new HttpError(409, "A folder with this name already exists here.");
  if (
    message.includes("folder_owner") ||
    message.includes("folder_space") ||
    message.includes("FOREIGN KEY")
  )
    throw new HttpError(
      409,
      "The selected folder changed or was removed. Choose it again.",
    );
  throw error;
}
function name(value: unknown) {
  ensure(typeof value === "string", 400, "Enter a folder name.");
  const result = (value as string).normalize("NFC").trim();
  ensure(
    result.length > 0 &&
      result.length <= 120 &&
      !/[\x00-\x1f\x7f/\\]/.test(result) &&
      ![".", ".."].includes(result),
    400,
    "Use a folder name of 1–120 characters without slashes or control characters.",
  );
  return result;
}
async function owner(env: Env, user: Row, ownerId: unknown) {
  const target = ownerId || user.id;
  ensure(
    typeof target === "string" && (target === user.id || user.role === "admin"),
    403,
    "You can only organize your own workspace.",
  );
  ensure(
    await env.DB.prepare(
      "SELECT id FROM users WHERE id=? AND status<>'deleted'",
    )
      .bind(target)
      .first(),
    404,
    "User not found.",
  );
  return target as string;
}
export async function removeUserFolders(env: Env, ownerId: string) {
  await env.DB.prepare(
    "UPDATE invitations SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=?",
  )
    .bind(now(), ownerId)
    .run();
  for (let level = 0; level < 20; level++) {
    const result = await env.DB.prepare(
      "DELETE FROM folders WHERE owner_id=? AND space='private' AND NOT EXISTS(SELECT 1 FROM folders child WHERE child.parent_id=folders.id)",
    )
      .bind(ownerId)
      .run();
    if (!result.meta.changes) break;
  }
}
export async function folderRoutes(request: Request, env: Env, path: string) {
  const archive = path.match(/^\/api\/folders\/([^/]+)\/archive$/);
  if (archive && request.method === "GET")
    return folderArchive(
      env,
      await currentUser(request, env, true),
      archive[1],
    );
  const match = path.match(/^\/api\/folders(?:\/([^/]+))?$/);
  if (!match && path !== "/api/files/move") return null;
  const user = await currentUser(request, env, true);
  try {
    if (path === "/api/files/move" && request.method === "POST") {
      const input = await body(request);
      ensure(
        Array.isArray(input.fileIds) &&
          input.fileIds.length >= 1 &&
          input.fileIds.length <= 500 &&
          input.fileIds.every(
            (value: unknown) =>
              typeof value === "string" && value.length <= 128,
          ),
        400,
        "Select 1–500 files to move.",
      );
      ensure(
        Object.hasOwn(input, "folderId"),
        400,
        "Choose a destination folder.",
      );
      const ids = JSON.stringify([...new Set(input.fileIds)]),
        count = JSON.parse(ids).length;
      const rows = (
        await env.DB.prepare(
          "SELECT id,owner_id,state,space FROM files WHERE id IN (SELECT value FROM json_each(?))",
        )
          .bind(ids)
          .all<Row>()
      ).results;
      ensure(
        rows.length === count &&
          rows.every(
            (file) =>
              readsFile(user, file) &&
              ["ready", "uploading"].includes(file.state),
          ),
        404,
        "One or more selected files are no longer available.",
      );
      const space = workspaceSpace(input.space ?? rows[0].space);
      const owners = new Set(rows.map((file) => file.owner_id));
      if (space === "private") {
        ensure(
          owners.size === 1,
          400,
          "Select files belonging to one owner to move them.",
        );
        ensure(
          rows.every((file) => ownsFile(user, file)),
          403,
          "Only the uploader or an administrator can move this file to Private.",
        );
      }
      const ownerId = rows[0].owner_id;
      const folder = await folderForOwner(env, ownerId, input.folderId, space);
      // Recheck permissions and availability in the transaction: a public file
      // may have returned to Private since the initial lookup.
      const predicate =
        "id IN (SELECT value FROM json_each(?)) AND state IN ('ready','uploading') AND (owner_id=? OR ?=1 OR (space='public' AND ?='public'))";
      const args = [ids, user.id, user.role === "admin" ? 1 : 0, space];
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE files SET folder_id=?,space=? WHERE ${predicate} AND (SELECT COUNT(*) FROM files WHERE ${predicate})=? RETURNING id`,
        ).bind(folder, space, ...args, ...args, count),
        env.DB.prepare(
          `UPDATE invitations SET folder_id=?,space=? WHERE current_file_id<>source_file_id AND current_file_id IN (SELECT value FROM json_each(?)) AND (SELECT COUNT(*) FROM files WHERE ${predicate})=?`,
        ).bind(folder, space, ids, ...args, count),
      ]);
      ensure(
        results[0].results.length === count,
        409,
        "The selected files changed. Refresh and try again.",
      );
      await audit(env, user.id, "files.moved", folder || ownerId);
      return json({ ok: true, moved: count });
    }
    if (!match) return null;
    const folderId = match[1];
    if (!folderId && request.method === "GET") {
      const space = workspaceSpace(
        new URL(request.url).searchParams.get("space") ?? "private",
      );
      const ownerId =
        space === "public"
          ? user.id
          : await owner(
              env,
              user,
              new URL(request.url).searchParams.get("ownerId"),
            );
      const rows = await env.DB.prepare(
        "SELECT id,owner_id,parent_id,name,created_at,space FROM folders WHERE space=? AND (space='public' OR owner_id=?) ORDER BY name COLLATE NOCASE,id",
      )
        .bind(space, ownerId)
        .all();
      return json({ folders: rows.results });
    }
    if (!folderId && request.method === "POST") {
      const input = await body(request),
        ownerId = await owner(env, user, input.ownerId);
      const space = workspaceSpace(input.space);
      const parent = await folderForOwner(env, ownerId, input.parentId, space),
        folder = {
          id: id(),
          owner_id: ownerId,
          parent_id: parent,
          name: name(input.name),
          created_at: now(),
          space,
        };
      await env.DB.prepare(
        "INSERT INTO folders(id,owner_id,parent_id,name,created_at,space) VALUES (?,?,?,?,?,?)",
      )
        .bind(folder.id, ownerId, parent, folder.name, folder.created_at, space)
        .run();
      await audit(env, user.id, "folder.created", folder.id);
      return json({ folder }, 201);
    }
    const folder = await env.DB.prepare("SELECT * FROM folders WHERE id=?")
      .bind(folderId)
      .first<Row>();
    ensure(folder && readsFile(user, folder), 404, "Folder not found.");
    if (request.method === "PATCH") {
      const input = await body(request);
      ensure(
        Object.hasOwn(input, "name") || Object.hasOwn(input, "parentId"),
        400,
        "Choose a folder change to save.",
      );
      const parent = Object.hasOwn(input, "parentId")
        ? await folderForOwner(
            env,
            folder!.owner_id,
            input.parentId,
            folder!.space,
          )
        : folder!.parent_id;
      const updated = await env.DB.prepare(
        "UPDATE folders SET name=?,parent_id=? WHERE id=? RETURNING *",
      )
        .bind(
          Object.hasOwn(input, "name") ? name(input.name) : folder!.name,
          parent,
          folder!.id,
        )
        .first();
      ensure(updated, 404, "Folder not found.");
      await audit(env, user.id, "folder.updated", folder!.id);
      return json({ folder: updated });
    }
    if (request.method === "DELETE") {
      const removed = await env.DB.prepare(
        "DELETE FROM folders WHERE id=? RETURNING id",
      )
        .bind(folder!.id)
        .first();
      ensure(removed, 404, "Folder not found.");
      await audit(env, user.id, "folder.deleted", folder!.id);
      return json({ ok: true });
    }
    return json({ error: "Endpoint not found." }, 404);
  } catch (error) {
    folderError(error);
  }
}
