import { SELF, env as bindings } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env, Row } from "../worker/model";
import { archiveEntries } from "../worker/archives";
const env = bindings as unknown as Env;
const origin = "http://localhost";
async function request(path: string, method = "GET", value?: any, cookie = "") {
  const bytes = value instanceof Uint8Array;
  const response = await SELF.fetch(`${origin}/files/api${path}`, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(value !== undefined
        ? {
            "Content-Type": bytes
              ? "application/octet-stream"
              : "application/json",
          }
        : {}),
    },
    body:
      value === undefined
        ? undefined
        : bytes
          ? value.slice().buffer
          : JSON.stringify(value),
  });
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: response.headers,
  });
}
async function result(response: Response, status = 200): Promise<Row> {
  const data = (await response.json()) as Row;
  expect(response.status, JSON.stringify(data)).toBe(status);
  return data;
}
async function login(email = "c@bychx.com") {
  const challenge = await result(
    await request("/auth/request", "POST", { email }),
  );
  const response = await request("/auth/verify", "POST", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  const data = await result(response);
  return {
    ...data.user,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}
async function folder(
  cookie: string,
  name: string,
  parentId: string | null = null,
  ownerId?: string,
) {
  return (
    await result(
      await request("/folders", "POST", { name, parentId, ownerId }, cookie),
      201,
    )
  ).folder as Row;
}
async function begin(cookie: string, options: Row = {}, path = "/uploads") {
  return (
    await result(
      await request(
        path,
        "POST",
        {
          connectorId: "r2-default",
          name: "original.txt",
          size: 8,
          fingerprint: "a".repeat(64),
          ...options,
        },
        cookie,
      ),
      201,
    )
  ).file as Row;
}
async function finish(
  cookie: string,
  file: Row,
  text = "original",
  path = "/uploads",
) {
  await result(
    await request(
      `${path}/${file.id}/parts/1`,
      "PUT",
      new TextEncoder().encode(text),
      cookie,
    ),
  );
  await result(
    await request(`${path}/${file.id}/complete`, "POST", {}, cookie),
  );
}
async function upload(cookie: string, folderId: string | null = null) {
  const file = await begin(cookie, { folderId });
  await finish(cookie, file);
  return file;
}

describe("folder archives", () => {
  it("uses safe relative paths and keeps all duplicate and case-colliding names", () => {
    const entries = archiveEntries(
      [
        { id: "root", name: "Reports", parent_id: null },
        { id: "child", name: "photos", parent_id: "root" },
      ],
      [
        "../escape.txt",
        "..\\escape.txt",
        "CON",
        "PHOTOS",
        "a.txt",
        "A.txt",
        "a (2).txt",
        "..",
        "Résumé 合同.txt",
      ].map((name, index) => ({
        id: String(index),
        folder_id: "root",
        name,
        size: 1,
      })),
      "root",
    );
    const paths = entries.map((entry) => entry.path);
    expect(
      new Set(paths.map((path) => path.replace(/\/$/, "").toLowerCase())).size,
    ).toBe(paths.length);
    expect(paths).toContain("Reports/Résumé 合同.txt");
    expect(paths).toContain("Reports/_CON");
    expect(paths).toContain("Reports/PHOTOS (2)");
    expect(
      paths.every(
        (path) =>
          !path.startsWith("/") &&
          !path.includes("\\") &&
          path.split("/").every((part) => part !== ".."),
      ),
    ).toBe(true);
  });
  it("snapshots completed files, skips pending uploads in nested folders, preserves empty folders and protects private access", async () => {
    const admin = await login(),
      owner = await login("owner@international.gc.ca"),
      other = await login("other@international.gc.ca");
    const root = await folder(owner.cookie, "Reports 合同"),
      nested = await folder(owner.cookie, "Nested", root.id);
    const empty = await folder(owner.cookie, "Empty", root.id);
    const first = await upload(owner.cookie, root.id),
      second = await upload(owner.cookie, nested.id);
    const expired = await upload(owner.cookie, root.id);
    await env.DB.prepare("UPDATE files SET expires_at=1 WHERE id=?")
      .bind(expired.id)
      .run();
    const pendingRoot = await begin(owner.cookie, { folderId: root.id }),
      pendingNested = await begin(owner.cookie, { folderId: nested.id }),
      pendingOnly = await begin(owner.cookie, { folderId: empty.id });
    // Even uploaded bytes stay out until the upload is committed successfully.
    await result(
      await request(
        `/uploads/${pendingNested.id}/parts/1`,
        "PUT",
        new TextEncoder().encode("original"),
        owner.cookie,
      ),
    );
    await result(await request(`/folders/${root.id}/archive`), 401);
    await result(
      await request(
        `/folders/${root.id}/archive`,
        "GET",
        undefined,
        other.cookie,
      ),
      404,
    );
    for (const cookie of [owner.cookie, admin.cookie]) {
      const manifest = await result(
        await request(`/folders/${root.id}/archive`, "GET", undefined, cookie),
      );
      expect(manifest.fileCount).toBe(2);
      expect(manifest.totalSize).toBe(16);
      expect(manifest.entries.map((entry: Row) => entry.path).sort()).toEqual([
        "Reports 合同/",
        "Reports 合同/Empty/",
        "Reports 合同/Nested/",
        "Reports 合同/Nested/original.txt",
        "Reports 合同/original.txt",
      ]);
      expect(
        manifest.entries
          .filter((entry: Row) => entry.id)
          .map((entry: Row) => entry.id)
          .sort(),
      ).toEqual([first.id, second.id].sort());
      expect(JSON.stringify(manifest)).not.toContain("object_key");
    }
    const pendingManifest = await result(
      await request(
        `/folders/${empty.id}/archive`,
        "GET",
        undefined,
        owner.cookie,
      ),
    );
    expect(pendingManifest.fileCount).toBe(0);
    expect(pendingManifest.totalSize).toBe(0);
    expect(pendingManifest.entries).toEqual([
      { path: "Empty/", directory: true },
    ]);
    for (const pending of [pendingRoot, pendingNested, pendingOnly])
      expect(
        (await env.DB.prepare("SELECT state FROM files WHERE id=?")
          .bind(pending.id)
          .first<Row>())!.state,
      ).toBe("uploading");
    await result(
      await request(
        `/uploads/${pendingNested.id}/complete`,
        "POST",
        {},
        owner.cookie,
      ),
    );
    const completedManifest = await result(
      await request(
        `/folders/${root.id}/archive`,
        "GET",
        undefined,
        owner.cookie,
      ),
    );
    expect(completedManifest.fileCount).toBe(3);
    expect(completedManifest.totalSize).toBe(24);
    expect(
      completedManifest.entries.some(
        (entry: Row) => entry.id === pendingNested.id,
      ),
    ).toBe(true);
    const shared = (
      await result(
        await request(
          "/folders",
          "POST",
          { name: "Shared", space: "public" },
          owner.cookie,
        ),
        201,
      )
    ).folder;
    await result(
      await request(
        `/folders/${shared.id}/archive`,
        "GET",
        undefined,
        other.cookie,
      ),
    );
    await env.DB.prepare("UPDATE users SET status='inactive' WHERE id=?")
      .bind(other.id)
      .run();
    await result(
      await request(
        `/folders/${shared.id}/archive`,
        "GET",
        undefined,
        other.cookie,
      ),
      401,
    );
    await env.DB.prepare("UPDATE users SET status='pending' WHERE id=?")
      .bind(other.id)
      .run();
    await result(
      await request(
        `/folders/${shared.id}/archive`,
        "GET",
        undefined,
        other.cookie,
      ),
      403,
    );
  });

  it("returns every file beyond the normal 500-file page and explicitly rejects over 1,000", async () => {
    const user = await login(),
      root = await folder(user.cookie, "Many"),
      file = await upload(user.cookie, root.id);
    const ids = JSON.stringify(
      Array.from({ length: 999 }, (_, index) => `archive-${index}`),
    );
    await env.DB.prepare(
      `INSERT INTO files(id,owner_id,connector_id,name,mime,size,state,object_key,fingerprint,created_at,upload_expires_at,folder_id,space)
      SELECT j.value,f.owner_id,f.connector_id,f.name,f.mime,f.size,f.state,f.object_key,f.fingerprint,f.created_at,f.upload_expires_at,f.folder_id,f.space FROM files f,json_each(?) j WHERE f.id=?`,
    )
      .bind(ids, file.id)
      .run();
    // Pending reservations do not count toward the 1,000 archived-file limit.
    await begin(user.cookie, { folderId: root.id });
    const manifest = await result(
      await request(
        `/folders/${root.id}/archive`,
        "GET",
        undefined,
        user.cookie,
      ),
    );
    expect(manifest.fileCount).toBe(1000);
    expect(manifest.entries).toHaveLength(1001);
    expect(new Set(manifest.entries.map((entry: Row) => entry.path)).size).toBe(
      1001,
    );
    await upload(user.cookie, root.id);
    await result(
      await request(
        `/folders/${root.id}/archive`,
        "GET",
        undefined,
        user.cookie,
      ),
      400,
    );
  });

  it("reserves ZIP capacity without evicting originals, while ordinary uploads retain FIFO", async () => {
    const user = await login(),
      root = await folder(user.cookie, "Keep me"),
      original = await upload(user.cookie, root.id);
    await env.DB.prepare(
      "UPDATE connectors SET limit_bytes=12 WHERE id='r2-default'",
    ).run();
    const denied = await result(
      await request(
        "/uploads",
        "POST",
        {
          connectorId: "r2-default",
          name: "Keep me.zip",
          size: 8,
          fingerprint: "b".repeat(64),
          preserveExistingFiles: true,
        },
        user.cookie,
      ),
      409,
    );
    expect(denied.error).toContain("without deleting existing files");
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(original.id)
        .first<Row>())!.state,
    ).toBe("ready");
    await result(
      await request(
        "/uploads",
        "POST",
        {
          connectorId: "r2-default",
          name: "Keep me.zip",
          size: 4,
          fingerprint: "c".repeat(64),
          preserveExistingFiles: true,
        },
        user.cookie,
      ),
      201,
    );
    // Reserved uploads prevent overbooking even when another browser creates a ZIP.
    await result(
      await request(
        "/uploads",
        "POST",
        {
          connectorId: "r2-default",
          name: "second.zip",
          size: 1,
          fingerprint: "d".repeat(64),
          preserveExistingFiles: true,
        },
        user.cookie,
      ),
      409,
    );
    await begin(user.cookie, { name: "ordinary.txt" });
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(original.id)
        .first<Row>())!.state,
    ).toBe("deleted");
  });
});
