import { t } from "./i18n";
import React, { useEffect, useState } from "react";
import { api } from "./http";
import { ErrorMessage } from "./App.jsx";
export default function ShareAddressSettings({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [address, setAddress] = useState("current"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api("/admin/settings")
      .then((result) => setAddress(result.shareBaseUrl))
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          shareBaseUrl: address,
        }),
      });
      onNotice("Share link address saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{t("Share link address")}</h2>
      <p className="muted">
        {t(
          "Choose the website address used in copied links and invitation emails for downloads, file requests, and collaborations.",
        )}
      </p>
      <form onSubmit={save}>
        <label>
          {t("Website address")}
          <select
            aria-label={t("Share link address")}
            value={address}
            disabled={loading || busy}
            onChange={(event) => setAddress(event.target.value)}
          >
            <option value="current">
              {t("Use the current website address")}
            </option>
            <option value="https://files.bychx.com">
              {t("files.bychx.com")}
            </option>
            <option value="https://utils.bychx.com/files">
              {t("utils.bychx.com/files")}
            </option>
          </select>
        </label>
        <p className="fineprint">
          {t(
            "Both addresses remain available. Existing links and access codes continue to work.",
          )}
        </p>
        <ErrorMessage error={error} />
        <button className="button primary" disabled={loading || busy}>
          {busy ? t("Saving\u2026") : t("Save share address")}
        </button>
      </form>
    </section>
  );
}
