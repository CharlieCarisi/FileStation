import type { Env, Row } from "./model";
import { coordinate } from "./coordinator.js";
import { ensure, json } from "./util.js";
import { previewInfo } from "../shared/preview";

// Call only after checking the file/share/invitation authorization.
export async function fileResponse(
  request: Request,
  env: Env,
  file: Row,
  preview = false,
) {
  const info = preview ? previewInfo(file.name) : null;
  if (preview) {
    ensure(
      info,
      415,
      "A preview is not available for this format. Download the file to open it.",
    );
    ensure(
      file.size <= info!.limit,
      413,
      "This file is too large for an in-browser preview. Use the download option.",
    );
    const version = new URL(request.url).searchParams.get("version");
    ensure(
      !version || version === file.id,
      409,
      "The working copy changed. Refresh to preview the latest document.",
    );
  }
  let offset = 0,
    length = file.size,
    partial = false;
  const range = request.headers.get("range");
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) return invalidRange(file.size);
    const start = match[1]
      ? Number(match[1])
      : Math.max(0, file.size - Number(match[2]));
    const end =
      match[1] && match[2]
        ? Math.min(Number(match[2]), file.size - 1)
        : file.size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= file.size ||
      end < start ||
      (!match[1] && Number(match[2]) === 0)
    )
      return invalidRange(file.size);
    offset = start;
    length = end - start + 1;
    partial = true;
  }
  // Browsers can request an open-ended video range. Bound each response so
  // seeking also works on chunk-backed WebDAV, without buffering a whole movie.
  if (
    preview &&
    ["video", "audio"].includes(info!.kind) &&
    length > 8 * 1024 * 1024
  ) {
    length = 8 * 1024 * 1024;
    partial = true;
  }
  const headers = new Headers({
    "Content-Type": info?.mime || "application/octet-stream",
    "Content-Length": String(length),
    "Accept-Ranges": "bytes",
    ETag: `"${file.id}"`,
    "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
    "Cache-Control": "private, no-store",
  });
  if (partial)
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${file.size}`,
    );
  const status = partial ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const response = await coordinate(
    env,
    file.connector_id,
    `/download?file=${file.id}&offset=${offset}&length=${length}`,
  );
  return response.ok
    ? new Response(response.body, { status, headers })
    : response;
}

function invalidRange(size: number) {
  const response = json(
    { error: "Requested range is outside this file. Use one byte range." },
    416,
  );
  response.headers.set("Content-Range", `bytes */${size}`);
  return response;
}
