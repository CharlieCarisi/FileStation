import React, { useEffect, useState } from "react";
import {
  Download,
  ArrowDown,
  Link2,
  FolderInput,
  Trash2,
  Upload,
} from "lucide-react";
import {
  FileIcon,
  formatBytes,
  formatDate,
  canDirectDownload,
} from "./App.jsx";
import { basePath } from "./http";
import { MoveFilesDialog } from "./Folders";
import { t } from "./i18n";
type Row = Record<string, any>;
export default function FileTable({
  files,
  connectors,
  showOwner,
  showLocation,
  contextKey,
  onDownload,
  onShare,
  onDelete,
  onTransfers,
  onChanged,
}: {
  files: Row[];
  connectors: Row[];
  showOwner: boolean;
  showLocation: boolean;
  contextKey: string;
  onDownload: (file: Row) => void;
  onShare: (file: Row) => void;
  onDelete: (file: Row) => void;
  onTransfers: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [moving, setMoving] = useState<Row[] | null>(null);
  useEffect(() => setSelected(new Set()), [contextKey]);
  const chosen = files.filter((file) => selected.has(file.id)),
    mixed = new Set(chosen.map((file) => file.owner_id)).size > 1;
  function choose(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  return (
    <>
      {!!chosen.length && (
        <div className="file-selection">
          <span>{t("{0} selected", { 0: chosen.length })}</span>
          <button
            className="button secondary"
            disabled={mixed}
            onClick={() => setMoving(chosen)}
          >
            {t("Move selected files")}
          </button>
          <button
            className="text-button"
            onClick={() => setSelected(new Set())}
          >
            {t("Clear selection")}
          </button>
          {mixed && (
            <small>
              {t("Select files belonging to one owner to move them.")}
            </small>
          )}
        </div>
      )}
      <div className="table-shell">
        <table className="files-table">
          <thead>
            <tr>
              <th className="file-select-cell">
                <input
                  type="checkbox"
                  aria-label={t("Select all files")}
                  checked={!!files.length && chosen.length === files.length}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(files.map((file) => file.id))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th>
                {t("NAME")} <ArrowDown size={12} />
              </th>
              <th>{t("STORAGE")}</th>
              <th>{t("SIZE")}</th>
              <th>{showOwner ? t("OWNER") : t("ADDED")}</th>
              <th>{t("KEEP UNTIL")}</th>
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.id}>
                <td className="file-select-cell">
                  <input
                    type="checkbox"
                    aria-label={t("Select {0}", { 0: file.name })}
                    checked={selected.has(file.id)}
                    onChange={(event) => choose(file.id, event.target.checked)}
                  />
                </td>
                <td>
                  <div className="file-name">
                    <FileIcon name={file.name} />
                    <div>
                      <strong title={file.name}>{file.name}</strong>
                      <small>
                        {file.state === "uploading"
                          ? t("Upload in progress")
                          : file.share_count
                            ? t("{0} active share{1}", {
                                0: file.share_count,
                                1: file.share_count > 1 ? t("s") : "",
                              })
                            : file.mime || t("File")}
                      </small>
                      {showLocation && (
                        <small>
                          {t("Folder")}: {file.folder_name || t("Root")}
                        </small>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <span className="storage-tag">
                    <span
                      className={`storage-dot ${connectors.find((connector) => connector.id === file.connector_id)?.kind}`}
                    />
                    {file.connector_name}
                  </span>
                </td>
                <td>{formatBytes(file.size)}</td>
                <td>
                  {showOwner ? file.owner_email : formatDate(file.created_at)}
                </td>
                <td>
                  {file.state === "uploading"
                    ? "—"
                    : formatDate(file.expires_at)}
                </td>
                <td>
                  <div className="row-actions">
                    {file.state === "ready" ? (
                      <>
                        <button
                          className="icon-button"
                          aria-label={t("Download {0}", { 0: file.name })}
                          title={t("Resumable download")}
                          onClick={() => onDownload(file)}
                        >
                          <Download size={17} />
                        </button>
                        {canDirectDownload(file) && (
                          <a
                            className="icon-button"
                            aria-label={t("Direct browser download {0}", {
                              0: file.name,
                            })}
                            title={t("Direct browser download")}
                            href={`${basePath}/api/files/${file.id}/download`}
                          >
                            <ArrowDown size={17} />
                          </a>
                        )}
                        <button
                          className="icon-button"
                          aria-label={t("Share {0}", { 0: file.name })}
                          title={t("Share file")}
                          onClick={() => onShare(file)}
                        >
                          <Link2 size={17} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="icon-button"
                        aria-label={t("Go to transfers")}
                        title={t("Go to transfers")}
                        onClick={onTransfers}
                      >
                        <Upload size={17} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={t("Move {0}", { 0: file.name })}
                      title={t("Move files")}
                      onClick={() => setMoving([file])}
                    >
                      <FolderInput size={17} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={t("Delete {0}", { 0: file.name })}
                      title={t("Delete file")}
                      onClick={() => onDelete(file)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {moving && (
        <MoveFilesDialog
          files={moving}
          onClose={() => setMoving(null)}
          onMoved={async () => {
            setSelected(new Set());
            await onChanged();
          }}
        />
      )}
    </>
  );
}
