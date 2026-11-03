import React, { useEffect, useState } from "react";
import { FolderDown } from "lucide-react";
import { Modal, ErrorMessage, formatBytes } from "./App.jsx";
import { api, basePath } from "./http";
import { t } from "./i18n";
type Row = Record<string, any>;

export default function FolderDownloadDialog({
  folder,
  onClose,
}: {
  folder: Row;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [started, setStarted] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api(`/folders/${folder.id}/archive`, { signal: controller.signal })
      .then(setManifest)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [folder.id]);
  return (
    <Modal title={t("Download folder")} onClose={onClose}>
      <div className="feature-form">
        <strong>{folder.name}</strong>
        <p>
          {t(
            "Download completed files and subfolders as a ZIP. Unfinished uploads are skipped. No copy is saved to storage.",
          )}
        </p>
        <ErrorMessage error={error} />
        {!manifest && !error && (
          <p role="status">{t("Preparing folder download…")}</p>
        )}
        {manifest && (
          <>
            <p>
              {t("{0} files · {1} of source files", {
                0: manifest.fileCount,
                1: formatBytes(manifest.totalSize),
              })}
            </p>
            <a
              className="button primary"
              href={`${basePath}/api/folders/${encodeURIComponent(folder.id)}/download`}
              onClick={() => setStarted(true)}
            >
              <FolderDown size={18} aria-hidden="true" />
              {t("Download ZIP")}
            </a>
          </>
        )}
        {started && (
          <p className="info" role="status">
            {t(
              "Check your browser’s downloads for progress. If the download is interrupted, start it again here.",
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}
