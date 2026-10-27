import type { Env, Row } from "./model";
import { body, ensure, json, now, audit } from "./util.js";
import { readsFile } from "./workspaces";
import { splitFileName } from "../shared/file-names";

// Incomplete or superseded collaboration copies cannot be renamed as files.
export const renameAvailable = (fileAlias: string) =>
  `NOT EXISTS(SELECT 1 FROM invitation_files x JOIN invitations i ON i.id=x.invitation_id WHERE x.file_id=${fileAlias}.id AND i.kind='collaboration' AND (x.published_at IS NULL OR i.current_file_id IS NOT ${fileAlias}.id))`;

export async function renameFile(
  request: Request,
  env: Env,
  user: Row,
  fileId: string,
) {
  const file = await env.DB.prepare("SELECT * FROM files WHERE id=?")
    .bind(fileId)
    .first<Row>();
  ensure(file && readsFile(user, file!), 404, "File not found.");
  ensure(
    file!.state !== "uploading",
    409,
    "Finish uploading the file before renaming it.",
  );
  ensure(
    file!.state === "ready" && (!file!.expires_at || file!.expires_at > now()),
    410,
    "This file is no longer available.",
  );
  const input = await body(request);
  ensure(typeof input.name === "string", 400, "Enter a file name.");
  const name = input.name.normalize("NFC").trim();
  ensure(
    name.length > 0 &&
      name.length <= 255 &&
      !/[\x00-\x1f\x7f/\\]/.test(name) &&
      ![".", ".."].includes(name),
    400,
    "Use a file name of 1–255 characters without slashes or control characters.",
  );
  ensure(
    splitFileName(name).extension.toLowerCase() ===
      splitFileName(file!.name.normalize("NFC")).extension.toLowerCase(),
    400,
    "Keep the original file extension when renaming.",
  );
  ensure(
    input.expectedName === undefined || typeof input.expectedName === "string",
    400,
    "Choose a valid filename to rename.",
  );
  const expected = input.expectedName ?? file!.name;
  ensure(
    expected === file!.name,
    409,
    "The file changed. Refresh and try again.",
  );
  const predicate =
    "id=? AND state='ready' AND (expires_at IS NULL OR expires_at>?) AND (owner_id=? OR space='public' OR ?=1)";
  const args = [fileId, now(), user.id, user.role === "admin" ? 1 : 0];
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE files SET name=? WHERE ${predicate} AND name=? AND ${renameAvailable("files")} RETURNING id,name`,
    ).bind(name, ...args, expected),
    env.DB.prepare(
      `UPDATE invitations SET target_name=? WHERE kind='collaboration' AND current_file_id=? AND current_file_id<>source_file_id AND EXISTS(SELECT 1 FROM files WHERE ${predicate} AND name=?)`,
    ).bind(name, fileId, ...args, name),
  ]);
  ensure(
    results[0].results.length,
    409,
    "The file changed. Refresh and try again.",
  );
  if (name !== expected) await audit(env, user.id, "file.renamed", fileId);
  return json({ file: { id: fileId, name } });
}
