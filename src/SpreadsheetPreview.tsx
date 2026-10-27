import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "./i18n";
import {
  ROWS_PER_PAGE,
  COLUMNS_PER_PAGE,
  type SheetPage,
} from "./spreadsheet-model";
export default function SpreadsheetPreview({
  buffer,
  name,
  onRetry,
}: {
  buffer: ArrayBuffer;
  name: string;
  onRetry: () => void;
}) {
  const worker = useRef<Worker | null>(null),
    serial = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [data, setData] = useState<SheetPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  function send(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ) {
    clearTimeout(timer.current);
    setLoading(true);
    worker.current?.postMessage({ ...message, id: ++serial.current }, transfer);
    timer.current = setTimeout(() => {
      worker.current?.terminate();
      setLoading(false);
      setError("Workbook preview took too long. Download the file to open it.");
    }, 20000);
  }
  useEffect(() => {
    const current = new Worker(
      new URL("./spreadsheet.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = current;
    current.onmessage = (event) => {
      if (event.data.id !== serial.current) return;
      clearTimeout(timer.current);
      setLoading(false);
      if (event.data.error) setError(event.data.error);
      else setData(event.data.page);
    };
    current.onerror = (event) => {
      event.preventDefault();
      clearTimeout(timer.current);
      current.terminate();
      setLoading(false);
      setError(
        "This workbook could not be previewed. It may be password-protected or damaged. Download it to open it.",
      );
    };
    const copy = buffer.slice(0);
    send({ type: "load", buffer: copy, name }, [copy]);
    return () => {
      clearTimeout(timer.current);
      current.terminate();
      worker.current = null;
    };
  }, [buffer]);
  function navigate(sheet: number, row: number, column: number) {
    send({ type: "page", sheet, row, column });
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
    <div className="spreadsheet-preview" aria-busy={loading}>
      {loading && (
        <p className="preview-note" role="status">
          {t("Loading workbook…")}
        </p>
      )}
      {data && (
        <>
          <div className="office-preview-toolbar">
            <label>
              {t("Worksheet")}
              <select
                aria-label={t("Worksheet")}
                value={data.sheet}
                disabled={loading}
                onChange={(event) => navigate(Number(event.target.value), 0, 0)}
              >
                {data.sheets.map((sheet) => (
                  <option key={sheet.index} value={sheet.index}>
                    {sheet.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="office-page-controls">
              <button
                className="icon-button"
                aria-label={t("Previous rows")}
                disabled={loading || !data.row}
                onClick={() =>
                  navigate(data.sheet, data.row - ROWS_PER_PAGE, data.column)
                }
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {t("Rows {0}–{1} of {2}", {
                  0: data.totalRows ? data.row + 1 : 0,
                  1: data.row + data.rows.length,
                  2: data.totalRows,
                })}
              </span>
              <button
                className="icon-button"
                aria-label={t("Next rows")}
                disabled={loading || data.row + ROWS_PER_PAGE >= data.totalRows}
                onClick={() =>
                  navigate(data.sheet, data.row + ROWS_PER_PAGE, data.column)
                }
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="office-page-controls">
              <button
                className="icon-button"
                aria-label={t("Previous columns")}
                disabled={loading || !data.column}
                onClick={() =>
                  navigate(data.sheet, data.row, data.column - COLUMNS_PER_PAGE)
                }
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {data.columns.length
                  ? `${data.columns[0]}–${data.columns.at(-1)}`
                  : "—"}
              </span>
              <button
                className="icon-button"
                aria-label={t("Next columns")}
                disabled={
                  loading || data.column + COLUMNS_PER_PAGE >= data.totalColumns
                }
                onClick={() =>
                  navigate(data.sheet, data.row, data.column + COLUMNS_PER_PAGE)
                }
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          {data.rows.length ? (
            <div
              className="spreadsheet-scroll"
              tabIndex={0}
              role="region"
              aria-label={t("Read-only worksheet")}
            >
              <table
                className="spreadsheet-grid"
                aria-label={
                  data.sheets.find((sheet) => sheet.index === data.sheet)?.name
                }
              >
                <thead>
                  <tr>
                    <th aria-label={t("Row number")} />
                    {data.columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.number}>
                      <th scope="row">{row.number}</th>
                      {row.cells.map(
                        (cell, index) =>
                          !cell.hidden && (
                            <td
                              key={index}
                              colSpan={cell.colSpan}
                              rowSpan={cell.rowSpan}
                              title={cell.value}
                            >
                              {cell.value}
                            </td>
                          ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="preview-note">{t("This worksheet is empty.")}</p>
          )}
          {data.truncated && (
            <p className="preview-note">
              {t(
                "Preview shows the first 20,000 rows and 200 columns per sheet. Download the workbook to see everything.",
              )}
            </p>
          )}
          <p className="preview-note">
            {t(
              "Read-only data preview. Formulas show saved results, or formula text when no result was saved. Charts, images and advanced formatting are not shown.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
