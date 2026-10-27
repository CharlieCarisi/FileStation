import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import { LanguageProvider, t } from "./i18n";
import { ItemMenuProvider } from "./ItemMenu";
const PreviewPage = lazy(() => import("./PreviewPage"));
const query = new URLSearchParams(location.search);
const previewWindow = query.has("preview") || query.has("previewInvitation");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      {previewWindow ? (
        <Suspense
          fallback={
            <p className="preview-note" role="status">
              {t("Loading preview…")}
            </p>
          }
        >
          <PreviewPage />
        </Suspense>
      ) : (
        <ItemMenuProvider>
          <App />
        </ItemMenuProvider>
      )}
    </LanguageProvider>
  </React.StrictMode>,
);
