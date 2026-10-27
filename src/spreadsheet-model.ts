export const ROWS_PER_PAGE = 100,
  COLUMNS_PER_PAGE = 25,
  MAX_PREVIEW_ROWS = 20000,
  MAX_PREVIEW_COLUMNS = 200;
export type SheetCell = {
  value: string;
  rowSpan?: number;
  colSpan?: number;
  hidden?: boolean;
};
export type SheetPage = {
  sheets: { index: number; name: string }[];
  sheet: number;
  row: number;
  column: number;
  totalRows: number;
  totalColumns: number;
  truncated: boolean;
  columns: string[];
  rows: { number: number; cells: SheetCell[] }[];
};
