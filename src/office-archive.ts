import { ZipReader, Uint8ArrayReader } from "@zip.js/zip.js/index-native.js";
export const OFFICE_COMPLEXITY_ERROR =
  "This document is too complex for a browser preview. Download it to open it in Office.";

// Check the directory before an Office parser starts inflating an upload. The
// spreadsheet parser also runs in a disposable worker with a time limit.
export async function checkOfficeArchive(
  buffer: ArrayBuffer,
  required: string,
) {
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(buffer)), {
    useWebWorkers: false,
  });
  let count = 0,
    total = 0,
    slides = 0,
    found = false;
  const names = new Set<string>();
  try {
    for await (const entry of zip.getEntriesGenerator()) {
      if (
        ++count > 4000 ||
        entry.encrypted ||
        entry.uncompressedSize > 50 * 1024 * 1024 ||
        (total += entry.uncompressedSize) > 200 * 1024 * 1024 ||
        names.has(entry.filename) ||
        entry.filename.split(/[\\/]/).includes("..") ||
        (/^ppt\/slides\/slide\d+\.xml$/.test(entry.filename) && ++slides > 300)
      )
        throw Error(OFFICE_COMPLEXITY_ERROR);
      names.add(entry.filename);
      if (entry.filename === required) found = true;
    }
    if (!found) throw Error("Invalid Office document.");
  } finally {
    await zip.close();
  }
}
