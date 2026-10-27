import React, { useEffect, useRef, useState } from "react";
import { Reader, ZipWriter } from "@zip.js/zip.js/index-native.js";
import { FileArchive, LoaderCircle } from "lucide-react";
import { Modal, ErrorMessage, formatBytes } from "./App.jsx";
import { api, basePath } from "./http";
import { transfers } from "./transfers";
import {
  archiveDirectory,
  archiveFile,
  removeArchive,
} from "./archive-storage";
import { t } from "./i18n";
type Row = Record<string, any>;
const RANGE_SIZE = 8 * 1024 * 1024;

class FileReader extends Reader<string> {
  cache = new Uint8Array(0);
  start = -1;
  constructor(
    private file: Row,
    private signal: AbortSignal,
  ) {
    super(file.id);
    this.size = file.size;
  }
  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    this.signal.throwIfAborted();
    length = Math.min(length, this.size - index);
    if (!length) return new Uint8Array(0);
    if (index < this.start || index + length > this.start + this.cache.length) {
      const end = Math.min(this.size, index + Math.max(length, RANGE_SIZE)) - 1;
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetch(
            `${basePath}/api/files/${this.file.id}/download`,
            {
              headers: { Range: `bytes=${index}-${end}` },
              signal: this.signal,
            },
          );
          if (!response.ok) {
            const result = (await response.json()) as Row;
            const error = new Error(result.error || "Download failed.");
            Object.assign(error, { status: response.status });
            throw error;
          }
          if (
            response.status !== 206 ||
            response.headers.get("etag") !== `"${this.file.id}"` ||
            response.headers.get("content-range") !==
              `bytes ${index}-${end}/${this.size}`
          ) {
            await response.body?.cancel();
            throw Error("The server returned an unexpected byte range.");
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== end - index + 1)
            throw Error(
              "An incomplete download part was received. Retry to continue.",
            );
          this.cache = bytes;
          this.start = index;
          break;
        } catch (error: any) {
          this.signal.throwIfAborted();
          if (
            attempt >= 2 ||
            (error.status >= 400 && error.status < 500 && error.status !== 429)
          )
            throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 400 * (attempt + 1)),
          );
        }
      }
    }
    return this.cache.subarray(index - this.start, index - this.start + length);
  }
}

export default function FolderArchiveDialog({
  folder,
  connectors,
  onClose,
  onSaved,
}: {
  folder: Row;
  connectors: Row[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [manifest, setManifest] = useState<Row | null>(null),
    [error, setError] = useState("");
  const [name, setName] = useState(`${folder.name}.zip`),
    [connector, setConnector] = useState("");
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState({ done: 0, name: "" });
  const controller = useRef<AbortController | null>(null);
  const destinations = connectors.filter(
    (row) => row.enabled && (row.kind === "r2" || row.credentials_configured),
  );
  useEffect(() => {
    const load = new AbortController();
    api(`/folders/${folder.id}/archive`, { signal: load.signal })
      .then(setManifest)
      .catch((error) => {
        if (!load.signal.aborted) setError(error.message);
      });
    return () => {
      load.abort();
      controller.current?.abort();
    };
  }, [folder.id]);
  useEffect(() => {
    if (!connector && destinations.length) setConnector(destinations[0].id);
  }, [connectors]);
  function close() {
    controller.current?.abort();
    onClose();
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!manifest || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    let source: { key: string; name: string; lastModified: number } | undefined;
    let sink: FileSystemWritableFileStream | undefined;
    try {
      const directory = await archiveDirectory();
      const estimate = await navigator.storage.estimate();
      const needed =
        manifest.totalSize * 1.01 +
        manifest.entries.reduce(
          (total: number, entry: Row) =>
            total + new TextEncoder().encode(entry.path).length * 2 + 512,
          65536,
        );
      if (
        estimate.quota &&
        estimate.usage &&
        needed > estimate.quota - estimate.usage
      )
        throw Error(
          "Your browser does not have enough free space to create this ZIP. Choose a smaller folder or free up disk space.",
        );
      source = {
        key: crypto.randomUUID(),
        name: /\.zip$/i.test(name.trim()) ? name.trim() : `${name.trim()}.zip`,
        lastModified: Date.now(),
      };
      const handle = await directory.getFileHandle(source.key, {
        create: true,
      });
      sink = await handle.createWritable();
      const writer = new ZipWriter(
        new WritableStream({
          write: (chunk) => sink!.write(chunk),
          close: () => sink!.close(),
          abort: (reason) => sink!.abort(reason),
        }),
        {
          useWebWorkers: false,
          useCompressionStream: true,
          level: 6,
          bufferedWrite: false,
          keepOrder: true,
        },
      );
      let done = 0;
      for (const entry of manifest.entries) {
        abort.signal.throwIfAborted();
        setProgress({ done, name: entry.path });
        await writer.add(
          entry.path,
          entry.directory ? undefined : new FileReader(entry, abort.signal),
          {
            directory: entry.directory,
            signal: abort.signal,
            ...(entry.created_at
              ? { lastModDate: new Date(entry.created_at) }
              : {}),
            onprogress: (bytes) =>
              setProgress({ done: done + bytes, name: entry.path }),
          },
        );
        done += entry.size || 0;
      }
      await writer.close();
      sink = undefined;
      abort.signal.throwIfAborted();
      const file = await archiveFile(source);
      const transferId = await transfers.upload(
        file,
        connector,
        undefined,
        folder.parent_id || null,
        folder.space || "private",
        {
          preserveExistingFiles: true,
          localArchive: source,
        },
      );
      source = undefined; // The transfer now owns the local file, including across refreshes.
      if (abort.signal.aborted) {
        await transfers.cancel(transferId);
        return;
      }
      await onSaved();
      onClose();
    } catch (error: any) {
      if (!abort.signal.aborted) setError(error.message);
    } finally {
      await sink?.abort().catch(() => {});
      await removeArchive(source);
      if (controller.current === abort) controller.current = null;
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Create folder ZIP")} onClose={close}>
      <form className="feature-form" onSubmit={create}>
        <p>
          {t(
            "Save a ZIP of this folder and its subfolders as a regular file, ready to share.",
          )}
        </p>
        {manifest && (
          <p className="info">
            {t("{0} files · {1} before compression", {
              0: manifest.fileCount,
              1: formatBytes(manifest.totalSize),
            })}
          </p>
        )}
        <label>
          {t("ZIP filename")}
          <input
            required
            maxLength={240}
            pattern={'[^/\\\\:*?"<>|]+'}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("Storage destination")}
          <select
            required
            disabled={busy}
            value={connector}
            onChange={(event) => setConnector(event.target.value)}
          >
            <option value="" disabled>
              {t("Choose a storage connector")}
            </option>
            {destinations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <p className="fineprint">
          {t(
            "The ZIP is saved beside the original folder, in the same workspace. Existing files are kept; enough free storage is required.",
          )}
        </p>
        <p className="fineprint">
          {t(
            "Keep this tab open while creating the ZIP. Its upload can then be paused and resumed in Transfers.",
          )}
        </p>
        {busy && (
          <div className="archive-progress" role="status">
            <strong>
              <LoaderCircle size={17} className="spin" />
              {t("Creating ZIP…")}
            </strong>
            <progress
              max={Math.max(manifest?.totalSize || 0, 1)}
              value={progress.done}
            />
            <span>{progress.name}</span>
          </div>
        )}
        <ErrorMessage error={error} />
        <div className="feature-actions">
          <button
            className="button primary"
            disabled={busy || !manifest || !connector}
          >
            <FileArchive size={18} />
            {busy ? t("Creating ZIP…") : t("Create and save ZIP")}
          </button>
          <button type="button" className="button secondary" onClick={close}>
            {t("Cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
