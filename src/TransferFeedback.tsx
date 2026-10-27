import React from "react";
import { CircleCheck, CloudDownload, Download } from "lucide-react";
import { t } from "./i18n";

// Keep the two download modes consistent in tables, previews and collaboration.
export function DownloadIcon({
  resumable = false,
  size = 18,
}: {
  resumable?: boolean;
  size?: number;
}) {
  const Icon = resumable ? CloudDownload : Download;
  return <Icon size={size} aria-hidden="true" />;
}
export function CompletionBadge({
  name,
  direction = "upload",
  compact = false,
}: {
  name: string;
  direction?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={`completion-badge${compact ? " compact" : ""}`}
      role={compact ? undefined : "status"}
      aria-label={t(
        direction === "upload"
          ? "Upload complete for {0}"
          : "Download complete for {0}",
        { 0: name },
      )}
    >
      <CircleCheck size={compact ? 12 : 16} aria-hidden="true" />
      {t("Done")}
    </span>
  );
}
