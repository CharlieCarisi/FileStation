// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { PART_SIZE, MAX_PARTS, UPLOAD_TTL, CONNECTOR_FIELDS } from "./types.js";
import {
  ensure,
  json,
  body,
  id,
  now,
  hash,
  audit,
  errorResponse,
} from "./util.js";
import { Storage } from "./storage.js";
import { ONEDRIVE_PART_SIZE } from "./onedrive";
import { OperationGate, uploadConcurrency } from "../shared/concurrency";
import { folderForOwner, folderError } from "./folders";
import { workspaceSpace } from "./workspaces";
import {
  guardInvitationUpload,
  recordInvitationUpload,
  guardAttachedInvitation,
} from "./invitations";
var StorageCoordinator = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  state;
  env;
  static {
    __name(this, "StorageCoordinator");
  }
  gate = new OperationGate(3);
  fetch(request) {
    const url = new URL(request.url);
    const part = url.pathname === "/part";
    return this.gate
      .run(
        () => this.run(request),
        part || url.pathname === "/download",
        part
          ? `${url.searchParams.get("file")}:${url.searchParams.get("part")}`
          : "",
      )
      .catch(errorResponse);
  }
  async connector() {
    const connectorId = await this.state.storage.get("connectorId");
    const c = await this.env.DB.prepare(
      `SELECT ${CONNECTOR_FIELDS} FROM connectors WHERE id=?`,
    )
      .bind(connectorId)
      .first();
    ensure(c, 404, "Storage connector not found.");
    return c;
  }
  async deleteFile(file, connector, reason, actor) {
    if (file.state === "deleted") return;
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE files SET state='deleting',delete_reason=? WHERE id=?",
      ).bind(reason, file.id),
      this.env.DB.prepare(
        "UPDATE shares SET revoked_at=? WHERE file_id=? AND revoked_at IS NULL",
      ).bind(now(), file.id),
    ]);
    await new Storage(this.env, connector).remove(file);
    await this.env.DB.prepare(
      "UPDATE files SET state='deleted',deleted_at=? WHERE id=?",
    )
      .bind(now(), file.id)
      .run();
    await this.env.DB.prepare("DELETE FROM upload_parts WHERE file_id=?")
      .bind(file.id)
      .run();
    await audit(this.env, actor, `file.${reason}`, file.id);
  }
  async cleanup(connector) {
    const stale = await this.env.DB.prepare(
      "SELECT * FROM files WHERE connector_id=? AND (state='deleting' OR (state='ready' AND expires_at IS NOT NULL AND expires_at<=?) OR (state='uploading' AND upload_expires_at<=?)) ORDER BY created_at,id",
    )
      .bind(connector.id, now(), now())
      .all();
    for (const file of stale.results)
      await this.deleteFile(
        file,
        connector,
        file.delete_reason ||
          (file.state === "uploading" ? "abandoned" : "expired"),
        null,
      );
  }
  async run(request) {
    const url = new URL(request.url),
      connectorId = url.searchParams.get("connector");
    ensure(connectorId, 400, "Missing connector.");
    const known = await this.state.storage.get("connectorId");
    ensure(!known || known === connectorId, 400, "Connector mismatch.");
    if (!known) await this.state.storage.put("connectorId", connectorId);
    const c = await this.connector(),
      storage = new Storage(this.env, c);
    if (url.pathname === "/test") {
      await storage.test();
      return json({
        ok: true,
        message:
          (c.kind === "onedrive" ? "OneDrive" : "WebDAV") +
          " folder is reachable. Upload a test file to verify write, range-download and delete permissions.",
      });
    }
    if (url.pathname === "/cleanup") {
      await this.cleanup(c);
      return json({ ok: true });
    }
    if (url.pathname === "/configure") {
      const b = await body(request);
      if (
        c.config !== b.config &&
        (await this.env.DB.prepare(
          "SELECT id FROM files WHERE connector_id=? LIMIT 1",
        )
          .bind(c.id)
          .first())
      ) {
        let sameFolder = false;
        if (
          ["webdav", "synology"].includes(c.kind) &&
          b.confirmSameStorage === true
        ) {
          const before = new URL(JSON.parse(c.config).endpoint),
            after = new URL(JSON.parse(b.config).endpoint);
          sameFolder = before.pathname === after.pathname;
        }
        ensure(
          sameFolder,
          409,
          "Create a new connector for a different storage folder. A WebDAV hostname change requires confirmation that it points to the same folder.",
        );
      }
      const usage = await this.env.DB.prepare(
        "SELECT COALESCE(SUM(size),0) AS used FROM files WHERE connector_id=? AND state<>'deleted'",
      )
        .bind(c.id)
        .first();
      ensure(
        b.limit_bytes >= (usage?.used || 0),
        409,
        "The new limit must cover current files and reserved uploads. Delete files first.",
      );
      await this.env.DB.prepare(
        "UPDATE connectors SET name=?,limit_bytes=?,retention_days=?,enabled=?,config=?,encrypted_credentials=? WHERE id=?",
      )
        .bind(
          b.name,
          b.limit_bytes,
          b.retention_days,
          b.enabled,
          b.config,
          b.encrypted_credentials || c.encrypted_credentials,
          c.id,
        )
        .run();
      await this.env.DB.prepare(
        "UPDATE files SET expires_at=CASE WHEN ? IS NULL THEN NULL ELSE completed_at+?*86400000 END WHERE connector_id=? AND state='ready'",
      )
        .bind(b.retention_days, b.retention_days, c.id)
        .run();
      return json({ ok: true });
    }
    if (url.pathname === "/create") {
      const partSize = c.kind === "onedrive" ? ONEDRIVE_PART_SIZE : PART_SIZE;
      ensure(c.enabled, 409, "This connector is disabled.");
      const b = await body(request);
      const invitation = b.invitationId
        ? await guardInvitationUpload(this.env, c, b)
        : null;
      const owner2 = await this.env.DB.prepare(
        "SELECT status FROM users WHERE id=?",
      )
        .bind(b.ownerId)
        .first();
      ensure(
        owner2?.status === "active",
        403,
        "Your account is no longer approved for uploads.",
      );
      ensure(
        typeof b.name === "string" &&
          b.name.trim().length > 0 &&
          b.name.length <= 255 &&
          !/[\x00-\x1f]/.test(b.name),
        400,
        "Enter a valid file name.",
      );
      ensure(
        Number.isSafeInteger(b.size) &&
          b.size > 0 &&
          b.size <= Math.min(c.limit_bytes, MAX_PARTS * partSize),
        413,
        "This file is larger than the connector limit.",
      );
      ensure(
        typeof b.fingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(b.fingerprint),
        400,
        "A valid file fingerprint is required.",
      );
      const space = workspaceSpace(b.space);
      const folderId = await folderForOwner(
        this.env,
        b.ownerId,
        b.folderId,
        space,
      );
      await this.cleanup(c);
      const usage = await this.env.DB.prepare(
        "SELECT COALESCE(SUM(size),0) AS used, COALESCE(SUM(CASE WHEN state='uploading' THEN size ELSE 0 END),0) AS reserved FROM files WHERE connector_id=? AND state<>'deleted'",
      )
        .bind(c.id)
        .first();
      ensure(
        b.preserveExistingFiles !== true ||
          (usage?.used || 0) + b.size <= c.limit_bytes,
        409,
        "Not enough free space to save this ZIP without deleting existing files. Choose another storage connector or free up space.",
      );
      ensure(
        (usage?.reserved || 0) + b.size <= c.limit_bytes,
        409,
        "Other uploads have reserved this capacity. Retry after they finish.",
      );
      const fileId2 = id();
      const file2 = {
        id: fileId2,
        part_size: partSize,
        owner_id: b.ownerId,
        connector_id: c.id,
        name: b.name.trim(),
        folder_id: folderId,
        space,
        mime:
          typeof b.mime === "string"
            ? b.mime.slice(0, 128)
            : "application/octet-stream",
        size: b.size,
        state: "uploading",
        object_key: `${c.id}/${fileId2}`,
        provider_upload_id: null,
        provider_file_id: null,
        fingerprint: b.fingerprint,
        created_at: now(),
        completed_at: null,
        expires_at: null,
        upload_expires_at: now() + UPLOAD_TTL,
        deleted_at: null,
        delete_reason: null,
      };
      const created = await storage.create(file2);
      file2.provider_upload_id = created.uploadId;
      file2.provider_file_id = created.fileId;
      let evicted = 0;
      try {
        let used = usage?.used || 0;
        const candidates = await this.env.DB.prepare(
          "SELECT * FROM files WHERE connector_id=? AND state='ready' AND id NOT IN (SELECT source_file_id FROM invitations WHERE kind='collaboration' AND revoked_at IS NULL AND expires_at>?) AND id NOT IN (SELECT current_file_id FROM invitations WHERE kind='collaboration' AND current_file_id IS NOT NULL AND revoked_at IS NULL AND expires_at>?) ORDER BY created_at,id",
        )
          .bind(c.id, now(), now())
          .all();
        for (const old of candidates.results) {
          if (used + b.size <= c.limit_bytes) break;
          await this.deleteFile(old, c, "capacity", b.ownerId);
          used -= old.size;
          evicted++;
        }
        ensure(
          used + b.size <= c.limit_bytes,
          409,
          "Storage is awaiting cleanup. Retry later.",
        );
        await this.env.DB.prepare(
          "INSERT INTO files(id,owner_id,connector_id,name,mime,size,state,object_key,provider_upload_id,provider_file_id,fingerprint,created_at,upload_expires_at,part_size,folder_id,space) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
          .bind(
            file2.id,
            file2.owner_id,
            file2.connector_id,
            file2.name,
            file2.mime,
            file2.size,
            file2.state,
            file2.object_key,
            file2.provider_upload_id,
            file2.provider_file_id,
            file2.fingerprint,
            file2.created_at,
            file2.upload_expires_at,
            partSize,
            folderId,
            space,
          )
          .run();
        if (invitation)
          await recordInvitationUpload(this.env, invitation, file2, b);
      } catch (error) {
        await storage.remove(file2);
        folderError(error);
      }
      return json(
        {
          file: file2,
          partSize,
          uploadConcurrency: uploadConcurrency(c.kind),
          parts: [],
          evicted,
        },
        201,
      );
    }
    const fileId = url.searchParams.get("file");
    const file = await this.env.DB.prepare(
      "SELECT * FROM files WHERE id=? AND connector_id=?",
    )
      .bind(fileId, c.id)
      .first();
    ensure(file, 404, "File not found.");
    if (url.pathname === "/delete") {
      await this.deleteFile(
        file,
        c,
        url.searchParams.get("reason") || "manual",
        url.searchParams.get("actor"),
      );
      return json({ ok: true });
    }
    if (url.pathname === "/download") {
      ensure(
        file.state === "ready" && (!file.expires_at || file.expires_at > now()),
        410,
        "This file is no longer available.",
      );
      const offset = Number(url.searchParams.get("offset")),
        length = Number(url.searchParams.get("length"));
      return new Response(await storage.download(file, offset, length));
    }
    ensure(
      file.state === "uploading" && file.upload_expires_at > now(),
      410,
      "This upload is no longer available.",
    );
    const owner = await this.env.DB.prepare(
      "SELECT status FROM users WHERE id=?",
    )
      .bind(file.owner_id)
      .first();
    ensure(
      owner?.status === "active",
      403,
      "The upload owner is no longer approved.",
    );
    const partSize = file.part_size || PART_SIZE;
    await guardAttachedInvitation(this.env, file.id);
    if (url.pathname === "/part") {
      const number = Number(url.searchParams.get("part"));
      const count = Math.ceil(file.size / partSize);
      ensure(
        Number.isInteger(number) && number >= 1 && number <= count,
        400,
        "Invalid part number.",
      );
      const expected =
        number === count ? file.size - (count - 1) * partSize : partSize;
      ensure(
        Number(request.headers.get("content-length")) === expected,
        400,
        "Part length does not match.",
      );
      const data = await request.arrayBuffer();
      ensure(data.byteLength === expected, 400, "Incomplete part.");
      const digest = await hash(data);
      const previous = await this.env.DB.prepare(
        "SELECT etag,digest FROM upload_parts WHERE file_id=? AND part_number=?",
      )
        .bind(file.id, number)
        .first();
      if (previous) {
        ensure(
          previous.digest === digest,
          409,
          "A different file was selected.",
        );
        return json({ partNumber: number, etag: previous.etag });
      }
      const etag = await storage.part(file, number, data);
      await this.env.DB.prepare(
        "INSERT INTO upload_parts(file_id,part_number,etag,size,digest) VALUES (?,?,?,?,?)",
      )
        .bind(file.id, number, etag, data.byteLength, digest)
        .run();
      await this.env.DB.prepare(
        "UPDATE files SET upload_expires_at=? WHERE id=?",
      )
        .bind(now() + UPLOAD_TTL, file.id)
        .run();
      return json({ partNumber: number, etag });
    }
    if (url.pathname === "/complete") {
      const parts = await this.env.DB.prepare(
        "SELECT part_number,etag,size FROM upload_parts WHERE file_id=? ORDER BY part_number",
      )
        .bind(file.id)
        .all();
      ensure(
        parts.results.length === Math.ceil(file.size / partSize) &&
          parts.results.every((p, i) => p.part_number === i + 1) &&
          parts.results.reduce((s, p) => s + p.size, 0) === file.size,
        409,
        "Upload all parts before completing this file.",
      );
      await storage.complete(
        file,
        parts.results.map((p) => ({ partNumber: p.part_number, etag: p.etag })),
      );
      await this.env.DB.prepare(
        "UPDATE files SET state='ready',completed_at=?,expires_at=? WHERE id=?",
      )
        .bind(
          now(),
          c.retention_days ? now() + c.retention_days * 864e5 : null,
          file.id,
        )
        .run();
      await audit(this.env, file.owner_id, "file.uploaded", file.id);
      return json({ ok: true });
    }
    return json({ error: "Operation not found." }, 404);
  }
};
async function coordinate(env, connector, path, request) {
  const object = env.STORAGE_COORDINATOR.get(
    env.STORAGE_COORDINATOR.idFromName(connector),
  );
  const separator = path.includes("?") ? "&" : "?";
  return object.fetch(
    new Request(
      `https://storage.internal${path}${separator}connector=${encodeURIComponent(connector)}`,
      request || { method: "POST" },
    ),
  );
}
__name(coordinate, "coordinate");

export { StorageCoordinator, coordinate };
