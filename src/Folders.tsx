import React, { useEffect, useState } from "react";
import { Folder, Home, Settings2, Trash2 } from "lucide-react";
import { api, post } from "./http";
import { Modal, ErrorMessage } from "./App.jsx";
import { t, getLocale } from "./i18n";
type Row = Record<string, any>;
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
export function FolderSelect({
  value,
  onChange,
  label,
  ownerId,
  excludeId,
  onReady,
}: {
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
    api(`/folders${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`)
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
  }, [ownerId]);
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
  onClose,
  onSaved,
}: {
  folder?: Row;
  parentId: string | null;
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
        body: JSON.stringify({ name, parentId: parent }),
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
export function FolderPane({
  folders,
  current,
  onOpen,
  onChanged,
}: {
  folders: Row[];
  current: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<Row | null | undefined>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
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
  const children = folders.filter((row) => (row.parent_id || null) === current);
  async function remove(folder: Row) {
    if (!confirm(t("Delete empty folder {0}?", { 0: folder.name }))) return;
    setBusy(folder.id);
    setError("");
    try {
      await api(`/folders/${folder.id}`, { method: "DELETE" });
      await onChanged();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
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
        <button className="button secondary" onClick={() => setEditing(null)}>
          {t("New folder")}
        </button>
      </div>
      <p className="fineprint">
        {t(
          "Folders organize your workspace. Each file keeps its storage destination and retention policy.",
        )}
      </p>
      <ErrorMessage error={error} />
      {!!children.length && (
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
              <div className="row-actions">
                <button
                  className="icon-button"
                  aria-label={t("Manage folder {0}", { 0: folder.name })}
                  onClick={() => setEditing(folder)}
                >
                  <Settings2 size={16} />
                </button>
                <button
                  className="icon-button danger"
                  disabled={busy === folder.id}
                  aria-label={t("Delete folder {0}", { 0: folder.name })}
                  onClick={() => remove(folder)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing !== undefined && (
        <FolderForm
          folder={editing || undefined}
          parentId={current}
          onClose={() => setEditing(undefined)}
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
  const [folder, setFolder] = useState<string | null>(
      files[0]?.folder_id || null,
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
        <FolderSelect
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
        <ErrorMessage error={error} />
        <button
          className="button primary"
          disabled={
            busy ||
            !ready ||
            files.every((file) => (file.folder_id || null) === folder)
          }
        >
          {busy ? t("Moving…") : t("Move files")}
        </button>
      </form>
    </Modal>
  );
}
