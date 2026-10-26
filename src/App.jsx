import { t, getLocale, useLanguage, LanguageSelector } from "./i18n";
import {
  AccessGate,
  InvitationManager,
  InvitationDialog,
  OneDriveDialog,
} from "./features";
import FilePreview from "./FilePreview";
import ShareAddressSettings from "./ShareAddressSettings";
import { FolderPane, FolderSelect } from "./Folders";
import FileTable from "./FileTable";
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
import { api, post, basePath } from "./http";
export { basePath };
import { transfers, fingerprint } from "./transfers";
const canDirectDownload = (file) =>
  !["synology", "webdav"].includes(file.storage_kind || "") ||
  file.size <= 256 * 1024 * 1024;
function formatBytes(S) {
  if (S === 0) return getLocale() === "fr-CA" ? "0 o" : "0 B";
  const v = ["B", "KB", "MB", "GB", "TB"],
    T = Math.min(Math.floor(Math.log(S) / Math.log(1e3)), 4);
  return `${new Intl.NumberFormat(getLocale(), { minimumFractionDigits: T > 1 ? 1 : 0, maximumFractionDigits: T > 1 ? 1 : 0 }).format(S / 1e3 ** T)} ${(getLocale() === "fr-CA" ? ["o", "ko", "Mo", "Go", "To"] : v)[T]}`;
}
const formatDate = (S) =>
  S
    ? new Date(S).toLocaleDateString(getLocale(), {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : t("No expiry");
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
          "aria-label": t("Close"),
          children: c.jsx(Lf, {
            size: 20,
          }),
        }),
        c.jsx("h2", {
          children: S,
        }),
        v &&
          c.jsx("p", {
            className: "muted",
            children: v,
          }),
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
        children: [
          c.jsx(n1, {
            size: 16,
          }),
          t(S),
        ],
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
        const $ = await post("/auth/verify", {
          challengeId: B,
          pin: _,
        });
        v($.user);
      } else {
        const $ = await post("/auth/request", {
          email: T,
        });
        (M($.challengeId), J($.developmentPin || ""));
      }
    } catch ($) {
      k($.message);
    } finally {
      j(!1);
    }
  }
  return c.jsxs(Modal, {
    title: B ? t("Check your inbox") : t("Welcome to your station"),
    subtitle: B
      ? t("We sent a six-digit code to {0}. It expires in 10 minutes.", {
          0: T,
        })
      : t(
          "Sign in or create an account with your email. No password to remember.",
        ),
    onClose: S,
    children: [
      c.jsx("div", {
        className: "dialog-symbol",
        children: c.jsx(Gm, {
          size: 26,
        }),
      }),
      c.jsxs("form", {
        onSubmit: xe,
        children: [
          c.jsxs("label", {
            children: [
              B ? t("Verification PIN") : t("Email address"),
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
                t("Local email simulator \xB7 PIN: "),
                c.jsx("strong", {
                  children: R,
                }),
              ],
            }),
          c.jsx(ErrorMessage, {
            error: N,
          }),
          c.jsxs("button", {
            type: "submit",
            className: "button primary full",
            disabled: A,
            children: [
              A
                ? t("Please wait\u2026")
                : B
                  ? t("Sign in")
                  : t("Email me a sign-in code"),
              c.jsx($i, {
                size: 17,
              }),
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
          children: t("Use another email or request a new code"),
        }),
      c.jsxs("p", {
        className: "fineprint",
        children: [
          c.jsx(yu, {
            size: 14,
          }),
          t(" Only approved accounts can upload files."),
        ],
      }),
    ],
  });
}
function AccessForm({ initialCode, onFile }) {
  return c.jsx(AccessGate, {
    initialCode,
    onFile,
  });
}
function UploadDialog({
  connectors: S,
  onClose: v,
  onUploaded: T,
  folderId: defaultFolderId = null,
}) {
  const [uploadFolderId, setUploadFolderId] = D.useState(defaultFolderId);
  const [folderReady, setFolderReady] = D.useState(false);
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
      for (const $ of o)
        await transfers.upload($, C, undefined, uploadFolderId);
      (T(), v());
    } catch ($) {
      (A($.message), T());
    } finally {
      R(!1);
    }
  }
  return c.jsx(Modal, {
    title: t("Bring your files aboard"),
    subtitle: t(
      "Choose a destination. You can pause a transfer and pick up where you left off.",
    ),
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
            c.jsx(u1, {
              size: 34,
            }),
            c.jsx("strong", {
              children: o.length
                ? t("{0} file{1} selected", {
                    0: o.length,
                    1: o.length > 1 ? t("s") : "",
                  })
                : t("Drop files here, or browse"),
            }),
            c.jsx("span", {
              children: o.length
                ? o.map((G) => G.name).join(", ")
                : t("All file types welcome"),
            }),
            c.jsx("input", {
              type: "file",
              multiple: !0,
              onChange: (G) => _(Array.from(G.target.files || [])),
              "aria-label": t("Choose files"),
            }),
          ],
        }),
        c.jsxs("label", {
          children: [
            t("Storage destination"),
            c.jsxs("select", {
              value: C,
              onChange: (G) => B(G.target.value),
              required: !0,
              children: [
                c.jsx("option", {
                  value: "",
                  disabled: !0,
                  children: t("Choose a connector"),
                }),
                S.filter((G) => G.enabled).map((G) =>
                  c.jsxs(
                    "option",
                    {
                      value: G.id,
                      disabled: G.kind !== "r2" && !G.credentials_configured,
                      children: [
                        G.name,
                        " \xB7 ",
                        formatBytes(
                          Math.max(
                            0,
                            G.limit_bytes - G.used_bytes - G.reserved_bytes,
                          ),
                        ),
                        " ",
                        t("available"),
                        G.kind !== "r2" && !G.credentials_configured
                          ? t(" \xB7 setup needed")
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
        c.jsx(FolderSelect, {
          value: uploadFolderId,
          onChange: setUploadFolderId,
          onReady: setFolderReady,
        }),
        k &&
          c.jsxs("div", {
            className: "info",
            children: [
              c.jsx(vu, {
                size: 18,
              }),
              c.jsxs("span", {
                children: [
                  k.retention_days
                    ? t("Files are kept for {0} days. ", {
                        0: k.retention_days,
                      })
                    : t("No time-based expiry. "),
                  t("If this storage reaches its "),
                  formatBytes(k.limit_bytes),
                  t(
                    " limit, its oldest files are deleted to make room. Deleted files and their shares cannot be recovered.",
                  ),
                ],
              }),
            ],
          }),
        c.jsx(ErrorMessage, {
          error: J,
        }),
        c.jsxs("button", {
          type: "submit",
          className: "button primary full",
          disabled: M || !C || !o.length || !folderReady,
          children: [
            M
              ? t("Preparing uploads\u2026")
              : t("Upload{0}", {
                  0: o.length
                    ? " " + formatBytes(o.reduce((G, $) => G + $.size, 0))
                    : "",
                }),
            c.jsx($i, {
              size: 17,
            }),
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
      (await api(`/shares/${V}`, {
        method: "DELETE",
      }),
        await Ae(),
        T());
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
    title: k ? t("Ready to share") : t("A file. The right people."),
    subtitle: S.name,
    onClose: v,
    children: [
      !k &&
        c.jsx("button", {
          type: "button",
          className: "button secondary full",
          onClick: () => setCollaboration(true),
          children: t("Share for collaboration instead"),
        }),
      k
        ? c.jsxs(c.Fragment, {
            children: [
              c.jsxs("div", {
                className: "share-code",
                children: [
                  c.jsx("span", {
                    children: t("FILE ACCESS CODE"),
                  }),
                  c.jsx("strong", {
                    children: k.code.match(/.{1,4}/g)?.join(" "),
                  }),
                  c.jsxs("small", {
                    children: [t("Expires "), formatDate(k.expiresAt)],
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  t("Share link"),
                  c.jsxs("div", {
                    className: "copy-field",
                    children: [
                      c.jsx("input", {
                        readOnly: !0,
                        value: k.link,
                      }),
                      c.jsx("button", {
                        className: "icon-button",
                        "aria-label": t("Copy share link"),
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
                          ? c.jsx(ki, {
                              size: 18,
                            })
                          : c.jsx(i1, {
                              size: 18,
                            }),
                      }),
                    ],
                  }),
                ],
              }),
              c.jsxs("p", {
                className: "info",
                children: [
                  c.jsx(Gm, {
                    size: 18,
                  }),
                  k.emailError ||
                    (k.developmentEmail
                      ? t("Email simulated locally. Copy the link for testing.")
                      : k.emailSent
                        ? t(
                            "Email sent to your recipients. They\u2019ll verify their address before downloading.",
                          )
                        : t(
                            "Copy this link and send it to your recipients. They\u2019ll verify their address before downloading.",
                          )),
                ],
              }),
              c.jsx("button", {
                className: "button primary full",
                onClick: v,
                children: t("Done"),
              }),
            ],
          })
        : c.jsxs("form", {
            onSubmit: De,
            children: [
              c.jsxs("label", {
                children: [
                  t("Recipient email addresses"),
                  c.jsx("textarea", {
                    required: !0,
                    rows: 3,
                    value: o,
                    onChange: (V) => _(V.target.value),
                    placeholder: "alex@company.com, sam@company.com",
                  }),
                  c.jsx("small", {
                    children: t(
                      "Separate addresses with commas. Up to 20 recipients.",
                    ),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  t("Share expires in"),
                  c.jsxs("select", {
                    value: C,
                    onChange: (V) => B(Number(V.target.value)),
                    children: [
                      c.jsx("option", {
                        value: 1,
                        children: t("1 day"),
                      }),
                      c.jsx("option", {
                        value: 7,
                        children: t("7 days"),
                      }),
                      c.jsx("option", {
                        value: 30,
                        children: t("30 days"),
                      }),
                      c.jsx("option", {
                        value: 90,
                        children: t("90 days"),
                      }),
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
                        children: t("Email the link automatically"),
                      }),
                      c.jsx("small", {
                        children: t(
                          "Turn off to copy the link and send it yourself.",
                        ),
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
                  J ? t("Creating share\u2026") : t("Create share"),
                  c.jsx(Fi, {
                    size: 17,
                  }),
                ],
              }),
              c.jsx("p", {
                className: "fineprint",
                children: t(
                  "File deletion or storage retention invalidates this code immediately.",
                ),
              }),
            ],
          }),
      c.jsx(ErrorMessage, {
        error: j,
      }),
      c.jsxs("div", {
        className: "existing-shares",
        children: [
          c.jsx("button", {
            className: "text-button",
            onClick: () => {
              Ae();
            },
            children: t("Manage existing shares"),
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
                                ? t("Revoked")
                                : t("Expires {0}", {
                                    0: formatDate(V.expires_at),
                                  }),
                            }),
                          ],
                        }),
                        !V.revoked_at &&
                          c.jsx("button", {
                            className: "text-button danger",
                            onClick: () => {
                              W(V.id);
                            },
                            children: t("Revoke"),
                          }),
                      ],
                    },
                    V.id,
                  ),
                )
              : c.jsx("p", {
                  className: "muted",
                  children: t("No existing shares."),
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
      c.jsx(ErrorMessage, {
        error: B,
      }),
      c.jsxs("div", {
        className: "actions",
        children: [
          c.jsx("button", {
            className: "button secondary",
            onClick: T,
            disabled: _,
            children: t("Cancel"),
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
            children: _ ? t("Working\u2026") : t("Confirm"),
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
      const j = await api(`/admin/connectors/${A.id}/test`, {
        method: "POST",
      });
      R((N) => ({
        ...N,
        [A.id]: {
          ok: !0,
          message: j.message,
        },
      }));
    } catch (j) {
      R((N) => ({
        ...N,
        [A.id]: {
          ok: !1,
          message: j.message,
        },
      }));
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
                children: t("YOUR STORAGE NETWORK"),
              }),
              c.jsx("h1", {
                children: t("A place for every file."),
              }),
              c.jsx("p", {
                className: "muted",
                children: t(
                  "Pick the storage that fits. Each destination has its own capacity and retention policy.",
                ),
              }),
            ],
          }),
          v &&
            c.jsxs("button", {
              className: "button primary",
              onClick: () => _(null),
              children: [
                c.jsx(Qf, {
                  size: 17,
                }),
                t("Add connector"),
              ],
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
                          ? c.jsx(Ym, {
                              size: 26,
                            })
                          : c.jsx(vu, {
                              size: 26,
                            }),
                    }),
                    c.jsx("span", {
                      className: `pill ${A.enabled ? "green" : "gray"}`,
                      children: A.enabled
                        ? A.kind !== "r2" && !A.credentials_configured
                          ? t("Setup needed")
                          : A.kind === "r2"
                            ? t("Ready")
                            : t("Configured")
                        : t("Disabled"),
                    }),
                  ],
                }),
                c.jsx("h2", {
                  children: A.name,
                }),
                c.jsx("p", {
                  className: "muted",
                  children:
                    A.kind === "onedrive"
                      ? t(
                          "OneDrive for Business \xB7 private application storage",
                        )
                      : A.kind === "r2"
                        ? t("Cloudflare R2 object storage")
                        : A.kind === "s3"
                          ? t("S3-compatible object storage")
                          : A.kind === "synology"
                            ? t("Synology \xB7 WebDAV through Cloudflare")
                            : A.kind === "webdav"
                              ? t("WebDAV \xB7 AliPan and other drives")
                              : t("AliPan \xB7 \u963F\u91CC\u4E91\u76D8"),
                }),
                c.jsxs("div", {
                  className: "capacity-number",
                  children: [
                    c.jsx("strong", {
                      children: formatBytes(A.used_bytes + A.reserved_bytes),
                    }),
                    c.jsxs("span", {
                      children: [t("of "), formatBytes(A.limit_bytes)],
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
                        c.jsx("dt", {
                          children: t("Files stored"),
                        }),
                        c.jsx("dd", {
                          children: A.file_count,
                        }),
                      ],
                    }),
                    c.jsxs("div", {
                      children: [
                        c.jsx("dt", {
                          children: t("Reserved for uploads"),
                        }),
                        c.jsx("dd", {
                          children: formatBytes(A.reserved_bytes),
                        }),
                      ],
                    }),
                    c.jsxs("div", {
                      children: [
                        c.jsx("dt", {
                          children: t("Time retention"),
                        }),
                        c.jsx("dd", {
                          children: A.retention_days
                            ? t("{0} days", {
                                0: A.retention_days,
                              })
                            : t("No time limit"),
                        }),
                      ],
                    }),
                    c.jsxs("div", {
                      children: [
                        c.jsx("dt", {
                          children: t("At capacity"),
                        }),
                        c.jsx("dd", {
                          children: t("Oldest files deleted first"),
                        }),
                      ],
                    }),
                  ],
                }),
                v &&
                  c.jsxs("button", {
                    className: "button secondary full",
                    onClick: () => _(A),
                    children: [
                      c.jsx(Vm, {
                        size: 16,
                      }),
                      t("Manage connector"),
                    ],
                  }),
                v &&
                  (A.kind === "webdav" || A.kind === "synology") &&
                  c.jsxs(c.Fragment, {
                    children: [
                      c.jsx("button", {
                        className: "button secondary full",
                        disabled: !!C || !A.credentials_configured,
                        onClick: () => J(A),
                        children:
                          C === A.id
                            ? t("Checking\u2026")
                            : t("Check connection"),
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
            ? {
                credentials: {
                  accessKeyId: W,
                  secretAccessKey: Me,
                },
              }
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
    title: S ? t("Manage storage") : t("Connect a destination"),
    subtitle: t(
      "Storage limits apply to File Station\u2019s own files. Capacity eviction removes the oldest files permanently.",
    ),
    onClose: v,
    children: c.jsxs("form", {
      onSubmit: Q,
      children: [
        c.jsxs("label", {
          children: [
            t("Name"),
            c.jsx("input", {
              required: !0,
              value: o,
              onChange: (U) => _(U.target.value),
              placeholder: t("Team storage"),
            }),
          ],
        }),
        c.jsxs("div", {
          className: "field-row",
          children: [
            c.jsxs("label", {
              children: [
                t("Provider"),
                c.jsxs("select", {
                  "aria-label": t("Provider"),
                  disabled: !!S,
                  value: C,
                  onChange: (U) => B(U.target.value),
                  children: [
                    c.jsx("option", {
                      value: "onedrive",
                      children: t("OneDrive for Business"),
                    }),
                    c.jsx("option", {
                      value: "r2",
                      children: t("Cloudflare R2"),
                    }),
                    c.jsx("option", {
                      value: "alipan",
                      children: t("AliPan / \u963F\u91CC\u4E91\u76D8"),
                    }),
                    c.jsx("option", {
                      value: "s3",
                      children: t("S3 compatible (R2, B2, Storj\u2026)"),
                    }),
                    c.jsx("option", {
                      value: "synology",
                      children: t("Synology WebDAV (Cloudflare)"),
                    }),
                    c.jsx("option", {
                      value: "webdav",
                      children: t("WebDAV (AliPan and other drives)"),
                    }),
                  ],
                }),
              ],
            }),
            c.jsxs("label", {
              children: [
                t("Capacity (GB)"),
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
            t("Retention in days"),
            c.jsx("input", {
              type: "number",
              min: "1",
              max: "3650",
              value: J,
              onChange: (U) => A(U.target.value),
              placeholder: t("Leave blank for no time limit"),
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
                      t("Drive ID"),
                      c.jsx("input", {
                        required: !0,
                        value: k,
                        onChange: (U) => xe(U.target.value),
                      }),
                    ],
                  }),
                  c.jsxs("label", {
                    children: [
                      t("Folder ID"),
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
                children: t(
                  "Use the official AliPan Open API application credentials. Existing credentials stay unchanged when these fields are blank.",
                ),
              }),
              c.jsxs("label", {
                children: [
                  t("Client ID"),
                  c.jsx("input", {
                    autoComplete: "off",
                    value: Le,
                    onChange: (U) => Ze(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  t("Client secret"),
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
                  t("Refresh token"),
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
                  t("S3 HTTPS endpoint"),
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
                  t("A hostname without https:// is accepted. For Oracle, use"),
                  " ",
                  "https://YOUR_NAMESPACE.compat.objectstorage.YOUR_REGION.oraclecloud.com or the equivalent .oci.customer-oci.com endpoint. Replace both placeholders with your account values and enter the bucket separately. An Oracle region set to auto is read from its endpoint.",
                ],
              }),
              c.jsxs("div", {
                className: "field-row",
                children: [
                  c.jsxs("label", {
                    children: [
                      t("Bucket"),
                      c.jsx("input", {
                        required: !0,
                        value: sl,
                        onChange: (U) => Qe(U.target.value),
                      }),
                      c.jsx("span", {
                        className: "fineprint",
                        children: t(
                          "Use the exact bucket name, including capitalization.",
                        ),
                      }),
                    ],
                  }),
                  c.jsxs("label", {
                    children: [
                      t("Region"),
                      c.jsx("input", {
                        required: !0,
                        value: Ae,
                        onChange: (U) => De(U.target.value),
                        placeholder: t("auto for R2"),
                      }),
                    ],
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  t("Access key ID"),
                  c.jsx("input", {
                    autoComplete: "off",
                    value: W,
                    onChange: (U) => V(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  t("Secret access key"),
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
                children: t(
                  "Keys are encrypted on the server. Blank fields preserve existing credentials. Use a dedicated File Station bucket; each connector has its own file prefix.",
                ),
              }),
            ],
          }),
        C === "r2" &&
          c.jsx("p", {
            className: "info",
            children: t(
              "R2 destinations use separate prefixes in the app\u2019s Cloudflare bucket. No storage keys are needed.",
            ),
          }),
        (C === "synology" || C === "webdav") &&
          c.jsxs(c.Fragment, {
            children: [
              c.jsxs("label", {
                children: [
                  t("WebDAV HTTPS folder URL"),
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
                children: t(
                  "Use the WebDAV folder URL, with write and delete access. A DSM login page is not a WebDAV endpoint. Transfers use 8 MiB parts; storage contains chunk folders, while File Station downloads the original file.",
                ),
              }),
              c.jsxs("label", {
                children: [
                  t("WebDAV username"),
                  c.jsx("input", {
                    autoComplete: "off",
                    value: K,
                    onChange: (U) => Z(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  t("WebDAV password"),
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
                children: t(
                  "For Cloudflare Access, create a service token and a Service Auth policy. Enter both fields below; browser login policies alone will block the Worker.",
                ),
              }),
              c.jsxs("label", {
                children: [
                  t("Access service token client ID"),
                  c.jsx("input", {
                    autoComplete: "off",
                    value: $e,
                    onChange: (U) => fl(U.target.value),
                  }),
                ],
              }),
              c.jsxs("label", {
                children: [
                  t("Access service token client secret"),
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
                children: t(
                  "Credentials are encrypted. Leave all four fields blank to preserve them; enter the complete set to replace them.",
                ),
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
                    t(
                      "I confirm a changed hostname points to the same WebDAV folder, with the same files.",
                    ),
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
            t("Allow new uploads to this connector"),
          ],
        }),
        c.jsx(ErrorMessage, {
          error: re,
        }),
        c.jsxs("button", {
          type: "submit",
          className: "button primary full",
          disabled: q,
          children: [
            c.jsx(Qm, {
              size: 17,
            }),
            q ? t("Saving\u2026") : t("Save connector"),
          ],
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
        body: JSON.stringify({
          status: k,
        }),
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
                children: t("ADMINISTRATION"),
              }),
              c.jsx("h1", {
                children: t("The people at your station."),
              }),
              c.jsx("p", {
                className: "muted",
                children: t("Approve new accounts and manage access."),
              }),
            ],
          }),
          c.jsxs("div", {
            className: "stat-inline",
            children: [
              c.jsx("strong", {
                children: T.filter((N) => N.status === "pending").length,
              }),
              c.jsx("span", {
                children: t("awaiting approval"),
              }),
            ],
          }),
        ],
      }),
      c.jsx(ErrorMessage, {
        error: _,
      }),
      c.jsx("div", {
        className: "table-shell",
        children: c.jsxs("table", {
          children: [
            c.jsx("thead", {
              children: c.jsxs("tr", {
                children: [
                  c.jsx("th", {
                    children: t("User"),
                  }),
                  c.jsx("th", {
                    children: t("Role"),
                  }),
                  c.jsx("th", {
                    children: t("Status"),
                  }),
                  c.jsx("th", {
                    children: t("Joined"),
                  }),
                  c.jsx("th", {
                    children: t("Actions"),
                  }),
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
                            c.jsx("strong", {
                              children: N.email,
                            }),
                            N.id === S.id &&
                              c.jsx("small", {
                                children: t("You"),
                              }),
                          ],
                        }),
                      }),
                      c.jsx("td", {
                        children: t(N.role),
                      }),
                      c.jsx("td", {
                        children: c.jsx("span", {
                          className: `pill ${N.status === "active" ? "green" : N.status === "pending" ? "amber" : "gray"}`,
                          children: t(N.status),
                        }),
                      }),
                      c.jsx("td", {
                        children: formatDate(N.created_at),
                      }),
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
                                    ? t("Deactivate")
                                    : t("Approve / reactivate"),
                                "aria-label":
                                  N.status === "active"
                                    ? t("Deactivate {0}", {
                                        0: N.email,
                                      })
                                    : t("Approve {0}", {
                                        0: N.email,
                                      }),
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
                                    ? c.jsx(g1, {
                                        size: 17,
                                      })
                                    : c.jsx(y1, {
                                        size: 17,
                                      }),
                              }),
                              c.jsx("button", {
                                className: "icon-button danger",
                                title: t("Delete user and files"),
                                "aria-label": t("Delete {0}", {
                                  0: N.email,
                                }),
                                onClick: () => M(N),
                                children: c.jsx(Lm, {
                                  size: 17,
                                }),
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
          title: t("Delete this account?"),
          message: t(
            "This deactivates {0}, permanently deletes all their files, and invalidates their shares.",
            {
              0: B.email,
            },
          ),
          onClose: () => M(void 0),
          onConfirm: async () => {
            (await api(`/admin/users/${B.id}`, {
              method: "DELETE",
            }),
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
            c.jsx("span", {
              className: "eyebrow",
              children: t("ADMINISTRATION"),
            }),
            c.jsx("h1", {
              children: t("Set the ground rules."),
            }),
            c.jsx("p", {
              className: "muted",
              children: t("Account approval and a record of activity."),
            }),
          ],
        }),
      }),
      c.jsxs("div", {
        className: "settings-grid",
        children: [
          c.jsx(ShareAddressSettings, {
            onNotice: S,
          }),
          c.jsxs("section", {
            className: "panel",
            children: [
              c.jsx("div", {
                className: "panel-icon",
                children: c.jsx(yu, {
                  size: 23,
                }),
              }),
              c.jsx("h2", {
                children: t("Automatic approval"),
              }),
              c.jsx("p", {
                className: "muted",
                children: t(
                  "New users with a verified email at these exact domains are approved automatically. Other users wait for an administrator.",
                ),
              }),
              c.jsxs("form", {
                onSubmit: j,
                children: [
                  c.jsxs("label", {
                    children: [
                      t("Allowed email domains"),
                      c.jsx("textarea", {
                        rows: 5,
                        value: v,
                        onChange: (N) => T(N.target.value),
                        placeholder: t("international.gc.ca"),
                        disabled: !M,
                      }),
                      c.jsx("small", {
                        children: t(
                          "One domain per line. Subdomains are not automatically included. Existing accounts are unchanged.",
                        ),
                      }),
                    ],
                  }),
                  c.jsx(ErrorMessage, {
                    error: C,
                  }),
                  c.jsxs("button", {
                    type: "submit",
                    className: "button primary",
                    disabled: o || !M,
                    children: [
                      c.jsx(Qm, {
                        size: 17,
                      }),
                      o ? t("Saving\u2026") : t("Save domains"),
                    ],
                  }),
                ],
              }),
            ],
          }),
          c.jsxs("section", {
            className: "panel",
            children: [
              c.jsx("h2", {
                children: t("Recent activity"),
              }),
              c.jsx("div", {
                className: "audit-list",
                children: J.length
                  ? J.map((N) =>
                      c.jsxs(
                        "div",
                        {
                          children: [
                            c.jsx("span", {
                              className: "audit-dot",
                            }),
                            c.jsxs("div", {
                              children: [
                                c.jsx("strong", {
                                  children: t(N.action.replace(/[._]/g, " ")),
                                }),
                                c.jsxs("small", {
                                  children: [
                                    N.actor_email || t("Retention service"),
                                    " \xB7 ",
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
                      children: t(
                        "Activity will appear here as people use File Station.",
                      ),
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
    {
      page: "files",
      label: "My files",
      icon: Xf,
    },
    {
      page: "shared",
      label: "Shared by me",
      icon: Fi,
    },
    {
      page: "access",
      label: "Use an access code",
      icon: Fi,
    },
    {
      page: "requests",
      label: "File requests",
      icon: v1,
    },
    {
      page: "collaborations",
      label: "Collaborations",
      icon: qm,
    },
    {
      page: "transfers",
      label: "Transfers",
      icon: gn,
    },
    {
      page: "storage",
      label: "Storage",
      icon: Ym,
    },
  ],
  adminNavigation = [
    {
      page: "users",
      label: "User management",
      icon: S1,
    },
    {
      page: "allfiles",
      label: "All files",
      icon: Bm,
    },
    {
      page: "settings",
      label: "Settings & activity",
      icon: Vm,
    },
  ];
function Brand() {
  return c.jsxs("div", {
    className: "brand",
    children: [
      c.jsx("span", {
        className: "brand-mark",
        children: c.jsx(Bm, {
          size: 23,
        }),
      }),
      c.jsxs("span", {
        children: [
          t("File Station"),
          c.jsx("span", {
            className: "brand-dot",
            children: ".",
          }),
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
    children: c.jsx(T, {
      size: 22,
    }),
  });
}
function App() {
  useLanguage();
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
  const [folders, setFolders] = D.useState([]);
  const [currentFolder, setCurrentFolder] = D.useState(
    () => new URLSearchParams(location.search).get("folder") || null,
  );
  const browserState = D.useRef();
  const reloadSequence = D.useRef(0);
  browserState.current = { user: S, view: R, folder: currentFolder };
  function openFolder(folder, replace = false) {
    k([]);
    setCurrentFolder(folder);
    J("files");
    const url = new URL(location.href);
    if (folder) url.searchParams.set("folder", folder);
    else url.searchParams.delete("folder");
    history[replace ? "replaceState" : "pushState"](null, "", url);
  }
  D.useEffect(() => {
    function navigate() {
      k([]);
      setCurrentFolder(
        new URLSearchParams(location.search).get("folder") || null,
      );
      J("files");
    }
    addEventListener("popstate", navigate);
    return () => removeEventListener("popstate", navigate);
  }, []);
  async function Z() {
    const { user, view, folder } = browserState.current;
    const sequence = ++reloadSequence.current;
    if (user) {
      Ae("");
      try {
        const requests = [api("/connectors")];
        if (user.status === "active")
          requests.push(
            api("/folders"),
            api(
              `/files${view === "allfiles" ? "?all=true" : view === "files" ? `?folderId=${encodeURIComponent(folder || "root")}` : ""}`,
            ),
          );
        const results = await Promise.all(requests);
        if (
          sequence !== reloadSequence.current ||
          browserState.current.user?.id !== user.id ||
          browserState.current.view !== view ||
          browserState.current.folder !== folder
        )
          return;
        j(results[0].connectors);
        if (user.status === "active") {
          setFolders(results[1].folders);
          k(results[2].files);
        }
      } catch (x) {
        if (
          sequence === reloadSequence.current &&
          browserState.current.user?.id === user.id &&
          browserState.current.view === view &&
          browserState.current.folder === folder
        ) {
          if (view === "files" && folder && x.status === 404)
            openFolder(null, true);
          else Ae(x.message);
        }
      }
    }
  }
  (D.useEffect(() => {
    Z();
  }, [S, R, w, currentFolder]),
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
      (v(null), k([]), j([]), setFolders([]), setCurrentFolder(null));
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
                c.jsx(m1, {
                  size: 17,
                }),
                c.jsx("input", {
                  placeholder: t("Search your files\u2026"),
                  "aria-label": t("Search files"),
                  value: V,
                  onChange: (x) => Me(x.target.value),
                }),
              ],
            }),
            c.jsxs("select", {
              "aria-label": t("Filter by storage"),
              value: Ve,
              onChange: (x) => Le(x.target.value),
              children: [
                c.jsx("option", {
                  value: "all",
                  children: t("All storage"),
                }),
                A.map((x) =>
                  c.jsx(
                    "option",
                    {
                      value: x.id,
                      children: x.name,
                    },
                    x.id,
                  ),
                ),
              ],
            }),
            c.jsx("button", {
              className: "icon-button",
              onClick: () => {
                Z();
              },
              "aria-label": t("Refresh files"),
              children: c.jsx(h1, {
                size: 17,
              }),
            }),
          ],
        }),
        R === "files" &&
          c.jsx(FolderPane, {
            folders,
            current: currentFolder,
            onOpen: openFolder,
            onChanged: Z,
          }),
        c.jsxs("div", {
          className: "file-list",
          children: [
            c.jsx(FileTable, {
              files: d,
              connectors: A,
              showOwner: R === "allfiles",
              showLocation: R !== "files",
              contextKey: `${R}:${currentFolder}:${V}:${Ve}`,
              onDownload: fe,
              onShare: G,
              onDelete: ye,
              onTransfers: () => J("transfers"),
              onChanged: Z,
            }),
            !d.length &&
              c.jsxs("div", {
                className: "empty-state",
                children: [
                  c.jsx("div", {
                    className: "empty-icon",
                    children: c.jsx(Xf, {
                      size: 34,
                    }),
                  }),
                  c.jsx("h3", {
                    children: V
                      ? t("No matching files")
                      : R === "shared"
                        ? t("Your next handoff starts here.")
                        : t("Make yourself at home."),
                  }),
                  c.jsx("p", {
                    children: V
                      ? t("Try another name or storage destination.")
                      : R === "shared"
                        ? t("Create a share from any uploaded file.")
                        : t(
                            "Upload a file, choose a destination, and send it to the right people.",
                          ),
                  }),
                  !V &&
                    R !== "shared" &&
                    c.jsxs("button", {
                      className: "button primary",
                      onClick: () => M(!0),
                      children: [
                        c.jsx(Qf, {
                          size: 16,
                        }),
                        t("Upload your first file"),
                      ],
                    }),
                ],
              }),
          ],
        }),
        c.jsxs("p", {
          className: "table-foot",
          children: [
            t("Showing "),
            d.length,
            t(" file"),
            d.length !== 1 ? t("s") : "",
            N.length === 500 ? t(" \xB7 Latest 500 files") : "",
            c.jsxs("span", {
              children: [
                c.jsx(yu, {
                  size: 14,
                }),
                t(" Files stay private until you share them"),
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
                      children: t("YOUR WORKSPACE"),
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
                                c.jsx(x.icon, {
                                  size: 18,
                                }),
                                t(x.label),
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
                                children: t("ADMINISTRATION"),
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
                                      c.jsx(x.icon, {
                                        size: 18,
                                      }),
                                      t(x.label),
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
                                c.jsx(vu, {
                                  size: 16,
                                }),
                                c.jsx("strong", {
                                  children: t("Room for your ideas"),
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
                                t(" of "),
                                formatBytes(fl),
                                t(" used"),
                              ],
                            }),
                            c.jsxs("button", {
                              className: "text-button",
                              onClick: () => J("storage"),
                              children: [
                                t("View storage"),
                                c.jsx(Am, {
                                  size: 14,
                                }),
                              ],
                            }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "sidebar-footer",
                          children: [
                            c.jsx("span", {
                              className: "tiny-dot",
                            }),
                            t(" WELL CONNECTED"),
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
                              "aria-label": t("Toggle navigation"),
                              children: c.jsx(r1, {
                                size: 20,
                              }),
                            }),
                            c.jsxs("span", {
                              className: "breadcrumb",
                              children: [
                                t("Workspace"),
                                c.jsx(Am, {
                                  size: 14,
                                }),
                                c.jsx("strong", {
                                  children: t(
                                    [
                                      ...userNavigation,
                                      ...adminNavigation,
                                    ].find((x) => x.page === R)?.label || "",
                                  ),
                                }),
                              ],
                            }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "account",
                          children: [
                            c.jsx(LanguageSelector, {}),
                            c.jsxs("span", {
                              className: "account-text",
                              children: [
                                S.email,
                                c.jsx("small", {
                                  children:
                                    S.role === "admin"
                                      ? t("Administrator")
                                      : t("Personal workspace"),
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
                              title: t("Sign out"),
                              "aria-label": t("Sign out"),
                              children: c.jsx(o1, {
                                size: 17,
                              }),
                            }),
                          ],
                        }),
                      ],
                    }),
                    c.jsxs("main", {
                      className: "workspace",
                      children: [
                        c.jsx(ErrorMessage, {
                          error: Qe,
                        }),
                        S.status !== "active"
                          ? c.jsxs("section", {
                              className: "pending panel",
                              children: [
                                c.jsx(yu, {
                                  size: 42,
                                }),
                                c.jsx("h1", {
                                  children: t("You're on the list."),
                                }),
                                c.jsx("p", {
                                  children: t(
                                    "Your email is verified. An administrator needs to approve your account before you can upload or manage files.",
                                  ),
                                }),
                                c.jsx("button", {
                                  className: "button secondary",
                                  onClick: () => {
                                    api("/me")
                                      .then((x) => v(x.user))
                                      .catch((x) => Ae(x.message));
                                  },
                                  children: t("Check approval status"),
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
                                                    ? t("ADMINISTRATION")
                                                    : t(
                                                        "A LITTLE ORDER. A LOT OF POSSIBILITY.",
                                                      ),
                                              }),
                                              c.jsx("h1", {
                                                children:
                                                  R === "shared"
                                                    ? t(
                                                        "Good things, passed along.",
                                                      )
                                                    : R === "allfiles"
                                                      ? t(
                                                          "Every file at your station.",
                                                        )
                                                      : t(
                                                          "Your files, right at home.",
                                                        ),
                                              }),
                                              c.jsx("p", {
                                                className: "muted",
                                                children:
                                                  R === "shared"
                                                    ? t(
                                                        "Manage the files you\u2019ve shared and the people who can access them.",
                                                      )
                                                    : R === "allfiles"
                                                      ? t(
                                                          "Manage all users\u2019 files and sharing permissions.",
                                                        )
                                                      : t(
                                                          "Everything you\u2019ve uploaded, with room for what\u2019s next.",
                                                        ),
                                              }),
                                            ],
                                          }),
                                          c.jsxs("button", {
                                            className: "button primary",
                                            onClick: () => M(!0),
                                            children: [
                                              c.jsx(Qf, {
                                                size: 18,
                                              }),
                                              t("Upload files"),
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
                                                      children: t(
                                                        "Files in your station",
                                                      ),
                                                    }),
                                                    c.jsxs("strong", {
                                                      children: [
                                                        N.filter(
                                                          (x) =>
                                                            x.state === "ready",
                                                        ).length,
                                                        c.jsx("small", {
                                                          children: t("files"),
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
                                                        t("Active handoffs"),
                                                    }),
                                                    c.jsxs("strong", {
                                                      children: [
                                                        N.reduce(
                                                          (x, q) =>
                                                            x + q.share_count,
                                                          0,
                                                        ),
                                                        c.jsx("small", {
                                                          children: t("shares"),
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
                                                        t("Your files take up"),
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
                                    children: c.jsx(AccessForm, {
                                      onFile: sl,
                                    }),
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
                                  c.jsx(SettingsPanel, {
                                    onNotice: ne,
                                  }),
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
                                              children: t("AT YOUR OWN PACE"),
                                            }),
                                            c.jsx("h1", {
                                              children: t(
                                                "Every byte gets there.",
                                              ),
                                            }),
                                            c.jsx("p", {
                                              className: "muted",
                                              children: t(
                                                "Pause when you need to. Resume when you\u2019re ready. After a refresh, reselect the original file to resume an upload.",
                                              ),
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
                        t("A safe landing for every file."),
                        c.jsx("span", {
                          children: t("FILE STATION"),
                        }),
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
                        c.jsx(LanguageSelector, {}),
                        c.jsx("span", {
                          className: "public-tag",
                          children: t("A simpler way to send."),
                        }),
                        c.jsxs("button", {
                          className: "button secondary",
                          onClick: () => C(!0),
                          children: [
                            t("Sign in"),
                            c.jsx(zm, {
                              size: 16,
                            }),
                          ],
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
                            c.jsx("span", {
                              className: "tiny-dot",
                            }),
                            t(" FROM HERE TO THERE"),
                          ],
                        }),
                        c.jsxs("h1", {
                          children: [
                            t("Good files."),
                            c.jsx("br", {}),
                            t("Great Mission."),
                            c.jsx("br", {}),
                            c.jsx("em", {
                              children: t("Easy sharing."),
                            }),
                          ],
                        }),
                        c.jsx("p", {
                          children: t(
                            "A little station for your big ideas. Send files to the people who need them, with your storage and your rules.",
                          ),
                        }),
                        c.jsxs("button", {
                          className: "button primary hero-cta",
                          onClick: () => C(!0),
                          children: [
                            t("Sign in to upload"),
                            c.jsx($i, {
                              size: 19,
                            }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "hero-features",
                          children: [
                            c.jsxs("div", {
                              children: [
                                c.jsx("span", {
                                  children: c.jsx(vu, {
                                    size: 20,
                                  }),
                                }),
                                c.jsx("strong", {
                                  children: t("Your choice of storage"),
                                }),
                                c.jsx("small", {
                                  children: t("Cloud drives and your NAS."),
                                }),
                              ],
                            }),
                            c.jsxs("div", {
                              children: [
                                c.jsx("span", {
                                  children: c.jsx(Xm, {
                                    size: 20,
                                  }),
                                }),
                                c.jsx("strong", {
                                  children: t("Go at your own pace"),
                                }),
                                c.jsx("small", {
                                  children: t("Pause. Resume. Keep going."),
                                }),
                              ],
                            }),
                          ],
                        }),
                        c.jsxs("div", {
                          className: "hero-art",
                          "aria-hidden": "true",
                          children: [
                            c.jsx("span", {
                              className: "art-line",
                            }),
                            c.jsxs("div", {
                              className: "art-file",
                              children: [
                                c.jsx(qm, {
                                  size: 27,
                                }),
                                c.jsx("span", {
                                  children: t("Your file is shared."),
                                }),
                                c.jsx("span", {
                                  className: "art-check",
                                  children: c.jsx(ki, {
                                    size: 16,
                                  }),
                                }),
                              ],
                            }),
                            c.jsxs("div", {
                              className: "art-caption",
                              children: [
                                c.jsx("span", {
                                  className: "tiny-dot",
                                }),
                                t(" A SAFE LANDING FOR EVERY FILE"),
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
                              children: c.jsx(gn, {
                                size: 25,
                              }),
                            }),
                            c.jsx("span", {
                              className: "pill green",
                              children: t("FOR RECIPIENTS"),
                            }),
                          ],
                        }),
                        c.jsx("h2", {
                          children: t("Have an access code?"),
                        }),
                        c.jsxs("p", {
                          className: "muted",
                          children: [
                            t("Enter the access code you received."),
                            c.jsx("br", {}),
                            t("We\u2019ll take it from here."),
                          ],
                        }),
                        c.jsx(AccessForm, {
                          initialCode: xl,
                          onFile: sl,
                        }),
                        c.jsx("div", {
                          className: "receive-footer",
                          children: t(
                            "No account needed. Just your code and email.",
                          ),
                        }),
                      ],
                    }),
                  ],
                }),
                c.jsxs("footer", {
                  className: "public-footer",
                  children: [
                    c.jsx("span", {
                      children: t(
                        "File Station \xB7 Your files, well connected.",
                      ),
                    }),
                    c.jsx("span", {
                      children: t("Private by default. Thoughtfully shared."),
                    }),
                  ],
                }),
              ],
            })
        : c.jsxs("div", {
            className: "loading",
            children: [
              c.jsx(Brand, {}),
              c.jsx("p", {
                children: t("Opening your station\u2026"),
              }),
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
          folderId: R === "files" ? currentFolder : null,
          onClose: () => M(!1),
          onUploaded: () => {
            (J("transfers"), Z());
          },
        }),
      S &&
        codeOpen &&
        c.jsx(Modal, {
          title: t("Use your access code"),
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
          title: t("Delete this file?"),
          message: t(
            "\u201C{0}\u201D will be permanently removed from storage. Every access code for this file will become invalid.",
            {
              0: $.name,
            },
          ),
          onClose: () => ye(void 0),
          onConfirm: async () => {
            (await api(`/files/${$.id}`, {
              method: "DELETE",
            }),
              await Z(),
              ne("File deleted and all its shares invalidated."));
          },
        }),
      oe &&
        c.jsxs(Modal, {
          title: t("A file for you."),
          wide: true,
          subtitle: t("Your recipient email has been verified."),
          onClose: () => sl(void 0),
          children: [
            c.jsxs("div", {
              className: "received-file",
              children: [
                c.jsx(FileIcon, {
                  name: oe.name,
                }),
                c.jsxs("div", {
                  children: [
                    c.jsx("strong", {
                      children: oe.name,
                    }),
                    c.jsxs("small", {
                      children: [
                        formatBytes(oe.size),
                        " \xB7 ",
                        formatDate(oe.expires_at),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            c.jsx(
              FilePreview,
              {
                file: oe,
              },
              oe.id,
            ),
            c.jsxs("button", {
              className: "button primary full",
              onClick: () => {
                fe(oe);
              },
              children: [
                c.jsx(gn, {
                  size: 18,
                }),
                t("Start resumable download"),
              ],
            }),
            canDirectDownload(oe)
              ? c.jsxs("a", {
                  className: "text-button direct-download",
                  href: `${basePath}/api/files/${oe.id}/download`,
                  children: [
                    t("Direct browser download"),
                    c.jsx(zm, {
                      size: 14,
                    }),
                  ],
                })
              : c.jsx("p", {
                  className: "fineprint",
                  children: t(
                    "Use resumable download for files this size on this storage.",
                  ),
                }),
            c.jsx(TransfersPanel, {
              version: _e,
              onError: Ae,
            }),
          ],
        }),
      De &&
        c.jsxs("div", {
          role: "status",
          className: "toast",
          children: [
            c.jsx(ki, {
              size: 18,
            }),
            t(De),
            c.jsx("button", {
              className: "icon-button",
              "aria-label": t("Dismiss notification"),
              onClick: () => W(""),
              children: c.jsx(Lf, {
                size: 16,
              }),
            }),
          ],
        }),
      !S &&
        Qe &&
        c.jsx("div", {
          className: "public-error",
          children: c.jsx(ErrorMessage, {
            error: Qe,
          }),
        }),
    ],
  });
}
function TransfersPanel({ _version: S = 0, version: v = 0, onError: T }) {
  D.useSyncExternalStore(transfers.subscribe, transfers.getSnapshot);
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
      c.jsxs("div", {
        className: "transfer-options",
        children: [
          c.jsxs("label", {
            children: [
              t("Parallel connections"),
              c.jsx("select", {
                "aria-label": t("Parallel connections"),
                value: transfers.concurrency,
                onChange: (event) =>
                  transfers.setConcurrency(event.target.value),
                children: [1, 2, 3].map((value) =>
                  c.jsx(
                    "option",
                    {
                      value,
                      children: String(value),
                    },
                    value,
                  ),
                ),
              }),
            ],
          }),
          c.jsx("small", {
            children: t(
              "Applies to new or resumed transfers. OneDrive uploads use one connection.",
            ),
          }),
        ],
      }),
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
                            ? c.jsx(a1, {
                                size: 20,
                              })
                            : c.jsx(Gf, {
                                size: 20,
                              }),
                      }),
                      c.jsxs("div", {
                        children: [
                          c.jsx("strong", {
                            children: M.name,
                          }),
                          c.jsxs("small", {
                            children: [
                              M.direction === "upload"
                                ? t("Uploading")
                                : t("Downloading"),
                              " \xB7 ",
                              formatBytes(M.done),
                              t(" of"),
                              " ",
                              formatBytes(M.size),
                              " \xB7 ",
                              t(M.state),
                              M.connections
                                ? t(" \xB7 {0} connection{1}", {
                                    0: M.connections,
                                    1: M.connections === 1 ? "" : t("s"),
                                  })
                                : "",
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
                                title: t("Pause"),
                                "aria-label": t("Pause {0}", {
                                  0: M.name,
                                }),
                                onClick: () => transfers.pause(M.id),
                                children: c.jsx(Xm, {
                                  size: 18,
                                }),
                              })
                            : M.state !== "complete"
                              ? c.jsxs(c.Fragment, {
                                  children: [
                                    c.jsx("button", {
                                      className: "icon-button",
                                      title: t("Resume"),
                                      "aria-label": t("Resume {0}", {
                                        0: M.name,
                                      }),
                                      onClick: () => {
                                        transfers.resume(M.id);
                                      },
                                      children: c.jsx(d1, {
                                        size: 18,
                                      }),
                                    }),
                                    M.direction === "upload" &&
                                      c.jsx("button", {
                                        className: "text-button",
                                        onClick: () => {
                                          (C(M.id), o.current?.click());
                                        },
                                        children: t("Select original file"),
                                      }),
                                  ],
                                })
                              : M.direction === "download"
                                ? c.jsx("button", {
                                    className: "icon-button",
                                    title: t("Save again"),
                                    "aria-label": t("Save download again"),
                                    onClick: () => {
                                      transfers
                                        .saveDownload(M)
                                        .catch((R) => T(R.message));
                                    },
                                    children: c.jsx(gn, {
                                      size: 18,
                                    }),
                                  })
                                : c.jsx(ki, {
                                    size: 18,
                                  }),
                          c.jsx("button", {
                            className: "icon-button",
                            title:
                              M.state === "complete"
                                ? t("Dismiss")
                                : t("Cancel and remove transfer"),
                            "aria-label": t("Remove {0}", {
                              0: M.name,
                            }),
                            onClick: () =>
                              M.state === "complete"
                                ? transfers.dismiss(M.id)
                                : void B(M),
                            children: c.jsx(Lf, {
                              size: 17,
                            }),
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
                  M.error &&
                    c.jsx(ErrorMessage, {
                      error: M.error,
                    }),
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
                children: c.jsx(gn, {
                  size: 32,
                }),
              }),
              c.jsx("h3", {
                children: t("A clear track."),
              }),
              c.jsx("p", {
                children: t(
                  "Uploads and downloads will appear here, with pause and resume controls.",
                ),
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
  formatDate,
  FileIcon,
  canDirectDownload,
  fingerprint,
  ShareDialog,
  AccessForm,
  TransfersPanel,
};
