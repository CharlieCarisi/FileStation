import React from "react";
import { Eye, ExternalLink } from "lucide-react";
import { previewInfo } from "../shared/preview";
import { basePath } from "./http";
import { getLocale, t } from "./i18n";

export default function PreviewLink({
  file,
  invitationId,
  compact = false,
}: {
  file: { id: string; name: string; size: number };
  invitationId?: string;
  compact?: boolean;
}) {
  const info = previewInfo(file.name);
  if (!info || file.size > info.limit) return null;
  const query = new URLSearchParams({
    ...(invitationId
      ? { previewInvitation: invitationId }
      : { preview: file.id }),
    lang: getLocale(),
  });
  return (
    <a
      className={
        compact
          ? "icon-button preview-action"
          : "text-button preview-window-link"
      }
      href={`${basePath}/?${query}`}
      target="_blank"
      rel="noopener noreferrer"
      title={t("Open preview in a new window")}
      aria-label={t("Preview {0} in a new window", { 0: file.name })}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        window.open(
          event.currentTarget.href,
          "_blank",
          "popup=yes,width=1280,height=900,noopener,noreferrer",
        );
      }}
    >
      {compact ? (
        <Eye size={18} aria-hidden="true" />
      ) : (
        <>
          <ExternalLink size={15} aria-hidden="true" />
          {t("Open in new window")}
        </>
      )}
    </a>
  );
}
