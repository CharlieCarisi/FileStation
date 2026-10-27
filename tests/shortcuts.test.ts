import { SELF, env as bindings } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env, Row } from "../worker/model";
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

async function shortcut(
  cookie: string,
  file: Row,
  folderId: string | null = null,
  space = "private",
  name = "Reference.txt",
) {
  return (
    await result(
      await request(
        "/shortcuts",
        "POST",
        { fileId: file.id, folderId, space, name },
        cookie,
      ),
      201,
    )
  ).shortcut as Row;
}
async function listed(cookie: string, space = "private", folderId?: string) {
  return (
    await result(
      await request(
        `/shortcuts?space=${space}${folderId ? `&folderId=${folderId}` : ""}`,
        "GET",
        undefined,
        cookie,
      ),
    )
  ).shortcuts as Row[];
}
async function moveFile(
  cookie: string,
  file: Row,
  space: string,
  folderId: string | null = null,
) {
  await result(
    await request(
      "/files/move",
      "POST",
      { fileIds: [file.id], space, folderId },
      cookie,
    ),
  );
}
describe("file shortcuts", () => {
  it("creates one logical reference, preserves source shares and quota, and follows source renames/moves", async () => {
    const user = await login(),
      origin = await folder(user.cookie, "Originals"),
      destination = await folder(user.cookie, "References"),
      file = await upload(user.cookie, origin.id);
    const before = await env.DB.prepare("SELECT * FROM files WHERE id=?")
      .bind(file.id)
      .first<Row>();
    const share = await result(
      await request(
        `/files/${file.id}/shares`,
        "POST",
        {
          recipients: ["partner@example.com"],
          expiresDays: 1,
          sendEmail: false,
        },
        user.cookie,
      ),
      201,
    );
    const alias = await shortcut(user.cookie, file, destination.id);
    expect(alias.available).toBe(true);
    expect(alias.target.id).toBe(file.id);
    expect(alias.target).not.toHaveProperty("object_key");
    expect(alias.target).not.toHaveProperty("provider_file_id");
    expect(
      await env.DB.prepare("SELECT * FROM files WHERE id=?")
        .bind(file.id)
        .first(),
    ).toEqual(before);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM files").first<Row>())!.n,
    ).toBe(1);
    expect((await listed(user.cookie, "private", destination.id))[0].id).toBe(
      alias.id,
    );
    await result(
      await request(
        `/files/${file.id}`,
        "PATCH",
        { name: "Renamed.txt", expectedName: "original.txt" },
        user.cookie,
      ),
    );
    await moveFile(user.cookie, file, "private");
    const fresh = (await listed(user.cookie))[0];
    expect(fresh.name).toBe("Reference.txt");
    expect(fresh.target.name).toBe("Renamed.txt");
    expect(fresh.target.folder_id).toBeNull();
    await result(
      await request(`/shortcuts/${alias.id}`, "DELETE", undefined, user.cookie),
    );
    expect(
      await (
        await request(
          `/files/${file.id}/download`,
          "GET",
          undefined,
          user.cookie,
        )
      ).text(),
    ).toBe("original");
    expect(
      (await env.DB.prepare("SELECT revoked_at FROM shares WHERE id=?")
        .bind(share.id)
        .first<Row>())!.revoked_at,
    ).toBeNull();
  });
  it("does not grant private access, expose folder contents to guests, create shortcut chains or publish a private original", async () => {
    const owner = await login(),
      teammate = await login("shortcut-team@international.gc.ca"),
      pending = await login("shortcut-pending@example.com"),
      file = await upload(owner.cookie),
      destination = await folder(owner.cookie, "References");
    const alias = await shortcut(owner.cookie, file, destination.id);
    await result(await request("/shortcuts"), 401);
    await result(
      await request("/shortcuts", "GET", undefined, pending.cookie),
      403,
    );
    await result(
      await request(
        `/shortcuts/${alias.id}`,
        "GET",
        undefined,
        teammate.cookie,
      ),
      404,
    );
    await result(
      await request(
        `/shortcuts/${alias.id}`,
        "PATCH",
        { name: "Stolen" },
        teammate.cookie,
      ),
      404,
    );
    await result(
      await request("/shortcuts", "POST", { fileId: file.id }, teammate.cookie),
      404,
    );
    await result(
      await request(
        "/shortcuts",
        "POST",
        { fileId: file.id, space: "public", name: "Public link" },
        owner.cookie,
      ),
      409,
    );
    await result(
      await request("/shortcuts", "POST", { fileId: alias.id }, owner.cookie),
      404,
    );
    await result(
      await request(
        "/shortcuts",
        "POST",
        { fileId: destination.id },
        owner.cookie,
      ),
      404,
    );
    const otherFolder = await folder(teammate.cookie, "Other private");
    await result(
      await request(
        "/shortcuts",
        "POST",
        { fileId: file.id, folderId: otherFolder.id },
        owner.cookie,
      ),
      404,
    );
    for (const name of [
      "",
      " ",
      "..",
      "a/b",
      "a\\b",
      "a\u0000b",
      "a".repeat(256),
    ])
      await result(
        await request(
          "/shortcuts",
          "POST",
          { fileId: file.id, name },
          owner.cookie,
        ),
        400,
      );
    const uploading = await begin(owner.cookie);
    await result(
      await request(
        "/shortcuts",
        "POST",
        { fileId: uploading.id },
        owner.cookie,
      ),
      410,
    );
  });
  it("allows team organization of Public shortcuts while protecting creator-only removal and moves to Private", async () => {
    const owner = await login("shortcut-owner@international.gc.ca"),
      creator = await login("shortcut-creator@international.gc.ca");
    const file = await upload(owner.cookie);
    await moveFile(owner.cookie, file, "public");
    const publicFolder = (
      await result(
        await request(
          "/folders",
          "POST",
          { name: "Team", space: "public" },
          owner.cookie,
        ),
        201,
      )
    ).folder;
    const alias = await shortcut(
      creator.cookie,
      file,
      publicFolder.id,
      "public",
    );
    const visible = (await listed(owner.cookie, "public"))[0];
    expect(visible.target.id).toBe(file.id);
    expect(visible.can_delete).toBe(false);
    await result(
      await request(
        `/shortcuts/${alias.id}`,
        "PATCH",
        { name: "Organized", folderId: null, space: "public" },
        owner.cookie,
      ),
    );
    await result(
      await request(
        `/shortcuts/${alias.id}`,
        "DELETE",
        undefined,
        owner.cookie,
      ),
      403,
    );
    await result(
      await request(
        `/shortcuts/${alias.id}`,
        "PATCH",
        { space: "private", folderId: null },
        owner.cookie,
      ),
      403,
    );
    await result(
      await request(
        `/shortcuts/${alias.id}`,
        "PATCH",
        { space: "private", folderId: null },
        creator.cookie,
      ),
    );
    expect(await listed(owner.cookie, "public")).toHaveLength(0);
    expect(await listed(creator.cookie)).toHaveLength(1);
    expect(
      (await env.DB.prepare("SELECT space FROM files WHERE id=?")
        .bind(file.id)
        .first<Row>())!.space,
    ).toBe("public");
  });
  it("hides current target metadata when a source becomes private, expired or deleted and restores availability when access returns", async () => {
    const admin = await login(),
      owner = await login("shortcut-source@international.gc.ca"),
      member = await login("shortcut-reader@international.gc.ca"),
      file = await upload(owner.cookie);
    await moveFile(owner.cookie, file, "public");
    const privateAlias = await shortcut(member.cookie, file),
      publicAlias = await shortcut(
        member.cookie,
        file,
        null,
        "public",
        "Known public label",
      );
    await moveFile(owner.cookie, file, "private");
    await result(
      await request(
        `/files/${file.id}`,
        "PATCH",
        { name: "Secret-current-name.txt", expectedName: "original.txt" },
        owner.cookie,
      ),
    );
    for (const alias of [privateAlias, publicAlias]) {
      const response = await result(
        await request(
          `/shortcuts/${alias.id}`,
          "GET",
          undefined,
          member.cookie,
        ),
      );
      expect(response.shortcut.target).toBeNull();
      expect(response.shortcut.available).toBe(false);
      expect(JSON.stringify(response)).not.toContain("Secret-current-name");
    }
    expect(
      (
        await result(
          await request(
            `/shortcuts/${publicAlias.id}`,
            "GET",
            undefined,
            admin.cookie,
          ),
        )
      ).shortcut.target,
    ).toBeNull();
    expect(
      (
        await result(
          await request(
            `/shortcuts/${privateAlias.id}`,
            "GET",
            undefined,
            admin.cookie,
          ),
        )
      ).shortcut.available,
    ).toBe(true);
    await moveFile(owner.cookie, file, "public");
    expect(
      (
        await result(
          await request(
            `/shortcuts/${privateAlias.id}`,
            "GET",
            undefined,
            member.cookie,
          ),
        )
      ).shortcut.target.name,
    ).toBe("Secret-current-name.txt");
    await env.DB.prepare("UPDATE files SET expires_at=1 WHERE id=?")
      .bind(file.id)
      .run();
    expect(
      (
        await result(
          await request(
            `/shortcuts/${privateAlias.id}`,
            "GET",
            undefined,
            member.cookie,
          ),
        )
      ).shortcut.available,
    ).toBe(false);
    await result(
      await request(`/files/${file.id}`, "DELETE", undefined, owner.cookie),
    );
    expect(
      (
        await result(
          await request(
            `/shortcuts/${publicAlias.id}`,
            "GET",
            undefined,
            member.cookie,
          ),
        )
      ).shortcut.available,
    ).toBe(false);
    await result(
      await request(
        `/shortcuts/${publicAlias.id}`,
        "PATCH",
        { name: "Broken link" },
        owner.cookie,
      ),
    );
    await result(
      await request(
        `/shortcuts/${publicAlias.id}`,
        "DELETE",
        undefined,
        member.cookie,
      ),
    );
  });
  it("includes available shortcut bytes in folder ZIPs and protects folders containing shortcuts", async () => {
    const user = await login(),
      source = await upload(user.cookie),
      destination = await folder(user.cookie, "Archive"),
      child = await folder(user.cookie, "Nested", destination.id);
    const ordinary = await upload(user.cookie, destination.id);
    const alias = await shortcut(
      user.cookie,
      source,
      destination.id,
      "private",
      "original.txt",
    );
    await shortcut(user.cookie, source, child.id, "private", "合同.txt");
    const manifest = await result(
      await request(
        `/folders/${destination.id}/archive`,
        "GET",
        undefined,
        user.cookie,
      ),
    );
    expect(manifest.fileCount).toBe(3);
    expect(manifest.totalSize).toBe(24);
    expect(
      manifest.entries.filter((entry: Row) => entry.id === source.id),
    ).toHaveLength(2);
    expect(manifest.entries.map((entry: Row) => entry.path)).toContain(
      "Archive/original (2).txt",
    );
    expect(manifest.entries.map((entry: Row) => entry.path)).toContain(
      "Archive/Nested/合同.txt",
    );
    const protectedFolder = await result(
      await request(`/folders/${child.id}`, "DELETE", undefined, user.cookie),
      409,
    );
    expect(protectedFolder.error).toContain("shortcuts");
    await result(
      await request(`/files/${source.id}`, "DELETE", undefined, user.cookie),
    );
    await result(
      await request(
        `/folders/${destination.id}/archive`,
        "GET",
        undefined,
        user.cookie,
      ),
      409,
    );
    expect(
      (
        await result(
          await request(
            `/shortcuts/${alias.id}`,
            "GET",
            undefined,
            user.cookie,
          ),
        )
      ).shortcut.target,
    ).toBeNull();
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(ordinary.id)
        .first<Row>())!.state,
    ).toBe("ready");
  });
  it("creates references without eviction at full capacity and marks them unavailable after FIFO eviction of the source", async () => {
    const user = await login(),
      file = await upload(user.cookie);
    await env.DB.prepare(
      "UPDATE connectors SET limit_bytes=8 WHERE id='r2-default'",
    ).run();
    const alias = await shortcut(user.cookie, file);
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(file.id)
        .first<Row>())!.state,
    ).toBe("ready");
    expect(
      (await env.DB.prepare(
        "SELECT SUM(size) AS used FROM files WHERE state<>'deleted'",
      ).first<Row>())!.used,
    ).toBe(8);
    await upload(user.cookie);
    expect(
      (
        await result(
          await request(
            `/shortcuts/${alias.id}`,
            "GET",
            undefined,
            user.cookie,
          ),
        )
      ).shortcut.available,
    ).toBe(false);
  });
  it("enforces duplicate and workspace limits in the database", async () => {
    const user = await login(),
      file = await upload(user.cookie);
    const payload = { fileId: file.id, name: "Same", folderId: null };
    const concurrent = await Promise.all([
      request("/shortcuts", "POST", payload, user.cookie),
      request("/shortcuts", "POST", payload, user.cookie),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    await env.DB.prepare("DELETE FROM file_shortcuts").run();
    const ids = JSON.stringify(
      Array.from({ length: 1000 }, (_, index) => `shortcut-limit-${index}`),
    );
    await env.DB.prepare(
      `INSERT INTO files(id,owner_id,connector_id,name,mime,size,state,object_key,fingerprint,created_at,upload_expires_at,space) SELECT j.value,f.owner_id,f.connector_id,f.name,f.mime,f.size,f.state,f.object_key,f.fingerprint,f.created_at,f.upload_expires_at,f.space FROM files f,json_each(?) j WHERE f.id=?`,
    )
      .bind(ids, file.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO file_shortcuts(id,owner_id,file_id,name,space,created_at) SELECT 'alias-'||value,?,value,'Link','private',0 FROM json_each(?)",
    )
      .bind(user.id, ids)
      .run();
    await result(
      await request("/shortcuts", "POST", payload, user.cookie),
      409,
    );
    expect(await listed(user.cookie)).toHaveLength(1000);
  });
  it("removes deleted users' private shortcuts before folder cleanup and preserves Public team references", async () => {
    const admin = await login(),
      owner = await login("shortcut-original-owner@international.gc.ca"),
      user = await login("shortcut-departing@international.gc.ca"),
      file = await upload(owner.cookie);
    await moveFile(owner.cookie, file, "public");
    const destination = await folder(user.cookie, "Personal references");
    await shortcut(user.cookie, file, destination.id);
    const shared = await shortcut(user.cookie, file, null, "public");
    await result(
      await request(
        `/admin/users/${user.id}`,
        "DELETE",
        undefined,
        admin.cookie,
      ),
    );
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM file_shortcuts WHERE owner_id=? AND space='private'",
      )
        .bind(user.id)
        .first<Row>())!.n,
    ).toBe(0);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM folders WHERE owner_id=? AND space='private'",
      )
        .bind(user.id)
        .first<Row>())!.n,
    ).toBe(0);
    expect(
      (
        await result(
          await request(
            `/shortcuts/${shared.id}`,
            "GET",
            undefined,
            owner.cookie,
          ),
        )
      ).shortcut.available,
    ).toBe(true);
    await result(
      await request(
        `/shortcuts/${shared.id}`,
        "DELETE",
        undefined,
        admin.cookie,
      ),
    );
  });
});
