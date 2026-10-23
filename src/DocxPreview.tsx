import React, { useState } from "react";
import { DocxEditor } from "@eigenpal/docx-editor-react";
import { setGoogleFontsEnabled } from "@eigenpal/docx-editor-core";
import "@eigenpal/docx-editor-react/styles.css";
setGoogleFontsEnabled(false);
const fonts = ["Arial", "Times New Roman", "Calibri", "Courier New"];

export default function DocxPreview({
  buffer,
  name,
}: {
  buffer: ArrayBuffer;
  name: string;
}) {
  const [error, setError] = useState("");
  return error ? (
    <p className="preview-note" role="alert">
      The DOCX preview could not be opened. Download the document to view it.
    </p>
  ) : (
    <div className="docx-preview" aria-label="Read-only document preview">
      <DocxEditor
        documentBuffer={buffer}
        documentName={name}
        readOnly
        showToolbar={false}
        showRuler={false}
        showFileOpen={false}
        showHelpMenu={false}
        showOutlineButton={false}
        documentNameEditable={false}
        initialZoom={0.75}
        fontFamilies={fonts}
        onError={(error) => setError(error.message)}
      />
      <p className="preview-note">
        Read-only preview. Complex Word layouts may appear differently.
      </p>
    </div>
  );
}
