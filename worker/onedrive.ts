import type { Env, Row } from "./model";
import { decrypt, encrypt, ensure, HttpError } from "./util.js";

export const ONEDRIVE_PART_SIZE = 10 * 1024 * 1024; // 32 × Microsoft's required 320 KiB.
const GRAPH = "https://graph.microsoft.com/v1.0";
const tokens = new Map<string, { value: string; expires: number }>();
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export function validateOneDrive(config: Row) {
  ensure(
    uuid.test(config.tenantId || "") && uuid.test(config.clientId || ""),
    400,
    "Enter the Microsoft tenant ID and application (client) ID as UUIDs.",
  );
  for (const key of ["driveId", "folderId"])
    ensure(
      typeof config[key] === "string" &&
        /^[a-z\d!_-]{1,256}$/i.test(config[key]),
      400,
      `Choose a valid OneDrive ${key === "driveId" ? "drive" : "root folder"}.`,
    );
  return {
    tenantId: config.tenantId,
    clientId: config.clientId,
    driveId: config.driveId,
    folderId: config.folderId,
  };
}
function resourceUrl(value: string) {
  const url = new URL(value);
  ensure(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.endsWith(".sharepoint.com"),
    502,
    "Microsoft returned an unsupported storage URL.",
  );
  return url.href;
}
export class OneDriveStorage {
  config: Row;
  constructor(
    private env: Env,
    private connector: Row,
  ) {
    this.config = JSON.parse(connector.config);
  }
  tokenKey() {
    return `${this.config.tenantId}:${this.config.clientId}:${this.connector.encrypted_credentials}`;
  }
  async accessToken() {
    ensure(
      this.connector.encrypted_credentials,
      503,
      "OneDrive application credentials are not configured.",
    );
    const cacheKey = this.tokenKey();
    const cached = tokens.get(cacheKey);
    if (cached && cached.expires > Date.now() + 60000) return cached.value;
    const credentials = await decrypt(
      this.env,
      this.connector.encrypted_credentials,
    );
    ensure(
      credentials.clientSecret,
      503,
      "Enter the Microsoft application secret value.",
    );
    const response = await fetch(
      `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: credentials.clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
      },
    );
    const value = (await response.json()) as Row;
    ensure(
      response.ok && value.access_token,
      502,
      "Microsoft application sign-in failed. Check the tenant, client ID, secret value and tenant admin consent.",
    );
    if (tokens.size >= 100) tokens.delete(tokens.keys().next().value!);
    tokens.set(cacheKey, {
      value: value.access_token,
      expires:
        Date.now() + Math.min(Number(value.expires_in) || 300, 3600) * 1000,
    });
    return value.access_token as string;
  }
  async graphResponse(path: string, init: RequestInit = {}) {
    ensure(
      path.startsWith("/") && !path.startsWith("//"),
      500,
      "Invalid Microsoft Graph path.",
    );
    const send = (accessToken: string) =>
      fetch(GRAPH + path, {
        ...init,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    let response = await send(await this.accessToken());
    if (response.status === 401) {
      // Consent or token revocation can invalidate an otherwise unexpired token.
      await response.body?.cancel();
      tokens.delete(this.tokenKey());
      response = await send(await this.accessToken());
    }
    return response;
  }
  async graph(path: string, init: RequestInit = {}) {
    const response = await this.graphResponse(path, init);
    if (!response.ok) {
      const status = response.status;
      let code = "";
      try {
        const value = ((await response.json()) as Row)?.error?.code;
        if (typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value))
          code = value;
      } catch {
        /* Do not expose provider bodies, tokens or identity details. */
      }
      const detail = `HTTP ${status}${code ? `, ${code}` : ""}`;
      throw new HttpError(
        502,
        status === 401
          ? `Microsoft Graph rejected the application's access token (${detail}). Check Microsoft Graph application permissions and grant tenant administrator consent, then retry. The tenant, client ID and secret value must belong to the same application.`
          : status === 403
            ? `Microsoft Graph denied access (${detail}). Grant the required application permissions and administrator consent. Selected permissions also require a write grant on the selected site or folder; drive discovery may require entering its ID manually.`
            : `OneDrive request failed (${detail}). Check the selected drive/folder and the application's granted permissions.`,
      );
    }
    return response.status === 204 ? {} : ((await response.json()) as Row);
  }
  drive() {
    return `/drives/${encodeURIComponent(this.config.driveId)}`;
  }
  item(id: string) {
    return id === "root"
      ? `${this.drive()}/root`
      : `${this.drive()}/items/${encodeURIComponent(id)}`;
  }
  name(file: Row) {
    const extension = file.name.match(/\.[a-z\d]{1,12}$/i)?.[0] || "";
    return `${this.connector.id}-${file.id}${extension}`;
  }
  path(file: Row) {
    return `${this.item(this.config.folderId)}:/${encodeURIComponent(this.name(file))}:`;
  }
  async test() {
    let folder: Row;
    try {
      folder = await this.graph(
        `${this.item(this.config.folderId)}?$select=id,name,folder,parentReference`,
      );
    } catch (error) {
      if (error instanceof HttpError && /HTTP (400|404)\b/.test(error.message))
        throw new HttpError(
          400,
          "The selected OneDrive folder could not be found in this drive. Storage root folder ID must be Microsoft's item ID, not a folder name or path. Choose Browse drive root, then open the intended folder, or enter root to use the drive root.",
        );
      throw error;
    }
    ensure(folder.folder, 400, "The selected OneDrive item must be a folder.");
    return folder;
  }
  async browse(folderId = this.config.folderId, skip = "") {
    const path = `${this.item(folderId)}/children?$select=id,name,folder,parentReference&$top=200${skip ? "&$skiptoken=" + encodeURIComponent(skip) : ""}`;
    const data = await this.graph(path);
    let next = "";
    if (data["@odata.nextLink"]) {
      const nextUrl = new URL(data["@odata.nextLink"]);
      ensure(
        nextUrl.origin === "https://graph.microsoft.com",
        502,
        "Unexpected Microsoft pagination URL.",
      );
      next = nextUrl.searchParams.get("$skiptoken") || "";
    }
    return { folders: (data.value || []).filter((f: Row) => f.folder), next };
  }
  async createFolder(name: unknown) {
    ensure(
      typeof name === "string" &&
        name.trim().length > 0 &&
        name.length <= 128 &&
        !/["*:<>?\\/|\x00-\x1f]/.test(name) &&
        !/[. ]$/.test(name),
      400,
      "Enter a folder name without slashes, reserved characters, or a trailing dot or space.",
    );
    await this.test();
    const folder = await this.graph(
      `${this.item(this.config.folderId)}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      },
    );
    ensure(
      folder.id && folder.folder,
      502,
      "Microsoft did not return the new folder.",
    );
    return folder;
  }
  async create(file: Row) {
    let session: Row;
    try {
      session = await this.graph(`${this.path(file)}/createUploadSession`, {
        method: "POST",
        body: JSON.stringify({
          item: {
            "@microsoft.graph.conflictBehavior": "fail",
            name: this.name(file),
          },
        }),
      });
    } catch (error) {
      // Existing connectors may contain an unverified folder name. Graph often
      // reports that as invalidRequest when starting an upload, rather than 404.
      if (error instanceof HttpError && /HTTP (400|404)\b/.test(error.message))
        await this.test();
      throw error;
    }
    ensure(
      session.uploadUrl,
      502,
      "OneDrive did not create an upload session.",
    );
    return {
      uploadId: await encrypt(this.env, {
        uploadUrl: resourceUrl(session.uploadUrl),
      }),
      fileId: null,
    };
  }
  async session(file: Row) {
    return resourceUrl(
      (await decrypt(this.env, file.provider_upload_id)).uploadUrl,
    );
  }
  async find(file: Row) {
    return await this.graph(`${this.path(file)}?$select=id,size,eTag`);
  }
  async part(file: Row, number: number, data: ArrayBuffer) {
    const offset = (number - 1) * ONEDRIVE_PART_SIZE;
    const previous = await this.env.DB.prepare(
      "SELECT COUNT(*) count FROM upload_parts WHERE file_id=? AND part_number<?",
    )
      .bind(file.id, number)
      .first<Row>();
    ensure(
      previous?.count === number - 1,
      409,
      "OneDrive parts must be uploaded in sequence. Resume from the first missing part.",
    );
    const url = await this.session(file);
    const response = await fetch(url, {
      method: "PUT",
      body: data,
      redirect: "manual",
      headers: {
        "Content-Length": String(data.byteLength),
        "Content-Range": `bytes ${offset}-${offset + data.byteLength - 1}/${file.size}`,
      },
    });
    if (response.status === 404 && offset + data.byteLength === file.size) {
      const existing = await this.find(file);
      ensure(
        existing.size === file.size,
        502,
        "The OneDrive upload session expired. Start a new upload.",
      );
      await this.storeId(file, existing.id);
      return `part-${number}`;
    }
    if (response.status === 416) {
      await response.body?.cancel();
      const status = await fetch(url, { redirect: "manual" });
      const value = (await status.json()) as Row;
      const next = Number(value.nextExpectedRanges?.[0]?.split("-")[0]);
      ensure(
        status.ok && Number.isFinite(next) && next >= offset + data.byteLength,
        502,
        "OneDrive could not confirm the saved part. Retry this upload.",
      );
      return `part-${number}`;
    }
    ensure(
      [200, 201, 202].includes(response.status),
      502,
      `OneDrive could not save this part (HTTP ${response.status}). Retry or resume the upload.`,
    );
    const value = (await response.json()) as Row;
    if (value.id) await this.storeId(file, value.id);
    return `part-${number}`;
  }
  async storeId(file: Row, id: string) {
    await this.env.DB.prepare("UPDATE files SET provider_file_id=? WHERE id=?")
      .bind(id, file.id)
      .run();
  }
  async complete(file: Row) {
    const item = await this.find(file);
    ensure(
      item.size === file.size && item.id,
      502,
      "OneDrive returned an unexpected final file size.",
    );
    await this.storeId(file, item.id);
  }
  async remove(file: Row) {
    let cancellationPending = false;
    // A saved item ID means Microsoft's final part already committed the file,
    // even if File Station did not receive/finish the completion request.
    if (
      !file.completed_at &&
      !file.provider_file_id &&
      file.provider_upload_id
    ) {
      try {
        const response = await fetch(await this.session(file), {
          method: "DELETE",
          redirect: "manual",
        });
        // An expired/revoked preauthenticated URL may return 401/403 rather
        // than 404. Still check the authenticated item below: the final part
        // might have committed before its response was lost.
        cancellationPending =
          !response.ok && ![401, 403, 404, 410].includes(response.status);
        if (!response.ok)
          console.warn("OneDrive upload cancellation response", {
            fileId: file.id,
            status: response.status,
          });
        await response.body?.cancel();
      } catch {
        cancellationPending = true;
        console.warn("OneDrive upload cancellation unavailable", {
          fileId: file.id,
        });
      }
    }
    // A final part may have committed before the caller received its response.
    const path = file.provider_file_id
      ? this.item(file.provider_file_id)
      : this.path(file);
    const response = await this.graphResponse(path, { method: "DELETE" });
    const deleted = response.ok,
      absent = response.status === 404;
    await response.body?.cancel();
    ensure(
      deleted || absent,
      502,
      "OneDrive could not delete the file. Cleanup will retry.",
    );
    // If Graph actually removed a committed item, its old upload session is
    // irrelevant. An absent item alone cannot confirm a transient cancel error.
    ensure(
      !cancellationPending || deleted,
      502,
      "OneDrive could not cancel the upload. Cleanup will retry.",
    );
  }
  async download(file: Row, offset: number, length: number) {
    // The preauthenticated download URL is a computed annotation. Request the
    // default metadata: selecting it as a property can omit it on SharePoint.
    const item = await this.graph(
      file.provider_file_id
        ? this.item(file.provider_file_id)
        : this.path(file),
    );
    ensure(
      item.size === file.size,
      502,
      "The OneDrive file changed outside File Station.",
    );
    ensure(
      typeof item["@microsoft.graph.downloadUrl"] === "string",
      502,
      "Microsoft did not provide a download URL for this file. Check the application's file read access and the tenant's download policy.",
    );
    const response = await fetch(
      resourceUrl(item["@microsoft.graph.downloadUrl"]),
      {
        redirect: "manual",
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      },
    );
    ensure(
      response.status === 206 &&
        response.body &&
        response.headers.get("content-range") ===
          `bytes ${offset}-${offset + length - 1}/${file.size}`,
      502,
      "OneDrive did not return the requested file range.",
    );
    return response.body;
  }
}
