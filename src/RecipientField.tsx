import React, { useId } from "react";
import { parseRecipients } from "../shared/recipients";
import { t } from "./i18n";
export default function RecipientField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const hint = useId();
  let count = 0;
  try {
    count = parseRecipients(value).length;
  } catch {
    /* Validation is shown on submission. */
  }
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        maxLength={16384}
        required
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="alex@example.com; sam@example.com"
        aria-describedby={hint}
      />
      <small id={hint}>
        {t(
          "Separate addresses with commas, semicolons, spaces, or new lines. Up to 20 recipients.",
        )}
        {count > 0 && (
          <>
            {" "}
            {count === 1 ? t("1 recipient") : t("{0} recipients", { 0: count })}
          </>
        )}
      </small>
    </label>
  );
}
