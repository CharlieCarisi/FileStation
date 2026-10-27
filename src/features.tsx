import { t, getLocale } from "./i18n";
import { parseRecipients } from "../shared/recipients";
import RecipientField from "./RecipientField";
import React, {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  api,
  post,
  Modal,
  ErrorMessage,
  transfers,
  formatBytes,
  basePath,
  TransfersPanel,
} from "./App.jsx";
import FilePreview from "./FilePreview";
import { DownloadIcon } from "./TransferFeedback";
import { FilePenLine, CloudUpload } from "lucide-react";
import { FolderSelect, SpaceSelect } from "./Folders";
const DocumentEditor = lazy(() => import("./DocumentEditor"));
type Row = Record<string, any>;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";
export function AccessGate({
  initialCode = "",
  onFile,
}: {
  initialCode?: string;
  onFile: (file: any) => void;
}) {
  const [code, setCode] = useState(initialCode),
    [email, setEmail] = useState(""),
    [pin, setPin] = useState("");
  const [challenge, setChallenge] = useState<Row | null>(null),
    [workspace, setWorkspace] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!challenge)
        setChallenge(
          await post("/access/request", {
            code,
            email,
          }),
        );
      else {
        const result = await post("/access/verify", {
          challengeId: challenge.challengeId,
          pin,
          kind: challenge.kind,
        });
        if (result.kind === "download") onFile(result.file);
        else setWorkspace(result);
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="receive-form" onSubmit={submit}>
        {challenge ? (
          <>
            <p className="muted">
              {t("A verification PIN was sent to ")}
              <strong>{email}</strong>.
            </p>
            <label>
              {t("Email verification PIN")}
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </label>
            {challenge.developmentPin && (
              <p className="development">
                {t("Local email simulator \xB7 PIN:")}{" "}
                <strong>{challenge.developmentPin}</strong>
              </p>
            )}
          </>
        ) : (
          <>
            <label>
              {t("File access code")}
              <input
                className="code-input"
                required
                maxLength={18}
                autoComplete="off"
                placeholder={t("Download, upload or collaboration code")}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              {t("Your recipient email")}
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                placeholder="you@company.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </>
        )}
        <ErrorMessage error={error} />
        <button className="button primary full" disabled={busy}>
          {busy
            ? t("Verifying\u2026")
            : challenge
              ? t("Verify and continue")
              : t("Continue securely")}
        </button>
        {challenge && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setChallenge(null);
              setPin("");
            }}
          >
            {t("Use another code or email")}
          </button>
        )}
        <p className="fineprint">
          {t(
            "One code to download a file, submit documents, or join a collaboration.",
          )}
        </p>
      </form>
      {workspace && (
        <Modal
          title={workspace.invitation.title}
          onClose={() => setWorkspace(null)}
          wide
        >
          <InvitationPortal initial={workspace} />
        </Modal>
      )}
    </>
  );
}
export function InvitationDialog({
  kind,
  source,
  connectors: supplied,
  files = [],
  onClose,
  onSaved,
}: {
  kind: string;
  source?: Row;
  connectors?: Row[];
  files?: Row[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [connectors, setConnectors] = useState<Row[]>(supplied || []),
    [title, setTitle] = useState(""),
    [sourceId, setSourceId] = useState(source?.id || "");
  const [target, setTarget] = useState(source ? workingName(source.name) : ""),
    [connectorId, setConnector] = useState(
      source?.connector_id || supplied?.[0]?.id || "",
    );
  const [destinationSpace, setDestinationSpace] = useState(
    source?.space || "private",
  );
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderReady, setFolderReady] = useState(false);
  const [recipients, setRecipients] = useState(""),
    [days, setDays] = useState(7),
    [maxMB, setMaxMB] = useState(
      Math.max(100, Math.ceil(((source?.size || 0) * 2) / 1e6)),
    ),
    [count, setCount] = useState(10),
    [send, setSend] = useState(true);
  const [result, setResult] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supplied)
      api("/connectors")
        .then((r: Row) => {
          setConnectors(r.connectors);
          setConnector((v: string) => v || r.connectors[0]?.id || "");
        })
        .catch((e: Error) => setError(e.message));
  }, []);
  function chooseSource(id: string) {
    const file = files.find((f) => f.id === id);
    setSourceId(id);
    if (file) {
      setDestinationSpace(file.space || "private");
      setFolderId(null);
      setFolderReady(false);
      setTarget(workingName(file.name));
      setConnector(file.connector_id);
      setMaxMB(Math.max(100, Math.ceil((file.size * 2) / 1e6)));
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(
        await post("/invitations", {
          kind,
          title,
          sourceFileId: sourceId,
          targetName: target,
          connectorId,
          folderId,
          space: destinationSpace,
          recipients: parseRecipients(recipients),
          expiresDays: days,
          maxFileBytes: Math.round(maxMB * 1e6),
          maxFiles: count,
          sendEmail: send,
        }),
      );
      onSaved?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        result
          ? t("Your invitation is ready.")
          : kind === "submission"
            ? t("Request documents.")
            : t("Share for collaboration.")
      }
      onClose={onClose}
    >
      {result ? (
        <>
          <div className="share-code">
            <span>{t("ACCESS CODE")}</span>
            <strong>{result.code}</strong>
          </div>
          <label>
            {t("Invitation link")}
            <input
              readOnly
              value={result.link}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            className="button primary"
            onClick={() =>
              navigator.clipboard
                .writeText(result.link)
                .catch(() => setError("Select and copy the link above."))
            }
          >
            {t("Copy link")}
          </button>
          <p>
            {result.developmentEmail
              ? t("Email simulated locally. Copy the link for testing.")
              : result.emailSent
                ? result.recipientCount === 1
                  ? t("Invitation email sent to 1 recipient.")
                  : t("Invitation email sent to {0} recipients.", {
                      0: result.recipientCount,
                    })
                : t("Send this link and code to the invited recipients.")}
          </p>
          <p className="fineprint">
            {t(
              "Everyone invited uses this same code and verifies their own email address.",
            )}
          </p>
          <ErrorMessage error={result.emailError || error} />
        </>
      ) : (
        <form onSubmit={submit} className="feature-form">
          <label>
            {t("Invitation title")}
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === "submission"
                  ? t("Documents for our next meeting")
                  : t("Review the proposed document")
              }
            />
          </label>
          {kind === "collaboration" && (
            <>
              {source ? (
                <p>
                  {t("Original: ")}
                  <strong>{source.name}</strong>
                </p>
              ) : (
                <label>
                  {t("Original document")}
                  <select
                    required
                    value={sourceId}
                    onChange={(e) => chooseSource(e.target.value)}
                  >
                    <option value="">{t("Choose an uploaded document")}</option>
                    {files
                      .filter((f) => f.state === "ready")
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                {t("Target filename")}
                <input
                  required
                  maxLength={255}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder={t("Reviewed-document.docx")}
                />
              </label>
              <p className="fineprint">
                {t(
                  "The original is preserved. Online edits and re-uploads replace one working copy using this target filename. No version history is kept.",
                )}
              </p>
            </>
          )}
          <label>
            {t("Save submitted files to")}
            <select
              required
              value={connectorId}
              onChange={(e) => setConnector(e.target.value)}
            >
              <option value="">{t("Choose storage")}</option>
              {connectors
                .filter((c) => c.enabled)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <SpaceSelect
            value={destinationSpace}
            onChange={(space) => {
              setFolderReady(false);
              setDestinationSpace(space);
              setFolderId(null);
            }}
          />
          {destinationSpace === "public" && (
            <p className="info">
              {t(
                "Submitted files will be visible to all approved team members.",
              )}
            </p>
          )}
          <FolderSelect
            key={destinationSpace}
            space={destinationSpace}
            value={folderId}
            onChange={setFolderId}
            onReady={setFolderReady}
          />
          <RecipientField
            label={t("Invited email addresses")}
            value={recipients}
            onChange={setRecipients}
          />
          <div className="field-row">
            <label>
              {t("Expires in days")}
              <input
                required
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <label>
              {t("Maximum file size (MB)")}
              <input
                required
                type="number"
                min={0.001}
                step={0.001}
                value={maxMB}
                onChange={(e) => setMaxMB(Number(e.target.value))}
              />
            </label>
          </div>
          {kind === "submission" && (
            <label>
              {t("Maximum submissions across this invitation")}
              <input
                required
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={send}
              onChange={(e) => setSend(e.target.checked)}
            />
            {t("Email the invitation automatically")}
          </label>
          <ErrorMessage error={error} />
          <button
            className="button primary full"
            disabled={busy || !folderReady}
          >
            {busy ? t("Creating\u2026") : t("Create invitation")}
          </button>
        </form>
      )}
    </Modal>
  );
}
function workingName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}-collaboration${name.slice(dot)}`
    : `${name}-collaboration`;
}
export function InvitationManager({
  kind,
  connectors,
  files,
  user,
  onNotice,
}: {
  kind: string;
  connectors: Row[];
  files: Row[];
  user: Row;
  onNotice: (text: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [create, setCreate] = useState(false),
    [workspace, setWorkspace] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [all, setAll] = useState(false);
  async function refresh() {
    try {
      setRows((await api(`/invitations${all ? "?all=true" : ""}`)).invitations);
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    refresh();
  }, [all]);
  async function revoke(row: Row) {
    if (!confirm(t("Revoke this invitation? Its recipients will lose access.")))
      return;
    try {
      await api(`/invitations/${row.id}`, {
        method: "DELETE",
      });
      await refresh();
      onNotice("Invitation revoked.");
    } catch (e) {
      setError(message(e));
    }
  }
  async function open(row: Row) {
    try {
      setWorkspace(await api(`/invitations/${row.id}/view`));
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("WORKING TOGETHER")}</span>
          <h1>
            {kind === "submission"
              ? t("A place to receive.")
              : t("Documents, together.")}
          </h1>
          <p className="muted">
            {kind === "submission"
              ? t(
                  "Invite external partners to submit documents to storage you choose.",
                )
              : t(
                  "Keep the original. Share a working copy for online edits or desktop re-uploads.",
                )}
          </p>
        </div>
        <button className="button primary" onClick={() => setCreate(true)}>
          {kind === "submission"
            ? t("New file request")
            : t("New collaboration")}
        </button>
      </div>
      {user.role === "admin" && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          {t("Show invitations from all users")}
        </label>
      )}
      <ErrorMessage error={error} />
      <div className="invitation-grid">
        {rows
          .filter((r) => r.kind === kind)
          .map((row) => (
            <section className="panel invitation-card" key={row.id}>
              <h2>{row.title}</h2>
              <p className="muted">
                {row.connector_name} ·{" "}
                {row.revoked_at
                  ? t("Revoked")
                  : row.expires_at <= Date.now()
                    ? t("Expired")
                    : t("Expires {0}", {
                        "0": new Date(row.expires_at).toLocaleDateString(
                          getLocale(),
                        ),
                      })}
              </p>
              <p className="fineprint">
                {t("Destination folder")}:{" "}
                {row.space === "public" ? t("Public") : t("Private")} /{" "}
                {row.folder_name || t("Root")}
              </p>
              {all && <p>{row.owner_email}</p>}
              <p>{row.recipients.join(", ")}</p>
              {row.target_name && (
                <p>
                  {t("Working copy: ")}
                  <strong>{row.target_name}</strong>
                </p>
              )}
              <code>{row.code}</code>
              <div className="feature-actions">
                <button
                  className="button secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(row.link)
                      .then(() => onNotice("Invitation link copied."))
                      .catch(() => setError("Copy this link: " + row.link))
                  }
                >
                  {t("Copy link")}
                </button>
                {!row.revoked_at && row.expires_at > Date.now() && (
                  <>
                    <button
                      className="button secondary"
                      onClick={() => open(row)}
                    >
                      {kind === "submission"
                        ? t("Open request")
                        : t("Open document")}
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => revoke(row)}
                    >
                      {t("Revoke")}
                    </button>
                  </>
                )}
              </div>
              <details>
                <summary>
                  {kind === "submission"
                    ? t("Submissions")
                    : t("Working files")}
                </summary>
                {row.files
                  .filter((f: Row) => f.published_at && f.state === "ready")
                  .map((f: Row) => (
                    <p key={f.id}>
                      <a href={`${basePath}/api/files/${f.id}/download`}>
                        {f.name}
                      </a>{" "}
                      · {f.recipient_email} · {formatBytes(f.size)}
                    </p>
                  ))}
              </details>
            </section>
          ))}
      </div>
      {!rows.some((r) => r.kind === kind) && (
        <section className="panel">
          <p className="muted">{t("Your invitations will appear here.")}</p>
        </section>
      )}
      {create && (
        <InvitationDialog
          kind={kind}
          connectors={connectors}
          files={files}
          onClose={() => setCreate(false)}
          onSaved={refresh}
        />
      )}
      {workspace && (
        <Modal
          title={workspace.invitation.title}
          wide
          onClose={() => {
            setWorkspace(null);
            refresh();
          }}
        >
          <InvitationPortal initial={workspace} />
        </Modal>
      )}
    </>
  );
}
export function InvitationPortal({ initial }: { initial: Row }) {
  const [data, setData] = useState(initial),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  useSyncExternalStore(transfers.subscribe, transfers.getSnapshot);
  const invitation = data.invitation,
    path = `/invitations/${invitation.id}/download`;
  const completed = transfers.items
    .filter(
      (t: Row) => t.invitationId === invitation.id && t.state === "complete",
    )
    .map((t: Row) => t.id)
    .join(",");
  async function refresh() {
    try {
      setData(await api(`/invitations/${invitation.id}/view`));
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    refresh();
  }, [completed]);
  async function upload(files: FileList | null) {
    if (!files) return;
    setError("");
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > invitation.max_file_bytes)
          throw Error("The file exceeds this invitation’s size limit.");
        await transfers.upload(file, undefined, {
          id: invitation.id,
          baseRevision: invitation.revision,
        });
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="invitation-portal">
      <p className="muted">
        {t("Expires ")}
        {new Date(invitation.expires_at).toLocaleString(getLocale())}
        {t(" \xB7 Up to")} {formatBytes(invitation.max_file_bytes)}
        {t(" per file.")}
      </p>
      <ErrorMessage error={error} />
      {invitation.kind === "collaboration" ? (
        <>
          <h3>{invitation.target_name}</h3>
          <p>
            {t(
              "The original is preserved. Saved edits and re-uploads replace this working copy.",
            )}
          </p>
          <FilePreview
            key={data.file.id}
            file={data.file}
            previewPath={`/invitations/${invitation.id}/preview`}
          />
          <div className="feature-actions">
            <button
              className="button primary"
              onClick={() => setEditing(true)}
              disabled={
                !/\.(docx|txt|md|markdown|csv|json|log|xml|ya?ml)$/i.test(
                  invitation.target_name,
                ) || data.file.size > 20 * 1024 * 1024
              }
            >
              <FilePenLine size={17} aria-hidden="true" />
              {t("Edit online")}
            </button>
            <button
              className="button secondary"
              onClick={() =>
                transfers
                  .download(data.file, path)
                  .catch((e: Error) => setError(e.message))
              }
            >
              <DownloadIcon resumable />
              {t("Resumable download")}
            </button>
            <a className="text-button" href={`${basePath}/api${path}`}>
              <DownloadIcon />
              {t("Direct download")}
            </a>
          </div>
          <p className="fineprint">
            {t(
              "Online editing supports DOCX and plain text up to 20 MiB. For other files, download, edit on your computer, and re-upload below.",
            )}
          </p>
        </>
      ) : (
        <p>
          {t(
            "Your submitted files are available to the requester. Other invited partners cannot see them.",
          )}
        </p>
      )}
      <label className="submission-drop">
        <CloudUpload size={24} aria-hidden="true" />
        {invitation.kind === "collaboration"
          ? t("Re-upload your edited document")
          : t("Choose documents to submit")}
        <input
          type="file"
          disabled={busy}
          multiple={invitation.kind === "submission"}
          accept={
            invitation.kind === "collaboration" &&
            invitation.target_name.includes(".")
              ? invitation.target_name.slice(
                  invitation.target_name.lastIndexOf("."),
                )
              : undefined
          }
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <TransfersPanel onError={setError} />
      <h3>{t("Your submissions")}</h3>
      {data.submitted.map((f: Row) => (
        <p key={f.id}>
          {f.name} · {formatBytes(f.size)} ·{" "}
          {f.published_at
            ? t("Saved")
            : f.state === "uploading"
              ? t("In progress")
              : t("Awaiting save")}
        </p>
      ))}
      {editing && (
        <Suspense fallback={<p>{t("Loading document editor\u2026")}</p>}>
          <DocumentEditor
            file={data.file}
            invitation={invitation}
            downloadPath={path}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              refresh();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
export function OneDriveDialog({
  connector,
  onClose,
  onSaved,
  onBack,
}: {
  connector?: Row;
  onClose: () => void;
  onSaved: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(connector?.name || "OneDrive for Business"),
    [tenantId, setTenant] = useState(connector?.config.tenantId || ""),
    [clientId, setClient] = useState(connector?.config.clientId || ""),
    [secret, setSecret] = useState("");
  const [driveId, setDrive] = useState(connector?.config.driveId || ""),
    [folderId, setFolder] = useState(connector?.config.folderId || "root"),
    [userEmail, setUserEmail] = useState(""),
    [folderName, setFolderName] = useState(""),
    [listing, setListing] = useState<Row | null>(null);
  const [capacity, setCapacity] = useState(
      (connector?.limit_bytes || 10e9) / 1e9,
    ),
    [retention, setRetention] = useState(
      String(connector?.retention_days ?? 30),
    ),
    [enabled, setEnabled] = useState(
      connector ? Boolean(connector.enabled) : true,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function settings() {
    return {
      connectorId: connector?.id,
      tenantId,
      clientId,
      clientSecret: secret || undefined,
      driveId,
      folderId,
    };
  }
  async function browse(id = folderId, append = false) {
    setBusy(true);
    setError("");
    try {
      const result = await post("/admin/onedrive/browse", {
        ...settings(),
        folderId: id,
        skip: append ? listing?.next : undefined,
      });
      setFolder(result.folder.id);
      setListing(
        append && listing
          ? {
              ...result,
              folders: [...listing.folders, ...result.folders],
            }
          : result,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function resolve() {
    setBusy(true);
    setError("");
    try {
      const result = await post("/admin/onedrive/resolve", {
        ...settings(),
        userEmail,
      });
      setDrive(result.driveId);
      setFolder("root");
      setListing(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function createFolder() {
    setBusy(true);
    setError("");
    try {
      const result = await post("/admin/onedrive/folders", {
        ...settings(),
        name: folderName,
      });
      setFolder(result.folder.id);
      setListing({
        folder: result.folder,
        folders: [],
        next: "",
      });
      setFolderName("");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/admin/connectors${connector ? "/" + connector.id : ""}`, {
        method: connector ? "PUT" : "POST",
        body: JSON.stringify({
          name,
          kind: "onedrive",
          tenantId,
          clientId,
          driveId,
          folderId,
          limitBytes: Math.round(capacity * 1e9),
          retentionDays: retention ? Number(retention) : null,
          enabled,
          ...(secret
            ? {
                credentials: {
                  clientSecret: secret,
                },
              }
            : {}),
        }),
      });
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("OneDrive for Business")} onClose={onClose}>
      <form onSubmit={save} className="feature-form">
        <p className="muted">
          {t(
            "Connect an enterprise application. Files stay in your selected folder; File Station handles invitations without OneDrive sharing links.",
          )}
        </p>
        <label>
          {t("Name")}
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          {t("Tenant ID")}
          <input
            required
            value={tenantId}
            onChange={(e) => setTenant(e.target.value)}
          />
        </label>
        <label>
          {t("Application (client) ID")}
          <input
            required
            value={clientId}
            onChange={(e) => setClient(e.target.value)}
          />
        </label>
        <label>
          {t("Client secret value")}
          <input
            type="password"
            autoComplete="new-password"
            required={!connector}
            value={secret}
            placeholder={
              connector ? t("Leave blank to keep the saved secret") : ""
            }
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <p className="fineprint">
          {t(
            "Requires Microsoft Graph application permissions and tenant administrator consent. Sites.ReadWrite.All enables the full connector with tenant-wide access. For restricted access, use Sites.Selected with a write grant on your storage site and enter its Drive ID manually. Delegated permissions do not apply to this sign-in method.",
          )}
        </p>
        <div className="feature-actions">
          <label>
            {t("OneDrive owner email")}
            <input
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="storage-account@your-tenant.com"
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !userEmail}
            onClick={resolve}
          >
            {t("Find drive")}
          </button>
        </div>
        <label>
          {t("Drive ID")}
          <input
            required
            value={driveId}
            onChange={(e) => {
              setDrive(e.target.value);
              setListing(null);
            }}
          />
        </label>
        <label>
          {t("Storage root folder ID")}
          <input
            required
            aria-describedby="onedrive-folder-hint"
            value={folderId}
            onChange={(e) => {
              setFolder(e.target.value);
              setListing(null);
            }}
          />
        </label>
        <p className="fineprint" id="onedrive-folder-hint">
          {t(
            "Enter Microsoft\u2019s folder item ID, or use the folder picker. A folder name such as FileStation is not an ID. Enter root to use the drive root. The folder is checked when you save a new storage location.",
          )}
        </p>
        <div className="feature-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy || !driveId}
            onClick={() => browse()}
          >
            {t("Browse folders")}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy || !driveId}
            onClick={() => browse("root")}
          >
            {t("Browse drive root")}
          </button>
        </div>
        {listing && (
          <div className="folder-picker">
            <strong>
              {t("Selected: ")}
              {listing.folder.name}
            </strong>
            <p className="fineprint">
              {t(
                "Documents will be stored in this folder. Open a folder below to select it.",
              )}
            </p>
            <div className="feature-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => browse("root")}
              >
                {t("Drive root")}
              </button>
              {listing.folder.parentId && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => browse(listing.folder.parentId)}
                >
                  {t("Parent folder")}
                </button>
              )}
            </div>
            {listing.folders.map((folder: Row) => (
              <button
                key={folder.id}
                type="button"
                className="folder-option"
                disabled={busy}
                onClick={() => browse(folder.id)}
              >
                📁 {folder.name}
              </button>
            ))}
            {listing.next && (
              <button
                type="button"
                className="text-button"
                onClick={() => browse(folderId, true)}
              >
                {t("More folders")}
              </button>
            )}
            <div className="feature-actions">
              <label>
                {t("New folder name")}
                <input
                  value={folderName}
                  maxLength={128}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder={t("FileStation")}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={busy || !folderName.trim()}
                onClick={createFolder}
              >
                {t("Create folder here")}
              </button>
            </div>
          </div>
        )}
        <p className="fineprint">
          {t(
            "Use a dedicated private folder or service account with restricted native permissions. OneDrive owners and tenant administrators retain their normal access. The selected location is locked after the first file is stored.",
          )}
        </p>
        <div className="field-row">
          <label>
            {t("Capacity (GB)")}
            <input
              required
              type="number"
              min={0.001}
              step={0.001}
              max={5000}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </label>
          <label>
            {t("Retention in days")}
            <input
              type="number"
              min={1}
              max={3650}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              placeholder={t("No time limit")}
            />
          </label>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("Enabled")}
        </label>
        <ErrorMessage error={error} />
        <button className="button primary full" disabled={busy}>
          {busy ? t("Working\u2026") : t("Save connector")}
        </button>
        {!connector && (
          <button type="button" className="text-button" onClick={onBack}>
            {t("Choose another provider")}
          </button>
        )}
      </form>
    </Modal>
  );
}
