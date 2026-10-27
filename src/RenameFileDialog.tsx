import React, { useState } from "react";
import { TextCursorInput } from "lucide-react";
import { Modal, ErrorMessage } from "./App.jsx";
import { api } from "./http";
import { t } from "./i18n";
import { splitFileName } from "../shared/file-names";
type Row = Record<string, any>;
export default function RenameFileDialog({
  file,
  onClose,
  onRenamed,
}: {
  file: Row;
  onClose: () => void;
  onRenamed: () => void | Promise<void>;
}) {
  const { stem, extension } = splitFileName(file.name);
  const [name, setName] = useState(stem),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/files/${file.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim() + extension,
          expectedName: file.name,
        }),
      });
      await onRenamed();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("Rename file")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="feature-form" onSubmit={save}>
        <label>
          {t("File name")}
          <span className="rename-name">
            <input
              aria-label={t("File name")}
              autoFocus
              required
              disabled={busy}
              maxLength={255 - extension.length}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
            {extension && <span className="rename-extension">{extension}</span>}
          </span>
        </label>
        {extension && (
          <p className="fineprint">
            {t("The file extension stays {0}.", { 0: extension })}
          </p>
        )}
        <p className="fineprint">
          {t(
            "Renaming keeps existing shares, folders, storage, and retention dates.",
          )}
        </p>
        <ErrorMessage error={error} />
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t("Cancel")}
          </button>
          <button
            className="button primary"
            disabled={busy || !name.trim() || name.trim() === stem}
          >
            <TextCursorInput size={17} aria-hidden="true" />
            {busy ? t("Renaming…") : t("Rename file")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
