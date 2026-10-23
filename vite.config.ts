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
      },
    },
  ],
  base: "./",
  build: { sourcemap: true },
});
