import { t } from "./i18n";
import React, { Component, lazy, Suspense, useEffect, useState } from "react";
import { Eye, EyeOff, FileSearch } from "lucide-react";
import { previewInfo, type PreviewInfo } from "../shared/preview";
import { basePath, formatBytes } from "./App.jsx";
const PdfPreview = lazy(() => import("./PdfPreview"));
const DocxPreview = lazy(() => import("./DocxPreview"));
type FileInfo = {
  id: string;
  name: string;
  size: number;
};
export default function FilePreview({
  file,
  previewPath = `/files/${file.id}/preview`,
}: {
  file: FileInfo;
  previewPath?: string;
}) {
  const info = previewInfo(file.name);
  const available = info && file.size <= info.limit;
  const [open, setOpen] = useState(
    Boolean(available && file.size <= 10 * 1024 * 1024),
  );
  const [attempt, setAttempt] = useState(0);
  const url = `${basePath}/api${previewPath}?version=${encodeURIComponent(file.id)}`;
  return (
    <section
      className="file-preview"
      aria-label={t("Preview of {0}", {
        "0": file.name,
      })}
    >
      <header className="preview-header">
        <span>
          <FileSearch size={18} aria-hidden="true" />
          {t(" File preview")}
        </span>
        {available && (
          <button
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? (
              <EyeOff size={15} aria-hidden="true" />
            ) : (
              <Eye size={15} aria-hidden="true" />
            )}
            {open ? t("Hide preview") : t("Show preview")}
          </button>
        )}
      </header>
      {!info ? (
        <p className="preview-note">
          {t(
            "Preview isn\u2019t available for this format. Download the file to open it.",
          )}
        </p>
      ) : !available ? (
        <p className="preview-note">
          {t("Browser previews for this format support files up to")}{" "}
          {formatBytes(info.limit)}
          {t(". Download this file to open it.")}
        </p>
      ) : open ? (
        <PreviewBoundary
          key={`${file.id}-${attempt}`}
          onRetry={() => setAttempt(attempt + 1)}
        >
          <PreviewContent
            file={file}
            info={info}
            url={url}
            onRetry={() => setAttempt(attempt + 1)}
          />
        </PreviewBoundary>
      ) : (
        <p className="preview-note">
          {t("Open a preview without downloading a local copy.")}
        </p>
      )}
    </section>
  );
}
function PreviewContent({
  file,
  info,
  url,
  onRetry,
}: {
  file: FileInfo;
  info: PreviewInfo;
  url: string;
  onRetry: () => void;
}) {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const native = ["image", "audio", "video"].includes(info.kind);
  useEffect(() => {
    if (native) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!response.ok) {
          const result = (await response.json()) as {
            error?: string;
          };
          throw Error(result.error || "The preview could not be opened.");
        }
        if (response.headers.get("etag") !== `"${file.id}"`)
          throw Error(
            "The document changed. Close and reopen it to see the latest copy.",
          );
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== file.size || bytes.byteLength > info.limit)
          throw Error("The preview download was incomplete. Please retry.");
        if (!controller.signal.aborted) {
          if (info.kind === "text")
            setText(
              new TextDecoder("utf-8", {
                fatal: true,
              }).decode(bytes),
            );
          else setBuffer(bytes);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "The preview could not be opened.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url, file.id]);
  if (error) return <PreviewError message={error} onRetry={onRetry} />;
  const mediaError = () =>
    setError(
      "This preview is unavailable or the browser does not support its format or codec. You can still use the download option. If access expired, verify your email again.",
    );
  const ready = () => setLoading(false);
  return (
    <div className={`preview-content preview-${info.kind}`}>
      {loading && (
        <p className="preview-note" role="status">
          {t("Loading preview\u2026")}
        </p>
      )}
      {info.kind === "image" ? (
        <img
          src={url}
          alt={file.name}
          decoding="async"
          onLoad={ready}
          onError={mediaError}
        />
      ) : info.kind === "video" ? (
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label={t("Video preview: {0}", {
            "0": file.name,
          })}
          onLoadedMetadata={ready}
          onError={mediaError}
        />
      ) : info.kind === "audio" ? (
        <audio
          src={url}
          controls
          preload="metadata"
          aria-label={t("Audio preview: {0}", {
            "0": file.name,
          })}
          onLoadedMetadata={ready}
          onError={mediaError}
        />
      ) : info.kind === "text" && !loading ? (
        <pre className="preview-text" tabIndex={0}>
          {text}
        </pre>
      ) : (
        buffer && (
          <Suspense
            fallback={
              <p className="preview-note" role="status">
                {t("Preparing document preview\u2026")}
              </p>
            }
          >
            {info.kind === "pdf" ? (
              <PdfPreview buffer={buffer} />
            ) : (
              <DocxPreview buffer={buffer} name={file.name} />
            )}
          </Suspense>
        )
      )}
      {info.kind === "video" && (
        <p className="preview-note">
          {t(
            "Playback depends on browser codec support. Use the controls to pause or seek.",
          )}
        </p>
      )}
    </div>
  );
}
function PreviewError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="preview-note" role="alert">
      <p>{t(message)}</p>
      <button className="text-button" onClick={onRetry}>
        {t("Retry preview")}
      </button>
    </div>
  );
}
class PreviewBoundary extends Component<
  {
    children: React.ReactNode;
    onRetry: () => void;
  },
  {
    failed: boolean;
  }
> {
  state = {
    failed: false,
  };
  static getDerivedStateFromError() {
    return {
      failed: true,
    };
  }
  render() {
    return this.state.failed ? (
      <PreviewError
        message={t(
          "This document could not be previewed. Download it to open it in your usual app.",
        )}
        onRetry={this.props.onRetry}
      />
    ) : (
      this.props.children
    );
  }
}
