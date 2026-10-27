import React from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { t } from "./i18n";

export function AccessSteps({ step = 1 }: { step?: number }) {
  return (
    <ol className="access-steps" aria-label={t("Invitation steps")}>
      {[t("Code & email"), t("Verify email"), t("Upload or download")].map(
        (label, index) => (
          <li
            key={index}
            aria-current={step === index + 1 ? "step" : undefined}
            className={step > index + 1 ? "finished" : ""}
          >
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </li>
        ),
      )}
    </ol>
  );
}

export default function GuestGuide({
  mode = "access",
}: {
  mode?: "access" | "upload" | "download" | "collaboration";
}) {
  return (
    <details className="guest-guide">
      <summary>
        <BookOpen size={23} aria-hidden="true" />
        <span>
          <strong>
            {mode === "download"
              ? t("How to download your file")
              : mode === "collaboration"
                ? t("How to work on this document")
                : t("How to upload files")}
          </strong>
          <small>{t("A quick step-by-step guide · No account needed")}</small>
        </span>
        <ChevronDown size={19} className="guide-chevron" aria-hidden="true" />
      </summary>
      <div className="guest-guide-content">
        <ol>
          <li>
            <strong>{t("Open your invitation")}</strong>
            <p>
              {t(
                "Follow the link in your email, or enter the access code your contact gave you.",
              )}
            </p>
          </li>
          <li>
            <strong>{t("Use your invited email address")}</strong>
            <p>
              {t(
                "Enter the email address the invitation was sent to, then choose Continue securely. You do not need to sign in or create an account.",
              )}
            </p>
          </li>
          <li>
            <strong>{t("Check your inbox")}</strong>
            <p>
              {t(
                "Enter the six-digit verification PIN from File Station. Check your junk or spam folder if it has not arrived.",
              )}
            </p>
          </li>
          {mode === "download" ? (
            <li>
              <strong>{t("Preview and download")}</strong>
              <p>
                {t(
                  "Preview supported files, then choose Direct download to save in your browser, or Resumable download to pause and continue in Transfers.",
                )}
              </p>
            </li>
          ) : mode === "collaboration" ? (
            <li>
              <strong>{t("Edit or re-upload")}</strong>
              <p>
                {t(
                  "Choose Edit online for supported documents. Save your changes, or download the document, edit on your computer, and choose Re-upload your edited document before the invitation expires.",
                )}
              </p>
            </li>
          ) : (
            <li>
              <strong>{t("Choose your documents")}</strong>
              <p>
                {t(
                  "Choose documents to submit and select one or more files. Uploads start automatically. Your contact has already chosen where they will be saved.",
                )}
              </p>
            </li>
          )}
          {mode !== "download" && (
            <li>
              <strong>{t("Wait for Done")}</strong>
              <p>
                {t(
                  "Keep the page open until every upload shows Done. You can pause and resume in Transfers. After a refresh, select the same original file to continue an unfinished upload.",
                )}
              </p>
            </li>
          )}
        </ol>
        {mode === "access" && (
          <p className="fineprint">
            {t(
              "A download code opens a file preview and download options instead. A collaboration code lets you edit or re-upload the invited document.",
            )}
          </p>
        )}
      </div>
    </details>
  );
}
