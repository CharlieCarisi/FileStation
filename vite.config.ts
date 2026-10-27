import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-pdf-resources",
      closeBundle() {
        for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"])
          cpSync(
            resolve("node_modules/pdfjs-dist", folder),
            resolve("dist/pdfjs", folder),
            { recursive: true },
          );
        cpSync(
          resolve("node_modules/pdfjs-dist/LICENSE"),
          resolve("dist/pdfjs/LICENSE"),
        );
        for (const [source, destination] of [
          ["node_modules/xlsx/LICENSE", "dist/licenses/sheetjs.txt"],
          [
            "node_modules/@aiden0z/pptx-renderer/LICENSE",
            "dist/licenses/pptx/LICENSE",
          ],
          [
            "node_modules/@aiden0z/pptx-renderer/THIRD_PARTY_NOTICES.md",
            "dist/licenses/pptx/THIRD_PARTY_NOTICES.md",
          ],
          [
            "node_modules/@aiden0z/pptx-renderer/licenses",
            "dist/licenses/pptx/licenses",
          ],
        ])
          cpSync(resolve(source), resolve(destination), { recursive: true });
      },
    },
  ],
  base: "./",
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve("index.html"),
        presentation: resolve("presentation-preview.html"),
      },
    },
  },
});
