import React, { useState } from "react";
import {
  CornerUpLeft,
  Eye,
  FolderPen,
  Link2,
  Share2,
  Trash2,
  CloudDownload,
  Download,
} from "lucide-react";
import {
  FileIcon,
  formatBytes,
  formatDate,
  canDirectDownload,
  Modal,
  ErrorMessage,
} from "./App.jsx";
import { DownloadIcon } from "./TransferFeedback";
import PreviewLink, { previewHref, openPreviewWindow } from "./PreviewLink";
import { ItemMenu, type MenuAction } from "./ItemMenu";
import ShortcutDialog from "./ShortcutDialog";
import { api, basePath } from "./http";
import { t } from "./i18n";
type Row = Record<string, any>;
export default function ShortcutRow({
  shortcut,
  showOwner,
  onDownload,
  onShare,
  onOpenFileLocation,
  onChanged,
}: {
  shortcut: Row;
  showOwner: boolean;
  onDownload: (file: Row) => void;
  onShare: (file: Row) => void;
  onOpenFileLocation?: (file: Row) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const file = shortcut.target;
  async function remove() {
    if (
      !confirm(
        t("Remove shortcut {0}? The original file and its shares are kept.", {
          0: shortcut.name,
        }),
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/shortcuts/${shortcut.id}`, { method: "DELETE" });
      await onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }
  const actions: MenuAction[] = [];
  if (file) {
    const href = previewHref(file);
    if (href)
      actions.push({
        id: "preview",
        label: t("Open preview in a new window"),
        icon: Eye,
        onSelect: () => openPreviewWindow(href),
      });
    actions.push({
      id: "resumable",
      label: t("Resumable download"),
      icon: CloudDownload,
      onSelect: () => onDownload(file),
    });
    if (canDirectDownload(file))
      actions.push({
        id: "direct",
        label: t("Direct browser download"),
        icon: Download,
        href: `${basePath}/api/files/${file.id}/download`,
      });
    actions.push({
      id: "share",
      label: t("Share file"),
      icon: Share2,
      onSelect: () => onShare(file),
    });
    if (file.can_open_location)
      actions.push({
        id: "location",
        label: t("Open original location"),
        icon: CornerUpLeft,
        onSelect: () => onOpenFileLocation?.(file),
      });
  }
  actions.push({
    id: "manage",
    label: t("Rename or move shortcut"),
    icon: FolderPen,
    divider: true,
    onSelect: () => setEditing(true),
  });
  if (shortcut.can_delete)
    actions.push({
      id: "remove",
      label: t("Remove shortcut"),
      icon: Trash2,
      danger: true,
      disabled: busy,
      onSelect: remove,
    });
  return (
    <ItemMenu name={shortcut.name} items={actions}>
      {({ bind, trigger }) => (
        <tr
          {...bind}
          className={`shortcut-row${file ? "" : " is-unavailable"}`}
        >
          <td className="file-select-cell" />
          <td>
            <div className="file-name">
              <span className="shortcut-icon">
                <FileIcon name={file?.name || shortcut.name} />
                <Link2 size={14} aria-hidden="true" />
              </span>
              <div>
                <div className="file-title">
                  <strong title={shortcut.name}>{shortcut.name}</strong>
                  <span className="shortcut-badge">{t("Shortcut")}</span>
                </div>
                <small>
                  {file
                    ? t("Original: {0}", { 0: file.name })
                    : t(
                        "The original file was deleted, expired or is no longer accessible.",
                      )}
                </small>
              </div>
            </div>
          </td>
          <td>{file?.connector_name || "—"}</td>
          <td>{file ? formatBytes(file.size) : "—"}</td>
          <td>
            {showOwner ? shortcut.owner_email : formatDate(shortcut.created_at)}
          </td>
          <td>{file ? formatDate(file.expires_at) : "—"}</td>
          <td>
            <div className="row-actions">
              {file && (
                <>
                  <PreviewLink file={file} compact />
                  <button
                    className="icon-button download-action resumable"
                    title={t("Resumable download")}
                    aria-label={t("Resumable download {0}", {
                      0: shortcut.name,
                    })}
                    onClick={() => onDownload(file)}
                  >
                    <DownloadIcon resumable size={18} />
                    <span>{t("Resumable")}</span>
                  </button>
                  {canDirectDownload(file) && (
                    <a
                      className="icon-button download-action direct"
                      title={t("Direct browser download")}
                      aria-label={t("Direct browser download {0}", {
                        0: shortcut.name,
                      })}
                      href={`${basePath}/api/files/${file.id}/download`}
                    >
                      <DownloadIcon size={18} />
                      <span>{t("Direct")}</span>
                    </a>
                  )}
                  <button
                    className="icon-button"
                    title={t("Share file")}
                    aria-label={t("Share {0}", { 0: shortcut.name })}
                    onClick={() => onShare(file)}
                  >
                    <Share2 size={17} />
                  </button>
                </>
              )}
              <button
                className="icon-button"
                title={t("Manage shortcut")}
                aria-label={t("Manage shortcut {0}", { 0: shortcut.name })}
                onClick={() => setEditing(true)}
              >
                <FolderPen size={17} />
              </button>
              {shortcut.can_delete && (
                <button
                  className="icon-button danger"
                  disabled={busy}
                  title={t("Remove shortcut")}
                  aria-label={t("Remove shortcut {0}", { 0: shortcut.name })}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
              )}
              {trigger}
            </div>
            {editing && (
              <ShortcutDialog
                shortcut={shortcut}
                onClose={() => setEditing(false)}
                onSaved={onChanged}
              />
            )}
            {error && (
              <Modal title={t("Shortcut")} onClose={() => setError("")}>
                <ErrorMessage error={error} />
              </Modal>
            )}
          </td>
        </tr>
      )}
    </ItemMenu>
  );
}
