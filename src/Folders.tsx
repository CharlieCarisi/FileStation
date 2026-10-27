import React, { lazy, Suspense, useEffect, useState } from "react";
import {
  Folder,
  Home,
  FolderPen,
  FolderPlus,
  Trash2,
  FileArchive,
  LayoutGrid,
  List,
} from "lucide-react";
import { api, post } from "./http";
import { Modal, ErrorMessage } from "./App.jsx";
import { t, getLocale } from "./i18n";
type Row = Record<string, any>;
const FolderArchiveDialog = lazy(() => import("./FolderArchiveDialog"));
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";
export function folderPath(id: string | null, folders: Row[]): string {
  const names: string[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((row) => row.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parent_id;
  }
  return [t("Root"), ...names].join(" / ");
}
export function SpaceSelect({
  value,
  onChange,
  allowPrivate = true,
}: {
  value: string;
  onChange: (value: string) => void;
  allowPrivate?: boolean;
}) {
  return (
    <label>
      {t("Workspace")}
      <select
        aria-label={t("Workspace")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="private" disabled={!allowPrivate}>
          {t("Private")}
        </option>
        <option value="public">{t("Public")}</option>
      </select>
    </label>
  );
}
export function FolderSelect({
  value,
  onChange,
  label,
  ownerId,
  excludeId,
  onReady,
  space = "private",
}: {
  space?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  ownerId?: string;
  excludeId?: string;
  onReady?: (ready: boolean) => void;
}) {
  const [folders, setFolders] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api(
      `/folders?space=${space}${ownerId && space === "private" ? `&ownerId=${encodeURIComponent(ownerId)}` : ""}`,
    )
      .then((result) => {
        if (active) setFolders(result.folders);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ownerId, space]);
  useEffect(() => {
    onReady?.(!loading && !error);
  }, [loading, error, onReady]);
  const excluded = new Set(excludeId ? [excludeId] : []);
  for (let level = 0; level < 20; level++)
    for (const folder of folders)
      if (excluded.has(folder.parent_id)) excluded.add(folder.id);
  const options = folders
    .filter((folder) => !excluded.has(folder.id))
    .map((folder) => ({
      ...folder,
      id: folder.id,
      path: folderPath(folder.id, folders),
    }))
    .sort((a, b) =>
      a.path.localeCompare(b.path, getLocale(), { numeric: true }),
    );
  return (
    <>
      <label>
        {label || t("Destination folder")}
        <select
          value={value || ""}
          disabled={loading || !!error}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{t("Root")}</option>
          {options.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.path}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage error={error} />
    </>
  );
}
function FolderForm({
  folder,
  parentId,
  space,
  onClose,
  onSaved,
}: {
  folder?: Row;
  parentId: string | null;
  space: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(folder?.name || ""),
    [parent, setParent] = useState<string | null>(
      folder?.parent_id || parentId,
    ),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/folders${folder ? `/${folder.id}` : ""}`, {
        method: folder ? "PATCH" : "POST",
        body: JSON.stringify({ name, parentId: parent, space }),
      });
      await onSaved();
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={folder ? t("Manage folder") : t("New folder")}
      onClose={onClose}
    >
      <form className="feature-form" onSubmit={save}>
        <label>
          {t("Folder name")}
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <FolderSelect
          value={parent}
          space={space}
          onChange={setParent}
          ownerId={folder?.owner_id}
          excludeId={folder?.id}
          label={t("Parent folder")}
          onReady={setReady}
        />
        <ErrorMessage error={error} />
        <button className="button primary" disabled={busy || !ready}>
          {busy ? t("Saving…") : t("Save folder")}
        </button>
      </form>
    </Modal>
  );
}
export function FolderActions({
  folder,
  connectors,
  onChanged,
}: {
  folder: Row;
  connectors: Row[];
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [archive, setArchive] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    if (!confirm(t("Delete empty folder {0}?", { 0: folder.name }))) return;
    setBusy(true);
    setError("");
    try {
      await api(`/folders/${folder.id}`, { method: "DELETE" });
      await onChanged();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="row-actions folder-actions">
        <button
          className="icon-button"
          title={t("Create folder ZIP")}
          aria-label={t("Create ZIP of {0}", { 0: folder.name })}
          onClick={() => setArchive(true)}
        >
          <FileArchive size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          title={t("Manage folder")}
          aria-label={t("Manage folder {0}", { 0: folder.name })}
          onClick={() => setEditing(true)}
        >
          <FolderPen size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button danger"
          title={t("Delete folder")}
          disabled={busy}
          aria-label={t("Delete folder {0}", { 0: folder.name })}
          onClick={remove}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <Modal title={t("Folder")} onClose={() => setError("")}>
          <ErrorMessage error={error} />
        </Modal>
      )}
      {editing && (
        <FolderForm
          folder={folder}
          parentId={folder.parent_id}
          space={folder.space || "private"}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
      {archive && (
        <Suspense
          fallback={
            <Modal
              title={t("Create folder ZIP")}
              onClose={() => setArchive(false)}
            >
              <p role="status">{t("Creating ZIP…")}</p>
            </Modal>
          }
        >
          <FolderArchiveDialog
            folder={folder}
            connectors={connectors}
            onClose={() => setArchive(false)}
            onSaved={onChanged}
          />
        </Suspense>
      )}
    </>
  );
}
export function FolderPane({
  folders,
  current,
  space = "private",
  onOpen,
  onChanged,
  connectors,
  view,
  onView,
  search = "",
}: {
  folders: Row[];
  current: string | null;
  space?: string;
  onOpen: (id: string | null) => void;
  onChanged: () => void | Promise<void>;
  connectors: Row[];
  view: string;
  onView: (view: string) => void;
  search?: string;
}) {
  const [creating, setCreating] = useState(false);
  const ancestors: Row[] = [];
  let parent = current;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const folder = folders.find((row) => row.id === parent);
    if (!folder) break;
    ancestors.unshift(folder);
    parent = folder.parent_id;
  }
  const children = folders.filter(
    (row) =>
      (row.parent_id || null) === current &&
      row.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="folder-workspace" aria-label={t("Workspace folders")}>
      <div className="folder-toolbar">
        <nav aria-label={t("Folder navigation")} className="folder-breadcrumbs">
          <button
            className="text-button"
            onClick={() => onOpen(null)}
            disabled={!current}
            aria-label={t("Go to root folder")}
          >
            <Home size={16} />
            {t("Root")}
          </button>
          {ancestors.map((folder) => (
            <React.Fragment key={folder.id}>
              <span aria-hidden="true">/</span>
              <button
                className="text-button"
                disabled={folder.id === current}
                onClick={() => onOpen(folder.id)}
              >
                {folder.name}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="folder-toolbar-actions">
          <div
            className="folder-view-toggle"
            role="group"
            aria-label={t("Folder view")}
          >
            <button
              className="text-button"
              aria-label={t("Folder tile view")}
              aria-pressed={view === "tiles"}
              onClick={() => onView("tiles")}
            >
              <LayoutGrid size={16} />
              {t("Tiles")}
            </button>
            <button
              className="text-button"
              aria-label={t("Folder list view")}
              aria-pressed={view === "list"}
              onClick={() => onView("list")}
            >
              <List size={16} />
              {t("List")}
            </button>
          </div>
          <button
            className="button secondary"
            onClick={() => setCreating(true)}
          >
            <FolderPlus size={16} aria-hidden="true" />
            {t("New folder")}
          </button>
        </div>
      </div>
      <p className="fineprint">
        {t(
          "Folders organize your workspace. Each file keeps its storage destination and retention policy.",
        )}
      </p>
      {view === "tiles" && !!children.length && (
        <div className="folder-grid">
          {children.map((folder) => (
            <article className="folder-card" key={folder.id}>
              <button
                className="folder-open"
                aria-label={t("Open folder {0}", { 0: folder.name })}
                onClick={() => onOpen(folder.id)}
              >
                <Folder size={24} />
                <strong>{folder.name}</strong>
              </button>
              <FolderActions
                folder={folder}
                connectors={connectors}
                onChanged={onChanged}
              />
            </article>
          ))}
        </div>
      )}
      {creating && (
        <FolderForm
          parentId={current}
          space={space}
          onClose={() => setCreating(false)}
          onSaved={onChanged}
        />
      )}
    </section>
  );
}
export function MoveFilesDialog({
  files,
  onClose,
  onMoved,
}: {
  files: Row[];
  onClose: () => void;
  onMoved: () => void | Promise<void>;
}) {
  const allowPrivate =
    files.every((file) => file.can_make_private !== false) &&
    new Set(files.map((file) => file.owner_id)).size === 1;
  const initialSpace = allowPrivate ? files[0]?.space || "private" : "public";
  const [space, setSpace] = useState(initialSpace);
  const [folder, setFolder] = useState<string | null>(
      (files[0]?.space || "private") === initialSpace
        ? files[0]?.folder_id || null
        : null,
    ),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function move(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/files/move", {
        fileIds: files.map((file) => file.id),
        folderId: folder,
        space,
      });
      await onMoved();
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Move files")} onClose={onClose}>
      <form className="feature-form" onSubmit={move}>
        <p>{t("{0} selected", { 0: files.length })}</p>
        <SpaceSelect
          value={space}
          allowPrivate={allowPrivate}
          onChange={(value) => {
            setReady(false);
            setSpace(value);
            setFolder(null);
          }}
        />
        {space === "public" && (
          <p className="info">
            {t(
              "Everyone with an approved account can view, upload, organize, download, and share in Public.",
            )}
          </p>
        )}
        <FolderSelect
          key={space}
          space={space}
          value={folder}
          onChange={setFolder}
          ownerId={files[0]?.owner_id}
          onReady={setReady}
        />
        <p className="fineprint">
          {t(
            "Moving files keeps their shares, storage connector, and retention dates.",
          )}
        </p>
        <p className="fineprint">
          {t(
            "Existing share links and invitations remain valid when changing spaces.",
          )}
        </p>
        <ErrorMessage error={error} />
        <button
          className="button primary"
          disabled={
            busy ||
            !ready ||
            files.every(
              (file) =>
                (file.folder_id || null) === folder &&
                (file.space || "private") === space,
            )
          }
        >
          {busy ? t("Moving…") : t("Move files")}
        </button>
      </form>
    </Modal>
  );
}
