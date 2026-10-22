// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { PART_SIZE } from "./types.js";
import {
  HttpError,
  ensure,
  json,
  body,
  id,
  hash,
  token,
  decrypt,
} from "./util.js";
function validateWebDavEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HttpError(400, "Enter a valid WebDAV HTTPS folder URL.");
  }
  ensure(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
        url.hostname,
      ) &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(
        url.hostname,
      ) &&
      !/%(?:2f|5c|00)/i.test(url.pathname),
    400,
    "Use a public HTTPS WebDAV hostname through Cloudflare, with no port, embedded credentials, query or fragment.",
  );
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url.href;
}
__name(validateWebDavEndpoint, "validateWebDavEndpoint");
var WebDavStorage = class {
  constructor(env, connector) {
    this.env = env;
    this.connector = connector;
    this.endpoint = validateWebDavEndpoint(
      JSON.parse(connector.config).endpoint,
    );
  }
  env;
  connector;
  static {
    __name(this, "WebDavStorage");
  }
  endpoint;
  async request(path, method, body2, extra = {}) {
    ensure(
      this.connector.encrypted_credentials,
      503,
      "WebDAV credentials are not configured.",
    );
    const credentials = await decrypt(
      this.env,
      this.connector.encrypted_credentials,
    );
    const bytes = new TextEncoder().encode(
      `${credentials.username}:${credentials.password}`,
    );
    const url = new URL(this.endpoint);
    url.pathname += path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(url.href, {
      method,
      body: body2,
      redirect: "manual",
      signal: AbortSignal.timeout(6e4),
      headers: {
        Authorization: `Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))}`,
        ...(credentials.accessClientId && credentials.accessClientSecret
          ? {
              "CF-Access-Client-Id": credentials.accessClientId,
              "CF-Access-Client-Secret": credentials.accessClientSecret,
            }
          : {}),
        ...extra,
      },
    });
    ensure(
      response.status < 300 || response.status >= 400,
      502,
      "WebDAV redirected the request. Check the WebDAV folder URL and Cloudflare Access service authentication.",
    );
    return response;
  }
  path(file, name = "") {
    ensure(
      /^[a-z0-9-]+$/i.test(this.connector.id) && /^[a-z0-9-]+$/i.test(file.id),
      500,
      "Invalid storage identifier.",
    );
    return `file-station/${this.connector.id}/${file.id}/${name}`;
  }
  async collection(path) {
    const r = await this.request(path, "MKCOL");
    if (r.status === 201) {
      await r.arrayBuffer();
      return;
    }
    await r.arrayBuffer();
    ensure(
      r.status === 405,
      502,
      "WebDAV could not create the upload folder. Check folder permissions and Cloudflare Access service authentication.",
    );
    const check = await this.request(path, "PROPFIND", void 0, { Depth: "0" });
    const text = await check.text();
    ensure(
      check.status === 207 &&
        /<(?:[\w-]+:)?collection(?:\s[^>]*)?\s*\/?\s*>/i.test(text),
      502,
      "The WebDAV upload path is not an accessible collection.",
    );
  }
  async test() {
    const r = await this.request("", "PROPFIND", void 0, { Depth: "0" });
    const text = await r.text();
    ensure(
      r.status === 207 &&
        /<(?:[\w-]+:)?collection(?:\s[^>]*)?\s*\/?\s*>/i.test(text),
      502,
      "Cannot read the WebDAV folder. Check the HTTPS folder URL, NAS credentials and Access service token.",
    );
  }
  async create(file) {
    await this.collection("file-station/");
    await this.collection(`file-station/${this.connector.id}/`);
    await this.collection(this.path(file));
    return { uploadId: file.id, fileId: file.id };
  }
  async part(file, number, data) {
    const r = await this.request(
      this.path(file, `${String(number).padStart(5, "0")}.part`),
      "PUT",
      data,
      { "Content-Type": "application/octet-stream" },
    );
    await r.arrayBuffer();
    ensure(
      r.status === 200 || r.status === 201 || r.status === 204,
      502,
      "WebDAV could not save the part. Check write permissions and retry.",
    );
    return hash(data);
  }
  async complete(file, parts) {
    const manifest = {
      version: 1,
      id: file.id,
      size: file.size,
      partSize: PART_SIZE,
      partCount: parts.length,
    };
    const r = await this.request(
      this.path(file, "manifest.json"),
      "PUT",
      JSON.stringify(manifest),
      { "Content-Type": "application/json" },
    );
    await r.arrayBuffer();
    ensure(
      r.status === 200 || r.status === 201 || r.status === 204,
      502,
      "WebDAV could not commit the file. Retry completion.",
    );
  }
  async remove(file) {
    const r = await this.request(this.path(file), "DELETE", void 0, {
      Depth: "infinity",
    });
    await r.arrayBuffer();
    ensure(
      r.status === 200 || r.status === 204 || r.status === 404,
      502,
      "WebDAV could not delete every file part. Cleanup will retry.",
    );
  }
  async download(file, offset, length) {
    const manifestResponse = await this.request(
      this.path(file, "manifest.json"),
      "GET",
    );
    ensure(
      manifestResponse.ok,
      502,
      "The WebDAV file manifest is unavailable.",
    );
    const manifest = await manifestResponse.json();
    ensure(
      manifest.version === 1 &&
        manifest.id === file.id &&
        manifest.size === file.size &&
        manifest.partSize === PART_SIZE &&
        manifest.partCount === Math.ceil(file.size / PART_SIZE),
      502,
      "The WebDAV file manifest does not match this file.",
    );
    let cursor = offset;
    const end = offset + length;
    ensure(
      Math.floor((end - 1) / PART_SIZE) - Math.floor(offset / PART_SIZE) < 32,
      413,
      "Use the resumable download for this file. Each download request may span at most 32 parts.",
    );
    let reader;
    let received = 0,
      expected = 0,
      cancelled = false;
    const open = /* @__PURE__ */ __name(async () => {
      const part = Math.floor(cursor / PART_SIZE) + 1;
      const partSize = Math.min(PART_SIZE, file.size - (part - 1) * PART_SIZE);
      const start = cursor % PART_SIZE;
      expected = Math.min(end - cursor, partSize - start);
      received = 0;
      const r = await this.request(
        this.path(file, `${String(part).padStart(5, "0")}.part`),
        "GET",
        void 0,
        { Range: `bytes=${start}-${start + expected - 1}` },
      );
      ensure(
        r.body &&
          (r.status === 206 ||
            (r.status === 200 && start === 0 && expected === partSize)),
        502,
        "WebDAV did not return the requested file range.",
      );
      if (r.status === 206)
        ensure(
          r.headers.get("content-range") ===
            `bytes ${start}-${start + expected - 1}/${partSize}`,
          502,
          "WebDAV returned an unexpected file range.",
        );
      if (r.headers.has("content-length"))
        ensure(
          Number(r.headers.get("content-length")) === expected,
          502,
          "WebDAV returned an unexpected part size.",
        );
      if (cancelled) {
        await r.body.cancel();
        return;
      }
      reader = r.body.getReader();
    }, "open");
    await open();
    return new ReadableStream({
      async pull(controller) {
        try {
          while (!cancelled) {
            const r = await reader.read();
            if (!r.done) {
              received += r.value.byteLength;
              ensure(received <= expected, 502, "WebDAV sent too many bytes.");
              controller.enqueue(r.value);
              return;
            }
            ensure(
              received === expected,
              502,
              "WebDAV sent an incomplete file part.",
            );
            reader.releaseLock();
            reader = void 0;
            cursor += expected;
            if (cursor === end) {
              controller.close();
              return;
            }
            await open();
          }
        } catch (error) {
          await reader?.cancel().catch(() => {});
          controller.error(error);
        }
      },
      async cancel() {
        cancelled = true;
        await reader?.cancel();
      },
    });
  }
};

export { validateWebDavEndpoint, WebDavStorage };
