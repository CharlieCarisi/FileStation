import React from "react";
import { Eye, ExternalLink } from "lucide-react";
import { previewInfo } from "../shared/preview";
import { basePath } from "./http";
import { getLocale, t } from "./i18n";
export function previewHref(
  file: { id: string; name: string; size: number },
  invitationId?: string,
) {
  const info = previewInfo(file.name);
  if (!info || file.size > info.limit) return null;
  return `${basePath}/?${new URLSearchParams({ ...(invitationId ? { previewInvitation: invitationId } : { preview: file.id }), lang: getLocale() })}`;
}
export function openPreviewWindow(href: string) {
  window.open(
    href,
    "_blank",
    "popup=yes,width=1280,height=900,noopener,noreferrer",
  );
}

export default function PreviewLink({
  file,
  invitationId,
  compact = false,
}: {
  file: { id: string; name: string; size: number };
  invitationId?: string;
  compact?: boolean;
}) {
  const href = previewHref(file, invitationId);
  if (!href) return null;
  return (
    <a
      className={
        compact
          ? "icon-button preview-action"
          : "text-button preview-window-link"
      }
      href={href}
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
        openPreviewWindow(event.currentTarget.href);
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
