import { crc32 } from "node:zlib";
import type { Env, Row } from "./model";
import { folderArchiveManifest } from "./archives";
import { coordinate } from "./coordinator.js";
import { ensure, now } from "./util.js";
import { readsFile } from "./workspaces";
import {
  createStreamingArchive,
  StreamingZip,
  type ArchiveEntry,
} from "../src/streaming-archive";

const CHUNK_SIZE = 1024 * 1024;

// Read each provider response sequentially with backpressure. A file may appear
// more than once through shortcuts; its archive path identifies each occurrence.
class Sources {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private path = "";
  private position = 0;
  private pending: Uint8Array = new Uint8Array(0);
  constructor(
    private env: Env,
    private files: Map<string, Row>,
  ) {}

  async open(entry: ArchiveEntry, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.reader && this.path === entry.path) return;
    await this.close();
    const file = this.files.get(entry.id!)!;
    const response = await coordinate(
      this.env,
      file.connector_id,
      `/download?file=${encodeURIComponent(file.id)}&offset=0&length=${file.size}`,
    );
    if (signal.aborted) {
      await response.body?.cancel();
      signal.throwIfAborted();
    }
    if (!response.ok) {
      const error = (await response.json()) as Row;
      ensure(false, response.status, error.error || "Download failed.");
    }
    ensure(
      response.body,
      502,
      "An incomplete download part was received. Retry to continue.",
    );
    this.reader = response.body!.getReader();
    this.path = entry.path;
    this.position = 0;
  }

  async read(
    entry: ArchiveEntry,
    offset: number,
    length: number,
    signal: AbortSignal,
  ) {
    await this.open(entry, signal);
    ensure(
      offset === this.position,
      502,
      "The server returned an unexpected byte range.",
    );
    const bytes = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      signal.throwIfAborted();
      if (!this.pending.length) {
        const chunk = await this.reader!.read();
        ensure(
          !chunk.done,
          502,
          "An incomplete download part was received. Retry to continue.",
        );
        this.pending = chunk.value!;
      }
      const take = Math.min(length - written, this.pending.length);
      bytes.set(this.pending.subarray(0, take), written);
      this.pending = this.pending.subarray(take);
      written += take;
    }
    this.position += length;
    if (this.position === entry.size) {
      ensure(
        !this.pending.length && (await this.reader!.read()).done,
        502,
        "The server returned an unexpected byte range.",
      );
      await this.close();
    }
    return bytes;
  }

  async close() {
    const reader = this.reader;
    this.reader = undefined;
    this.pending = new Uint8Array(0);
    if (reader) {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }
}

export async function folderDownload(
  request: Request,
  env: Env,
  user: Row,
  folderId: string,
) {
  const manifest = await folderArchiveManifest(env, user, folderId);
  const ids = [
    ...new Set(
      manifest.entries.flatMap((entry) => (entry.directory ? [] : [entry.id])),
    ),
  ];
  const rows = ids.length
    ? (
        await env.DB.prepare(
          "SELECT * FROM files WHERE id IN (SELECT value FROM json_each(?))",
        )
          .bind(JSON.stringify(ids))
          .all<Row>()
      ).results
    : [];
  const files = new Map(rows.map((file) => [file.id, file]));
  // Recheck the snapshot before starting a response, including shortcut targets.
  ensure(
    manifest.entries.every((entry) => {
      if (entry.directory) return true;
      const file = files.get(entry.id!);
      return (
        file &&
        readsFile(user, file) &&
        file.state === "ready" &&
        (!file.expires_at || file.expires_at > now()) &&
        file.size === entry.size &&
        (manifest.folder.space !== "public" || file.space === "public")
      );
    }),
    409,
    "The selected files changed. Refresh and try again.",
  );

  const source = createStreamingArchive(
    manifest,
    `${manifest.folder.name}.zip`,
  );
  const controller = new AbortController();
  const sources = new Sources(env, files);
  // Use workerd's native zlib CRC for large files, retaining the portable ZIP64
  // format shared with resumable archives. zlib's CRC is finalized; the ZIP
  // serializer stores the intermediate value between chunks.
  const zip = new StreamingZip(
    source,
    (entry, offset, length, signal) =>
      sources.read(entry, offset, length, signal),
    (bytes, previous) =>
      (crc32(bytes, (previous ^ 0xffffffff) >>> 0) ^ 0xffffffff) >>> 0,
  );
  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="folder.zip"; filename*=UTF-8''${encodeURIComponent(source.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
    "Content-Length": String(zip.size),
    "Accept-Ranges": "none",
    "Cache-Control": "private, no-store",
  });
  if (request.method === "HEAD") return new Response(null, { headers });

  const abort = () => {
    controller.abort();
    void sources.close().catch(() => {});
  };
  const finish = async () => {
    request.signal.removeEventListener("abort", abort);
    await sources.close();
  };
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    // Surface initial provider failures before the browser saves a ZIP header.
    const first = source.entries.find(
      (entry) => !entry.directory && entry.size,
    );
    if (first) await sources.open(first, controller.signal);
  } catch (error) {
    await finish();
    throw error;
  }
  let position = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const chunk = await zip.readPart(
          position,
          Math.min(CHUNK_SIZE, zip.size - position),
          controller.signal,
        );
        position += chunk.length;
        // Only the next boundary's CRC is needed; discard historical checkpoints.
        const checkpoint = source.checkpoints[String(position)];
        source.checkpoints =
          checkpoint === undefined ? {} : { [position]: checkpoint };
        output.enqueue(chunk);
        if (position === zip.size) {
          await finish();
          output.close();
        }
      } catch (error) {
        await finish();
        output.error(error);
      }
    },
    async cancel() {
      abort();
      await finish();
    },
  });
  // FixedLengthStream preserves Content-Length through Cloudflare and ensures
  // an interrupted provider stream cannot look like a successful truncated ZIP.
  const output = new FixedLengthStream(zip.size);
  void stream.pipeTo(output.writable).catch(() => {});
  return new Response(output.readable, { headers });
}
