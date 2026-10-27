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
async function rename(
  cookie: string,
  file: Row,
  name: string,
  status = 200,
  expectedName = file.name,
) {
  return result(
    await request(`/files/${file.id}`, "PATCH", { name, expectedName }, cookie),
    status,
  );
}
describe("file renaming", () => {
  it("renames metadata while preserving file identity, folder, provider bytes, retention and verified shares", async () => {
    const user = await login(),
      directory = await folder(user.cookie, "Reports"),
      file = await upload(user.cookie, directory.id),
      before = await stored(file.id);
    const share = await result(
        await request(
          `/files/${file.id}/shares`,
          "POST",
          {
            recipients: ["partner@example.com"],
            expiresDays: 7,
            sendEmail: false,
          },
          user.cookie,
        ),
        201,
      ),
      guest = await partner(share);
    await rename(user.cookie, file, "  Revue 合同.txt  ");
    expect(await stored(file.id)).toEqual({
      ...before,
      name: "Revue 合同.txt",
    });
    const response = await request(
      `/files/${file.id}/download`,
      "GET",
      undefined,
      guest,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original");
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("Revue 合同.txt"),
    );
    const list = await result(
      await request(
        `/files?folderId=${directory.id}`,
        "GET",
        undefined,
        user.cookie,
      ),
    );
    expect(list.files[0]).toMatchObject({
      id: file.id,
      name: "Revue 合同.txt",
      can_rename: true,
    });
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) total FROM audit_log WHERE action='file.renamed' AND target_id=?",
      )
        .bind(file.id)
        .first<Row>())!.total,
    ).toBe(1);
  });
  it("enforces Private permissions, permits Public organization, and rejects stale or concurrent renames", async () => {
    const admin = await login(),
      alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca"),
      pending = await login("pending@example.com"),
      file = await upload(alice.cookie);
    await rename("", file, "Anonymous.txt", 401);
    await rename(pending.cookie, file, "Pending.txt", 403);
    await rename(bob.cookie, file, "Stolen.txt", 404);
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [file.id], folderId: null, space: "public" },
        alice.cookie,
      ),
    );
    await rename(bob.cookie, file, "Team.txt");
    await rename(alice.cookie, file, "Stale.txt", 409);
    const current = { ...file, name: "Team.txt" };
    const results = await Promise.all([
      request(
        `/files/${file.id}`,
        "PATCH",
        { name: "First.txt", expectedName: current.name },
        alice.cookie,
      ),
      request(
        `/files/${file.id}`,
        "PATCH",
        { name: "Second.txt", expectedName: current.name },
        bob.cookie,
      ),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    for (const response of results) await response.arrayBuffer();
    await result(
      await request(
        "/files/move",
        "POST",
        { fileIds: [file.id], folderId: null, space: "private" },
        alice.cookie,
      ),
    );
    const latest = await stored(file.id);
    await rename(bob.cookie, latest, "Forbidden.txt", 404);
    await rename(admin.cookie, latest, "Admin.txt");
    expect((await stored(file.id)).owner_id).toBe(alice.id);
  });
  it("validates filenames and preserves extensions without allowing renames to revive incomplete, expired or deleted files", async () => {
    const user = await login(),
      file = await upload(user.cookie);
    for (const name of [
      "",
      ".",
      "..",
      "a/b.txt",
      "a\\b.txt",
      "a\u0000.txt",
      "a\u007f.txt",
      "x".repeat(252) + ".txt",
      "changed.pdf",
    ])
      await rename(user.cookie, file, name, 400);
    await rename(user.cookie, file, "Cafe\u0301.txt");
    expect((await stored(file.id)).name).toBe("Café.txt");
    const paused = await begin(user.cookie);
    await rename(user.cookie, paused, "Paused.txt", 409);
    const rows = (
      await result(await request("/files", "GET", undefined, user.cookie))
    ).files;
    expect(rows.find((row: Row) => row.id === paused.id).can_rename).toBe(
      false,
    );
    await env.DB.prepare("UPDATE files SET expires_at=? WHERE id=?")
      .bind(Date.now() - 1000, file.id)
      .run();
    await rename(
      user.cookie,
      { ...file, name: "Café.txt" },
      "Expired.txt",
      410,
    );
    await result(
      await request(`/files/${file.id}`, "DELETE", undefined, user.cookie),
    );
    await rename(
      user.cookie,
      { ...file, name: "Café.txt" },
      "Deleted.txt",
      410,
    );
  });
  it("renames a collaboration working copy and keeps the target name through an already-uploaded edit and future saves", async () => {
    const user = await login(),
      source = await upload(user.cookie),
      invitation = await link(user.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "Working.txt",
      }),
      guest = await partner(invitation),
      path = `/invitations/${invitation.id}/uploads`;
    await rename(user.cookie, source, "Original renamed.txt");
    expect(
      (await env.DB.prepare("SELECT target_name FROM invitations WHERE id=?")
        .bind(invitation.id)
        .first<Row>())!.target_name,
    ).toBe("Working.txt");
    const first = await begin(guest, { baseRevision: 0 }, path);
    await finish(guest, first, "original", path);
    await rename(user.cookie, first, "Too soon.txt", 409);
    await result(
      await request(`${path}/${first.id}/publish`, "POST", {}, guest),
    );
    const edit = await begin(guest, { baseRevision: 1 }, path);
    await finish(guest, edit, "original", path);
    await rename(user.cookie, first, "Reviewed.txt");
    expect(
      (await env.DB.prepare("SELECT target_name FROM invitations WHERE id=?")
        .bind(invitation.id)
        .first<Row>())!.target_name,
    ).toBe("Reviewed.txt");
    const download = await request(
      `/invitations/${invitation.id}/download`,
      "GET",
      undefined,
      guest,
    );
    expect(download.headers.get("content-disposition")).toContain(
      "Reviewed.txt",
    );
    expect(await download.text()).toBe("original");
    await result(
      await request(`${path}/${edit.id}/publish`, "POST", {}, guest),
    );
    expect((await stored(edit.id)).name).toBe("Reviewed.txt");
    expect((await stored(source.id)).name).toBe("Original renamed.txt");
    const next = await begin(guest, { baseRevision: 2 }, path);
    expect(next.name).toBe("Reviewed.txt");
  });
});
