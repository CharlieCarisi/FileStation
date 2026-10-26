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
async function link(cookie: string, options: Row = {}) {
  return result(
    await request(
      "/invitations",
      "POST",
      {
        kind: "submission",
        title: "Documents",
        connectorId: "r2-default",
        recipients: ["partner@example.com"],
        expiresDays: 7,
        maxFileBytes: 1000000,
        maxFiles: 10,
        sendEmail: false,
        ...options,
      },
      cookie,
    ),
    201,
  );
}
async function partner(link: Row) {
  const challenge = await result(
    await request("/access/request", "POST", {
      code: link.code,
      email: "partner@example.com",
    }),
  );
  const response = await request("/access/verify", "POST", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
    kind: challenge.kind,
  });
  await result(response);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function stored(id: string): Promise<Row> {
  return (await env.DB.prepare("SELECT * FROM files WHERE id=?")
    .bind(id)
    .first<Row>())!;
}
describe("private workspace folders", () => {
  it("creates, renames and reparents nested folders, enforces sibling names, depth and cycles atomically", async () => {
    const user = await login();
    const a = await folder(user.cookie, " A "),
      b = await folder(user.cookie, "B", a.id);
    expect(a.name).toBe("A");
    await result(
      await request("/folders", "POST", { name: "a" }, user.cookie),
      409,
    );
    for (const name of ["..", "a/b", "a\\b", "x\u0000y", " ", "x".repeat(121)])
      await result(
        await request("/folders", "POST", { name }, user.cookie),
        400,
      );
    await result(
      await request(
        `/folders/${a.id}`,
        "PATCH",
        { parentId: b.id },
        user.cookie,
      ),
      409,
    );
    await result(
      await request(
        `/folders/${b.id}`,
        "PATCH",
        { name: "Renamed", parentId: null },
        user.cookie,
      ),
    );
    expect(
      (await result(await request("/folders", "GET", undefined, user.cookie)))
        .folders,
    ).toHaveLength(2);
    const concurrent = await Promise.all([
      request(`/folders/${a.id}`, "PATCH", { parentId: b.id }, user.cookie),
      request(`/folders/${b.id}`, "PATCH", { parentId: a.id }, user.cookie),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    let parentId: string | null = null;
    for (let level = 1; level <= 20; level++)
      parentId = (await folder(user.cookie, `Level ${level}`, parentId)).id;
    await result(
      await request(
        "/folders",
        "POST",
        { name: "Too deep", parentId },
        user.cookie,
      ),
      409,
    );
    await result(
      await request(`/folders/${a.id}`, "PATCH", { parentId }, user.cookie),
      409,
    );
    const top = await folder(user.cookie, "Another root"),
      child = await folder(user.cookie, "Child", top.id);
    const level19 = await env.DB.prepare(
      "SELECT id FROM folders WHERE name='Level 19'",
    ).first<Row>();
    await result(
      await request(
        `/folders/${top.id}`,
        "PATCH",
        { parentId: level19!.id },
        user.cookie,
      ),
      409,
    );
    expect(
      (
        await result(await request(`/folders`, "GET", undefined, user.cookie))
      ).folders.find((row: Row) => row.id === child.id).parent_id,
    ).toBe(top.id);
  });
  it("isolates owners, allows administrative organization without changing ownership, and rejects mixed-owner batches", async () => {
    const admin = await login(),
      alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca"),
      pending = await login("pending@example.com");
    const a = await folder(alice.cookie, "Alice"),
      b = await folder(bob.cookie, "Bob");
    await result(await request("/folders"), 401);
    await result(
      await request("/folders", "GET", undefined, pending.cookie),
      403,
    );
    await result(
      await request(
        `/folders?ownerId=${bob.id}`,
        "GET",
        undefined,
        alice.cookie,
      ),
      403,
    );
    await result(
      await request(
        `/folders/${b.id}`,
        "PATCH",
        { name: "Stolen" },
        alice.cookie,
      ),
      404,
    );
    await result(
      await request(
        "/folders",
        "POST",
        { name: "Foreign", parentId: b.id },
        alice.cookie,
      ),
      404,
    );
    await result(
      await request(`/files?folderId=${b.id}`, "GET", undefined, alice.cookie),
      404,
    );
    const file = await upload(alice.cookie),
      other = await upload(bob.cookie);
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [file.id], folderId: b.id },
        alice.cookie,
      ),
      404,
    );
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [file.id], folderId: null },
        bob.cookie,
      ),
      404,
    );
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [file.id, other.id], folderId: null },
        admin.cookie,
      ),
      400,
    );
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [file.id], folderId: a.id },
        admin.cookie,
      ),
    );
    expect(await stored(file.id)).toMatchObject({
      owner_id: alice.id,
      folder_id: a.id,
    });
    expect(
      (
        await result(
          await request(
            `/folders?ownerId=${alice.id}`,
            "GET",
            undefined,
            admin.cookie,
          ),
        )
      ).folders[0].id,
    ).toBe(a.id);
    expect(
      (
        await result(
          await request(
            `/files?all=true&folderId=${a.id}`,
            "GET",
            undefined,
            admin.cookie,
          ),
        )
      ).files[0].id,
    ).toBe(file.id);
    await expect(
      env.DB.prepare("UPDATE files SET folder_id=? WHERE id=?")
        .bind(b.id, file.id)
        .run(),
    ).rejects.toThrow("folder_owner");
  });
  it("moves paused uploads and selected files back to root while preserving storage, retention, shares and ranges", async () => {
    const user = await login(),
      directory = await folder(user.cookie, "Reports");
    const first = await upload(user.cookie),
      paused = await begin(user.cookie, { folderId: directory.id });
    const share = await result(
      await request(
        `/files/${first.id}/shares`,
        "POST",
        {
          recipients: ["partner@example.com"],
          expiresDays: 7,
          sendEmail: false,
        },
        user.cookie,
      ),
      201,
    );
    const guest = await partner(share),
      before = await stored(first.id);
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [first.id], folderId: directory.id },
        user.cookie,
      ),
    );
    const after = await stored(first.id);
    expect(after).toEqual({ ...before, folder_id: directory.id });
    expect(
      (
        await result(
          await request("/files?folderId=root", "GET", undefined, user.cookie),
        )
      ).files,
    ).toHaveLength(0);
    expect(
      (
        await result(
          await request(
            `/files?folderId=${directory.id}`,
            "GET",
            undefined,
            user.cookie,
          ),
        )
      ).files
        .map((row: Row) => row.id)
        .sort(),
    ).toEqual([first.id, paused.id].sort());
    const shareFile = await SELF.fetch(
      `${origin}/files/api/files/${first.id}/download`,
      { headers: { Cookie: guest, Range: "bytes=1-3" } },
    );
    expect(shareFile.status).toBe(206);
    expect(await shareFile.text()).toBe("rig");
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [first.id, paused.id], folderId: null },
        user.cookie,
      ),
    );
    await finish(user.cookie, paused);
    expect((await stored(paused.id)).folder_id).toBeNull();
    expect(
      (
        await result(
          await request("/files?folderId=root", "GET", undefined, user.cookie),
        )
      ).files,
    ).toHaveLength(2);
    expect(
      (await result(await request("/files", "GET", undefined, user.cookie)))
        .files,
    ).toHaveLength(2);
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [first.id, "missing"], folderId: directory.id },
        user.cookie,
      ),
      404,
    );
    expect((await stored(first.id)).folder_id).toBeNull();
  });
  it("filters folders before the 500-file limit and moves a full visible selection in one transaction", async () => {
    const user = await login(),
      directory = await folder(user.cookie, "Older documents");
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: `fixture-${index}`,
      age: index + 100,
    }));
    await env.DB.prepare(
      "INSERT INTO files(id,owner_id,connector_id,name,mime,size,state,object_key,fingerprint,created_at,upload_expires_at) SELECT json_extract(value,'$.id'),?,'r2-default','Fixture.txt','text/plain',1,'ready',json_extract(value,'$.id'),?,json_extract(value,'$.age'),9999999999999 FROM json_each(?)",
    )
      .bind(user.id, "a".repeat(64), JSON.stringify(rows))
      .run();
    await env.DB.prepare(
      "UPDATE files SET folder_id=?,created_at=1 WHERE id='fixture-0'",
    )
      .bind(directory.id)
      .run();
    const root = (
      await result(
        await request("/files?folderId=root", "GET", undefined, user.cookie),
      )
    ).files;
    expect(root).toHaveLength(500);
    expect(
      (
        await result(
          await request(
            `/files?folderId=${directory.id}`,
            "GET",
            undefined,
            user.cookie,
          ),
        )
      ).files[0].id,
    ).toBe("fixture-0");
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: root.map((row: Row) => row.id), folderId: directory.id },
        user.cookie,
      ),
    );
    expect(
      (
        await result(
          await request("/files?folderId=root", "GET", undefined, user.cookie),
        )
      ).files,
    ).toHaveLength(0);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) total FROM files WHERE folder_id=?",
      )
        .bind(directory.id)
        .first<Row>())!.total,
    ).toBe(501);
  });
  it("deletes only empty folders, protects active invitations, and cleans nested folders during account deletion", async () => {
    const admin = await login(),
      user = await login("cleanup@international.gc.ca"),
      directory = await folder(user.cookie, "Parent"),
      child = await folder(user.cookie, "Same", directory.id);
    await folder(user.cookie, "Same"); // A same-named root must not collide during cleanup.
    await result(
      await request(
        `/folders/${directory.id}`,
        "DELETE",
        undefined,
        user.cookie,
      ),
      409,
    );
    const file = await upload(user.cookie, child.id);
    await result(
      await request(`/folders/${child.id}`, "DELETE", undefined, user.cookie),
      409,
    );
    await result(
      await request(`/files/${file.id}`, "DELETE", undefined, user.cookie),
    );
    const invitation = await link(user.cookie, { folderId: child.id });
    await result(
      await request(`/folders/${child.id}`, "DELETE", undefined, user.cookie),
      409,
    );
    await result(
      await request(
        `/invitations/${invitation.id}`,
        "DELETE",
        undefined,
        user.cookie,
      ),
    );
    await result(
      await request(`/folders/${child.id}`, "DELETE", undefined, user.cookie),
    );
    expect((await stored(file.id)).folder_id).toBeNull();
    await folder(user.cookie, "Nested", directory.id);
    await link(user.cookie, { folderId: directory.id });
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
        "SELECT COUNT(*) total FROM folders WHERE owner_id=?",
      )
        .bind(user.id)
        .first<Row>())!.total,
    ).toBe(0);
    expect(
      (await env.DB.prepare("SELECT status FROM users WHERE id=?")
        .bind(user.id)
        .first<Row>())!.status,
    ).toBe("deleted");
  });
  it("forces submissions into the inviter's folder and follows moved collaboration copies, even for an in-flight save", async () => {
    const user = await login(),
      inbox = await folder(user.cookie, "Inbox"),
      edited = await folder(user.cookie, "Edited"),
      originalFolder = await folder(user.cookie, "Originals");
    const submission = await link(user.cookie, { folderId: inbox.id }),
      guest = await partner(submission),
      submissionPath = `/invitations/${submission.id}/uploads`;
    const submitted = await begin(
      guest,
      { folderId: "malicious-foreign-folder" },
      submissionPath,
    );
    await finish(guest, submitted, "original", submissionPath);
    await result(
      await request(
        `${submissionPath}/${submitted.id}/publish`,
        "POST",
        {},
        guest,
      ),
    );
    expect((await stored(submitted.id)).folder_id).toBe(inbox.id);
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [submitted.id], folderId: null },
        guest,
      ),
      401,
    );
    const source = await upload(user.cookie, originalFolder.id);
    const collaboration = await link(user.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "reviewed.txt",
        folderId: inbox.id,
      }),
      collaborator = await partner(collaboration),
      path = `/invitations/${collaboration.id}/uploads`;
    const first = await begin(collaborator, { baseRevision: 0 }, path);
    await finish(collaborator, first, "original", path);
    await result(
      await request(`${path}/${first.id}/publish`, "POST", {}, collaborator),
    );
    const inflight = await begin(collaborator, { baseRevision: 1 }, path);
    await finish(collaborator, inflight, "original", path);
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [first.id], folderId: edited.id },
        user.cookie,
      ),
    );
    await result(
      await request(`${path}/${inflight.id}/publish`, "POST", {}, collaborator),
    );
    expect((await stored(inflight.id)).folder_id).toBe(edited.id);
    expect((await stored(first.id)).state).toBe("deleted");
    expect((await stored(source.id)).folder_id).toBe(originalFolder.id);
    expect((await stored(source.id)).state).toBe("ready");
    const last = await begin(collaborator, { baseRevision: 2 }, path);
    expect((await stored(last.id)).folder_id).toBe(edited.id);
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [inflight.id], folderId: null },
        user.cookie,
      ),
    );
    expect(
      (await env.DB.prepare("SELECT folder_id FROM invitations WHERE id=?")
        .bind(collaboration.id)
        .first<Row>())!.folder_id,
    ).toBeNull();
  });
});
