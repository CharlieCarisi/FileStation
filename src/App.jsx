import {
  AccessGate,
  InvitationManager,
  InvitationDialog,
  OneDriveDialog,
} from "./features";
// Restored from the published browser application; see docs/recovery.md.
import * as D from "react";
import * as c from "react/jsx-runtime";
import {
  Link2 as Fi,
  Settings2 as Vm,
  Trash2 as Lm,
  ArrowDownToLine as gn,
  ArrowDown as Gf,
  ArrowRight as $i,
  ArrowUpRight as zm,
  ArrowUp as a1,
  Check as ki,
  ChevronRight as Am,
  CircleAlert as n1,
  CloudUpload as u1,
  Cloud as vu,
  Copy as i1,
  FileArchive as c1,
  FileImage as s1,
  FileText as qm,
  File as f1,
  FolderOpen as Xf,
  Folder as Bm,
  HardDrive as Ym,
  LogOut as o1,
  Mail as Gm,
  Menu as r1,
  Pause as Xm,
  Play as d1,
  Plus as Qf,
  RefreshCw as h1,
  Save as Qm,
  Search as m1,
  ShieldCheck as yu,
  Upload as v1,
  UserCheck as y1,
  UserX as g1,
  Users as S1,
  X as Lf,
} from "lucide-react";
export const basePath =
  location.pathname === "/files" || location.pathname.startsWith("/files/")
    ? "/files"
    : "";
const canDirectDownload = (file) =>
  !["synology", "webdav"].includes(file.storage_kind || "") ||
  file.size <= 256 * 1024 * 1024;
async function api(S, v = {}) {
  const T = await fetch(`${basePath}/api${S}`, {
      ...v,
      headers: {
        ...(v.body && typeof v.body == "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...v.headers,
      },
      credentials: "same-origin",
    }),
    o = await T.json();
  if (!T.ok) throw new Error(o.error || "The request failed.");
  return o;
}
const post = (S, v = {}) => api(S, { method: "POST", body: JSON.stringify(v) });
function formatBytes(S) {
  if (S === 0) return "0 B";
  const v = ["B", "KB", "MB", "GB", "TB"],
    T = Math.min(Math.floor(Math.log(S) / Math.log(1e3)), 4);
  return `${(S / 1e3 ** T).toFixed(T > 1 ? 1 : 0)} ${v[T]}`;
}
const formatDate = (S) =>
  S
    ? new Date(S).toLocaleDateString(void 0, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No expiry";
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
  open(v) {
    return this.command("open", { name: v });
  }
  write(v, T) {
    return this.command("write", { data: v, offset: T }, [v]);
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
  async upload(v, T, invitation) {
    const o = await fingerprint(v),
      _ = await post(
        invitation ? `/invitations/${invitation.id}/uploads` : "/uploads",
        {
          ...(invitation ? { baseRevision: invitation.baseRevision } : {}),
          connectorId: T,
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
          await (await downloadDirectory()).removeEntry(T.id);
        } catch {}
      ((this.items = this.items.filter((o) => o.id !== v)),
        this.files.delete(v),
        this.update());
    }
  }
  dismiss(v) {
    (this.items.find((o) => o.id === v)?.direction === "download" &&
      downloadDirectory()
        .then((o) => o.removeEntry(v))
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
      downloadPath,
    };
    (this.items.unshift(T), this.update(), this.resume(T.id));
  }
  async runUpload(v, T, o) {
    const _ = await api(`${v.apiBase || "/uploads"}/${v.fileId}`, {
      signal: o,
    });
    if (_.file.state === "ready") {
      if (v.invitationId) await post(`${v.apiBase}/${v.fileId}/publish`);
      v.done = v.size;
      return;
    }
    if (_.file.state !== "uploading")
      throw new Error("This upload was deleted or expired.");
    const C = new Set(_.parts.map((M) => M.part_number));
    ((v.done = _.parts.reduce((M, R) => M + R.size, 0)), this.update());
    const B = Math.ceil(v.size / v.partSize);
    for (let M = 1; M <= B; M++) {
      if ((o.throwIfAborted(), C.has(M))) continue;
      const R = T.slice((M - 1) * v.partSize, Math.min(M * v.partSize, v.size));
      (await retryTransfer(
        () =>
          api(`${v.apiBase || "/uploads"}/${v.fileId}/parts/${M}`, {
            method: "PUT",
            body: R,
            signal: o,
          }),
        o,
      ),
        (v.done += R.size),
        this.update());
    }
    (o.throwIfAborted(),
      await post(`${v.apiBase || "/uploads"}/${v.fileId}/complete`));
    if (v.invitationId) await post(`${v.apiBase}/${v.fileId}/publish`);
  }
  async runDownload(v, T) {
    const o = new DiskWorker();
    try {
      if (((v.done = await o.open(v.id)), v.done > v.size))
        throw new Error("The saved download is invalid. Restart it.");
      for (this.update(); v.done < v.size;) {
        T.throwIfAborted();
        const C = Math.min(v.done + v.partSize, v.size) - 1,
          B = await retryTransfer(async () => {
            const J = await fetch(
              `${basePath}/api${v.downloadPath || `/files/${v.fileId}/download`}`,
              {
                headers: { Range: `bytes=${v.done}-${C}` },
                signal: T,
              },
            );
            if (!J.ok) {
              const A = await J.json();
              throw new Error(A.error || "Download failed.");
            }
            if (
              J.status !== 206 ||
              J.headers.get("etag") !== `"${v.fileId}"` ||
              J.headers.get("content-range") !==
                `bytes ${v.done}-${C}/${v.size}`
            )
              throw new Error("The server returned an unexpected byte range.");
            return J;
          }, T),
          M = new Uint8Array(await B.arrayBuffer());
        if (M.length !== C - v.done + 1)
          throw new Error(
            "An incomplete download part was received. Retry to continue.",
          );
        T.throwIfAborted();
        const R = M.length;
        (await o.write(M.buffer, v.done), (v.done += R), this.update());
      }
    } finally {
      await o.close();
    }
    if (
      !(
        await fetch(
          `${basePath}/api${v.downloadPath || `/files/${v.fileId}/download`}`,
          {
            method: "HEAD",
            signal: T,
          },
        )
      ).ok
    )
      throw new Error("This share expired or the file was deleted.");
    await this.saveDownload(v);
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
async function retryTransfer(S, v) {
  for (let T = 0; ; T++)
    try {
      return await S();
    } catch (o) {
      if ((v.throwIfAborted(), T === 2)) throw o;
      await new Promise((_, C) => {
        const B = setTimeout(_, 1e3 * 2 ** T);
        v.addEventListener(
          "abort",
          () => {
            (clearTimeout(B), C(v.reason));
          },
          { once: !0 },
        );
      });
    }
}
const transfers = new TransferManager();
function Modal({
  title: S,
  subtitle: v = undefined,
  onClose: T,
  children: o,
  wide: _ = !1,
}) {
  return c.jsx("div", {
    className: "modal-backdrop",
    children: c.jsxs("section", {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": S,
      className: `modal ${_ ? "wide" : ""}`,
      children: [
        c.jsx("button", {
          className: "icon-button modal-close",
          onClick: T,
          "aria-label": "Close",
          children: c.jsx(Lf, { size: 20 }),
        }),
        c.jsx("h2", { children: S }),
        v && c.jsx("p", { className: "muted", children: v }),
        o,
      ],
    }),
  });
}
function ErrorMessage({ error: S }) {
  return S
    ? c.jsxs("p", {
        role: "alert",
        className: "error",
        children: [c.jsx(n1, { size: 16 }), S],
      })
    : null;
}
function LoginDialog({ onClose: S, onLogin: v }) {
  const [T, o] = D.useState(""),
    [_, C] = D.useState(""),
    [B, M] = D.useState(""),
    [R, J] = D.useState(""),
    [A, j] = D.useState(!1),
    [N, k] = D.useState("");
  async function xe(G) {
    (G.preventDefault(), j(!0), k(""));
    try {
      if (B) {
        const $ = await post("/auth/verify", { challengeId: B, pin: _ });
        v($.user);
      } else {
        const $ = await post("/auth/request", { email: T });
        (M($.challengeId), J($.developmentPin || ""));
      }
    } catch ($) {
      k($.message);
    } finally {
      j(!1);
    }
  }
  return c.jsxs(Modal, {
    title: B ? "Check your inbox" : "Welcome to your station",
    subtitle: B
      ? `We sent a six-digit code to ${T}. It expires in 10 minutes.`
      : "Sign in or create an account with your email. No password to remember.",
    onClose: S,
    children: [
      c.jsx("div", {
        className: "dialog-symbol",
        children: c.jsx(Gm, { size: 26 }),
      }),
      c.jsxs("form", {
        onSubmit: xe,
        children: [
          c.jsxs("label", {
            children: [
              B ? "Verification PIN" : "Email address",
              c.jsx("input", {
                type: B ? "text" : "email",
                inputMode: B ? "numeric" : "email",
                autoComplete: B ? "one-time-code" : "email",
                autoFocus: !0,
                required: !0,
                maxLength: B ? 6 : 254,
                value: B ? _ : T,
                onChange: (G) => (B ? C(G.target.value) : o(G.target.value)),
                placeholder: B ? "000000" : "you@company.com",
              }),
            ],
          }),
          R &&
            c.jsxs("p", {
              className: "development",
              children: [
                "Local email simulator · PIN: ",
                c.jsx("strong", { children: R }),
              ],
            }),
          c.jsx(ErrorMessage, { error: N }),
          c.jsxs("button", {
            type: "submit",
            className: "button primary full",
            disabled: A,
            children: [
              A ? "Please wait…" : B ? "Sign in" : "Email me a sign-in code",
              c.jsx($i, { size: 17 }),
            ],
          }),
        ],
      }),
      B &&
        c.jsx("button", {
          className: "text-button",
          onClick: () => {
            (M(""), C(""), J(""), k(""));
          },
          children: "Use another email or request a new code",
        }),
      c.jsxs("p", {
        className: "fineprint",
        children: [
          c.jsx(yu, { size: 14 }),
          " Only approved accounts can upload files.",
        ],
      }),
    ],
  });
}
function AccessForm({ initialCode, onFile }) {
  return c.jsx(AccessGate, { initialCode, onFile });
}
function UploadDialog({ connectors: S, onClose: v, onUploaded: T }) {
  const [o, _] = D.useState([]),
    [C, B] = D.useState(
      S.find((G) => G.enabled && (G.kind === "r2" || G.credentials_configured))
        ?.id || "",
    ),
    [M, R] = D.useState(!1),
    [J, A] = D.useState(""),
    [j, N] = D.useState(!1),
    k = S.find((G) => G.id === C);
  async function xe(G) {
    (G.preventDefault(), R(!0), A(""));
    try {
      if (!o.length) throw new Error("Choose at least one file.");
      for (const $ of o) await transfers.upload($, C);
      (T(), v());
    } catch ($) {
      (A($.message), T());
    } finally {
      R(!1);
    }
  }
  return c.jsx(Modal, {
    title: "Bring your files aboard",
    subtitle:
      "Choose a destination. You can pause a transfer and pick up where you left off.",
    onClose: () => {
      M || v();
    },
    children: c.jsxs("form", {
      onSubmit: xe,
      children: [
        c.jsxs("label", {
          className: `dropzone ${j ? "drag" : ""}`,
          onDragOver: (G) => {
            (G.preventDefault(), N(!0));
          },
          onDragLeave: () => N(!1),
          onDrop: (G) => {
            (G.preventDefault(), N(!1), _(Array.from(G.dataTransfer.files)));
          },
          children: [
            c.jsx(u1, { size: 34 }),
            c.jsx("strong", {
              children: o.length
                ? `${o.length} file${o.length > 1 ? "s" : ""} selected`
                : "Drop files here, or browse",
            }),
            c.jsx("span", {
              children: o.length
                ? o.map((G) => G.name).join(", ")
                : "All file types welcome",
            }),
            c.jsx("input", {
              type: "file",
              multiple: !0,
              onChange: (G) => _(Array.from(G.target.files || [])),
              "aria-label": "Choose files",
            }),
          ],
        }),
        c.jsxs("label", {
          children: [
            "Storage destination",
            c.jsxs("select", {
              value: C,
              onChange: (G) => B(G.target.value),
              required: !0,
              children: [
                c.jsx("option", {
                  value: "",
                  disabled: !0,
                  children: "Choose a connector",
                }),
                S.filter((G) => G.enabled).map((G) =>
                  c.jsxs(
                    "option",
                    {
                      value: G.id,
                      disabled: G.kind !== "r2" && !G.credentials_configured,
                      children: [
                        G.name,
                        " · ",
                        formatBytes(
                          Math.max(
                            0,
                            G.limit_bytes - G.used_bytes - G.reserved_bytes,
                          ),
                        ),
                        " ",
                        "available",
                        G.kind !== "r2" && !G.credentials_configured
                          ? " · setup needed"
                          : "",
                      ],
                    },
                    G.id,
                  ),
                ),
              ],
            }),
          ],
        }),
        k &&
          c.jsxs("div", {
            className: "info",
            children: [
              c.jsx(vu, { size: 18 }),
              c.jsxs("span", {
                children: [
                  k.retention_days
                    ? `Files are kept for ${k.retention_days} days. `
                    : "No time-based expiry. ",
                  "If this storage reaches its ",
                  formatBytes(k.limit_bytes),
                  " limit, its oldest files are deleted to make room. Deleted files and their shares cannot be recovered.",
                ],
              }),
            ],
          }),
        c.jsx(ErrorMessage, { error: J }),
        c.jsxs("button", {
          type: "submit",
          className: "button primary full",
          disabled: M || !C || !o.length,
          children: [
            M
              ? "Preparing uploads…"
              : `Upload${o.length ? " " + formatBytes(o.reduce((G, $) => G + $.size, 0)) : ""}`,
            c.jsx($i, { size: 17 }),
          ],
        }),
      ],
    }),
  });
}
function ShareDialog({ file: S, onClose: v, onChanged: T }) {
  const [collaboration, setCollaboration] = D.useState(false);
  const [o, _] = D.useState(""),
    [C, B] = D.useState(7),
    [M, R] = D.useState(!0),
    [J, A] = D.useState(!1),
    [j, N] = D.useState(""),
    [k, xe] = D.useState(),
    [G, $] = D.useState(!1),
    [ye, oe] = D.useState([]),
    [sl, Qe] = D.useState(!1);
  async function Ae() {
    try {
      (oe((await api(`/files/${S.id}/shares`)).shares), Qe(!0));
    } catch (V) {
      N(V.message);
    }
  }
  async function De(V) {
    (V.preventDefault(), A(!0), N(""));
    try {
      const Me = await post(`/files/${S.id}/shares`, {
        recipients: o.split(/[,;\s]+/).filter(Boolean),
        expiresDays: C,
        sendEmail: M,
      });
      (xe(Me), T());
    } catch (Me) {
      N(Me.message);
    } finally {
      A(!1);
    }
  }
  async function W(V) {
    try {
      (await api(`/shares/${V}`, { method: "DELETE" }), await Ae(), T());
    } catch (Me) {
      N(Me.message);
    }
  }
  if (collaboration)
    return c.jsx(InvitationDialog, {
      kind: "collaboration",
      source: S,
      onClose: v,
      onSaved: T,
    });
  return c.jsxs(Modal, {
    title: k ? "Ready to share" : "A file. The right people.",
    subtitle: S.name,
    onClose: v,
    children: [
      !k &&
        c.jsx("button", {
          type: "button",
          className: "button secondary full",
          onClick: () => setCollaboration(true),
          children: "Share for collaboration instead",
        }),
      k
        ? c.jsxs(c.Fragment, {
            children: [
              c.jsxs("div", {
                className: "share-code",
                children: [
                  c.jsx("span", { children: "FILE ACCESS CODE" }),
                  c.jsx("strong", {
                    children: k.code.match(/.{1,4}/g)?.join(" "),
                  }),
                  c.jsxs("small", {
                    children: ["Expires ", formatDate(k.expiresAt)],
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "Share link",
                  c.jsxs("div", {
                    className: "copy-field",
                    children: [
                      c.jsx("input", { readOnly: !0, value: k.link }),
                      c.jsx("button", {
                        className: "icon-button",
                        "aria-label": "Copy share link",
                        onClick: () => {
                          navigator.clipboard
                            .writeText(
                              `${k.link}
Access code: ${k.code}`,
                            )
                            .then(() => $(!0))
                            .catch(() =>
                              N(
                                "Copy is unavailable. Select the link manually.",
                              ),
                            );
                        },
                        children: G
                          ? c.jsx(ki, { size: 18 })
                          : c.jsx(i1, { size: 18 }),
                      }),
                    ],
                  }),
                ],
              }),
              c.jsxs("p", {
                className: "info",
                children: [
                  c.jsx(Gm, { size: 18 }),
                  k.emailError ||
                    (k.developmentEmail
                      ? "Email simulated locally. Copy the link for testing."
                      : k.emailSent
                        ? "Email sent to your recipients. They’ll verify their address before downloading."
                        : "Copy this link and send it to your recipients. They’ll verify their address before downloading."),
                ],
              }),
              c.jsx("button", {
                className: "button primary full",
                onClick: v,
                children: "Done",
              }),
            ],
          })
        : c.jsxs("form", {
            onSubmit: De,
            children: [
              c.jsxs("label", {
                children: [
                  "Recipient email addresses",
                  c.jsx("textarea", {
                    required: !0,
                    rows: 3,
                    value: o,
                    onChange: (V) => _(V.target.value),
                    placeholder: "alex@company.com, sam@company.com",
                  }),
                  c.jsx("small", {
                    children:
                      "Separate addresses with commas. Up to 20 recipients.",
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "Share expires in",
                  c.jsxs("select", {
                    value: C,
                    onChange: (V) => B(Number(V.target.value)),
                    children: [
                      c.jsx("option", { value: 1, children: "1 day" }),
                      c.jsx("option", { value: 7, children: "7 days" }),
                      c.jsx("option", { value: 30, children: "30 days" }),
                      c.jsx("option", { value: 90, children: "90 days" }),
                    ],
                  }),
                ],
              }),
              c.jsxs("label", {
                className: "check-label",
                children: [
                  c.jsx("input", {
                    type: "checkbox",
                    checked: M,
                    onChange: (V) => R(V.target.checked),
                  }),
                  c.jsxs("span", {
                    children: [
                      c.jsx("strong", {
                        children: "Email the link automatically",
                      }),
                      c.jsx("small", {
                        children:
                          "Turn off to copy the link and send it yourself.",
                      }),
                    ],
                  }),
                ],
              }),
              c.jsxs("button", {
                type: "submit",
                className: "button primary full",
                disabled: J,
                children: [
                  J ? "Creating share…" : "Create share",
                  c.jsx(Fi, { size: 17 }),
                ],
              }),
              c.jsx("p", {
                className: "fineprint",
                children:
                  "File deletion or storage retention invalidates this code immediately.",
              }),
            ],
          }),
      c.jsx(ErrorMessage, { error: j }),
      c.jsxs("div", {
        className: "existing-shares",
        children: [
          c.jsx("button", {
            className: "text-button",
            onClick: () => {
              Ae();
            },
            children: "Manage existing shares",
          }),
          sl &&
            (ye.length
              ? ye.map((V) =>
                  c.jsxs(
                    "div",
                    {
                      className: "existing-share",
                      children: [
                        c.jsxs("div", {
                          children: [
                            c.jsx("strong", {
                              children: V.recipients.join(", "),
                            }),
                            c.jsx("small", {
                              children: V.revoked_at
                                ? "Revoked"
                                : `Expires ${formatDate(V.expires_at)}`,
                            }),
                          ],
                        }),
                        !V.revoked_at &&
                          c.jsx("button", {
                            className: "text-button danger",
                            onClick: () => {
                              W(V.id);
                            },
                            children: "Revoke",
                          }),
                      ],
                    },
                    V.id,
                  ),
                )
              : c.jsx("p", {
                  className: "muted",
                  children: "No existing shares.",
                })),
        ],
      }),
    ],
  });
}
function ConfirmDialog({ title: S, message: v, onClose: T, onConfirm: o }) {
  const [_, C] = D.useState(!1),
    [B, M] = D.useState("");
  return c.jsxs(Modal, {
    title: S,
    subtitle: v,
    onClose: () => {
      _ || T();
    },
    children: [
      c.jsx(ErrorMessage, { error: B }),
      c.jsxs("div", {
        className: "actions",
        children: [
          c.jsx("button", {
            className: "button secondary",
            onClick: T,
            disabled: _,
            children: "Cancel",
          }),
          c.jsx("button", {
            className: "button destructive",
            disabled: _,
            onClick: async () => {
              C(!0);
              try {
                (await o(), T());
              } catch (R) {
                M(R.message);
              } finally {
                C(!1);
              }
            },
            children: _ ? "Working…" : "Confirm",
          }),
        ],
      }),
    ],
  });
}
function StoragePanel({ connectors: S, isAdmin: v, onChanged: T }) {
  const [o, _] = D.useState(),
    [C, B] = D.useState(""),
    [M, R] = D.useState({});
  async function J(A) {
    B(A.id);
    try {
      const j = await api(`/admin/connectors/${A.id}/test`, { method: "POST" });
      R((N) => ({ ...N, [A.id]: { ok: !0, message: j.message } }));
    } catch (j) {
      R((N) => ({ ...N, [A.id]: { ok: !1, message: j.message } }));
    } finally {
      B("");
    }
  }
  return c.jsxs(c.Fragment, {
    children: [
      c.jsxs("div", {
        className: "section-heading",
        children: [
          c.jsxs("div", {
            children: [
              c.jsx("span", {
                className: "eyebrow",
                children: "YOUR STORAGE NETWORK",
              }),
              c.jsx("h1", { children: "A place for every file." }),
              c.jsx("p", {
                className: "muted",
                children:
                  "Pick the storage that fits. Each destination has its own capacity and retention policy.",
              }),
            ],
          }),
          v &&
            c.jsxs("button", {
              className: "button primary",
              onClick: () => _(null),
              children: [c.jsx(Qf, { size: 17 }), "Add connector"],
            }),
        ],
      }),
      c.jsx("div", {
        className: "connector-grid",
        children: S.map((A) =>
          c.jsxs(
            "article",
            {
              className: "connector-card",
              children: [
                c.jsxs("div", {
                  className: "connector-top",
                  children: [
                    c.jsx("div", {
                      className: `storage-symbol ${A.kind}`,
                      children:
                        A.kind === "synology" || A.kind === "webdav"
                          ? c.jsx(Ym, { size: 26 })
                          : c.jsx(vu, { size: 26 }),
                    }),
                    c.jsx("span", {
                      className: `pill ${A.enabled ? "green" : "gray"}`,
                      children: A.enabled
                        ? A.kind !== "r2" && !A.credentials_configured
                          ? "Setup needed"
                          : A.kind === "r2"
                            ? "Ready"
                            : "Configured"
                        : "Disabled",
                    }),
                  ],
                }),
                c.jsx("h2", { children: A.name }),
                c.jsx("p", {
                  className: "muted",
                  children:
                    A.kind === "onedrive"
                      ? "OneDrive for Business · private application storage"
                      : A.kind === "r2"
                        ? "Cloudflare R2 object storage"
                        : A.kind === "s3"
                          ? "S3-compatible object storage"
                          : A.kind === "synology"
                            ? "Synology · WebDAV through Cloudflare"
                            : A.kind === "webdav"
                              ? "WebDAV · AliPan and other drives"
                              : "AliPan · 阿里云盘",
                }),
                c.jsxs("div", {
                  className: "capacity-number",
                  children: [
                    c.jsx("strong", {
                      children: formatBytes(A.used_bytes + A.reserved_bytes),
                    }),
                    c.jsxs("span", {
                      children: ["of ", formatBytes(A.limit_bytes)],
                    }),
                  ],
                }),
                c.jsx("div", {
                  className: "progress-bar",
                  children: c.jsx("i", {
                    style: {
                      width: `${Math.min(100, ((A.used_bytes + A.reserved_bytes) / A.limit_bytes) * 100)}%`,
                    },
                  }),
                }),
                c.jsxs("dl", {
                  children: [
                    c.jsxs("div", {
                      children: [
                        c.jsx("dt", { children: "Files stored" }),
                        c.jsx("dd", { children: A.file_count }),
                      ],
                    }),
                    c.jsxs("div", {
                      children: [
                        c.jsx("dt", { children: "Reserved for uploads" }),
                        c.jsx("dd", {
                          children: formatBytes(A.reserved_bytes),
                        }),
                      ],
                    }),
                    c.jsxs("div", {
                      children: [
                        c.jsx("dt", { children: "Time retention" }),
                        c.jsx("dd", {
                          children: A.retention_days
                            ? `${A.retention_days} days`
                            : "No time limit",
                        }),
                      ],
                    }),
                    c.jsxs("div", {
                      children: [
                        c.jsx("dt", { children: "At capacity" }),
                        c.jsx("dd", { children: "Oldest files deleted first" }),
                      ],
                    }),
                  ],
                }),
                v &&
                  c.jsxs("button", {
                    className: "button secondary full",
                    onClick: () => _(A),
                    children: [c.jsx(Vm, { size: 16 }), "Manage connector"],
                  }),
                v &&
                  (A.kind === "webdav" || A.kind === "synology") &&
                  c.jsxs(c.Fragment, {
                    children: [
                      c.jsx("button", {
                        className: "button secondary full",
                        disabled: !!C || !A.credentials_configured,
                        onClick: () => J(A),
                        children: C === A.id ? "Checking…" : "Check connection",
                      }),
                      M[A.id] &&
                        c.jsx("p", {
                          role: "status",
                          className: M[A.id].ok ? "fineprint" : "error",
                          children: M[A.id].message,
                        }),
                    ],
                  }),
              ],
            },
            A.id,
          ),
        ),
      }),
      o !== void 0 &&
        c.jsx(ConnectorDialog, {
          connector: o,
          onClose: () => _(void 0),
          onSaved: () => {
            (_(void 0), T());
          },
        }),
    ],
  });
}
function ConnectorDialog({ connector: S, onClose: v, onSaved: T }) {
  const [o, _] = D.useState(S?.name || ""),
    [C, B] = D.useState(S?.kind || "r2"),
    [M, R] = D.useState(String((S?.limit_bytes || 1e10) / 1e9)),
    [J, A] = D.useState(S?.retention_days ? String(S.retention_days) : ""),
    [j, N] = D.useState(S ? !!S.enabled : !0),
    [k, xe] = D.useState(S?.config?.driveId || ""),
    [G, $] = D.useState(S?.config?.folderId || "root"),
    [ye, oe] = D.useState(S?.config?.endpoint || ""),
    [sl, Qe] = D.useState(S?.config?.bucket || ""),
    [Ae, De] = D.useState(S?.config?.region || "auto"),
    [W, V] = D.useState(""),
    [Me, Ve] = D.useState(""),
    [Le, Ze] = D.useState(""),
    [il, xl] = D.useState(""),
    [_e, w] = D.useState(""),
    [K, Z] = D.useState(""),
    [ne, fe] = D.useState(""),
    [$e, fl] = D.useState(""),
    [ml, d] = D.useState(""),
    [O, x] = D.useState(!1),
    [q, ue] = D.useState(!1),
    [re, de] = D.useState("");
  async function Q(U) {
    (U.preventDefault(), ue(!0), de(""));
    try {
      (await api(`/admin/connectors${S ? "/" + S.id : ""}`, {
        method: S ? "PUT" : "POST",
        body: JSON.stringify({
          name: o,
          kind: C,
          limitBytes: Math.round(Number(M) * 1e9),
          retentionDays: J ? Number(J) : null,
          enabled: j,
          driveId: k,
          folderId: G,
          endpoint: ye,
          bucket: sl,
          region: Ae,
          confirmSameStorage: O,
          ...(C === "s3" && (W || Me)
            ? { credentials: { accessKeyId: W, secretAccessKey: Me } }
            : {}),
          ...(C === "alipan" && (Le || il || _e)
            ? {
                credentials: {
                  clientId: Le,
                  clientSecret: il,
                  refreshToken: _e,
                },
              }
            : {}),
          ...((C === "synology" || C === "webdav") && (K || ne || $e || ml)
            ? {
                credentials: {
                  username: K,
                  password: ne,
                  accessClientId: $e,
                  accessClientSecret: ml,
                },
              }
            : {}),
        }),
      }),
        T());
    } catch (Vl) {
      de(Vl.message);
    } finally {
      ue(!1);
    }
  }
  if (C === "onedrive")
    return c.jsx(OneDriveDialog, {
      connector: S,
      onClose: v,
      onSaved: T,
      onBack: () => B("r2"),
    });
  return c.jsx(Modal, {
    title: S ? "Manage storage" : "Connect a destination",
    subtitle:
      "Storage limits apply to File Station’s own files. Capacity eviction removes the oldest files permanently.",
    onClose: v,
    children: c.jsxs("form", {
      onSubmit: Q,
      children: [
        c.jsxs("label", {
          children: [
            "Name",
            c.jsx("input", {
              required: !0,
              value: o,
              onChange: (U) => _(U.target.value),
              placeholder: "Team storage",
            }),
          ],
        }),
        c.jsxs("div", {
          className: "field-row",
          children: [
            c.jsxs("label", {
              children: [
                "Provider",
                c.jsxs("select", {
                  "aria-label": "Provider",
                  disabled: !!S,
                  value: C,
                  onChange: (U) => B(U.target.value),
                  children: [
                    c.jsx("option", {
                      value: "onedrive",
                      children: "OneDrive for Business",
                    }),
                    c.jsx("option", { value: "r2", children: "Cloudflare R2" }),
                    c.jsx("option", {
                      value: "alipan",
                      children: "AliPan / 阿里云盘",
                    }),
                    c.jsx("option", {
                      value: "s3",
                      children: "S3 compatible (R2, B2, Storj…)",
                    }),
                    c.jsx("option", {
                      value: "synology",
                      children: "Synology WebDAV (Cloudflare)",
                    }),
                    c.jsx("option", {
                      value: "webdav",
                      children: "WebDAV (AliPan and other drives)",
                    }),
                  ],
                }),
              ],
            }),
            c.jsxs("label", {
              children: [
                "Capacity (GB)",
                c.jsx("input", {
                  type: "number",
                  min: "0.001",
                  max: "5000",
                  step: "0.001",
                  value: M,
                  onChange: (U) => R(U.target.value),
                  required: !0,
                }),
              ],
            }),
          ],
        }),
        c.jsxs("label", {
          children: [
            "Retention in days",
            c.jsx("input", {
              type: "number",
              min: "1",
              max: "3650",
              value: J,
              onChange: (U) => A(U.target.value),
              placeholder: "Leave blank for no time limit",
            }),
          ],
        }),
        C === "alipan" &&
          c.jsxs(c.Fragment, {
            children: [
              c.jsxs("div", {
                className: "field-row",
                children: [
                  c.jsxs("label", {
                    children: [
                      "Drive ID",
                      c.jsx("input", {
                        required: !0,
                        value: k,
                        onChange: (U) => xe(U.target.value),
                      }),
                    ],
                  }),
                  c.jsxs("label", {
                    children: [
                      "Folder ID",
                      c.jsx("input", {
                        value: G,
                        onChange: (U) => $(U.target.value),
                      }),
                    ],
                  }),
                ],
              }),
              c.jsx("p", {
                className: "fineprint",
                children:
                  "Use the official AliPan Open API application credentials. Existing credentials stay unchanged when these fields are blank.",
              }),
              c.jsxs("label", {
                children: [
                  "Client ID",
                  c.jsx("input", {
                    autoComplete: "off",
                    value: Le,
                    onChange: (U) => Ze(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "Client secret",
                  c.jsx("input", {
                    type: "password",
                    autoComplete: "new-password",
                    value: il,
                    onChange: (U) => xl(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "Refresh token",
                  c.jsx("input", {
                    type: "password",
                    autoComplete: "new-password",
                    value: _e,
                    onChange: (U) => w(U.target.value),
                  }),
                ],
              }),
            ],
          }),
        C === "s3" &&
          c.jsxs(c.Fragment, {
            children: [
              c.jsxs("label", {
                children: [
                  "S3 HTTPS endpoint",
                  c.jsx("input", {
                    required: !0,
                    value: ye,
                    onChange: (U) => oe(U.target.value),
                    placeholder: "https://ACCOUNT_ID.r2.cloudflarestorage.com",
                  }),
                ],
              }),
              c.jsxs("p", {
                className: "fineprint",
                children: [
                  "A hostname without https:// is accepted. For Oracle, use",
                  " ",
                  "https://YOUR_NAMESPACE.compat.objectstorage.YOUR_REGION.oraclecloud.com or the equivalent .oci.customer-oci.com endpoint. Replace both placeholders with your account values and enter the bucket separately. An Oracle region set to auto is read from its endpoint.",
                ],
              }),
              c.jsxs("div", {
                className: "field-row",
                children: [
                  c.jsxs("label", {
                    children: [
                      "Bucket",
                      c.jsx("input", {
                        required: !0,
                        value: sl,
                        onChange: (U) => Qe(U.target.value),
                      }),
                      c.jsx("span", {
                        className: "fineprint",
                        children:
                          "Use the exact bucket name, including capitalization.",
                      }),
                    ],
                  }),
                  c.jsxs("label", {
                    children: [
                      "Region",
                      c.jsx("input", {
                        required: !0,
                        value: Ae,
                        onChange: (U) => De(U.target.value),
                        placeholder: "auto for R2",
                      }),
                    ],
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "Access key ID",
                  c.jsx("input", {
                    autoComplete: "off",
                    value: W,
                    onChange: (U) => V(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "Secret access key",
                  c.jsx("input", {
                    type: "password",
                    autoComplete: "new-password",
                    value: Me,
                    onChange: (U) => Ve(U.target.value),
                  }),
                ],
              }),
              c.jsx("p", {
                className: "fineprint",
                children:
                  "Keys are encrypted on the server. Blank fields preserve existing credentials. Use a dedicated File Station bucket; each connector has its own file prefix.",
              }),
            ],
          }),
        C === "r2" &&
          c.jsx("p", {
            className: "info",
            children:
              "R2 destinations use separate prefixes in the app’s Cloudflare bucket. No storage keys are needed.",
          }),
        (C === "synology" || C === "webdav") &&
          c.jsxs(c.Fragment, {
            children: [
              c.jsxs("label", {
                children: [
                  "WebDAV HTTPS folder URL",
                  c.jsx("input", {
                    required: !0,
                    type: "url",
                    value: ye,
                    onChange: (U) => oe(U.target.value),
                    placeholder:
                      C === "synology"
                        ? "https://nas.ch.localhosts.ltd/file-station/"
                        : "https://dav.example.com/",
                  }),
                ],
              }),
              c.jsx("p", {
                className: "fineprint",
                children:
                  "Use the WebDAV folder URL, with write and delete access. A DSM login page is not a WebDAV endpoint. Transfers use 8 MiB parts; storage contains chunk folders, while File Station downloads the original file.",
              }),
              c.jsxs("label", {
                children: [
                  "WebDAV username",
                  c.jsx("input", {
                    autoComplete: "off",
                    value: K,
                    onChange: (U) => Z(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "WebDAV password",
                  c.jsx("input", {
                    type: "password",
                    autoComplete: "new-password",
                    value: ne,
                    onChange: (U) => fe(U.target.value),
                  }),
                ],
              }),
              c.jsx("p", {
                className: "fineprint",
                children:
                  "For Cloudflare Access, create a service token and a Service Auth policy. Enter both fields below; browser login policies alone will block the Worker.",
              }),
              c.jsxs("label", {
                children: [
                  "Access service token client ID",
                  c.jsx("input", {
                    autoComplete: "off",
                    value: $e,
                    onChange: (U) => fl(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  "Access service token client secret",
                  c.jsx("input", {
                    type: "password",
                    autoComplete: "new-password",
                    value: ml,
                    onChange: (U) => d(U.target.value),
                  }),
                ],
              }),
              c.jsx("p", {
                className: "fineprint",
                children:
                  "Credentials are encrypted. Leave all four fields blank to preserve them; enter the complete set to replace them.",
              }),
              S &&
                c.jsxs("label", {
                  className: "check-label",
                  children: [
                    c.jsx("input", {
                      type: "checkbox",
                      checked: O,
                      onChange: (U) => x(U.target.checked),
                    }),
                    "I confirm a changed hostname points to the same WebDAV folder, with the same files.",
                  ],
                }),
            ],
          }),
        c.jsxs("label", {
          className: "check-label",
          children: [
            c.jsx("input", {
              type: "checkbox",
              checked: j,
              onChange: (U) => N(U.target.checked),
            }),
            "Allow new uploads to this connector",
          ],
        }),
        c.jsx(ErrorMessage, { error: re }),
        c.jsxs("button", {
          type: "submit",
          className: "button primary full",
          disabled: q,
          children: [c.jsx(Qm, { size: 17 }), q ? "Saving…" : "Save connector"],
        }),
      ],
    }),
  });
}
function UsersPanel({ current: S, onNotice: v }) {
  const [T, o] = D.useState([]),
    [_, C] = D.useState(""),
    [B, M] = D.useState(),
    [R, J] = D.useState("");
  async function A() {
    try {
      o((await api("/admin/users")).users);
    } catch (N) {
      C(N.message);
    }
  }
  D.useEffect(() => {
    A();
  }, []);
  async function j(N, k) {
    J(N.id);
    try {
      (await api(`/admin/users/${N.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: k }),
      }),
        await A(),
        v(
          k === "active"
            ? "User approved."
            : "User deactivated. Existing sign-in sessions were removed.",
        ));
    } catch (xe) {
      C(xe.message);
    } finally {
      J("");
    }
  }
  return c.jsxs(c.Fragment, {
    children: [
      c.jsxs("div", {
        className: "section-heading",
        children: [
          c.jsxs("div", {
            children: [
              c.jsx("span", {
                className: "eyebrow",
                children: "ADMINISTRATION",
              }),
              c.jsx("h1", { children: "The people at your station." }),
              c.jsx("p", {
                className: "muted",
                children: "Approve new accounts and manage access.",
              }),
            ],
          }),
          c.jsxs("div", {
            className: "stat-inline",
            children: [
              c.jsx("strong", {
                children: T.filter((N) => N.status === "pending").length,
              }),
              c.jsx("span", { children: "awaiting approval" }),
            ],
          }),
        ],
      }),
      c.jsx(ErrorMessage, { error: _ }),
      c.jsx("div", {
        className: "table-shell",
        children: c.jsxs("table", {
          children: [
            c.jsx("thead", {
              children: c.jsxs("tr", {
                children: [
                  c.jsx("th", { children: "User" }),
                  c.jsx("th", { children: "Role" }),
                  c.jsx("th", { children: "Status" }),
                  c.jsx("th", { children: "Joined" }),
                  c.jsx("th", { children: "Actions" }),
                ],
              }),
            }),
            c.jsx("tbody", {
              children: T.filter((N) => N.status !== "deleted").map((N) =>
                c.jsxs(
                  "tr",
                  {
                    children: [
                      c.jsx("td", {
                        children: c.jsxs("div", {
                          className: "user-cell",
                          children: [
                            c.jsx("span", {
                              className: "avatar",
                              children: N.email.slice(0, 2).toUpperCase(),
                            }),
                            c.jsx("strong", { children: N.email }),
                            N.id === S.id &&
                              c.jsx("small", { children: "You" }),
                          ],
                        }),
                      }),
                      c.jsx("td", { children: N.role }),
                      c.jsx("td", {
                        children: c.jsx("span", {
                          className: `pill ${N.status === "active" ? "green" : N.status === "pending" ? "amber" : "gray"}`,
                          children: N.status,
                        }),
                      }),
                      c.jsx("td", { children: formatDate(N.created_at) }),
                      c.jsx("td", {
                        children:
                          N.role !== "admin" &&
                          c.jsxs("div", {
                            className: "row-actions",
                            children: [
                              c.jsx("button", {
                                className: "icon-button",
                                disabled: R === N.id,
                                title:
                                  N.status === "active"
                                    ? "Deactivate"
                                    : "Approve / reactivate",
                                "aria-label":
                                  N.status === "active"
                                    ? "Deactivate " + N.email
                                    : "Approve " + N.email,
                                onClick: () => {
                                  j(
                                    N,
                                    N.status === "active"
                                      ? "inactive"
                                      : "active",
                                  );
                                },
                                children:
                                  N.status === "active"
                                    ? c.jsx(g1, { size: 17 })
                                    : c.jsx(y1, { size: 17 }),
                              }),
                              c.jsx("button", {
                                className: "icon-button danger",
                                title: "Delete user and files",
                                "aria-label": "Delete " + N.email,
                                onClick: () => M(N),
                                children: c.jsx(Lm, { size: 17 }),
                              }),
                            ],
                          }),
                      }),
                    ],
                  },
                  N.id,
                ),
              ),
            }),
          ],
        }),
      }),
      B &&
        c.jsx(ConfirmDialog, {
          title: "Delete this account?",
          message: `This deactivates ${B.email}, permanently deletes all their files, and invalidates their shares.`,
          onClose: () => M(void 0),
          onConfirm: async () => {
            (await api(`/admin/users/${B.id}`, { method: "DELETE" }),
              await A(),
              v("Account and files deleted."));
          },
        }),
    ],
  });
}
function SettingsPanel({ onNotice: S }) {
  const [v, T] = D.useState(""),
    [o, _] = D.useState(!1),
    [C, B] = D.useState(""),
    [M, R] = D.useState(!1),
    [J, A] = D.useState([]);
  D.useEffect(() => {
    (api("/admin/settings")
      .then((N) => {
        (T(
          N.allowedDomains.join(`
`),
        ),
          R(!0));
      })
      .catch((N) => B(N.message)),
      api("/admin/audit")
        .then((N) => A(N.events))
        .catch((N) => B(N.message)));
  }, []);
  async function j(N) {
    (N.preventDefault(), _(!0));
    try {
      (await api("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          allowedDomains: v.split(/[\s,;]+/).filter(Boolean),
        }),
      }),
        S("Automatic approval domains saved."));
    } catch (k) {
      B(k.message);
    } finally {
      _(!1);
    }
  }
  return c.jsxs(c.Fragment, {
    children: [
      c.jsx("div", {
        className: "section-heading",
        children: c.jsxs("div", {
          children: [
            c.jsx("span", { className: "eyebrow", children: "ADMINISTRATION" }),
            c.jsx("h1", { children: "Set the ground rules." }),
            c.jsx("p", {
              className: "muted",
              children: "Account approval and a record of activity.",
            }),
          ],
        }),
      }),
      c.jsxs("div", {
        className: "settings-grid",
        children: [
          c.jsxs("section", {
            className: "panel",
            children: [
              c.jsx("div", {
                className: "panel-icon",
                children: c.jsx(yu, { size: 23 }),
              }),
              c.jsx("h2", { children: "Automatic approval" }),
              c.jsx("p", {
                className: "muted",
                children:
                  "New users with a verified email at these exact domains are approved automatically. Other users wait for an administrator.",
              }),
              c.jsxs("form", {
                onSubmit: j,
                children: [
                  c.jsxs("label", {
                    children: [
                      "Allowed email domains",
                      c.jsx("textarea", {
                        rows: 5,
                        value: v,
                        onChange: (N) => T(N.target.value),
                        placeholder: "international.gc.ca",
                        disabled: !M,
                      }),
                      c.jsx("small", {
                        children:
                          "One domain per line. Subdomains are not automatically included. Existing accounts are unchanged.",
                      }),
                    ],
                  }),
                  c.jsx(ErrorMessage, { error: C }),
                  c.jsxs("button", {
                    type: "submit",
                    className: "button primary",
                    disabled: o || !M,
                    children: [
                      c.jsx(Qm, { size: 17 }),
                      o ? "Saving…" : "Save domains",
                    ],
                  }),
                ],
              }),
            ],
          }),
          c.jsxs("section", {
            className: "panel",
            children: [
              c.jsx("h2", { children: "Recent activity" }),
              c.jsx("div", {
                className: "audit-list",
                children: J.length
                  ? J.map((N) =>
                      c.jsxs(
                        "div",
                        {
                          children: [
                            c.jsx("span", { className: "audit-dot" }),
                            c.jsxs("div", {
                              children: [
                                c.jsx("strong", {
                                  children: N.action.replace(/[._]/g, " "),
                                }),
                                c.jsxs("small", {
                                  children: [
                                    N.actor_email || "Retention service",
                                    " · ",
                                    formatDate(N.created_at),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        },
                        N.id,
                      ),
                    )
                  : c.jsx("p", {
                      className: "muted",
                      children:
                        "Activity will appear here as people use File Station.",
                    }),
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
const userNavigation = [
    { page: "files", label: "My files", icon: Xf },
    { page: "shared", label: "Shared by me", icon: Fi },
    { page: "access", label: "Use an access code", icon: Fi },
    { page: "requests", label: "File requests", icon: v1 },
    { page: "collaborations", label: "Collaborations", icon: qm },
    { page: "transfers", label: "Transfers", icon: gn },
    { page: "storage", label: "Storage", icon: Ym },
  ],
  adminNavigation = [
    { page: "users", label: "User management", icon: S1 },
    { page: "allfiles", label: "All files", icon: Bm },
    { page: "settings", label: "Settings & activity", icon: Vm },
  ];
function Brand() {
  return c.jsxs("div", {
    className: "brand",
    children: [
      c.jsx("span", {
        className: "brand-mark",
        children: c.jsx(Bm, { size: 23 }),
      }),
      c.jsxs("span", {
        children: [
          "File Station",
          c.jsx("span", { className: "brand-dot", children: "." }),
        ],
      }),
    ],
  });
}
function FileIcon({ name: S }) {
  const v = S.split(".").at(-1)?.toLowerCase(),
    T = ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(v || "")
      ? s1
      : ["zip", "tar", "gz", "rar", "7z"].includes(v || "")
        ? c1
        : ["txt", "doc", "docx", "pdf", "md", "csv", "xlsx"].includes(v || "")
          ? qm
          : f1;
  return c.jsx("span", {
    className: `file-icon ${v === "pdf" ? "red" : ["png", "jpg", "jpeg"].includes(v || "") ? "purple" : ""}`,
    children: c.jsx(T, { size: 22 }),
  });
}
function App() {
  const [codeOpen, setCodeOpen] = D.useState(
    new URLSearchParams(location.hash.slice(1)).has("share"),
  );
  const [S, v] = D.useState(null),
    [T, o] = D.useState(!1),
    [_, C] = D.useState(!1),
    [B, M] = D.useState(!1),
    [R, J] = D.useState("files"),
    [A, j] = D.useState([]),
    [N, k] = D.useState([]),
    [xe, G] = D.useState(),
    [$, ye] = D.useState(),
    [oe, sl] = D.useState(),
    [Qe, Ae] = D.useState(""),
    [De, W] = D.useState(""),
    [V, Me] = D.useState(""),
    [Ve, Le] = D.useState("all"),
    [Ze, il] = D.useState(!1),
    [xl] = D.useState(
      () => new URLSearchParams(location.hash.slice(1)).get("share") || "",
    ),
    _e = D.useSyncExternalStore(transfers.subscribe, transfers.getSnapshot),
    w = transfers.items.filter((x) => x.state === "complete").length,
    K = transfers.items.filter((x) => x.state !== "complete").length;
  (D.useEffect(() => {
    (xl && history.replaceState(null, "", location.pathname),
      api("/me")
        .then((x) => v(x.user))
        .catch((x) => Ae(x.message))
        .finally(() => o(!0)));
  }, [xl]),
    D.useEffect(() => {
      transfers.setScope(S?.id || "guest");
    }, [S?.id]));
  async function Z() {
    if (S) {
      Ae("");
      try {
        const x = await api("/connectors");
        if ((j(x.connectors), S.status === "active")) {
          const q = await api(`/files${R === "allfiles" ? "?all=true" : ""}`);
          k(q.files);
        }
      } catch (x) {
        Ae(x.message);
      }
    }
  }
  (D.useEffect(() => {
    Z();
  }, [S, R, w]),
    D.useEffect(() => {
      if (!De) return;
      const x = setTimeout(() => W(""), 6e3);
      return () => clearTimeout(x);
    }, [De]));
  function ne(x) {
    W(x);
  }
  async function fe(x) {
    try {
      (await transfers.download(x),
        ne("Download started. Open Transfers to pause or resume."));
    } catch (q) {
      Ae(q.message);
    }
  }
  async function $e() {
    try {
      await post("/auth/logout");
      for (const x of transfers.items)
        x.state === "running" && transfers.pause(x.id);
      (v(null), k([]), j([]));
    } catch (x) {
      Ae(x.message);
    }
  }
  const fl = A.reduce((x, q) => x + q.limit_bytes, 0),
    ml = A.reduce((x, q) => x + q.used_bytes + q.reserved_bytes, 0),
    d = N.filter(
      (x) =>
        (R !== "shared" || x.share_count > 0) &&
        x.name.toLowerCase().includes(V.toLowerCase()) &&
        (Ve === "all" || x.connector_id === Ve),
    ),
    O = c.jsxs(c.Fragment, {
      children: [
        c.jsxs("div", {
          className: "file-tools",
          children: [
            c.jsxs("div", {
              className: "search-field",
              children: [
                c.jsx(m1, { size: 17 }),
                c.jsx("input", {
                  placeholder: "Search your files…",
                  "aria-label": "Search files",
                  value: V,
                  onChange: (x) => Me(x.target.value),
                }),
              ],
            }),
            c.jsxs("select", {
              "aria-label": "Filter by storage",
              value: Ve,
              onChange: (x) => Le(x.target.value),
              children: [
                c.jsx("option", { value: "all", children: "All storage" }),
                A.map((x) =>
                  c.jsx("option", { value: x.id, children: x.name }, x.id),
                ),
              ],
            }),
            c.jsx("button", {
              className: "icon-button",
              onClick: () => {
                Z();
              },
              "aria-label": "Refresh files",
              children: c.jsx(h1, { size: 17 }),
            }),
          ],
        }),
        c.jsxs("div", {
          className: "table-shell",
          children: [
            c.jsxs("table", {
              className: "files-table",
              children: [
                c.jsx("thead", {
                  children: c.jsxs("tr", {
                    children: [
                      c.jsxs("th", {
                        children: ["NAME ", c.jsx(Gf, { size: 12 })],
                      }),
                      c.jsx("th", { children: "STORAGE" }),
                      c.jsx("th", { children: "SIZE" }),
                      c.jsx("th", {
                        children: R === "allfiles" ? "OWNER" : "ADDED",
                      }),
                      c.jsx("th", { children: "KEEP UNTIL" }),
                      c.jsx("th", { "aria-label": "Actions" }),
                    ],
                  }),
                }),
                c.jsx("tbody", {
                  children: d.map((x) =>
                    c.jsxs(
                      "tr",
                      {
                        children: [
                          c.jsx("td", {
                            children: c.jsxs("div", {
                              className: "file-name",
                              children: [
                                c.jsx(FileIcon, { name: x.name }),
                                c.jsxs("div", {
                                  children: [
                                    c.jsx("strong", {
                                      title: x.name,
                                      children: x.name,
                                    }),
                                    c.jsx("small", {
                                      children:
                                        x.state === "uploading"
                                          ? "Upload in progress"
                                          : x.share_count
                                            ? `${x.share_count} active share${x.share_count > 1 ? "s" : ""}`
                                            : x.mime || "File",
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          }),
                          c.jsx("td", {
                            children: c.jsxs("span", {
                              className: "storage-tag",
                              children: [
                                c.jsx("span", {
                                  className: `storage-dot ${A.find((q) => q.id === x.connector_id)?.kind}`,
                                }),
                                x.connector_name,
                              ],
                            }),
                          }),
                          c.jsx("td", { children: formatBytes(x.size) }),
                          c.jsx("td", {
                            children:
                              R === "allfiles"
                                ? x.owner_email
                                : formatDate(x.created_at),
                          }),
                          c.jsx("td", {
                            children:
                              x.state === "uploading"
                                ? "—"
                                : formatDate(x.expires_at),
                          }),
                          c.jsx("td", {
                            children: c.jsxs("div", {
                              className: "row-actions",
                              children: [
                                x.state === "ready"
                                  ? c.jsxs(c.Fragment, {
                                      children: [
                                        c.jsx("button", {
                                          className: "icon-button",
                                          "aria-label": "Download " + x.name,
                                          title: "Resumable download",
                                          onClick: () => {
                                            fe(x);
                                          },
                                          children: c.jsx(gn, { size: 17 }),
                                        }),
                                        canDirectDownload(x) &&
                                          c.jsx("a", {
                                            className: "icon-button",
                                            "aria-label":
                                              "Direct browser download " +
                                              x.name,
                                            title: "Direct browser download",
                                            href: `${basePath}/api/files/${x.id}/download`,
                                            children: c.jsx(Gf, { size: 17 }),
                                          }),
                                        c.jsx("button", {
                                          className: "icon-button",
                                          "aria-label": "Share " + x.name,
                                          title: "Share file",
                                          onClick: () => G(x),
                                          children: c.jsx(Fi, { size: 17 }),
                                        }),
                                      ],
                                    })
                                  : c.jsx("button", {
                                      className: "icon-button",
                                      title: "Go to transfers",
                                      "aria-label": "Go to transfers",
                                      onClick: () => J("transfers"),
                                      children: c.jsx(v1, { size: 17 }),
                                    }),
                                c.jsx("button", {
                                  className: "icon-button danger",
                                  "aria-label": "Delete " + x.name,
                                  title: "Delete file",
                                  onClick: () => ye(x),
                                  children: c.jsx(Lm, { size: 16 }),
                                }),
                              ],
                            }),
                          }),
                        ],
                      },
                      x.id,
                    ),
                  ),
                }),
              ],
            }),
            !d.length &&
              c.jsxs("div", {
                className: "empty-state",
                children: [
                  c.jsx("div", {
                    className: "empty-icon",
                    children: c.jsx(Xf, { size: 34 }),
                  }),
                  c.jsx("h3", {
                    children: V
                      ? "No matching files"
                      : R === "shared"
                        ? "Your next handoff starts here."
                        : "Make yourself at home.",
                  }),
                  c.jsx("p", {
                    children: V
                      ? "Try another name or storage destination."
                      : R === "shared"
                        ? "Create a share from any uploaded file."
                        : "Upload a file, choose a destination, and send it to the right people.",
                  }),
                  !V &&
                    R !== "shared" &&
                    c.jsxs("button", {
                      className: "button primary",
                      onClick: () => M(!0),
                      children: [
                        c.jsx(Qf, { size: 16 }),
                        "Upload your first file",
                      ],
                    }),
                ],
              }),
          ],
        }),
        c.jsxs("p", {
          className: "table-foot",
          children: [
            "Showing ",
            d.length,
            " file",
            d.length !== 1 ? "s" : "",
            N.length === 500 ? " · Latest 500 files" : "",
            c.jsxs("span", {
              children: [
                c.jsx(yu, { size: 14 }),
                " Files stay private until you share them",
              ],
            }),
          ],
        }),
      ],
    });
  return c.jsxs(c.Fragment, {
    children: [
      T
        ? S
          ? c.jsxs("div", {
              className: "app-layout",
              children: [
                c.jsxs("aside", {
                  className: `sidebar ${Ze ? "open" : ""}`,
                  children: [
                    c.jsx(Brand, {}),
                    c.jsx("div", {
                      className: "workspace-label",
                      children: "YOUR WORKSPACE",
                    }),
                    c.jsxs("nav", {
                      children: [
                        userNavigation.map((x) =>
                          c.jsxs(
                            "button",
                            {
                              className: R === x.page ? "selected" : "",
                              onClick: () => {
                                (J(x.page), il(!1));
                              },
                              children: [
                                c.jsx(x.icon, { size: 18 }),
                                x.label,
                                x.page === "transfers" &&
                                  K > 0 &&
                                  c.jsx("span", {
                                    className: "nav-count",
                                    children: K,
                                  }),
                              ],
                            },
                            x.page,
                          ),
                        ),
                        S.role === "admin" &&
                          c.jsxs(c.Fragment, {
                            children: [
                              c.jsx("div", {
                                className: "workspace-label admin-label",
                                children: "ADMINISTRATION",
                              }),
                              adminNavigation.map((x) =>
                                c.jsxs(
                                  "button",
                                  {
                                    className: R === x.page ? "selected" : "",
                                    onClick: () => {
                                      (J(x.page), il(!1));
                                    },
                                    children: [
                                      c.jsx(x.icon, { size: 18 }),
                                      x.label,
                                    ],
                                  },
                                  x.page,
                                ),
                              ),
                            ],
                          }),
                      ],
                    }),
                    c.jsxs("div", {
                      className: "sidebar-bottom",
                      children: [
                        c.jsxs("div", {
                          className: "sidebar-storage",
                          children: [
                            c.jsxs("div", {
                              children: [
                                c.jsx(vu, { size: 16 }),
                                c.jsx("strong", {
                                  children: "Room for your ideas",
                                }),
                              ],
                            }),
                            c.jsx("div", {
                              className: "progress-bar",
                              children: c.jsx("i", {
                                style: {
                                  width: `${fl ? Math.min(100, (ml / fl) * 100) : 0}%`,
                                },
                              }),
                            }),
                            c.jsxs("small", {
                              children: [
                                formatBytes(ml),
                                " of ",
                                formatBytes(fl),
                                " used",
                              ],
                            }),
                            c.jsxs("button", {
                              className: "text-button",
                              onClick: () => J("storage"),
                              children: [
                                "View storage",
                                c.jsx(Am, { size: 14 }),
                              ],
                            }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "sidebar-footer",
                          children: [
                            c.jsx("span", { className: "tiny-dot" }),
                            " WELL CONNECTED",
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                c.jsxs("div", {
                  className: "app-main",
                  children: [
                    c.jsxs("header", {
                      className: "app-header",
                      children: [
                        c.jsxs("div", {
                          children: [
                            c.jsx("button", {
                              className: "icon-button mobile-menu",
                              onClick: () => il(!Ze),
                              "aria-label": "Toggle navigation",
                              children: c.jsx(r1, { size: 20 }),
                            }),
                            c.jsxs("span", {
                              className: "breadcrumb",
                              children: [
                                "Workspace",
                                c.jsx(Am, { size: 14 }),
                                c.jsx("strong", {
                                  children: [
                                    ...userNavigation,
                                    ...adminNavigation,
                                  ].find((x) => x.page === R)?.label,
                                }),
                              ],
                            }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "account",
                          children: [
                            c.jsxs("span", {
                              className: "account-text",
                              children: [
                                S.email,
                                c.jsx("small", {
                                  children:
                                    S.role === "admin"
                                      ? "Administrator"
                                      : "Personal workspace",
                                }),
                              ],
                            }),
                            c.jsx("span", {
                              className: "avatar",
                              children: S.email.slice(0, 2).toUpperCase(),
                            }),
                            c.jsx("button", {
                              className: "icon-button",
                              onClick: () => {
                                $e();
                              },
                              title: "Sign out",
                              "aria-label": "Sign out",
                              children: c.jsx(o1, { size: 17 }),
                            }),
                          ],
                        }),
                      ],
                    }),
                    c.jsxs("main", {
                      className: "workspace",
                      children: [
                        c.jsx(ErrorMessage, { error: Qe }),
                        S.status !== "active"
                          ? c.jsxs("section", {
                              className: "pending panel",
                              children: [
                                c.jsx(yu, { size: 42 }),
                                c.jsx("h1", {
                                  children: "You're on the list.",
                                }),
                                c.jsx("p", {
                                  children:
                                    "Your email is verified. An administrator needs to approve your account before you can upload or manage files.",
                                }),
                                c.jsx("button", {
                                  className: "button secondary",
                                  onClick: () => {
                                    api("/me")
                                      .then((x) => v(x.user))
                                      .catch((x) => Ae(x.message));
                                  },
                                  children: "Check approval status",
                                }),
                              ],
                            })
                          : c.jsxs(c.Fragment, {
                              children: [
                                ["files", "shared", "allfiles"].includes(R) &&
                                  c.jsxs(c.Fragment, {
                                    children: [
                                      c.jsxs("div", {
                                        className: "section-heading",
                                        children: [
                                          c.jsxs("div", {
                                            children: [
                                              c.jsx("span", {
                                                className: "eyebrow",
                                                children:
                                                  R === "allfiles"
                                                    ? "ADMINISTRATION"
                                                    : "A LITTLE ORDER. A LOT OF POSSIBILITY.",
                                              }),
                                              c.jsx("h1", {
                                                children:
                                                  R === "shared"
                                                    ? "Good things, passed along."
                                                    : R === "allfiles"
                                                      ? "Every file at your station."
                                                      : "Your files, right at home.",
                                              }),
                                              c.jsx("p", {
                                                className: "muted",
                                                children:
                                                  R === "shared"
                                                    ? "Manage the files you’ve shared and the people who can access them."
                                                    : R === "allfiles"
                                                      ? "Manage all users’ files and sharing permissions."
                                                      : "Everything you’ve uploaded, with room for what’s next.",
                                              }),
                                            ],
                                          }),
                                          c.jsxs("button", {
                                            className: "button primary",
                                            onClick: () => M(!0),
                                            children: [
                                              c.jsx(Qf, { size: 18 }),
                                              "Upload files",
                                            ],
                                          }),
                                        ],
                                      }),
                                      R === "files" &&
                                        c.jsxs("div", {
                                          className: "summary-grid",
                                          children: [
                                            c.jsxs("div", {
                                              className: "summary-card",
                                              children: [
                                                c.jsx("span", {
                                                  className: "summary-icon",
                                                  children: c.jsx(Xf, {
                                                    size: 22,
                                                  }),
                                                }),
                                                c.jsxs("div", {
                                                  children: [
                                                    c.jsx("span", {
                                                      children:
                                                        "Files in your station",
                                                    }),
                                                    c.jsxs("strong", {
                                                      children: [
                                                        N.filter(
                                                          (x) =>
                                                            x.state === "ready",
                                                        ).length,
                                                        c.jsx("small", {
                                                          children: "files",
                                                        }),
                                                      ],
                                                    }),
                                                  ],
                                                }),
                                              ],
                                            }),
                                            c.jsxs("div", {
                                              className: "summary-card",
                                              children: [
                                                c.jsx("span", {
                                                  className:
                                                    "summary-icon ochre",
                                                  children: c.jsx(Fi, {
                                                    size: 22,
                                                  }),
                                                }),
                                                c.jsxs("div", {
                                                  children: [
                                                    c.jsx("span", {
                                                      children:
                                                        "Active handoffs",
                                                    }),
                                                    c.jsxs("strong", {
                                                      children: [
                                                        N.reduce(
                                                          (x, q) =>
                                                            x + q.share_count,
                                                          0,
                                                        ),
                                                        c.jsx("small", {
                                                          children: "shares",
                                                        }),
                                                      ],
                                                    }),
                                                  ],
                                                }),
                                              ],
                                            }),
                                            c.jsxs("div", {
                                              className: "summary-card",
                                              children: [
                                                c.jsx("span", {
                                                  className:
                                                    "summary-icon blue",
                                                  children: c.jsx(vu, {
                                                    size: 22,
                                                  }),
                                                }),
                                                c.jsxs("div", {
                                                  children: [
                                                    c.jsx("span", {
                                                      children:
                                                        "Your files take up",
                                                    }),
                                                    c.jsx("strong", {
                                                      children: formatBytes(
                                                        N.reduce(
                                                          (x, q) => x + q.size,
                                                          0,
                                                        ),
                                                      ),
                                                    }),
                                                  ],
                                                }),
                                              ],
                                            }),
                                          ],
                                        }),
                                      O,
                                    ],
                                  }),
                                R === "access" &&
                                  c.jsx("section", {
                                    className: "panel",
                                    children: c.jsx(AccessForm, { onFile: sl }),
                                  }),
                                ["requests", "collaborations"].includes(R) &&
                                  c.jsx(InvitationManager, {
                                    kind:
                                      R === "requests"
                                        ? "submission"
                                        : "collaboration",
                                    connectors: A,
                                    files: N,
                                    user: S,
                                    onNotice: ne,
                                  }),
                                R === "storage" &&
                                  c.jsx(StoragePanel, {
                                    connectors: A,
                                    isAdmin: S.role === "admin",
                                    onChanged: () => {
                                      Z();
                                    },
                                  }),
                                " ",
                                R === "users" &&
                                  c.jsx(UsersPanel, {
                                    current: S,
                                    onNotice: ne,
                                  }),
                                " ",
                                R === "settings" &&
                                  c.jsx(SettingsPanel, { onNotice: ne }),
                                " ",
                                R === "transfers" &&
                                  c.jsxs(c.Fragment, {
                                    children: [
                                      c.jsx("div", {
                                        className: "section-heading",
                                        children: c.jsxs("div", {
                                          children: [
                                            c.jsx("span", {
                                              className: "eyebrow",
                                              children: "AT YOUR OWN PACE",
                                            }),
                                            c.jsx("h1", {
                                              children:
                                                "Every byte gets there.",
                                            }),
                                            c.jsx("p", {
                                              className: "muted",
                                              children:
                                                "Pause when you need to. Resume when you’re ready. After a refresh, reselect the original file to resume an upload.",
                                            }),
                                          ],
                                        }),
                                      }),
                                      c.jsx(TransfersPanel, {
                                        version: _e,
                                        onError: Ae,
                                      }),
                                    ],
                                  }),
                              ],
                            }),
                      ],
                    }),
                    c.jsxs("footer", {
                      className: "app-footer",
                      children: [
                        "A safe landing for every file.",
                        c.jsx("span", { children: "FILE STATION" }),
                      ],
                    }),
                  ],
                }),
              ],
            })
          : c.jsxs("div", {
              className: "landing",
              children: [
                c.jsxs("header", {
                  className: "public-header",
                  children: [
                    c.jsx(Brand, {}),
                    c.jsxs("div", {
                      children: [
                        c.jsx("span", {
                          className: "public-tag",
                          children: "A simpler way to send.",
                        }),
                        c.jsxs("button", {
                          className: "button secondary",
                          onClick: () => C(!0),
                          children: ["Sign in", c.jsx(zm, { size: 16 })],
                        }),
                      ],
                    }),
                  ],
                }),
                c.jsxs("main", {
                  className: "landing-main",
                  children: [
                    c.jsxs("div", {
                      className: "hero-copy",
                      children: [
                        c.jsxs("span", {
                          className: "eyebrow",
                          children: [
                            c.jsx("span", { className: "tiny-dot" }),
                            " FROM HERE TO THERE",
                          ],
                        }),
                        c.jsxs("h1", {
                          children: [
                            "Good files.",
                            c.jsx("br", {}),
                            "Great Mission.",
                            c.jsx("br", {}),
                            c.jsx("em", { children: "Easy sharing." }),
                          ],
                        }),
                        c.jsx("p", {
                          children:
                            "A little station for your big ideas. Send files to the people who need them, with your storage and your rules.",
                        }),
                        c.jsxs("button", {
                          className: "button primary hero-cta",
                          onClick: () => C(!0),
                          children: [
                            "Sign in to upload",
                            c.jsx($i, { size: 19 }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "hero-features",
                          children: [
                            c.jsxs("div", {
                              children: [
                                c.jsx("span", {
                                  children: c.jsx(vu, { size: 20 }),
                                }),
                                c.jsx("strong", {
                                  children: "Your choice of storage",
                                }),
                                c.jsx("small", {
                                  children: "Cloud drives and your NAS.",
                                }),
                              ],
                            }),
                            c.jsxs("div", {
                              children: [
                                c.jsx("span", {
                                  children: c.jsx(Xm, { size: 20 }),
                                }),
                                c.jsx("strong", {
                                  children: "Go at your own pace",
                                }),
                                c.jsx("small", {
                                  children: "Pause. Resume. Keep going.",
                                }),
                              ],
                            }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "hero-art",
                          "aria-hidden": "true",
                          children: [
                            c.jsx("span", { className: "art-line" }),
                            c.jsxs("div", {
                              className: "art-file",
                              children: [
                                c.jsx(qm, { size: 27 }),
                                c.jsx("span", {
                                  children: "Your file is shared.",
                                }),
                                c.jsx("span", {
                                  className: "art-check",
                                  children: c.jsx(ki, { size: 16 }),
                                }),
                              ],
                            }),
                            c.jsxs("div", {
                              className: "art-caption",
                              children: [
                                c.jsx("span", { className: "tiny-dot" }),
                                " A SAFE LANDING FOR EVERY FILE",
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                    c.jsxs("section", {
                      className: "receive-card",
                      children: [
                        c.jsxs("div", {
                          className: "receive-card-head",
                          children: [
                            c.jsx("span", {
                              className: "receive-symbol",
                              children: c.jsx(gn, { size: 25 }),
                            }),
                            c.jsx("span", {
                              className: "pill green",
                              children: "FOR RECIPIENTS",
                            }),
                          ],
                        }),
                        c.jsx("h2", { children: "Have an access code?" }),
                        c.jsxs("p", {
                          className: "muted",
                          children: [
                            "Enter the access code you received.",
                            c.jsx("br", {}),
                            "We’ll take it from here.",
                          ],
                        }),
                        c.jsx(AccessForm, { initialCode: xl, onFile: sl }),
                        c.jsx("div", {
                          className: "receive-footer",
                          children:
                            "No account needed. Just your code and email.",
                        }),
                      ],
                    }),
                  ],
                }),
                c.jsxs("footer", {
                  className: "public-footer",
                  children: [
                    c.jsx("span", {
                      children: "File Station · Your files, well connected.",
                    }),
                    c.jsx("span", {
                      children: "Private by default. Thoughtfully shared.",
                    }),
                  ],
                }),
              ],
            })
        : c.jsxs("div", {
            className: "loading",
            children: [
              c.jsx(Brand, {}),
              c.jsx("p", { children: "Opening your station…" }),
            ],
          }),
      _ &&
        c.jsx(LoginDialog, {
          onClose: () => C(!1),
          onLogin: (x) => {
            (v(x), C(!1));
          },
        }),
      B &&
        c.jsx(UploadDialog, {
          connectors: A,
          onClose: () => M(!1),
          onUploaded: () => {
            (J("transfers"), Z());
          },
        }),
      S &&
        codeOpen &&
        c.jsx(Modal, {
          title: "Use your access code",
          onClose: () => setCodeOpen(false),
          children: c.jsx(AccessForm, {
            initialCode: xl,
            onFile: (file) => {
              setCodeOpen(false);
              sl(file);
            },
          }),
        }),
      xe &&
        c.jsx(ShareDialog, {
          file: xe,
          onClose: () => G(void 0),
          onChanged: () => {
            Z();
          },
        }),
      " ",
      $ &&
        c.jsx(ConfirmDialog, {
          title: "Delete this file?",
          message: `“${$.name}” will be permanently removed from storage. Every access code for this file will become invalid.`,
          onClose: () => ye(void 0),
          onConfirm: async () => {
            (await api(`/files/${$.id}`, { method: "DELETE" }),
              await Z(),
              ne("File deleted and all its shares invalidated."));
          },
        }),
      oe &&
        c.jsxs(Modal, {
          title: "A file for you.",
          subtitle: "Your recipient email has been verified.",
          onClose: () => sl(void 0),
          children: [
            c.jsxs("div", {
              className: "received-file",
              children: [
                c.jsx(FileIcon, { name: oe.name }),
                c.jsxs("div", {
                  children: [
                    c.jsx("strong", { children: oe.name }),
                    c.jsxs("small", {
                      children: [
                        formatBytes(oe.size),
                        " · ",
                        formatDate(oe.expires_at),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            c.jsxs("button", {
              className: "button primary full",
              onClick: () => {
                fe(oe);
              },
              children: [c.jsx(gn, { size: 18 }), "Start resumable download"],
            }),
            canDirectDownload(oe)
              ? c.jsxs("a", {
                  className: "text-button direct-download",
                  href: `${basePath}/api/files/${oe.id}/download`,
                  children: [
                    "Direct browser download",
                    c.jsx(zm, { size: 14 }),
                  ],
                })
              : c.jsx("p", {
                  className: "fineprint",
                  children:
                    "Use resumable download for files this size on this storage.",
                }),
            c.jsx(TransfersPanel, { version: _e, onError: Ae }),
          ],
        }),
      De &&
        c.jsxs("div", {
          role: "status",
          className: "toast",
          children: [
            c.jsx(ki, { size: 18 }),
            De,
            c.jsx("button", {
              className: "icon-button",
              "aria-label": "Dismiss notification",
              onClick: () => W(""),
              children: c.jsx(Lf, { size: 16 }),
            }),
          ],
        }),
      !S &&
        Qe &&
        c.jsx("div", {
          className: "public-error",
          children: c.jsx(ErrorMessage, { error: Qe }),
        }),
    ],
  });
}
function TransfersPanel({ _version: S = 0, version: v = 0, onError: T }) {
  const o = D.useRef(null),
    [_, C] = D.useState();
  async function B(M) {
    try {
      await transfers.cancel(M.id);
    } catch (R) {
      T(R.message);
    }
  }
  return c.jsxs("div", {
    className: "transfer-list",
    children: [
      c.jsx("input", {
        ref: o,
        type: "file",
        className: "hidden",
        onChange: (M) => {
          const R = M.target.files?.[0];
          (R && _ && transfers.resume(_, R), (M.target.value = ""));
        },
      }),
      transfers.items.length
        ? transfers.items.map((M) =>
            c.jsxs(
              "article",
              {
                className: "transfer-card",
                children: [
                  c.jsxs("div", {
                    className: "transfer-head",
                    children: [
                      c.jsx("span", {
                        className: `transfer-direction ${M.direction}`,
                        children:
                          M.direction === "upload"
                            ? c.jsx(a1, { size: 20 })
                            : c.jsx(Gf, { size: 20 }),
                      }),
                      c.jsxs("div", {
                        children: [
                          c.jsx("strong", { children: M.name }),
                          c.jsxs("small", {
                            children: [
                              M.direction === "upload"
                                ? "Uploading"
                                : "Downloading",
                              " · ",
                              formatBytes(M.done),
                              " of",
                              " ",
                              formatBytes(M.size),
                              " · ",
                              M.state,
                            ],
                          }),
                        ],
                      }),
                      c.jsxs("div", {
                        className: "row-actions",
                        children: [
                          M.state === "running"
                            ? c.jsx("button", {
                                className: "icon-button",
                                title: "Pause",
                                "aria-label": "Pause " + M.name,
                                onClick: () => transfers.pause(M.id),
                                children: c.jsx(Xm, { size: 18 }),
                              })
                            : M.state !== "complete"
                              ? c.jsxs(c.Fragment, {
                                  children: [
                                    c.jsx("button", {
                                      className: "icon-button",
                                      title: "Resume",
                                      "aria-label": "Resume " + M.name,
                                      onClick: () => {
                                        transfers.resume(M.id);
                                      },
                                      children: c.jsx(d1, { size: 18 }),
                                    }),
                                    M.direction === "upload" &&
                                      c.jsx("button", {
                                        className: "text-button",
                                        onClick: () => {
                                          (C(M.id), o.current?.click());
                                        },
                                        children: "Select original file",
                                      }),
                                  ],
                                })
                              : M.direction === "download"
                                ? c.jsx("button", {
                                    className: "icon-button",
                                    title: "Save again",
                                    "aria-label": "Save download again",
                                    onClick: () => {
                                      transfers
                                        .saveDownload(M)
                                        .catch((R) => T(R.message));
                                    },
                                    children: c.jsx(gn, { size: 18 }),
                                  })
                                : c.jsx(ki, { size: 18 }),
                          c.jsx("button", {
                            className: "icon-button",
                            title:
                              M.state === "complete"
                                ? "Dismiss"
                                : "Cancel and remove transfer",
                            "aria-label": "Remove " + M.name,
                            onClick: () =>
                              M.state === "complete"
                                ? transfers.dismiss(M.id)
                                : void B(M),
                            children: c.jsx(Lf, { size: 17 }),
                          }),
                        ],
                      }),
                    ],
                  }),
                  c.jsx("div", {
                    className: "progress-bar",
                    children: c.jsx("i", {
                      style: {
                        width: `${Math.min(100, (M.done / M.size) * 100)}%`,
                      },
                    }),
                  }),
                  M.error && c.jsx(ErrorMessage, { error: M.error }),
                ],
              },
              M.id,
            ),
          )
        : c.jsxs("div", {
            className: "empty-state panel",
            children: [
              c.jsx("div", {
                className: "empty-icon",
                children: c.jsx(gn, { size: 32 }),
              }),
              c.jsx("h3", { children: "A clear track." }),
              c.jsx("p", {
                children:
                  "Uploads and downloads will appear here, with pause and resume controls.",
              }),
            ],
          }),
    ],
  });
}

export {
  App,
  api,
  post,
  Modal,
  ErrorMessage,
  transfers,
  formatBytes,
  fingerprint,
  ShareDialog,
  AccessForm,
  TransfersPanel,
};
