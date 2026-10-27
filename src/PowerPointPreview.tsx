import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { basePath } from "./http";
import { t } from "./i18n";
const FAILURE =
  "This presentation could not be previewed. It may be password-protected or damaged. Download it to open it.";
export default function PowerPointPreview({
  buffer,
  onRetry,
}: {
  buffer: ArrayBuffer;
  onRetry: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null),
    channel = useRef(crypto.randomUUID());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [page, setPage] = useState({
      slide: 0,
      slides: 0,
      width: 16,
      height: 9,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  function startTimer() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setError(
        "PowerPoint preview took too long. Download the file to open it.",
      );
      setLoading(false);
    }, 30000);
  }
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel.current
      )
        return;
      const data = event.data;
      if (
        data.type === "rendered" &&
        Number.isInteger(data.slides) &&
        data.slides > 0 &&
        data.slides <= 300 &&
        Number.isInteger(data.slide) &&
        data.slide >= 0 &&
        data.slide < data.slides &&
        data.width > 0 &&
        data.height > 0
      ) {
        setPage({
          slide: data.slide,
          slides: data.slides,
          width: data.width,
          height: data.height,
        });
        setLoading(false);
        clearTimeout(timer.current);
      } else if (data.type === "error") {
        setError(
          data.error ===
            "This document is too complex for a browser preview. Download it to open it in Office."
            ? data.error
            : FAILURE,
        );
        setLoading(false);
        clearTimeout(timer.current);
      }
    };
    window.addEventListener("message", listener);
    startTimer();
    return () => {
      window.removeEventListener("message", listener);
      clearTimeout(timer.current);
    };
  }, [buffer]);
  function show(slide: number) {
    setLoading(true);
    startTimer();
    frame.current?.contentWindow?.postMessage(
      { type: "show-slide", channel: channel.current, slide },
      "*",
    );
  }
  if (error)
    return (
      <div className="preview-note" role="alert">
        <p>{t(error)}</p>
        <button className="text-button" onClick={onRetry}>
          {t("Retry preview")}
        </button>
      </div>
    );
  return (
    <div className="powerpoint-preview" aria-busy={loading}>
      {!!page.slides && (
        <div className="office-preview-toolbar">
          <div className="office-page-controls">
            <button
              className="icon-button"
              aria-label={t("Previous slide")}
              disabled={loading || page.slide === 0}
              onClick={() => show(page.slide - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {t("Slide {0} of {1}", { 0: page.slide + 1, 1: page.slides })}
            </span>
            <button
              className="icon-button"
              aria-label={t("Next slide")}
              disabled={loading || page.slide + 1 === page.slides}
              onClick={() => show(page.slide + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <label>
            {t("Go to slide")}
            <select
              aria-label={t("Go to slide")}
              value={page.slide}
              disabled={loading}
              onChange={(event) => show(Number(event.target.value))}
            >
              {Array.from({ length: page.slides }, (_, index) => (
                <option key={index} value={index}>
                  {index + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {loading && (
        <p className="preview-note" role="status">
          {t("Loading presentation…")}
        </p>
      )}
      <iframe
        ref={frame}
        className="powerpoint-frame"
        title={t("PowerPoint slide preview")}
        src={`${basePath}/presentation-preview`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onLoad={() => {
          const copy = buffer.slice(0);
          frame.current?.contentWindow?.postMessage(
            {
              type: "load-presentation",
              channel: channel.current,
              buffer: copy,
            },
            "*",
            [copy],
          );
        }}
      />
      <p className="preview-note">
        {t(
          "Read-only PowerPoint preview. Animations, transitions and linked media are not played. Complex layouts may differ.",
        )}
      </p>
    </div>
  );
}
