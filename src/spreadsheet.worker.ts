import * as XLSX from "xlsx";
import { checkOfficeArchive, OFFICE_COMPLEXITY_ERROR } from "./office-archive";
import {
  ROWS_PER_PAGE,
  COLUMNS_PER_PAGE,
  MAX_PREVIEW_ROWS,
  MAX_PREVIEW_COLUMNS,
  type SheetCell,
  type SheetPage,
} from "./spreadsheet-model";
let source: ArrayBuffer,
  names: string[] = [],
  sheets: SheetPage["sheets"] = [];
let active = -1,
  worksheet: XLSX.WorkSheet,
  hasValues = false;
const options: XLSX.ParsingOptions = {
  type: "array",
  cellHTML: false,
  bookVBA: false,
  cellStyles: false,
  cellFormula: true,
  cellNF: true,
  sheetRows: MAX_PREVIEW_ROWS,
};
function read(index: number) {
  if (active !== index) {
    const workbook = XLSX.read(source, { ...options, sheets: [names[index]] });
    worksheet = workbook.Sheets[names[index]];
    // BIFF/XLS may report A1 as the used range of a genuinely empty sheet.
    hasValues = Object.keys(worksheet).some((key) => {
      if (key.startsWith("!")) return false;
      const cell = worksheet[key] as XLSX.CellObject;
      return (
        !!cell.f || (cell.v !== undefined && cell.v !== null && cell.v !== "")
      );
    });
    active = index;
    if (!sheets.length)
      sheets = names
        .map((name, index) => ({ name, index }))
        .filter((sheet) => !workbook.Workbook?.Sheets?.[sheet.index]?.Hidden);
  }
}
function value(row: number, column: number) {
  const cell = worksheet?.[XLSX.utils.encode_cell({ r: row, c: column })] as
    XLSX.CellObject | undefined;
  if (!cell) return "";
  const text =
    cell.v === undefined && cell.f
      ? `=${cell.f}`
      : (cell.w ?? XLSX.utils.format_cell(cell));
  return String(text).slice(0, 4000);
}
function page(
  sheet: number,
  requestedRow: number,
  requestedColumn: number,
): SheetPage {
  if (!sheets.some((item) => item.index === sheet))
    throw Error("Invalid worksheet.");
  read(sheet);
  const reference = worksheet["!fullref"] || worksheet["!ref"];
  const range =
    reference && (hasValues || worksheet["!fullref"])
      ? XLSX.utils.decode_range(reference)
      : null;
  if (
    range &&
    (!Number.isSafeInteger(range.e.r) ||
      !Number.isSafeInteger(range.e.c) ||
      range.e.r > 1048575 ||
      range.e.c > 16383)
  )
    throw Error(OFFICE_COMPLEXITY_ERROR);
  const totalRows = range ? Math.min(range.e.r + 1, MAX_PREVIEW_ROWS) : 0;
  const totalColumns = range ? Math.min(range.e.c + 1, MAX_PREVIEW_COLUMNS) : 0;
  const row = Math.min(
    Math.max(0, Math.floor(requestedRow / ROWS_PER_PAGE) * ROWS_PER_PAGE),
    Math.max(0, Math.floor((totalRows - 1) / ROWS_PER_PAGE) * ROWS_PER_PAGE),
  );
  const column = Math.min(
    Math.max(
      0,
      Math.floor(requestedColumn / COLUMNS_PER_PAGE) * COLUMNS_PER_PAGE,
    ),
    Math.max(
      0,
      Math.floor((totalColumns - 1) / COLUMNS_PER_PAGE) * COLUMNS_PER_PAGE,
    ),
  );
  const endRow = Math.min(totalRows, row + ROWS_PER_PAGE),
    endColumn = Math.min(totalColumns, column + COLUMNS_PER_PAGE);
  const merged = new Map<string, SheetCell>();
  const merges = worksheet["!merges"] || [];
  if (merges.length > 5000) throw Error(OFFICE_COMPLEXITY_ERROR);
  for (const merge of merges) {
    const top = Math.max(row, merge.s.r),
      left = Math.max(column, merge.s.c),
      bottom = Math.min(endRow - 1, merge.e.r),
      right = Math.min(endColumn - 1, merge.e.c);
    if (top > bottom || left > right) continue;
    for (let r = top; r <= bottom; r++)
      for (let c = left; c <= right; c++)
        merged.set(
          `${r}:${c}`,
          r === top && c === left
            ? {
                value: value(merge.s.r, merge.s.c),
                rowSpan: bottom - top + 1,
                colSpan: right - left + 1,
              }
            : { value: "", hidden: true },
        );
  }
  return {
    sheets,
    sheet,
    row,
    column,
    totalRows,
    totalColumns,
    truncated:
      !!range &&
      (range.e.r >= MAX_PREVIEW_ROWS || range.e.c >= MAX_PREVIEW_COLUMNS),
    columns: Array.from({ length: endColumn - column }, (_, index) =>
      XLSX.utils.encode_col(column + index),
    ),
    rows: Array.from({ length: endRow - row }, (_, index) => ({
      number: row + index + 1,
      cells: Array.from(
        { length: endColumn - column },
        (_, col) =>
          merged.get(`${row + index}:${column + col}`) || {
            value: value(row + index, column + col),
          },
      ),
    })),
  };
}
self.onmessage = async (event: MessageEvent) => {
  const input = event.data;
  try {
    if (input.type === "load") {
      source = input.buffer;
      const magic = new Uint8Array(source, 0, Math.min(source.byteLength, 8));
      if (/\.xlsx$/i.test(input.name))
        await checkOfficeArchive(source, "xl/workbook.xml");
      else if (
        ![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
          (byte, index) => magic[index] === byte,
        )
      )
        throw Error("Invalid Excel file.");
      const book = XLSX.read(source, {
        type: "array",
        bookSheets: true,
        cellHTML: false,
        bookVBA: false,
      });
      names = book.SheetNames;
      if (!names.length || names.length > 100)
        throw Error(OFFICE_COMPLEXITY_ERROR);
      read(0);
      if (!sheets.length) throw Error("No visible worksheets.");
      self.postMessage({ id: input.id, page: page(sheets[0].index, 0, 0) });
    } else if (
      input.type === "page" &&
      source &&
      Number.isInteger(input.sheet) &&
      Number.isInteger(input.row) &&
      Number.isInteger(input.column)
    )
      self.postMessage({
        id: input.id,
        page: page(input.sheet, input.row, input.column),
      });
  } catch (error) {
    self.postMessage({
      id: input.id,
      error:
        error instanceof Error && error.message === OFFICE_COMPLEXITY_ERROR
          ? error.message
          : "This workbook could not be previewed. It may be password-protected or damaged. Download it to open it.",
    });
  }
};
