import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  Share2,
  FolderInput,
  Trash2,
  ArrowLeftRight,
  TextCursorInput,
  Folder,
  Eye,
  Link2,
  CornerUpLeft,
  CloudDownload,
  Download,
} from "lucide-react";
import {
  FileIcon,
  formatBytes,
  formatDate,
  canDirectDownload,
} from "./App.jsx";
import { basePath } from "./http";
import { MoveFilesDialog, FolderItem } from "./Folders";
import { t } from "./i18n";
import RenameFileDialog from "./RenameFileDialog";
import { transfers } from "./transfers";
import { DownloadIcon, CompletionBadge } from "./TransferFeedback";
import PreviewLink, { previewHref, openPreviewWindow } from "./PreviewLink";
import { ItemMenu, type MenuAction } from "./ItemMenu";
import ShortcutDialog from "./ShortcutDialog";
import ShortcutRow from "./ShortcutRow";
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
  folders = [],
  onOpenFolder,
  onOpenFileLocation,
  shortcuts = [],
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
  folders?: Row[];
  onOpenFolder?: (id: string) => void;
  onOpenFileLocation?: (file: Row) => void;
  shortcuts?: Row[];
}) {
  useSyncExternalStore(transfers.subscribe, transfers.getSnapshot);
  const completedUploads = new Set(
    transfers.items
      .filter(
        (item: Row) => item.direction === "upload" && item.state === "complete",
      )
      .map((item: Row) => item.fileId),
  );
  const [renaming, setRenaming] = useState<Row | null>(null);
  const [creatingShortcut, setCreatingShortcut] = useState<Row | null>(null);
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
  function fileMenu(file: Row): MenuAction[] {
    const items: MenuAction[] = [];
    if (file.state === "ready") {
      const href = previewHref(file as any);
      if (href)
        items.push({
          id: "preview",
          label: t("Open preview in a new window"),
          icon: Eye,
          onSelect: () => openPreviewWindow(href),
        });
      items.push({
        id: "resumable",
        label: t("Resumable download"),
        icon: CloudDownload,
        onSelect: () => onDownload(file),
      });
      if (canDirectDownload(file))
        items.push({
          id: "direct",
          label: t("Direct browser download"),
          icon: Download,
          href: `${basePath}/api/files/${file.id}/download`,
        });
      items.push({
        id: "share",
        label: t("Share file"),
        icon: Share2,
        onSelect: () => onShare(file),
      });
      if (file.can_create_shortcut)
        items.push({
          id: "shortcut",
          label: t("Create shortcut"),
          icon: Link2,
          onSelect: () => setCreatingShortcut(file),
        });
    } else if (file.can_resume !== false)
      items.push({
        id: "transfers",
        label: t("Go to transfers"),
        icon: ArrowLeftRight,
        onSelect: onTransfers,
      });
    if (file.can_rename)
      items.push({
        id: "rename",
        label: t("Rename file"),
        icon: TextCursorInput,
        divider: true,
        onSelect: () => setRenaming(file),
      });
    items.push({
      id: "move",
      label:
        chosen.length > 1 && selected.has(file.id)
          ? t("Move selected files")
          : t("Move files"),
      icon: FolderInput,
      onSelect: () =>
        setMoving(chosen.length > 1 && selected.has(file.id) ? chosen : [file]),
    });
    if (file.can_open_location && onOpenFileLocation)
      items.push({
        id: "location",
        label: t("Open file location"),
        icon: CornerUpLeft,
        onSelect: () => onOpenFileLocation(file),
      });
    if (file.can_delete !== false)
      items.push({
        id: "delete",
        label: t("Delete file"),
        icon: Trash2,
        danger: true,
        divider: true,
        onSelect: () => onDelete(file),
      });
    return items;
  }
  return (
    <>
      {!!chosen.length && (
        <div className="file-selection">
          <span>{t("{0} selected", { 0: chosen.length })}</span>
          <button
            className="button secondary"
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
              {t(
                "Files from different uploaders can be moved together within Public.",
              )}
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
            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                connectors={connectors}
                onChanged={onChanged}
                onOpen={onOpenFolder}
                layout="row"
                showOwner={showOwner}
              />
            ))}
            {files.map((file) => (
              <ItemMenu
                key={file.id}
                name={file.name}
                items={fileMenu(file)}
                onOpen={() => {
                  if (!selected.has(file.id)) setSelected(new Set([file.id]));
                }}
              >
                {({ bind, trigger }) => (
                  <tr {...bind}>
                    <td className="file-select-cell">
                      <input
                        type="checkbox"
                        aria-label={t("Select {0}", { 0: file.name })}
                        checked={selected.has(file.id)}
                        onChange={(event) =>
                          choose(file.id, event.target.checked)
                        }
                      />
                    </td>
                    <td>
                      <div className="file-name">
                        <FileIcon name={file.name} />
                        <div>
                          <div className="file-title">
                            <strong title={file.name}>{file.name}</strong>
                            {completedUploads.has(file.id) &&
                              file.state === "ready" && (
                                <CompletionBadge compact name={file.name} />
                              )}
                          </div>
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
                              {t("Folder")}:{" "}
                              {file.space === "public"
                                ? t("Public")
                                : t("Private")}{" "}
                              / {file.folder_name || t("Root")}
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
                      {showOwner
                        ? file.owner_email
                        : formatDate(file.created_at)}
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
                            <PreviewLink file={file as any} compact />
                            <button
                              className="icon-button download-action resumable"
                              aria-label={t("Resumable download {0}", {
                                0: file.name,
                              })}
                              title={t("Resumable download")}
                              onClick={() => onDownload(file)}
                            >
                              <DownloadIcon resumable size={18} />
                              <span>{t("Resumable")}</span>
                            </button>
                            {canDirectDownload(file) && (
                              <a
                                className="icon-button download-action direct"
                                aria-label={t("Direct browser download {0}", {
                                  0: file.name,
                                })}
                                title={t("Direct browser download")}
                                href={`${basePath}/api/files/${file.id}/download`}
                              >
                                <DownloadIcon size={18} />
                                <span>{t("Direct")}</span>
                              </a>
                            )}
                            <button
                              className="icon-button"
                              aria-label={t("Share {0}", { 0: file.name })}
                              title={t("Share file")}
                              onClick={() => onShare(file)}
                            >
                              <Share2 size={17} aria-hidden="true" />
                            </button>
                          </>
                        ) : file.can_resume !== false ? (
                          <button
                            className="icon-button"
                            aria-label={t("Go to transfers")}
                            title={t("Go to transfers")}
                            onClick={onTransfers}
                          >
                            <ArrowLeftRight size={17} aria-hidden="true" />
                          </button>
                        ) : null}
                        {file.can_rename && (
                          <button
                            className="icon-button"
                            title={t("Rename file")}
                            aria-label={t("Rename {0}", { 0: file.name })}
                            onClick={() => setRenaming(file)}
                          >
                            <TextCursorInput size={17} aria-hidden="true" />
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
                        {file.can_delete !== false && (
                          <button
                            className="icon-button danger"
                            aria-label={t("Delete {0}", { 0: file.name })}
                            title={t("Delete file")}
                            onClick={() => onDelete(file)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        {trigger}
                      </div>
                    </td>
                  </tr>
                )}
              </ItemMenu>
            ))}
            {shortcuts.map((shortcut) => (
              <ShortcutRow
                key={shortcut.id}
                shortcut={shortcut}
                showOwner={showOwner}
                onDownload={onDownload}
                onShare={onShare}
                onOpenFileLocation={onOpenFileLocation}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>
      {renaming && (
        <RenameFileDialog
          file={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={onChanged}
        />
      )}
      {creatingShortcut && (
        <ShortcutDialog
          file={creatingShortcut}
          onClose={() => setCreatingShortcut(null)}
          onSaved={onChanged}
        />
      )}
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
