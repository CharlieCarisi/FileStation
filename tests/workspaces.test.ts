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
async function directory(
  cookie: string,
  name: string,
  space = "public",
  parentId: string | null = null,
) {
  return (
    await result(
      await request("/folders", "POST", { name, space, parentId }, cookie),
      201,
    )
  ).folder as Row;
}
async function move(
  cookie: string,
  ids: string[],
  space: string,
  folderId: string | null = null,
  status = 200,
) {
  return result(
    await request(
      "/files/move",
      "POST",
      { fileIds: ids, folderId, space },
      cookie,
    ),
    status,
  );
}
async function files(cookie: string, space = "public", folderId?: string) {
  return (
    await result(
      await request(
        `/files?space=${space}${folderId ? `&folderId=${folderId}` : ""}`,
        "GET",
        undefined,
        cookie,
      ),
    )
  ).files as Row[];
}
describe("Private and Public workspaces", () => {
  it("keeps old uploads/folders Private and provides one shared folder tree only to approved members", async () => {
    const alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca"),
      pending = await login("pending@example.com");
    const personal = await folder(alice.cookie, "Documents"),
      legacy = await upload(alice.cookie, personal.id);
    expect((await stored(legacy.id)).space).toBe("private");
    expect((await files(bob.cookie, "all")).length).toBe(0);
    const shared = await directory(alice.cookie, "Documents");
    const nested = await directory(
      bob.cookie,
      "Partner documents",
      "public",
      shared.id,
    );
    expect(
      (
        await result(
          await request("/folders?space=public", "GET", undefined, bob.cookie),
        )
      ).folders
        .map((row: Row) => row.id)
        .sort(),
    ).toEqual([shared.id, nested.id].sort());
    expect(
      (await result(await request("/folders", "GET", undefined, bob.cookie)))
        .folders,
    ).toHaveLength(0);
    await result(
      await request(
        "/folders",
        "POST",
        { name: "Documents", space: "public" },
        bob.cookie,
      ),
      409,
    );
    await result(
      await request(
        `/folders/${nested.id}`,
        "PATCH",
        { name: "Renamed by teammate" },
        alice.cookie,
      ),
    );
    await result(
      await request(
        `/folders/${shared.id}`,
        "PATCH",
        { parentId: nested.id },
        bob.cookie,
      ),
      409,
    );
    await result(
      await request(
        "/folders",
        "POST",
        { name: "Cross-space", space: "public", parentId: personal.id },
        alice.cookie,
      ),
      404,
    );
    await result(await request("/folders?space=public"), 401);
    await result(
      await request("/files?space=public", "GET", undefined, pending.cookie),
      403,
    );
    await result(
      await request("/folders?space=public", "GET", undefined, pending.cookie),
      403,
    );
    await result(
      await request(
        "/folders",
        "POST",
        { name: "Forbidden", space: "public" },
        pending.cookie,
      ),
      403,
    );
    await result(
      await request(
        `/files?space=private&folderId=${personal.id}`,
        "GET",
        undefined,
        bob.cookie,
      ),
      404,
    );
  });
  it("lets colleagues download, preview and create their own shares after publication while preserving storage and existing share codes", async () => {
    const alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca");
    const file = await upload(alice.cookie),
      before = await stored(file.id);
    const originalShare = await result(
        await request(
          `/files/${file.id}/shares`,
          "POST",
          {
            recipients: ["partner@example.com"],
            expiresDays: 7,
            sendEmail: false,
          },
          alice.cookie,
        ),
        201,
      ),
      recipient = await partner(originalShare);
    await move(alice.cookie, [file.id], "public");
    expect(await stored(file.id)).toEqual({ ...before, space: "public" });
    const publicRow = (await files(bob.cookie)).find(
      (row) => row.id === file.id,
    )!;
    expect(publicRow).toMatchObject({
      can_delete: false,
      can_make_private: false,
      can_resume: false,
    });
    expect(publicRow).not.toHaveProperty("provider_upload_id");
    expect(publicRow).not.toHaveProperty("object_key");
    expect(publicRow).not.toHaveProperty("provider_file_id");
    expect(
      await (
        await request(
          `/files/${file.id}/download`,
          "GET",
          undefined,
          bob.cookie,
        )
      ).text(),
    ).toBe("original");
    expect(
      await (
        await request(`/files/${file.id}/preview`, "GET", undefined, bob.cookie)
      ).text(),
    ).toBe("original");
    const ranged = await SELF.fetch(
      `${origin}/files/api/files/${file.id}/download`,
      { headers: { Cookie: bob.cookie, Range: "bytes=1-3" } },
    );
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe("rig");
    await result(await request(`/files/${file.id}/download`), 401);
    const teamShare = await result(
      await request(
        `/files/${file.id}/shares`,
        "POST",
        {
          recipients: ["partner@example.com"],
          expiresDays: 7,
          sendEmail: false,
        },
        bob.cookie,
      ),
      201,
    );
    expect(
      (
        await result(
          await request(
            `/files/${file.id}/shares`,
            "GET",
            undefined,
            bob.cookie,
          ),
        )
      ).shares.map((row: Row) => row.id),
    ).toEqual([teamShare.id]);
    expect(
      (
        await result(
          await request(
            "/files?space=all&sharedByMe=true",
            "GET",
            undefined,
            bob.cookie,
          ),
        )
      ).files[0].id,
    ).toBe(file.id);
    await result(
      await request(
        `/shares/${originalShare.id}`,
        "DELETE",
        undefined,
        bob.cookie,
      ),
      404,
    );
    await result(
      await request(`/shares/${teamShare.id}`, "DELETE", undefined, bob.cookie),
    );
    await move(alice.cookie, [file.id], "private");
    expect((await files(bob.cookie, "all")).length).toBe(0);
    await result(
      await request(`/files/${file.id}/download`, "GET", undefined, bob.cookie),
      401,
    );
    await result(
      await request(
        `/files/${file.id}/shares`,
        "POST",
        {
          recipients: ["partner@example.com"],
          expiresDays: 7,
          sendEmail: false,
        },
        bob.cookie,
      ),
      404,
    );
    expect(
      await (
        await request(`/files/${file.id}/download`, "GET", undefined, recipient)
      ).text(),
    ).toBe("original");
  });
  it("allows multi-uploader organization in Public while restricting deletion, upload control and Private migration to uploader/admin", async () => {
    const admin = await login(),
      alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca");
    const a = await upload(alice.cookie),
      b = await upload(bob.cookie),
      target = await directory(bob.cookie, "Team folder");
    await move(alice.cookie, [a.id], "public");
    await move(bob.cookie, [b.id], "public");
    await move(bob.cookie, [a.id, b.id], "public", target.id);
    expect(
      (await files(alice.cookie, "public", target.id))
        .map((row) => row.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    await move(bob.cookie, [a.id], "private", null, 403);
    await result(
      await request(`/files/${a.id}`, "DELETE", undefined, bob.cookie),
      404,
    );
    await result(
      await request(`/uploads/${a.id}`, "GET", undefined, bob.cookie),
      404,
    );
    await result(
      await request(
        `/uploads/${a.id}/parts/1`,
        "PUT",
        new TextEncoder().encode("tampered"),
        bob.cookie,
      ),
      404,
    );
    await move(admin.cookie, [a.id, b.id], "private", null, 400);
    await move(admin.cookie, [a.id], "private");
    expect((await stored(a.id)).owner_id).toBe(alice.id);
    const current = await stored(b.id);
    await move(bob.cookie, [a.id, b.id], "public", null, 404);
    expect(await stored(b.id)).toEqual(current);
    const privateFolder = await folder(bob.cookie, "Private target");
    await move(bob.cookie, [b.id], "public", privateFolder.id, 404);
    await expect(
      env.DB.prepare("UPDATE files SET folder_id=? WHERE id=?")
        .bind(privateFolder.id, b.id)
        .run(),
    ).rejects.toThrow("folder_owner");
    await result(
      await request(`/files/${b.id}`, "DELETE", undefined, admin.cookie),
    );
    expect((await stored(b.id)).state).toBe("deleted");
  });
  it("pins external submissions and collaboration saves to the chosen workspace and follows an in-flight working copy moved to Private", async () => {
    const alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca"),
      inbox = await directory(alice.cookie, "Team inbox");
    const submission = await link(bob.cookie, {
        space: "public",
        folderId: inbox.id,
      }),
      external = await partner(submission),
      path = `/invitations/${submission.id}/uploads`;
    const submitted = await begin(
      external,
      { space: "private", folderId: "malicious" },
      path,
    );
    await finish(external, submitted, "original", path);
    await result(
      await request(`${path}/${submitted.id}/publish`, "POST", {}, external),
    );
    expect(await stored(submitted.id)).toMatchObject({
      owner_id: bob.id,
      space: "public",
      folder_id: inbox.id,
    });
    await result(
      await request("/files?space=public", "GET", undefined, external),
      401,
    );
    const source = await upload(alice.cookie);
    await move(alice.cookie, [source.id], "public");
    const invitation = await link(bob.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "reviewed.txt",
        space: "public",
        folderId: inbox.id,
      }),
      collaborator = await partner(invitation),
      draftPath = `/invitations/${invitation.id}/uploads`;
    const first = await begin(collaborator, { baseRevision: 0 }, draftPath);
    await finish(collaborator, first, "original", draftPath);
    await result(
      await request(
        `${draftPath}/${first.id}/publish`,
        "POST",
        {},
        collaborator,
      ),
    );
    const pending = await begin(collaborator, { baseRevision: 1 }, draftPath);
    await finish(collaborator, pending, "original", draftPath);
    await move(bob.cookie, [first.id], "private");
    await result(
      await request(
        `${draftPath}/${pending.id}/publish`,
        "POST",
        {},
        collaborator,
      ),
    );
    expect(await stored(pending.id)).toMatchObject({
      owner_id: bob.id,
      space: "private",
      folder_id: null,
    });
    expect(
      (await files(alice.cookie, "all")).some((row) => row.id === pending.id),
    ).toBe(false);
    expect((await stored(source.id)).space).toBe("public");
    const next = await begin(
      collaborator,
      { baseRevision: 2, space: "public" },
      draftPath,
    );
    expect((await stored(next.id)).space).toBe("private");
    const privateSource = await upload(alice.cookie);
    await result(
      await request(
        "/invitations",
        "POST",
        {
          kind: "collaboration",
          title: "Unauthorized source",
          sourceFileId: privateSource.id,
          targetName: "stolen.txt",
          connectorId: "r2-default",
          space: "public",
          recipients: ["partner@example.com"],
          expiresDays: 7,
          maxFileBytes: 100000,
          maxFiles: 10,
          sendEmail: false,
        },
        bob.cookie,
      ),
      404,
    );
  });
  it("retains shared team documents and folders when their uploader is deleted, while cleaning Private files and unfinished uploads", async () => {
    const admin = await login(),
      alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca");
    const sharedFolder = await directory(alice.cookie, "Retained team folder"),
      privateFolder = await folder(alice.cookie, "Private folder");
    const personal = await upload(alice.cookie, privateFolder.id),
      shared = await begin(alice.cookie, {
        space: "public",
        folderId: sharedFolder.id,
      });
    await finish(alice.cookie, shared);
    const unfinished = await begin(alice.cookie, {
      space: "public",
      folderId: sharedFolder.id,
    });
    await result(
      await request(
        `/admin/users/${alice.id}`,
        "DELETE",
        undefined,
        admin.cookie,
      ),
    );
    expect((await stored(personal.id)).state).toBe("deleted");
    expect((await stored(unfinished.id)).state).toBe("deleted");
    expect((await stored(shared.id)).state).toBe("ready");
    expect(
      (
        await result(
          await request("/folders?space=public", "GET", undefined, bob.cookie),
        )
      ).folders.some((row: Row) => row.id === sharedFolder.id),
    ).toBe(true);
    const another = await begin(bob.cookie, {
      space: "public",
      folderId: sharedFolder.id,
    });
    await finish(bob.cookie, another);
    expect(
      await (
        await request(
          `/files/${shared.id}/download`,
          "GET",
          undefined,
          bob.cookie,
        )
      ).text(),
    ).toBe("original");
    await directory(bob.cookie, "New child", "public", sharedFolder.id);
    await result(
      await request(`/files/${shared.id}`, "DELETE", undefined, bob.cookie),
      404,
    );
    await result(
      await request(`/files/${shared.id}`, "DELETE", undefined, admin.cookie),
    );
  });
  it("cannot restore a file to Public using stale team permissions during concurrent moves to Private", async () => {
    const alice = await login("alice@international.gc.ca"),
      bob = await login("bob@international.gc.ca"),
      file = await upload(alice.cookie),
      target = await directory(bob.cookie, "Concurrent destination");
    for (let round = 0; round < 10; round++) {
      await move(alice.cookie, [file.id], "public");
      const responses = await Promise.all([
        request(
          "/files/move",
          "POST",
          { fileIds: [file.id], folderId: null, space: "private" },
          alice.cookie,
        ),
        request(
          "/files/move",
          "POST",
          { fileIds: [file.id], folderId: target.id, space: "public" },
          bob.cookie,
        ),
      ]);
      await result(responses[0]);
      expect([200, 404, 409]).toContain(responses[1].status);
      await responses[1].arrayBuffer();
      expect((await stored(file.id)).space).toBe("private");
    }
  });
});
