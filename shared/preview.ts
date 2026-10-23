export type PreviewKind = "image" | "video" | "audio" | "pdf" | "docx" | "text";
export type PreviewInfo = { kind: PreviewKind; mime: string; limit: number };
const MiB = 1024 * 1024;
const formats: Record<string, [PreviewKind, string]> = {
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  bmp: ["image", "image/bmp"],
  mp4: ["video", "video/mp4"],
  m4v: ["video", "video/mp4"],
  webm: ["video", "video/webm"],
  mov: ["video", "video/quicktime"],
  ogv: ["video", "video/ogg"],
  mp3: ["audio", "audio/mpeg"],
  m4a: ["audio", "audio/mp4"],
  aac: ["audio", "audio/aac"],
  wav: ["audio", "audio/wav"],
  ogg: ["audio", "audio/ogg"],
  opus: ["audio", "audio/ogg"],
  flac: ["audio", "audio/flac"],
  pdf: ["pdf", "application/pdf"],
  docx: [
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};
const textExtensions = new Set(
  "txt md markdown csv tsv json log xml yaml yml html htm svg css js jsx ts tsx sql ini toml sh py rs go java c cpp h rb".split(
    " ",
  ),
);

// Use a filename allowlist, never an uploader-supplied MIME type. Markup is shown
// as escaped text; HTML and SVG must never execute under File Station's origin.
export function previewInfo(name: string): PreviewInfo | null {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const format =
    (Object.hasOwn(formats, extension) ? formats[extension] : null) ||
    (textExtensions.has(extension)
      ? (["text", "text/plain; charset=utf-8"] as const)
      : null);
  if (!format) return null;
  const [kind, mime] = format;
  const limit =
    kind === "text"
      ? 2 * MiB
      : kind === "docx"
        ? 20 * MiB
        : kind === "image"
          ? 25 * MiB
          : kind === "pdf"
            ? 50 * MiB
            : Infinity;
  return { kind, mime, limit };
}
