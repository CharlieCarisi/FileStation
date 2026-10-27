import React, { useState } from "react";
import { Link2 } from "lucide-react";
import { Modal, ErrorMessage } from "./App.jsx";
import { FolderSelect, SpaceSelect } from "./Folders";
import { api } from "./http";
import { t } from "./i18n";
type Row = Record<string, any>;
export default function ShortcutDialog({
  file,
  shortcut,
  onClose,
  onSaved,
}: {
  file?: Row;
  shortcut?: Row;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(
    shortcut?.name || file?.name.replace(/[\x00-\x1f\x7f/\\]/g, "_") || "",
  );
  const [space, setSpace] = useState(
    shortcut?.space || file?.space || "private",
  );
  const [folder, setFolder] = useState<string | null>(
      shortcut?.folder_id || null,
    ),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const allowPrivate = shortcut?.can_make_private !== false;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/shortcuts${shortcut ? `/${shortcut.id}` : ""}`, {
        method: shortcut ? "PATCH" : "POST",
        body: JSON.stringify({
          fileId: file?.id,
          name,
          space,
          folderId: folder,
        }),
      });
      await onSaved();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={shortcut ? t("Manage shortcut") : t("Create shortcut")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="feature-form" onSubmit={save}>
        <label>
          {t("Shortcut name")}
          <input
            required
            autoFocus
            maxLength={255}
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <SpaceSelect
          value={space}
          allowPrivate={allowPrivate}
          onChange={(value) => {
            setReady(false);
            setSpace(value);
            setFolder(null);
          }}
        />
        <FolderSelect
          key={space}
          space={space}
          value={folder}
          onChange={setFolder}
          ownerId={shortcut?.owner_id}
          onReady={setReady}
        />
        <p className="info">
          {t(
            "A shortcut points to the original file without using extra storage. Removing the shortcut keeps the original file and its shares.",
          )}
        </p>
        <p className="fineprint">
          {t(
            "The original file’s permissions and retention still apply. Public shortcuts require a Public original.",
          )}
        </p>
        <ErrorMessage error={error} />
        <div className="feature-actions">
          <button
            className="button primary"
            disabled={busy || !ready || !name.trim()}
          >
            <Link2 size={17} />
            {busy
              ? t("Saving…")
              : shortcut
                ? t("Save shortcut")
                : t("Create shortcut")}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t("Cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
