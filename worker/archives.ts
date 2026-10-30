import type { Env, Row } from "./model";
import { ensure, json, now } from "./util.js";
import { readsFile, shortcutAvailable } from "./workspaces";

// ZIP names are portable relative paths, including for legacy file names that
// contain separators or collide after sanitizing. Never use a storage key here.
function component(value: string) {
  const clean = value
    .normalize("NFC")
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "");
  return !clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)
    ? `_${clean || "file"}`
    : clean;
}
export function archiveEntries(folders: Row[], files: Row[], rootId: string) {
  const paths = new Map<string, string>();
  const used = new Map<string, Set<string>>();
  function unique(parent: string, original: string, directory: boolean) {
    const names = used.get(parent) || new Set<string>();
    used.set(parent, names);
    const safe = component(original),
      dot = directory ? -1 : safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe,
      ext = dot > 0 ? safe.slice(dot) : "";
    let name = safe;
    for (let n = 2; names.has(name.toLowerCase()); n++)
      name = `${stem} (${n})${ext}`;
    names.add(name.toLowerCase());
    return name;
  }
  function directory(id: string): string {
    const saved = paths.get(id);
    if (saved) return saved;
    const folder = folders.find((row) => row.id === id)!;
    const parent = id === rootId ? "" : directory(folder.parent_id);
    const path = `${parent}${unique(parent, folder.name, true)}/`;
    paths.set(id, path);
    return path;
  }
  const directories = folders.map((folder) => ({
    path: directory(folder.id),
    directory: true as const,
  }));
  return [
    ...directories,
    ...files.map((file) => {
      const parent = directory(file.folder_id);
      return {
        id: file.id,
        name: file.name,
        size: file.size,
        created_at: file.created_at,
        path: parent + unique(parent, file.name, false),
        directory: false as const,
      };
    }),
  ];
}

export async function folderArchive(env: Env, user: Row, folderId: string) {
  const root = await env.DB.prepare("SELECT * FROM folders WHERE id=?")
    .bind(folderId)
    .first<Row>();
  ensure(root && readsFile(user, root), 404, "Folder not found.");
  const tree = `WITH RECURSIVE tree(id,depth) AS (SELECT id,0 FROM folders WHERE id=? UNION ALL SELECT f.id,tree.depth+1 FROM folders f JOIN tree ON f.parent_id=tree.id WHERE tree.depth<20)`;
  const folders = (
    await env.DB.prepare(
      `${tree} SELECT f.* FROM folders f JOIN tree ON tree.id=f.id ORDER BY tree.depth,f.name COLLATE NOCASE,f.id`,
    )
      .bind(folderId)
      .all<Row>()
  ).results;
  ensure(
    folders.every((row) => readsFile(user, row)),
    404,
    "Folder not found.",
  );
  const files = (
    await env.DB.prepare(
      `${tree} SELECT f.id,f.owner_id,f.space,f.folder_id,f.name,f.size,f.created_at,f.state FROM files f JOIN tree ON tree.id=f.folder_id WHERE f.state='ready' AND (f.expires_at IS NULL OR f.expires_at>?) ORDER BY f.created_at,f.id LIMIT 1001`,
    )
      .bind(folderId, now())
      .all<Row>()
  ).results;
  ensure(
    files.length <= 1000,
    400,
    "A ZIP can contain up to 1,000 files. Choose a smaller folder.",
  );
  ensure(
    files.every((row) => readsFile(user, row)),
    404,
    "Folder not found.",
  );
  const shortcuts = (
    await env.DB.prepare(
      `${tree} SELECT s.name,s.folder_id,s.created_at,s.owner_id AS shortcut_owner_id,s.space AS shortcut_space,f.id,f.owner_id,f.space,f.state,f.expires_at,f.size FROM file_shortcuts s JOIN tree ON tree.id=s.folder_id JOIN files f ON f.id=s.file_id ORDER BY s.created_at,s.id LIMIT 1001`,
    )
      .bind(folderId)
      .all<Row>()
  ).results;
  ensure(
    files.length + shortcuts.length <= 1000,
    400,
    "A ZIP can contain up to 1,000 files. Choose a smaller folder.",
  );
  ensure(
    shortcuts.every(
      (row) =>
        readsFile(user, {
          owner_id: row.shortcut_owner_id,
          space: row.shortcut_space,
        }) && shortcutAvailable(user, { space: row.shortcut_space }, row),
    ),
    409,
    "Move or remove unavailable shortcuts before creating a ZIP.",
  );
  const contents = [...files, ...shortcuts];
  return json({
    folder: {
      id: root!.id,
      name: root!.name,
      parent_id: root!.parent_id,
      space: root!.space,
    },
    entries: archiveEntries(folders, contents, folderId),
    fileCount: contents.length,
    totalSize: contents.reduce((total, file) => total + file.size, 0),
  });
}
