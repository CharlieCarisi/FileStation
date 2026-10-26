import { t } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { basePath } from "./App.jsx";
GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfPreview({ buffer }: { buffer: ArrayBuffer }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(600);
  const [error, setError] = useState(""),
    [text, setText] = useState(""),
    [loading, setLoading] = useState(true);
  const container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(100, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const task = getDocument({
      data: new Uint8Array(buffer.slice(0)),
      cMapUrl: `${basePath}/pdfjs/cmaps/`,
      cMapPacked: true,
      iccUrl: `${basePath}/pdfjs/iccs/`,
      standardFontDataUrl: `${basePath}/pdfjs/standard_fonts/`,
      wasmUrl: `${basePath}/pdfjs/wasm/`,
    });
    task.promise
      .then((value) => {
        if (!cancelled) setDocument(value);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "This PDF could not be previewed. It may be password-protected or damaged. Download it to open it.",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [buffer]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false,
      render: RenderTask | undefined;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled || !canvas.current) return;
        const original = pdfPage.getViewport({
          scale: 1,
        });
        const viewport = pdfPage.getViewport({
          scale: Math.min(2, (width - 24) / original.width) * zoom,
        });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const element = canvas.current;
        element.width = Math.ceil(viewport.width * ratio);
        element.height = Math.ceil(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        render = pdfPage.render({
          canvas: element,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        const content = await pdfPage.getTextContent();
        if (!cancelled)
          setText(
            content.items
              .map((item) =>
                "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
              )
              .join(""),
          );
      } catch (error) {
        if (
          !cancelled &&
          !(
            error instanceof Error &&
            error.name === "RenderingCancelledException"
          )
        )
          setError(
            "This PDF page could not be rendered. Download the document to open it.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, page, width, zoom]);
  return (
    <div className="pdf-preview" ref={container}>
      {document && (
        <div className="pdf-controls">
          <button
            className="text-button"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            {t("Previous page")}
          </button>
          <span aria-live="polite">
            {t("Page ")}
            {page}
            {t(" of ")}
            {document.numPages}
          </span>
          <button
            className="text-button"
            onClick={() => setPage(page + 1)}
            disabled={page >= document.numPages}
          >
            {t("Next page")}
          </button>
          <label>
            {t("Zoom")}{" "}
            <select
              aria-label={t("PDF zoom")}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            >
              <option value={0.75}>75%</option>
              <option value={1}>{t("Fit width")}</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
            </select>
          </label>
        </div>
      )}
      {loading && (
        <p className="preview-note" role="status">
          {t("Rendering PDF\u2026")}
        </p>
      )}
      {error && (
        <p className="preview-note" role="alert">
          {t(error)}
        </p>
      )}
      <div className="pdf-page">
        <canvas
          ref={canvas}
          aria-label={t("PDF page {0}", {
            "0": page,
          })}
          hidden={Boolean(error)}
        />
      </div>
      {text && (
        <details className="pdf-text">
          <summary>{t("Read page text")}</summary>
          <pre>{text}</pre>
        </details>
      )}
    </div>
  );
}
