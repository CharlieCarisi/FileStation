import { expect, it } from "vitest";
import {
  ZipWriter,
  Uint8ArrayWriter,
  Uint8ArrayReader,
  TextReader,
} from "@zip.js/zip.js/index-native.js";
import {
  checkOfficeArchive,
  OFFICE_COMPLEXITY_ERROR,
} from "../src/office-archive";
import { previewInfo } from "../shared/preview";

it("checks Office archive contents and rejects declared expansion beyond the preview budget before parsing", async () => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    level: 0,
  });
  await writer.add("xl/workbook.xml", new TextReader("<workbook/>"));
  const bytes = await writer.close();
  await expect(
    checkOfficeArchive(bytes.slice().buffer as ArrayBuffer, "xl/workbook.xml"),
  ).resolves.toBeUndefined();
  await expect(
    checkOfficeArchive(
      bytes.slice().buffer as ArrayBuffer,
      "ppt/presentation.xml",
    ),
  ).rejects.toThrow("Invalid Office document");
  const oversized = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  await oversized.add(
    "xl/workbook.xml",
    new Uint8ArrayReader(new Uint8Array([0])),
    {
      passThrough: true,
      compressionMethod: 8,
      crc32: 0,
      uncompressedSize: 51 * 1024 * 1024,
    },
  );
  const packed = await oversized.close();
  await expect(
    checkOfficeArchive(packed.slice().buffer as ArrayBuffer, "xl/workbook.xml"),
  ).rejects.toThrow(OFFICE_COMPLEXITY_ERROR);
  expect(previewInfo("Budget.XLSX")?.kind).toBe("spreadsheet");
  expect(previewInfo("Budget.xls")?.kind).toBe("spreadsheet");
  expect(previewInfo("Briefing.pptx")?.kind).toBe("presentation");
  expect(previewInfo("Legacy.ppt")).toBeNull();
});
