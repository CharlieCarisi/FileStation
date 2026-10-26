import { docxLocale } from "./docx-locales";
import { t, LanguageSelector } from "./i18n";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { DocxEditor, type DocxEditorRef } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";
import { setGoogleFontsEnabled } from "@eigenpal/docx-editor-core";
import { basePath, transfers, ErrorMessage } from "./App.jsx";
type Row = Record<string, any>;
setGoogleFontsEnabled(false);
export default function DocumentEditor({
  file,
  invitation,
  downloadPath,
  onClose,
  onSaved,
}: {
  file: Row;
  invitation: Row;
  downloadPath: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editor = useRef<DocxEditorRef>(null),
    [buffer, setBuffer] = useState<ArrayBuffer | null>(null),
    [text, setText] = useState("");
  const [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [transferId, setTransferId] = useState<string | null>(null);
  const docx = /\.docx$/i.test(invitation.target_name);
  const exporting = useRef(false),
    saveLock = useRef(false);
  useSyncExternalStore(transfers.subscribe, transfers.getSnapshot);
  const transfer = transfers.items.find((t: Row) => t.id === transferId);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        if (file.size > 20 * 1024 * 1024)
          throw Error("Use desktop editing for documents larger than 20 MiB.");
        const response = await fetch(`${basePath}/api${downloadPath}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const result = (await response.json()) as Row;
          throw Error(result.error || "The document could not be opened.");
        }
        if (response.headers.get("etag") !== `"${file.id}"`)
          throw Error("The working copy changed. Close and reopen it.");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== file.size)
          throw Error("The document download was incomplete.");
        if (docx) setBuffer(bytes);
        else
          setText(
            new TextDecoder("utf-8", {
              fatal: true,
            }).decode(bytes),
          );
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "The document could not be opened.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (transfer?.state === "complete") {
      setDirty(false);
      onSaved();
    } else if (transfer?.state === "error") {
      saveLock.current = false;
      setSaving(false);
      setError(
        transfer.error ||
          "The document could not be saved. Download your local edits before closing.",
      );
    }
  }, [transfer?.state]);
  async function bytes() {
    if (!docx) return new TextEncoder().encode(text);
    exporting.current = true;
    try {
      const result = await editor.current?.save();
      if (!result) throw Error("The document editor is not ready.");
      return result;
    } finally {
      exporting.current = false;
    }
  }
  async function save(exported?: ArrayBuffer) {
    if (saveLock.current) return;
    saveLock.current = true;
    setError("");
    setSaving(true);
    try {
      const content = exported || (await bytes());
      if (!content.byteLength)
        throw Error("The document must contain at least one byte.");
      const upload = new File([content], invitation.target_name, {
        type: docx
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain;charset=utf-8",
      });
      const id = await transfers.upload(upload, undefined, {
        id: invitation.id,
        baseRevision: invitation.revision,
      });
      setTransferId(id);
    } catch (e) {
      saveLock.current = false;
      setSaving(false);
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  }
  async function downloadLocal() {
    try {
      const url = URL.createObjectURL(new Blob([await bytes()]));
      const link = document.createElement("a");
      link.href = url;
      link.download = invitation.target_name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
  }
  function close() {
    if (!saving && (!dirty || confirm(t("Close without saving these edits?"))))
      onClose();
  }
  return (
    <section
      className="document-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("Edit {0}", {
        "0": invitation.target_name,
      })}
    >
      <header>
        <div>
          <strong>{invitation.target_name}</strong>
          <small>
            {saving
              ? t("Saving working copy\u2026")
              : dirty
                ? t("Unsaved edits")
                : t("Working copy")}
          </small>
        </div>
        <div className="feature-actions">
          <LanguageSelector />
          <button
            className="button secondary"
            onClick={downloadLocal}
            disabled={loading}
          >
            {t("Download my edits")}
          </button>
          <button
            className="button primary"
            onClick={() => save()}
            disabled={loading || saving || (!buffer && docx)}
          >
            {saving ? t("Saving\u2026") : t("Save working copy")}
          </button>
          <button
            className="button secondary"
            onClick={close}
            disabled={saving}
          >
            {t("Close editor")}
          </button>
        </div>
      </header>
      <ErrorMessage error={error} />
      {transfer && saving && (
        <div className="editor-progress">
          <progress value={transfer.done} max={transfer.size} />
          {transfer.state === "running" ? (
            <button
              className="text-button"
              onClick={() => transfers.pause(transfer.id)}
            >
              {t("Pause save")}
            </button>
          ) : transfer.state === "paused" ? (
            <button
              className="text-button"
              onClick={() => transfers.resume(transfer.id)}
            >
              {t("Resume save")}
            </button>
          ) : null}
        </div>
      )}
      <div className="document-editor-body">
        {loading ? (
          <p>{t("Opening document\u2026")}</p>
        ) : docx ? (
          buffer && (
            <DocxEditor
              i18n={docxLocale()}
              ref={editor}
              documentBuffer={buffer}
              documentName={invitation.target_name}
              documentNameEditable={false}
              showFileOpen={false}
              showHelpMenu={false}
              readOnly={saving}
              onChange={() => setDirty(true)}
              onSave={(exported) => {
                if (!exporting.current) save(exported);
              }}
              onError={(e) => setError(e.message)}
              fontFamilies={[
                "Arial",
                "Times New Roman",
                "Calibri",
                "Courier New",
              ]}
            />
          )
        ) : (
          <textarea
            aria-label={t("Document text")}
            className="plain-text-editor"
            value={text}
            disabled={saving}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            spellCheck
          />
        )}
      </div>
    </section>
  );
}
