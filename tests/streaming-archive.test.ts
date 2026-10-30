import { describe, expect, it } from "vitest";
import {
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js/index-native.js";
import {
  createStreamingArchive,
  StreamingZip,
  streamingArchiveFingerprint,
  type StreamingArchive,
} from "../src/streaming-archive";

describe("streaming ZIP64 archives", () => {
  it("produces byte-exact archives across arbitrary part boundaries, serializes checkpoints and resumes without rereading previous data", async () => {
    const payloads = [
      new TextEncoder().encode("Résumé 合同\n".repeat(30)),
      Uint8Array.from({ length: 513 }, (_, index) => index % 256),
    ];
    for (const partSize of [1, 37, 257, 1024]) {
      let source = createStreamingArchive(
        {
          entries: [
            { path: "Reports/", directory: true },
            { path: "Reports/Empty/", directory: true },
            {
              path: "Reports/Résumé 合同.txt",
              directory: false,
              id: "text",
              size: payloads[0].length,
              created_at: 1793116800000,
            },
            {
              path: "Reports/data.bin",
              directory: false,
              id: "binary",
              size: payloads[1].length,
            },
          ],
        },
        "Reports.zip",
      );
      const fingerprint = await streamingArchiveFingerprint(source),
        size = new StreamingZip(source).size;
      const chunks: Uint8Array[] = [],
        reads: Record<string, number> = {};
      for (let start = 0; start < size; start += partSize) {
        // Each part starts with a newly restored transfer, as after a reload.
        source = JSON.parse(JSON.stringify(source));
        const zip = new StreamingZip(source, async (entry, offset, length) => {
          expect(offset).toBe(reads[entry.id!] || 0);
          reads[entry.id!] = offset + length;
          return payloads[entry.id === "text" ? 0 : 1].slice(
            offset,
            offset + length,
          );
        });
        chunks.push(
          await zip.readPart(
            start,
            Math.min(partSize, size - start),
            new AbortController().signal,
          ),
        );
      }
      expect(await streamingArchiveFingerprint(source)).toBe(fingerprint);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const reader = new ZipReader(new Uint8ArrayReader(bytes), {
        useWebWorkers: false,
        checkSignature: true,
      });
      const entries = await reader.getEntries();
      expect(entries.map((entry) => entry.filename)).toEqual(
        source.entries.map((entry) => entry.path),
      );
      expect(entries.every((entry) => entry.compressionMethod === 0)).toBe(
        true,
      );
      expect(entries.filter((entry) => entry.directory)).toHaveLength(2);
      for (let index = 0; index < payloads.length; index++) {
        const entry = entries[index + 2];
        if (entry.directory) throw Error("Expected a file entry.");
        expect(await entry.getData(new Uint8ArrayWriter())).toEqual(
          payloads[index],
        );
      }
      await reader.close();
      expect(source.checksums.slice(0, 2)).toEqual([0, 0]);
    }
  });
  it("has an exact size and ZIP64 offsets for a 10 GiB folder without allocating or downloading its contents", async () => {
    const source = createStreamingArchive(
      {
        entries: [
          { path: "Videos/", directory: true },
          {
            path: "Videos/first.mp4",
            id: "first",
            size: 6 * 1024 ** 3,
            directory: false,
          },
          {
            path: "Videos/second.mp4",
            id: "second",
            size: 4 * 1024 ** 3,
            directory: false,
          },
        ],
      },
      "Videos.zip",
    );
    const zip = new StreamingZip(source, async () => {
      throw Error("Must not download source bytes to determine size.");
    });
    expect(zip.size).toBe(
      10 * 1024 ** 3 +
        98 +
        source.entries.reduce(
          (total, entry) =>
            total + 148 + 2 * new TextEncoder().encode(entry.path).length,
          0,
        ),
    );
    const tail = await zip.readPart(
        zip.size - 98,
        98,
        new AbortController().signal,
      ),
      view = new DataView(tail.buffer);
    expect(view.getUint32(0, true)).toBe(0x06064b50);
    expect(view.getBigUint64(32, true)).toBe(3n);
    const centralOffset = Number(view.getBigUint64(48, true));
    expect(centralOffset).toBeGreaterThan(10 * 1024 ** 3);
    source.checksums = [0, 0, 0];
    const central = await zip.readPart(
      centralOffset,
      Number(view.getBigUint64(40, true)),
      new AbortController().signal,
    );
    const third = central.slice(
      74 +
        new TextEncoder().encode(source.entries[0].path).length +
        (74 + new TextEncoder().encode(source.entries[1].path).length),
    );
    const offset = Number(
      new DataView(third.buffer).getBigUint64(
        66 + new TextEncoder().encode(source.entries[2].path).length,
        true,
      ),
    );
    expect(offset).toBeGreaterThan(6 * 1024 ** 3);
    expect(view.getUint32(56, true)).toBe(0x07064b50);
    expect(view.getUint32(76, true)).toBe(0x06054b50);
  });
  it("rejects incomplete ranges, missing resume state and tampered manifests, and observes cancellation", async () => {
    const manifest = {
      entries: [
        { path: "file.txt", directory: false, id: "source", size: 100 },
      ],
    };
    let source = createStreamingArchive(manifest, "file.zip");
    let zip = new StreamingZip(source, async () => new Uint8Array(0));
    await expect(
      zip.readPart(0, zip.size, new AbortController().signal),
    ).rejects.toThrow("incomplete download");
    source = createStreamingArchive(manifest, "file.zip");
    zip = new StreamingZip(source, async (_, offset, length) =>
      new Uint8Array(length).fill(offset),
    );
    await zip.readPart(0, 80, new AbortController().signal);
    source.checkpoints = {};
    await expect(
      zip.readPart(80, 10, new AbortController().signal),
    ).rejects.toThrow("source is invalid");
    const controller = new AbortController();
    controller.abort();
    await expect(zip.readPart(0, 10, controller.signal)).rejects.toThrow();
    expect(
      () =>
        new StreamingZip({
          ...source,
          entries: [{ path: "../escape", directory: true }],
        }),
    ).toThrow("source is invalid");
    const fingerprint = await streamingArchiveFingerprint(source);
    source.entries[0].id = "other";
    expect(await streamingArchiveFingerprint(source)).not.toBe(fingerprint);
    expect(
      () =>
        new StreamingZip({
          ...source,
          version: 2,
        } as unknown as StreamingArchive),
    ).toThrow("source is invalid");
  });
});
