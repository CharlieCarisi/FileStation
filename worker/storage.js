// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { PART_SIZE } from "./types.js";
import {
  HttpError,
  ensure,
  json,
  body,
  id,
  now,
  encrypt,
  decrypt,
} from "./util.js";
import { S3Storage } from "./s3.js";
import { WebDavStorage } from "./webdav.js";
import { OneDriveStorage } from "./onedrive";
var Storage = class {
  constructor(env, connector) {
    this.env = env;
    this.connector = connector;
  }
  env;
  connector;
  static {
    __name(this, "Storage");
  }
  async test() {
    if (this.connector.kind === "onedrive")
      return new OneDriveStorage(this.env, this.connector).test();
    ensure(
      ["webdav", "synology"].includes(this.connector.kind),
      400,
      "Connection checks are available for Synology and WebDAV.",
    );
    return new WebDavStorage(this.env, this.connector).test();
  }
  async ali(endpoint, payload) {
    ensure(
      this.connector.encrypted_credentials,
      503,
      "AliPan credentials are not configured.",
    );
    let credentials = await decrypt(
      this.env,
      this.connector.encrypted_credentials,
    );
    if (
      !credentials.accessToken ||
      (credentials.expiresAt || 0) < Date.now() + 12e4
    ) {
      const response2 = await fetch(
        "https://openapi.alipan.com/oauth/access_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            grant_type: "refresh_token",
            refresh_token: credentials.refreshToken,
          }),
        },
      );
      const t = await response2.json();
      ensure(
        response2.ok && t.access_token,
        502,
        "AliPan authorization expired. Update this connector\u2019s credentials.",
      );
      credentials = {
        ...credentials,
        accessToken: t.access_token,
        refreshToken: t.refresh_token || credentials.refreshToken,
        expiresAt: Date.now() + (t.expires_in || 7200) * 1e3,
      };
      this.connector.encrypted_credentials = await encrypt(
        this.env,
        credentials,
      );
      await this.env.DB.prepare(
        "UPDATE connectors SET encrypted_credentials=? WHERE id=?",
      )
        .bind(this.connector.encrypted_credentials, this.connector.id)
        .run();
    }
    const response = await fetch(`https://openapi.alipan.com${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (
        endpoint === "/adrive/v1.0/openFile/delete" &&
        ["NotFound.FileId", "FileIdNotFound", "NotFound"].includes(
          error.code || "",
        )
      )
        return {};
      throw new HttpError(
        502,
        `AliPan storage request failed (${response.status}).`,
      );
    }
    if (response.status === 204) return {};
    return response.json();
  }
  async create(file) {
    if (this.connector.kind === "onedrive")
      return new OneDriveStorage(this.env, this.connector).create(file);
    if (["webdav", "synology"].includes(this.connector.kind))
      return new WebDavStorage(this.env, this.connector).create(file);
    if (this.connector.kind === "s3")
      return new S3Storage(this.env, this.connector).create(file);
    if (this.connector.kind === "r2") {
      const u = await this.env.R2_FILES.createMultipartUpload(file.object_key, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      return { uploadId: u.uploadId, fileId: null };
    }
    const config = JSON.parse(this.connector.config);
    ensure(config.driveId, 503, "AliPan drive ID is not configured.");
    const result = await this.ali("/adrive/v1.0/openFile/create", {
      drive_id: config.driveId,
      parent_file_id: config.folderId || "root",
      name: file.object_key.replace(/\//g, "_"),
      type: "file",
      check_name_mode: "refuse",
      size: file.size,
      part_info_list: Array.from(
        { length: Math.ceil(file.size / PART_SIZE) },
        (_, i) => ({
          part_number: i + 1,
        }),
      ),
    });
    ensure(
      result.upload_id && result.file_id,
      502,
      "AliPan did not create an upload session.",
    );
    return { uploadId: result.upload_id, fileId: result.file_id };
  }
  async part(file, number, data) {
    if (this.connector.kind === "onedrive")
      return new OneDriveStorage(this.env, this.connector).part(
        file,
        number,
        data,
      );
    if (["webdav", "synology"].includes(this.connector.kind))
      return new WebDavStorage(this.env, this.connector).part(
        file,
        number,
        data,
      );
    if (this.connector.kind === "s3")
      return new S3Storage(this.env, this.connector).part(file, number, data);
    if (this.connector.kind === "r2")
      return (
        await this.env.R2_FILES.resumeMultipartUpload(
          file.object_key,
          file.provider_upload_id,
        ).uploadPart(number, data)
      ).etag;
    const config = JSON.parse(this.connector.config);
    const result = await this.ali("/adrive/v1.0/openFile/getUploadUrl", {
      drive_id: config.driveId,
      file_id: file.provider_file_id,
      upload_id: file.provider_upload_id,
      part_info_list: [{ part_number: number }],
    });
    const url = result.part_info_list?.[0]?.upload_url;
    this.validateUrl(url);
    const response = await fetch(url, {
      method: "PUT",
      body: data,
      redirect: "manual",
    });
    ensure(
      response.ok,
      502,
      "AliPan could not save this part. You can retry it.",
    );
    return response.headers.get("etag") || String(number);
  }
  async complete(file, parts) {
    if (this.connector.kind === "onedrive")
      return new OneDriveStorage(this.env, this.connector).complete(
        file,
        parts,
      );
    if (["webdav", "synology"].includes(this.connector.kind))
      return new WebDavStorage(this.env, this.connector).complete(file, parts);
    if (this.connector.kind === "s3")
      return new S3Storage(this.env, this.connector).complete(file, parts);
    if (this.connector.kind === "r2") {
      const existing = await this.env.R2_FILES.head(file.object_key);
      if (existing?.size === file.size) return;
      const result = await this.env.R2_FILES.resumeMultipartUpload(
        file.object_key,
        file.provider_upload_id,
      ).complete(parts);
      ensure(
        result.size === file.size,
        502,
        "Storage returned an unexpected file size.",
      );
      return;
    }
    const config = JSON.parse(this.connector.config);
    await this.ali("/adrive/v1.0/openFile/complete", {
      drive_id: config.driveId,
      file_id: file.provider_file_id,
      upload_id: file.provider_upload_id,
    });
  }
  async remove(file) {
    if (this.connector.kind === "onedrive")
      return new OneDriveStorage(this.env, this.connector).remove(file);
    if (["webdav", "synology"].includes(this.connector.kind))
      return new WebDavStorage(this.env, this.connector).remove(file);
    if (this.connector.kind === "s3")
      return new S3Storage(this.env, this.connector).remove(file);
    if (this.connector.kind === "r2") {
      if (
        !file.completed_at &&
        file.provider_upload_id &&
        !(await this.env.R2_FILES.head(file.object_key))
      ) {
        try {
          await this.env.R2_FILES.resumeMultipartUpload(
            file.object_key,
            file.provider_upload_id,
          ).abort();
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          ensure(
            /NoSuchUpload|does not exist|not found/i.test(message),
            502,
            "Storage could not cancel the upload. Cleanup will retry.",
          );
        }
      }
      await this.env.R2_FILES.delete(file.object_key);
      return;
    }
    if (!file.provider_file_id) return;
    const config = JSON.parse(this.connector.config);
    await this.ali("/adrive/v1.0/openFile/delete", {
      drive_id: config.driveId,
      file_id: file.provider_file_id,
    });
  }
  async download(file, offset, length) {
    if (this.connector.kind === "onedrive")
      return new OneDriveStorage(this.env, this.connector).download(
        file,
        offset,
        length,
      );
    if (["webdav", "synology"].includes(this.connector.kind))
      return new WebDavStorage(this.env, this.connector).download(
        file,
        offset,
        length,
      );
    if (this.connector.kind === "s3")
      return new S3Storage(this.env, this.connector).download(
        file,
        offset,
        length,
      );
    if (this.connector.kind === "r2") {
      const object = await this.env.R2_FILES.get(file.object_key, {
        range: { offset, length },
      });
      ensure(object, 404, "This file is no longer available.");
      return object.body;
    }
    const config = JSON.parse(this.connector.config);
    const result = await this.ali("/adrive/v1.0/openFile/getDownloadUrl", {
      drive_id: config.driveId,
      file_id: file.provider_file_id,
      expire_sec: 900,
    });
    this.validateUrl(result.url);
    const response = await fetch(result.url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      redirect: "manual",
    });
    ensure(
      response.status === 206 ||
        (offset === 0 && length === file.size && response.ok),
      502,
      "AliPan did not return the requested byte range.",
    );
    if (response.status === 206)
      ensure(
        response.headers.get("content-range") ===
          `bytes ${offset}-${offset + length - 1}/${file.size}`,
        502,
        "AliPan returned an unexpected byte range.",
      );
    ensure(response.body, 502, "AliPan returned an empty response.");
    return response.body;
  }
  validateUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(502, "Storage returned an invalid URL.");
    }
    ensure(
      parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        (parsed.hostname.endsWith(".aliyuncs.com") ||
          parsed.hostname.endsWith(".alipan.com") ||
          parsed.hostname.endsWith(".aliyundrive.com")),
      502,
      "Storage returned an untrusted URL.",
    );
  }
};

export { Storage };
