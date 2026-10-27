import React, { useEffect, useState } from "react";
import { Folder, RefreshCw, X } from "lucide-react";
import { api, basePath } from "./http";
import {
  ErrorMessage,
  FileIcon,
  formatBytes,
  formatDate,
  canDirectDownload,
} from "./App.jsx";
import FilePreview from "./FilePreview";
import { DownloadIcon } from "./TransferFeedback";
import { LanguageSelector, t, useLanguage } from "./i18n";
type Row = Record<string, any>;

export default function PreviewPage() {
  const { locale } = useLanguage();
  const [query] = useState(() => new URLSearchParams(location.search));
  const fileId = query.get("preview"),
    invitationId = query.get("previewInvitation");
  const [file, setFile] = useState<Row | null>(null),
    [error, setError] = useState("");
  const [authNeeded, setAuthNeeded] = useState(false),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setFile(null);
    setAuthNeeded(false);
    const id = invitationId || fileId;
    if (!id || id.length > 128 || !!fileId === !!invitationId) {
      setError("Choose a file to preview from File Station.");
      setLoading(false);
      return () => controller.abort();
    }
    api(
      invitationId
        ? `/invitations/${encodeURIComponent(id)}/view`
        : `/files/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    )
      .then((result: Row) => {
        if (controller.signal.aborted) return;
        if (invitationId && result.invitation?.kind !== "collaboration")
          throw Error(
            "Submission invitations do not allow browsing or downloading other submissions.",
          );
        const expirations = [
          result.invitation?.expires_at,
          result.file.expires_at,
        ].filter((value) => value > 0);
        setFile({
          ...result.file,
          expires_at: expirations.length ? Math.min(...expirations) : null,
        });
      })
      .catch((error: any) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          setAuthNeeded(error.status === 401 || error.status === 403);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fileId, invitationId, attempt]);
  useEffect(() => {
    document.title = file
      ? `${file.name} · ${t("File preview")} · File Station`
      : `${t("File preview")} · File Station`;
  }, [file?.name, locale]);
  const resource = invitationId
    ? `/invitations/${encodeURIComponent(invitationId)}`
    : `/files/${encodeURIComponent(fileId || "")}`;
  return (
    <div className="standalone-preview">
      <header className="standalone-preview-header">
        <a
          className="brand"
          href={`${basePath}/`}
          aria-label={t("Open File Station")}
        >
          <span className="brand-mark">
            <Folder size={23} aria-hidden="true" />
          </span>
          {t("File Station")}
          <span className="brand-dot">.</span>
        </a>
        <div className="standalone-preview-controls">
          <LanguageSelector />
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {t("Refresh preview")}
          </button>
          <button
            className="icon-button"
            title={t("Close preview")}
            aria-label={t("Close preview")}
            onClick={() => window.close()}
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main className="standalone-preview-main">
        {loading ? (
          <p className="preview-note" role="status">
            {t("Loading preview…")}
          </p>
        ) : error ? (
          <div className="standalone-preview-error">
            <h1>{t("File preview")}</h1>
            <ErrorMessage error={error} />
            {authNeeded && (
              <p>
                {t(
                  "Sign in or verify your invitation in File Station, then retry this preview.",
                )}
              </p>
            )}
            <a className="button primary" href={`${basePath}/`}>
              {t("Open File Station")}
            </a>
          </div>
        ) : (
          file && (
            <>
              <div className="standalone-preview-title">
                <FileIcon name={file.name} />
                <div>
                  <h1>{file.name}</h1>
                  <p>
                    {formatBytes(file.size)} · {t("KEEP UNTIL")}:{" "}
                    {formatDate(file.expires_at)}
                  </p>
                </div>
                {canDirectDownload(file) ? (
                  <a
                    className="button primary"
                    href={`${basePath}/api${resource}/download`}
                  >
                    <DownloadIcon />
                    {t("Direct download")}
                  </a>
                ) : (
                  <p className="fineprint">
                    {t(
                      "Use resumable download for files this size on this storage.",
                    )}
                  </p>
                )}
              </div>
              <FilePreview
                key={`${file.id}:${attempt}`}
                file={file as any}
                previewPath={`${resource}/preview`}
                standalone
              />
            </>
          )
        )}
      </main>
    </div>
  );
}
