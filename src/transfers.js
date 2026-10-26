import { api, post, basePath } from "./http";
import { RequestPool, parallel } from "../shared/concurrency";
class DiskWorker {
  worker = new Worker(new URL("./disk.worker.js", import.meta.url), {
    type: "module",
  });
  serial = 0;
  failed = !1;
  pending = new Map();
  constructor() {
    ((this.worker.onmessage = (v) => {
      const T = this.pending.get(v.data.id);
      T &&
        (this.pending.delete(v.data.id),
        v.data.error
          ? T.reject(new Error(v.data.error))
          : T.resolve(v.data.result));
    }),
      (this.worker.onerror = () => {
        this.failed = !0;
        for (const v of this.pending.values())
          v.reject(
            new Error(
              "Browser download storage could not start. Use the direct browser download.",
            ),
          );
        this.pending.clear();
      }));
  }
  command(v, T = {}, o = []) {
    if (this.failed)
      return Promise.reject(
        new Error(
          "Browser download storage is unavailable. Use the direct browser download.",
        ),
      );
    const _ = ++this.serial;
    return new Promise((C, B) => {
      (this.pending.set(_, { resolve: C, reject: B }),
        this.worker.postMessage({ id: _, action: v, ...T }, o));
    });
  }
  open(item) {
    return this.command("open", {
      name: item.id,
      fileId: item.fileId,
      size: item.size,
      partSize: item.partSize,
      legacyDone: item.downloadMapVersion ? 0 : item.done,
    });
  }
  write(data, part) {
    return this.command("write", { data, part }, [data]);
  }
  async close() {
    try {
      await this.command("close");
    } finally {
      this.worker.terminate();
    }
  }
}
const DOWNLOAD_PART_SIZE = 8 * 1024 * 1024,
  loadTransfers = (S) => {
    try {
      return JSON.parse(localStorage.getItem(`fs-transfers:${S}`) || "[]");
    } catch {
      return [];
    }
  };
class TransferManager {
  scope = "guest";
  concurrency = [1, 2, 3].includes(
    Number(localStorage.getItem("fs-transfer-concurrency")),
  )
    ? Number(localStorage.getItem("fs-transfer-concurrency"))
    : 3;
  pool = new RequestPool(6);
  setConcurrency(value) {
    if (![1, 2, 3].includes(Number(value))) return;
    this.concurrency = Number(value);
    localStorage.setItem("fs-transfer-concurrency", String(this.concurrency));
    this.update();
  }
  items = loadTransfers("guest").map((v) => ({
    ...v,
    state: v.state === "complete" ? "complete" : "paused",
  }));
  listeners = new Set();
  controllers = new Map();
  files = new Map();
  snapshot = 0;
  subscribe = (v) => (this.listeners.add(v), () => this.listeners.delete(v));
  getSnapshot = () => this.snapshot;
  update() {
    (this.snapshot++,
      localStorage.setItem(
        `fs-transfers:${this.scope}`,
        JSON.stringify(this.items),
      ),
      this.listeners.forEach((v) => v()));
  }
  async setScope(v) {
    if (v !== this.scope) {
      for (const T of this.items) T.state === "running" && this.pause(T.id);
      for (; this.controllers.size;)
        await new Promise((T) => setTimeout(T, 50));
      (this.files.clear(),
        (this.scope = v),
        (this.items = loadTransfers(v).map((T) => ({
          ...T,
          state: T.state === "complete" ? "complete" : "paused",
        }))),
        this.update());
    }
  }
  async upload(v, T, invitation, folderId = null, space = "private") {
    const o = await fingerprint(v),
      _ = await post(
        invitation ? `/invitations/${invitation.id}/uploads` : "/uploads",
        {
          ...(invitation ? { baseRevision: invitation.baseRevision } : {}),
          connectorId: T,
          folderId,
          space,
          name: v.name,
          size: v.size,
          mime: v.type,
          fingerprint: o,
        },
      ),
      C = {
        id: crypto.randomUUID(),
        apiBase: invitation
          ? `/invitations/${invitation.id}/uploads`
          : "/uploads",
        invitationId: invitation?.id,
        fileId: _.file.id,
        name: v.name,
        size: v.size,
        done: 0,
        direction: "upload",
        state: "paused",
        fingerprint: o,
        partSize: _.partSize,
        connections: Math.min(this.concurrency, _.uploadConcurrency || 1),
        evicted: _.evicted,
      };
    (this.items.unshift(C),
      this.files.set(C.id, v),
      this.update(),
      this.resume(C.id));
    return C.id;
  }
  pause(v) {
    const T = this.items.find((o) => o.id === v);
    T &&
      ((T.state = "paused"), this.controllers.get(v)?.abort(), this.update());
  }
  async resume(v, T) {
    const o = this.items.find((_) => _.id === v);
    if (!(!o || o.state === "running" || o.state === "complete")) {
      this.controllers.has(v) &&
        (await new Promise((_) => {
          const C = setInterval(() => {
            this.controllers.has(v) || (clearInterval(C), _());
          }, 50);
        }));
      if (
        this.controllers.has(v) ||
        o.state === "running" ||
        o.state === "complete"
      )
        return;
      try {
        if (T) {
          if (T.size !== o.size || (await fingerprint(T)) !== o.fingerprint)
            throw new Error("Select the original file to resume this upload.");
          this.files.set(v, T);
        }
        if (o.direction === "upload" && !this.files.has(v)) {
          ((o.error = "Select the original file to resume."),
            (o.state = "paused"),
            this.update());
          return;
        }
        if (
          !this.items.includes(o) ||
          this.controllers.has(v) ||
          o.state === "running" ||
          o.state === "complete"
        )
          return;
        ((o.state = "running"), (o.error = void 0));
        const _ = new AbortController();
        (this.controllers.set(v, _),
          this.update(),
          o.direction === "upload"
            ? await this.runUpload(o, this.files.get(v), _.signal)
            : await this.runDownload(o, _.signal),
          o.state === "running" && (o.state = "complete"));
      } catch (_) {
        o.state !== "paused" &&
          ((o.state = "error"),
          (o.error = _ instanceof Error ? _.message : "Transfer failed."));
      } finally {
        (this.controllers.delete(v), this.update());
      }
    }
  }
  async cancel(v) {
    const T = this.items.find((o) => o.id === v);
    if (T) {
      for (this.pause(v); this.controllers.has(v);)
        await new Promise((o) => setTimeout(o, 50));
      if (
        (T.direction === "upload" &&
          T.state !== "complete" &&
          (await api(`${T.apiBase || "/uploads"}/${T.fileId}`, {
            method: "DELETE",
          })),
        T.direction === "download")
      )
        try {
          await removeDownload(T.id);
        } catch {}
      ((this.items = this.items.filter((o) => o.id !== v)),
        this.files.delete(v),
        this.update());
    }
  }
  dismiss(v) {
    (this.items.find((o) => o.id === v)?.direction === "download" &&
      downloadDirectory()
        .then(() => removeDownload(v))
        .catch(() => {}),
      (this.items = this.items.filter((o) => o.id !== v)),
      this.files.delete(v),
      this.update());
  }
  async download(v, downloadPath) {
    await downloadDirectory();
    const T = {
      id: crypto.randomUUID(),
      fileId: v.id,
      name: v.name,
      size: v.size,
      done: 0,
      direction: "download",
      state: "paused",
      partSize: DOWNLOAD_PART_SIZE,
      downloadMapVersion: 1,
      connections: this.concurrency,
      downloadPath,
    };
    (this.items.unshift(T), this.update(), this.resume(T.id));
  }
  async runUpload(item, file, signal) {
    const path = `${item.apiBase || "/uploads"}/${item.fileId}`;
    const status = await api(path, { signal });
    signal.throwIfAborted();
    if (status.file.state === "ready") {
      if (item.invitationId) await post(`${path}/publish`, {}, { signal });
      item.done = item.size;
      return;
    }
    if (status.file.state !== "uploading")
      throw new Error("This upload was deleted or expired.");
    item.partSize = status.partSize;
    item.connections = Math.min(
      this.concurrency,
      status.uploadConcurrency || 1,
    );
    const completed = new Set(status.parts.map((part) => part.part_number));
    item.done = status.parts.reduce((total, part) => total + part.size, 0);
    this.update();
    const missing = Array.from(
      { length: Math.ceil(item.size / item.partSize) },
      (_, index) => index + 1,
    ).filter((part) => !completed.has(part));
    await parallel(
      missing,
      item.connections,
      signal,
      async (part, activeSignal) => {
        const bytes = file.slice(
          (part - 1) * item.partSize,
          Math.min(part * item.partSize, item.size),
        );
        await retryTransfer(
          () =>
            this.pool.run(
              () =>
                api(`${path}/parts/${part}`, {
                  method: "PUT",
                  body: bytes,
                  signal: activeSignal,
                }),
              activeSignal,
            ),
          activeSignal,
        );
        item.done += bytes.size;
        this.update();
      },
    );
    signal.throwIfAborted();
    await post(`${path}/complete`, {}, { signal });
    if (item.invitationId) await post(`${path}/publish`, {}, { signal });
  }
  async runDownload(item, signal) {
    const disk = new DiskWorker();
    const url = `${basePath}/api${item.downloadPath || `/files/${item.fileId}/download`}`;
    try {
      const saved = await disk.open(item);
      item.downloadMapVersion = 1;
      const completed = new Set(saved.completedParts);
      item.done = [...completed].reduce(
        (sum, part) =>
          sum + Math.min(item.partSize, item.size - (part - 1) * item.partSize),
        0,
      );
      item.connections = this.concurrency;
      this.update();
      const missing = Array.from(
        { length: Math.ceil(item.size / item.partSize) },
        (_, index) => index + 1,
      ).filter((part) => !completed.has(part));
      await parallel(
        missing,
        item.connections,
        signal,
        async (part, activeSignal) => {
          const start = (part - 1) * item.partSize;
          const end = Math.min(start + item.partSize, item.size) - 1;
          // Keep the permit until the disk write is flushed, bounding buffered
          // chunks across multiple simultaneous downloads as well as requests.
          await this.pool.run(async () => {
            const data = await retryTransfer(async () => {
              const response = await fetch(url, {
                headers: { Range: `bytes=${start}-${end}` },
                signal: activeSignal,
              });
              if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error || "Download failed.");
              }
              if (
                response.status !== 206 ||
                response.headers.get("etag") !== `"${item.fileId}"` ||
                response.headers.get("content-range") !==
                  `bytes ${start}-${end}/${item.size}`
              ) {
                await response.body?.cancel();
                throw new Error(
                  "The server returned an unexpected byte range.",
                );
              }
              const data = await response.arrayBuffer();
              if (data.byteLength !== end - start + 1)
                throw new Error(
                  "An incomplete download part was received. Retry to continue.",
                );
              return data;
            }, activeSignal);
            activeSignal.throwIfAborted();
            const size = data.byteLength;
            await disk.write(data, part);
            item.done += size;
            this.update();
          }, activeSignal);
        },
      );
    } finally {
      await disk.close();
    }
    signal.throwIfAborted();
    const final = await fetch(url, { method: "HEAD", signal });
    if (!final.ok)
      throw new Error("This share expired or the file was deleted.");
    if (
      final.headers.get("etag") !== `"${item.fileId}"` ||
      Number(final.headers.get("content-length")) !== item.size
    )
      throw new Error(
        "The working copy changed. Start a new download for the latest file.",
      );
    signal.throwIfAborted();
    await this.saveDownload(item);
  }
  async saveDownload(v) {
    const T = await (
        await (await downloadDirectory()).getFileHandle(v.id)
      ).getFile(),
      o = URL.createObjectURL(T),
      _ = document.createElement("a");
    ((_.href = o),
      (_.download = v.name),
      _.click(),
      setTimeout(() => URL.revokeObjectURL(o), 6e4));
  }
}
async function downloadDirectory() {
  if (!navigator.storage?.getDirectory)
    throw new Error(
      "Resumable downloads need a browser with private file storage (current Chrome, Edge, Firefox, or Safari) and a secure connection. Use the direct download instead.",
    );
  return navigator.storage.getDirectory();
}
async function fingerprint(S) {
  const v = new Blob([
    JSON.stringify({
      name: S.name,
      size: S.size,
      lastModified: S.lastModified,
    }),
    S.slice(0, 65536),
    S.slice(Math.max(0, S.size - 65536)),
  ]);
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await v.arrayBuffer()),
    ),
    (T) => T.toString(16).padStart(2, "0"),
  ).join("");
}
async function retryTransfer(job, signal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await job();
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === 2) throw error;
      await new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
          1000 * 2 ** attempt,
        );
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}
async function removeDownload(id) {
  const directory = await downloadDirectory();
  await Promise.allSettled([
    directory.removeEntry(id),
    directory.removeEntry(`${id}.progress`),
  ]);
}
const transfers = new TransferManager();

export { TransferManager, transfers, fingerprint };
