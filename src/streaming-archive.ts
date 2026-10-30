// A deterministic, uncompressed ZIP64 can be uploaded in ordinary resumable
// parts: its exact size is known before reading any source bytes. Only a part,
// file checksums and small CRC checkpoints are kept locally, never the ZIP.
export type ArchiveEntry = {
  id?: string;
  path: string;
  directory: boolean;
  size?: number;
  created_at?: number;
};
export type StreamingArchive = {
  version: 1;
  name: string;
  createdAt: number;
  entries: ArchiveEntry[];
  checksums: (number | null)[];
  checkpoints: Record<string, number>;
};
type Segment = {
  start: number;
  size: number;
  kind: "header" | "data" | "descriptor" | "central" | "end";
  entry?: number;
};
type ReadRange = (
  entry: ArchiveEntry,
  offset: number,
  length: number,
  signal: AbortSignal,
) => Promise<Uint8Array>;
const text = new TextEncoder();
const CRC_START = 0xffffffff;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array, crc: number) {
  for (let i = 0; i < bytes.length; i++)
    crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
const invalid = () =>
  Error(
    "The ZIP transfer source is invalid. Cancel this transfer and create the ZIP again.",
  );
function timestamp(value: number) {
  const date = new Date(
    Math.min(
      Date.UTC(2107, 11, 31, 23, 59, 58),
      Math.max(Date.UTC(1980, 0, 1), value),
    ),
  );
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date:
      ((date.getUTCFullYear() - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}
export function createStreamingArchive(
  manifest: { entries: ArchiveEntry[] },
  name: string,
): StreamingArchive {
  const source: StreamingArchive = {
    version: 1,
    name: /\.zip$/i.test(name.trim()) ? name.trim() : `${name.trim()}.zip`,
    createdAt: Date.now(),
    entries: manifest.entries.map((entry) => ({
      path: entry.path,
      directory: entry.directory,
      ...(entry.directory
        ? {}
        : { id: entry.id, size: entry.size, created_at: entry.created_at }),
    })),
    checksums: manifest.entries.map((entry) =>
      entry.directory || entry.size === 0 ? 0 : null,
    ),
    checkpoints: {},
  };
  new StreamingZip(source); // Validate before reserving provider capacity.
  return source;
}
export async function streamingArchiveFingerprint(source: StreamingArchive) {
  const bytes = text.encode(
    JSON.stringify({
      version: source.version,
      name: source.name,
      createdAt: source.createdAt,
      entries: source.entries,
    }),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
export class StreamingZip {
  readonly size: number;
  private segments: Segment[] = [];
  private names: Uint8Array[] = [];
  private offsets: number[] = [];
  private centralOffset = 0;
  private centralSize = 0;
  constructor(
    readonly source: StreamingArchive,
    private readRange?: ReadRange,
  ) {
    if (
      source.version !== 1 ||
      !Number.isFinite(source.createdAt) ||
      !Array.isArray(source.entries) ||
      source.entries.length > 2001 ||
      !Array.isArray(source.checksums) ||
      source.checksums.length !== source.entries.length ||
      !source.checkpoints ||
      typeof source.checkpoints !== "object"
    )
      throw invalid();
    let offset = 0;
    const append = (kind: Segment["kind"], size: number, entry?: number) => {
      if (size) this.segments.push({ kind, size, start: offset, entry });
      offset += size;
      if (!Number.isSafeInteger(offset)) throw invalid();
    };
    source.entries.forEach((entry, index) => {
      if (
        typeof entry.path !== "string" ||
        !entry.path ||
        entry.path.startsWith("/") ||
        /[\\\x00]/.test(entry.path) ||
        entry.path.split("/").some((part) => part === "." || part === "..") ||
        typeof entry.directory !== "boolean" ||
        (entry.directory && !entry.path.endsWith("/")) ||
        (!entry.directory &&
          (typeof entry.id !== "string" ||
            !entry.id ||
            !Number.isSafeInteger(entry.size) ||
            entry.size! < 0)) ||
        (entry.created_at !== undefined && !Number.isFinite(entry.created_at))
      )
        throw invalid();
      const name = text.encode(entry.path);
      if (name.length > 65535) throw invalid();
      this.names.push(name);
      this.offsets.push(offset);
      append("header", 50 + name.length, index);
      append("data", entry.directory ? 0 : entry.size!, index);
      append("descriptor", 24, index);
    });
    this.centralOffset = offset;
    source.entries.forEach((_, index) =>
      append("central", 74 + this.names[index].length, index),
    );
    this.centralSize = offset - this.centralOffset;
    append("end", 98);
    this.size = offset;
  }
  private metadata(segment: Segment) {
    const bytes = new Uint8Array(segment.size),
      view = new DataView(bytes.buffer);
    const u16 = (offset: number, value: number) =>
      view.setUint16(offset, value, true);
    const u32 = (offset: number, value: number) =>
      view.setUint32(offset, value, true);
    const u64 = (offset: number, value: number) =>
      view.setBigUint64(offset, BigInt(value), true);
    if (segment.kind === "end") {
      u32(0, 0x06064b50);
      u64(4, 44);
      u16(12, 45);
      u16(14, 45);
      u64(24, this.source.entries.length);
      u64(32, this.source.entries.length);
      u64(40, this.centralSize);
      u64(48, this.centralOffset);
      u32(56, 0x07064b50);
      u64(64, this.centralOffset + this.centralSize);
      u32(72, 1);
      u32(76, 0x06054b50);
      u16(84, 0xffff);
      u16(86, 0xffff);
      u32(88, 0xffffffff);
      u32(92, 0xffffffff);
      return bytes;
    }
    const index = segment.entry!,
      entry = this.source.entries[index],
      name = this.names[index];
    const size = entry.directory ? 0 : entry.size!,
      stamp = timestamp(entry.created_at ?? this.source.createdAt);
    const checksum = this.source.checksums[index];
    if (
      segment.kind !== "header" &&
      (!Number.isInteger(checksum) || checksum! < 0 || checksum! > 0xffffffff)
    )
      throw invalid();
    if (segment.kind === "header") {
      u32(0, 0x04034b50);
      u16(4, 45);
      u16(6, 0x0808);
      u16(10, stamp.time);
      u16(12, stamp.date);
      u32(18, 0xffffffff);
      u32(22, 0xffffffff);
      u16(26, name.length);
      u16(28, 20);
      bytes.set(name, 30);
      u16(30 + name.length, 1);
      u16(32 + name.length, 16);
      u64(34 + name.length, size);
      u64(42 + name.length, size);
    } else if (segment.kind === "descriptor") {
      u32(0, 0x08074b50);
      u32(4, checksum!);
      u64(8, size);
      u64(16, size);
    } else {
      u32(0, 0x02014b50);
      u16(4, 45);
      u16(6, 45);
      u16(8, 0x0808);
      u16(12, stamp.time);
      u16(14, stamp.date);
      u32(16, checksum!);
      u32(20, 0xffffffff);
      u32(24, 0xffffffff);
      u16(28, name.length);
      u16(30, 28);
      u32(38, entry.directory ? 0x10 : 0x20);
      u32(42, 0xffffffff);
      bytes.set(name, 46);
      u16(46 + name.length, 1);
      u16(48 + name.length, 24);
      u64(50 + name.length, size);
      u64(58 + name.length, size);
      u64(66 + name.length, this.offsets[index]);
    }
    return bytes;
  }
  async readPart(start: number, length: number, signal: AbortSignal) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 0 ||
      length > 16 * 1024 * 1024 ||
      start + length > this.size
    )
      throw invalid();
    const output = new Uint8Array(length),
      end = start + length;
    let cursor = start;
    for (const segment of this.segments) {
      if (segment.start + segment.size <= cursor) continue;
      if (segment.start >= end) break;
      while (cursor < Math.min(end, segment.start + segment.size)) {
        signal.throwIfAborted();
        const offset = cursor - segment.start,
          take = Math.min(end - cursor, segment.size - offset, 8 * 1024 * 1024);
        if (segment.kind === "data") {
          if (!this.readRange) throw invalid();
          const crc =
            offset === 0 ? CRC_START : this.source.checkpoints[String(cursor)];
          if (!Number.isInteger(crc) || crc < 0 || crc > 0xffffffff)
            throw invalid();
          const bytes = await this.readRange(
            this.source.entries[segment.entry!],
            offset,
            take,
            signal,
          );
          signal.throwIfAborted();
          if (bytes.byteLength !== take)
            throw Error(
              "An incomplete download part was received. Retry to continue.",
            );
          output.set(bytes, cursor - start);
          const next = crc32(bytes, crc);
          if (offset + take === segment.size)
            this.source.checksums[segment.entry!] = (next ^ CRC_START) >>> 0;
          else this.source.checkpoints[String(cursor + take)] = next;
        } else
          output.set(
            this.metadata(segment).subarray(offset, offset + take),
            cursor - start,
          );
        cursor += take;
      }
    }
    if (cursor !== end) throw invalid();
    return output;
  }
}
