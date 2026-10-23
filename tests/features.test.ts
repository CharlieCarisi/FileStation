import { SELF, env as bindings } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env, Row } from "../worker/model";
import { encrypt, hash, decrypt } from "../worker/util.js";
const env = bindings as unknown as Env;
const origin = "http://localhost";
async function request(
  path: string,
  method = "GET",
  value?: any,
  cookie = "",
  prefix = "",
  headers: Record<string, string> = {},
) {
  const raw =
    value instanceof Uint8Array
      ? value.slice().buffer
      : value === undefined
        ? undefined
        : JSON.stringify(value);
  const response = await SELF.fetch(`${origin}${prefix}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...headers,
      ...(raw
        ? {
            "Content-Type":
              value instanceof Uint8Array
                ? "application/octet-stream"
                : "application/json",
          }
        : {}),
    },
    body: raw,
  });
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: response.headers,
  });
}
async function login(
  email = "c@bychx.com",
  prefix = "",
): Promise<Row & { cookie: string; setCookie: string }> {
  const challenge = (await (
    await request("/auth/request", "POST", { email }, "", prefix)
  ).json()) as Row;
  const response = await request(
    "/auth/verify",
    "POST",
    { challengeId: challenge.challengeId, pin: challenge.developmentPin },
    "",
    prefix,
  );
  expect(response.status).toBe(200);
  return {
    ...((await response.json()) as Row),
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    setCookie: response.headers.get("set-cookie")!,
  };
}
async function upload(
  cookie: string,
  text = "original",
  connectorId = "r2-default",
  name = "source.txt",
) {
  const data = new TextEncoder().encode(text);
  const response = await request(
    "/uploads",
    "POST",
    {
      connectorId,
      name,
      size: data.length,
      fingerprint: await hash(data.buffer),
    },
    cookie,
  );
  expect(response.status).toBe(201);
  const result = (await response.json()) as Row;
  expect(
    (await request(`/uploads/${result.file.id}/parts/1`, "PUT", data, cookie))
      .status,
  ).toBe(200);
  expect(
    (await request(`/uploads/${result.file.id}/complete`, "POST", {}, cookie))
      .status,
  ).toBe(200);
  return result.file as Row;
}
async function invitation(cookie: string, options: Row = {}, prefix = "") {
  const response = await request(
    "/invitations",
    "POST",
    {
      title: "Partner documents",
      kind: "submission",
      connectorId: "r2-default",
      recipients: ["partner@example.com"],
      expiresDays: 7,
      maxFileBytes: 1000000,
      maxFiles: 10,
      sendEmail: false,
      ...options,
    },
    cookie,
    prefix,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Row;
}
async function verify(
  link: Row,
  email = "partner@example.com",
  prefix = "",
): Promise<Row & { cookie: string }> {
  const sent = await request(
    "/access/request",
    "POST",
    { code: link.code, email },
    "",
    prefix,
  );
  expect(sent.status).toBe(200);
  const challenge = (await sent.json()) as Row;
  const response = await request(
    "/access/verify",
    "POST",
    {
      challengeId: challenge.challengeId,
      pin: challenge.developmentPin,
      kind: challenge.kind,
    },
    "",
    prefix,
  );
  expect(response.status).toBe(200);
  return {
    ...((await response.json()) as Row),
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}
async function draft(
  link: Row,
  cookie: string,
  text = "edited",
  baseRevision = 0,
) {
  const bytes = new TextEncoder().encode(text),
    path = `/invitations/${link.id}/uploads`;
  const response = await request(
    path,
    "POST",
    {
      name: "arbitrary-name.txt",
      mime: "text/plain",
      size: bytes.length,
      fingerprint: await hash(bytes.buffer),
      baseRevision,
    },
    cookie,
  );
  expect(response.status).toBe(201);
  const result = (await response.json()) as Row;
  const part = await request(
    `${path}/${result.file.id}/parts/1`,
    "PUT",
    bytes,
    cookie,
  );
  expect(part.status).toBe(200);
  expect(
    (await request(`${path}/${result.file.id}/complete`, "POST", {}, cookie))
      .status,
  ).toBe(200);
  return { file: result.file, path: `${path}/${result.file.id}` };
}
describe("restored service and URL prefixes", () => {
  it("serves the existing identity flow and isolates /files cookies and invitation URLs", async () => {
    const response = await request("/health", "GET", undefined, "", "/files");
    expect(await response.json()).toMatchObject({
      name: "File Station",
      development: true,
      partSize: 8388608,
    });
    const admin = await login("c@bychx.com", "/files");
    expect(admin.setCookie).toContain("Path=/files;");
    const link = await invitation(admin.cookie, {}, "/files");
    expect(link.link).toContain("/files/#share=U");
    const partner = await verify(link, "partner@example.com", "/files");
    expect(partner.invitation.kind).toBe("submission");
    expect(
      (await request("/invitations", "GET", undefined, partner.cookie)).status,
    ).toBe(401);
  });
  it("keeps existing download keys and verification working through the unified form", async () => {
    const admin = await login(),
      file = await upload(admin.cookie);
    const share = await request(
      `/files/${file.id}/shares`,
      "POST",
      { recipients: ["partner@example.com"], expiresDays: 7, sendEmail: false },
      admin.cookie,
    );
    const link = (await share.json()) as Row;
    const recipient = await verify(link);
    expect(recipient.kind).toBe("download");
    expect(
      await (
        await request(
          `/files/${file.id}/download`,
          "GET",
          undefined,
          recipient.cookie,
        )
      ).text(),
    ).toBe("original");
    await request(`/files/${file.id}`, "DELETE", undefined, admin.cookie);
    expect(
      (
        await request(
          `/files/${file.id}/download`,
          "GET",
          undefined,
          recipient.cookie,
        )
      ).status,
    ).toBe(410);
  });
  it("requires exact-domain approval and protects writes against cross-site requests", async () => {
    expect((await login("user@international.gc.ca")).user.status).toBe(
      "active",
    );
    expect((await login("user@sub.international.gc.ca")).user.status).toBe(
      "pending",
    );
    const response = await SELF.fetch(origin + "/files/api/auth/request", {
      method: "POST",
      headers: { Origin: "https://untrusted.example" },
      body: JSON.stringify({ email: "p@example.com" }),
    });
    expect(response.status).toBe(403);
  });
});
describe("authorized file previews", () => {
  it("requires a verified recipient, serves safe text and ranges, and stops access after revocation", async () => {
    const admin = await login(),
      file = await upload(
        admin.cookie,
        "<script>alert(1)</script>",
        "r2-default",
        "notes.html",
      );
    await env.DB.prepare("UPDATE files SET mime='text/html' WHERE id=?")
      .bind(file.id)
      .run();
    const path = `/files/${file.id}/preview`;
    expect((await request(path, "GET", undefined, "", "/files")).status).toBe(
      401,
    );
    const share = (await (
      await request(
        `/files/${file.id}/shares`,
        "POST",
        {
          recipients: ["partner@example.com"],
          expiresDays: 7,
          sendEmail: false,
        },
        admin.cookie,
      )
    ).json()) as Row;
    const partner = await verify(share);
    const response = await request(
      path,
      "GET",
      undefined,
      partner.cookie,
      "/files",
    );
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("<script>alert(1)</script>");
    const range = await request(
      path,
      "GET",
      undefined,
      partner.cookie,
      "/files",
      { Range: "bytes=1-6" },
    );
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(`bytes 1-6/${file.size}`);
    expect(await range.text()).toBe("script");
    const suffix = await request(path, "GET", undefined, partner.cookie, "", {
      Range: "bytes=-9",
    });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("</script>");
    const invalid = await request(path, "GET", undefined, partner.cookie, "", {
      Range: "bytes=999-",
    });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe(`bytes */${file.size}`);
    const other = await upload(admin.cookie);
    expect(
      (
        await request(
          `/files/${other.id}/preview`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).status,
    ).toBe(403);
    await request(`/shares/${share.id}`, "DELETE", undefined, admin.cookie);
    expect((await request(path, "GET", undefined, partner.cookie)).status).toBe(
      410,
    );
  });
  it("previews the current collaboration copy, rejects stale copies, and isolates submission guests", async () => {
    const admin = await login(),
      source = await upload(admin.cookie),
      link = await invitation(admin.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "working.txt",
      });
    const partner = await verify(link),
      path = `/invitations/${link.id}/preview`;
    expect(
      await (await request(path, "GET", undefined, partner.cookie)).text(),
    ).toBe("original");
    expect(
      (
        await request(
          `/files/${source.id}/preview`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).status,
    ).toBe(401);
    const working = await draft(link, partner.cookie, "Updated preview");
    await request(working.path + "/publish", "POST", {}, partner.cookie);
    const response = await request(
      path,
      "GET",
      undefined,
      partner.cookie,
      "/files",
    );
    expect(response.headers.get("etag")).toBe(`"${working.file.id}"`);
    expect(await response.text()).toBe("Updated preview");
    expect(
      (
        await request(
          path + `?version=${source.id}`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).status,
    ).toBe(409);
    const submission = await invitation(admin.cookie),
      submitter = await verify(submission);
    expect(
      (
        await request(
          `/invitations/${submission.id}/preview`,
          "GET",
          undefined,
          submitter.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(path, "GET", undefined, submitter.cookie)).status,
    ).toBe(401);
    await request(`/invitations/${link.id}`, "DELETE", undefined, admin.cookie);
    expect((await request(path, "GET", undefined, partner.cookie)).status).toBe(
      410,
    );
    await request(`/files/${source.id}`, "DELETE", undefined, admin.cookie);
    expect(
      (
        await request(
          `/files/${source.id}/preview`,
          "HEAD",
          undefined,
          admin.cookie,
        )
      ).status,
    ).toBe(410);
  });
  it("bounds movie ranges, rejects unsupported and oversized previews, and retains ordinary downloads", async () => {
    const admin = await login(),
      movie = await upload(
        admin.cookie,
        "movie bytes",
        "r2-default",
        "movie.mp4",
      );
    const range = await request(
      `/files/${movie.id}/preview`,
      "GET",
      undefined,
      admin.cookie,
      "",
      { Range: "bytes=2-6" },
    );
    expect(range.status).toBe(206);
    expect(range.headers.get("content-type")).toBe("video/mp4");
    expect(await range.text()).toBe("vie b");
    await env.DB.prepare("UPDATE files SET size=? WHERE id=?")
      .bind(512 * 1024 * 1024, movie.id)
      .run();
    const head = await request(
      `/files/${movie.id}/preview`,
      "HEAD",
      undefined,
      admin.cookie,
      "",
      { Range: "bytes=0-" },
    );
    expect(head.status).toBe(206);
    expect(head.headers.get("content-length")).toBe(String(8 * 1024 * 1024));
    expect(head.headers.get("content-range")).toBe(`bytes 0-8388607/536870912`);
    const unsupported = await upload(
      admin.cookie,
      "binary",
      "r2-default",
      "archive.constructor",
    );
    expect(
      (
        await request(
          `/files/${unsupported.id}/preview`,
          "HEAD",
          undefined,
          admin.cookie,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await request(
          `/files/${unsupported.id}/download`,
          "GET",
          undefined,
          admin.cookie,
        )
      ).headers.get("content-disposition"),
    ).toContain("attachment;");
    const oversized = await upload(admin.cookie);
    await env.DB.prepare("UPDATE files SET size=? WHERE id=?")
      .bind(3 * 1024 * 1024, oversized.id)
      .run();
    expect(
      (
        await request(
          `/files/${oversized.id}/preview`,
          "HEAD",
          undefined,
          admin.cookie,
        )
      ).status,
    ).toBe(413);
  });
});
describe("private document submissions", () => {
  it("binds destination and owner, saves submissions, and hides other recipients’ files", async () => {
    const admin = await login(),
      link = await invitation(admin.cookie, {
        recipients: ["partner@example.com", "another@example.com"],
      });
    const partner = await verify(link),
      saved = await draft(link, partner.cookie, "partner document");
    expect(
      (await request(saved.path + "/publish", "POST", {}, partner.cookie))
        .status,
    ).toBe(200);
    const file = await env.DB.prepare(
      "SELECT owner_id,connector_id,name FROM files WHERE id=?",
    )
      .bind(saved.file.id)
      .first<Row>();
    expect(file).toMatchObject({
      owner_id: admin.user.id,
      connector_id: "r2-default",
    });
    const second = await verify(link, "another@example.com");
    expect(
      (
        (await (
          await request(
            `/invitations/${link.id}/view`,
            "GET",
            undefined,
            second.cookie,
          )
        ).json()) as Row
      ).submitted,
    ).toEqual([]);
    expect(
      (await request(saved.path, "GET", undefined, second.cookie)).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/invitations/${link.id}/download`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/files/${saved.file.id}/download`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).status,
    ).toBe(401);
    expect(
      await (
        await request(
          `/files/${saved.file.id}/download`,
          "GET",
          undefined,
          admin.cookie,
        )
      ).text(),
    ).toBe("partner document");
    const listing = (await (
      await request("/invitations", "GET", undefined, admin.cookie)
    ).json()) as Row;
    expect(listing.invitations[0]).toMatchObject({ code: link.code });
    expect(JSON.stringify(listing)).not.toContain("encrypted_code");
  });
  it("enforces size and concurrent file-count limits inside the connector queue", async () => {
    const admin = await login(),
      link = await invitation(admin.cookie, { maxFileBytes: 10, maxFiles: 1 }),
      partner = await verify(link);
    const path = `/invitations/${link.id}/uploads`,
      value = { name: "small.txt", size: 5, fingerprint: "a".repeat(64) };
    expect(
      (await request(path, "POST", { ...value, size: 11 }, partner.cookie))
        .status,
    ).toBe(413);
    const results = await Promise.all([
      request(path, "POST", value, partner.cookie),
      request(path, "POST", value, partner.cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it("rechecks revocation during resumed uploads and refuses unauthorized recipient emails", async () => {
    const admin = await login(),
      link = await invitation(admin.cookie),
      partner = await verify(link);
    expect(
      (
        await request("/access/request", "POST", {
          code: link.code,
          email: "stranger@example.com",
        })
      ).status,
    ).toBe(400);
    const response = await request(
      `/invitations/${link.id}/uploads`,
      "POST",
      { name: "p.txt", size: 5, fingerprint: "a".repeat(64) },
      partner.cookie,
    );
    const pending = (await response.json()) as Row;
    await request(`/invitations/${link.id}`, "DELETE", undefined, admin.cookie);
    expect(
      (
        await request(
          `/invitations/${link.id}/uploads/${pending.file.id}/parts/1`,
          "PUT",
          new TextEncoder().encode("hello"),
          partner.cookie,
        )
      ).status,
    ).toBe(410);
  });
  it("expires existing recipient sessions and blocks a deactivated requester", async () => {
    const admin = await login(),
      link = await invitation(admin.cookie),
      partner = await verify(link);
    await env.DB.prepare("UPDATE invitations SET expires_at=? WHERE id=?")
      .bind(Date.now() - 1, link.id)
      .run();
    expect(
      (
        await request(
          `/invitations/${link.id}/view`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).status,
    ).toBe(410);
    const second = await invitation(admin.cookie),
      guest = await verify(second);
    await env.DB.prepare("UPDATE users SET status='inactive' WHERE id=?")
      .bind(admin.user.id)
      .run();
    expect(
      (
        await request(
          `/invitations/${second.id}/view`,
          "GET",
          undefined,
          guest.cookie,
        )
      ).status,
    ).toBe(410);
  });
});
describe("collaboration working copies", () => {
  it("preserves the original and replaces the target filename without retaining previous working copies", async () => {
    const admin = await login(),
      source = await upload(admin.cookie),
      link = await invitation(admin.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "final.txt",
      }),
      partner = await verify(link);
    expect(partner.file.name).toBe("final.txt");
    expect(
      await (
        await request(
          `/invitations/${link.id}/download`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).text(),
    ).toBe("original");
    const first = await draft(link, partner.cookie, "first edit");
    expect(first.file.name).toBe("final.txt");
    expect(
      (await request(first.path + "/publish", "POST", {}, partner.cookie))
        .status,
    ).toBe(200);
    const second = await draft(link, partner.cookie, "second edit", 1);
    expect(
      (await request(second.path + "/publish", "POST", {}, partner.cookie))
        .status,
    ).toBe(200);
    expect(
      await (
        await request(
          `/invitations/${link.id}/download`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).text(),
    ).toBe("second edit");
    expect(
      await (
        await request(
          `/files/${source.id}/download`,
          "GET",
          undefined,
          admin.cookie,
        )
      ).text(),
    ).toBe("original");
    expect(
      await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(first.file.id)
        .first(),
    ).toMatchObject({ state: "deleted" });
    expect(
      await env.DB.prepare("SELECT name FROM files WHERE id=?")
        .bind(second.file.id)
        .first(),
    ).toMatchObject({ name: "final.txt" });
  });
  it("rejects stale saves without replacing a newer working copy", async () => {
    const admin = await login(),
      source = await upload(admin.cookie),
      link = await invitation(admin.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "working.txt",
      }),
      partner = await verify(link);
    const first = await draft(link, partner.cookie, "one"),
      second = await draft(link, partner.cookie, "two");
    expect(
      (await request(first.path + "/publish", "POST", {}, partner.cookie))
        .status,
    ).toBe(200);
    expect(
      (await request(second.path + "/publish", "POST", {}, partner.cookie))
        .status,
    ).toBe(409);
    expect(
      await (
        await request(
          `/invitations/${link.id}/download`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).text(),
    ).toBe("one");
  });
  it("invalidates access when the original is deleted or the owner is deactivated", async () => {
    const admin = await login(),
      source = await upload(admin.cookie),
      link = await invitation(admin.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "working.txt",
      }),
      partner = await verify(link);
    await request(`/files/${source.id}`, "DELETE", undefined, admin.cookie);
    expect(
      (
        await request(
          `/invitations/${link.id}/view`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).status,
    ).toBe(410);
  });
  it("reserves space for a replacement without FIFO eviction of the original or current copy", async () => {
    const admin = await login(),
      source = await upload(admin.cookie),
      link = await invitation(admin.cookie, {
        kind: "collaboration",
        sourceFileId: source.id,
        targetName: "working.txt",
      }),
      partner = await verify(link);
    const first = await draft(link, partner.cookie, "first edit");
    await request(first.path + "/publish", "POST", {}, partner.cookie);
    await env.DB.prepare("UPDATE connectors SET limit_bytes=40 WHERE id=?")
      .bind("r2-default")
      .run();
    const response = await request(
      `/invitations/${link.id}/uploads`,
      "POST",
      {
        name: "large.txt",
        size: 30,
        fingerprint: "a".repeat(64),
        baseRevision: 1,
      },
      partner.cookie,
    );
    expect(response.status).toBe(409);
    expect(
      await (
        await request(
          `/files/${source.id}/download`,
          "GET",
          undefined,
          admin.cookie,
        )
      ).text(),
    ).toBe("original");
    expect(
      await (
        await request(
          `/invitations/${link.id}/download`,
          "GET",
          undefined,
          partner.cookie,
        )
      ).text(),
    ).toBe("first edit");
  });
});
describe("OneDrive for Business", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111",
    clientId = "22222222-2222-4222-8222-222222222222";
  const discovery = {
    tenantId,
    clientId,
    clientSecret: "app-secret-value",
    userEmail: "owner@contoso.com",
  };
  it("finds the business drive using the application-supported drives collection", async () => {
    const admin = await login();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "login.microsoftonline.com")
        return Response.json({ access_token: "graph-token" });
      expect(url.hostname).toBe("graph.microsoft.com");
      expect(url.pathname).toBe("/v1.0/users/owner%40contoso.com/drives");
      expect(url.searchParams.get("$select")).toContain("driveType");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer graph-token",
      );
      return Response.json({
        value: [
          { id: "private-drive", name: "OneDrive", driveType: "business" },
        ],
      });
    });
    const response = await request(
      "/admin/onedrive/resolve",
      "POST",
      discovery,
      admin.cookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      driveId: "private-drive",
      name: "OneDrive",
    });
  });
  it("refreshes a rejected token once before retrying drive discovery", async () => {
    const admin = await login();
    let tokens = 0,
      calls = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://login.microsoftonline.com/"))
        return Response.json({ access_token: `token-${++tokens}` });
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer token-${tokens}`,
      );
      if (++calls === 1)
        return Response.json(
          { error: { code: "InvalidAuthenticationToken" } },
          { status: 401 },
        );
      return Response.json({
        value: [{ id: "drive", name: "OneDrive", driveType: "business" }],
      });
    });
    const response = await request(
      "/admin/onedrive/resolve",
      "POST",
      discovery,
      admin.cookie,
    );
    expect(response.status).toBe(200);
    expect(tokens).toBe(2);
    expect(calls).toBe(2);
  });
  it.each([401, 403])(
    "explains Microsoft HTTP %s without exposing raw provider identity/token details",
    async (status) => {
      const admin = await login();
      let calls = 0;
      vi.mocked(fetch).mockImplementation(async (input) => {
        if (String(input).startsWith("https://login.microsoftonline.com/"))
          return Response.json({ access_token: "private-access-token" });
        calls++;
        return Response.json(
          {
            error: {
              code:
                status === 401 ? "InvalidAuthenticationToken" : "accessDenied",
              message:
                "private-access-token app-secret-value sensitive-user@contoso.com",
            },
          },
          { status },
        );
      });
      const response = await request(
        "/admin/onedrive/resolve",
        "POST",
        discovery,
        admin.cookie,
      );
      expect(response.status).toBe(502);
      const error = ((await response.json()) as Row).error;
      expect(error).toContain(`HTTP ${status}`);
      expect(error).toMatch(/administrator consent/);
      expect(error).not.toContain("private-access-token");
      expect(error).not.toContain("app-secret-value");
      expect(error).not.toContain("sensitive-user");
      expect(calls).toBe(status === 401 ? 2 : 1);
      if (status === 403) expect(error).toContain("write grant");
    },
  );
  it.each([
    { value: [] },
    {
      value: [
        { id: "a", driveType: "business" },
        { id: "b", driveType: "business" },
      ],
    },
  ])(
    "requires a known Drive ID when discovery cannot identify exactly one business drive (%j)",
    async ({ value }) => {
      const admin = await login();
      vi.mocked(fetch).mockImplementation(async (input) =>
        String(input).startsWith("https://login.microsoftonline.com/")
          ? Response.json({ access_token: "graph-token" })
          : Response.json({ value }),
      );
      const response = await request(
        "/admin/onedrive/resolve",
        "POST",
        discovery,
        admin.cookie,
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as Row).error).toMatch(
        /Drive ID|OneDrive for Business/,
      );
    },
  );
  it("requires admin access to browse and never returns the application secret", async () => {
    const user = await login("user@international.gc.ca");
    expect(
      (await request("/admin/onedrive/browse", "POST", {}, user.cookie)).status,
    ).toBe(403);
    const admin = await login();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://login.microsoftonline.com/")) {
        expect(String(init?.body)).toContain("grant_type=client_credentials");
        return Response.json({ access_token: "graph-token" });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer graph-token",
      );
      expect(init?.redirect).toBe("manual");
      return url.includes("/children?")
        ? Response.json({
            value: [
              { id: "private-folder", name: "Private uploads", folder: {} },
              { id: "file", name: "not a folder" },
            ],
          })
        : Response.json({ id: "root-id", name: "Documents", folder: {} });
    });
    const response = await request(
      "/admin/onedrive/browse",
      "POST",
      {
        tenantId,
        clientId,
        driveId: "drive-id",
        folderId: "root",
        clientSecret: "application-secret",
      },
      admin.cookie,
    );
    expect(response.status).toBe(200);
    const listing = (await response.json()) as Row;
    expect(listing.folders).toEqual([
      { id: "private-folder", name: "Private uploads", folder: {} },
    ]);
    expect(JSON.stringify(listing)).not.toContain("application-secret");
    const saved = await request(
      "/admin/connectors",
      "POST",
      {
        name: "Private OneDrive",
        kind: "onedrive",
        tenantId,
        clientId,
        driveId: "drive-id",
        folderId: "private-folder",
        limitBytes: 100000000,
        retentionDays: 30,
        enabled: true,
        credentials: { clientSecret: "application-secret" },
      },
      admin.cookie,
    );
    expect(saved.status).toBe(200);
    const id = ((await saved.json()) as Row).id;
    const row = await env.DB.prepare(
      "SELECT encrypted_credentials FROM connectors WHERE id=?",
    )
      .bind(id)
      .first<Row>();
    expect(row!.encrypted_credentials).not.toContain("application-secret");
    expect(await decrypt(env, row!.encrypted_credentials)).toEqual({
      clientSecret: "application-secret",
    });
    expect(
      await (
        await request("/connectors", "GET", undefined, user.cookie)
      ).text(),
    ).not.toContain("application-secret");
  });
  it("uses aligned resumable chunks and encrypted upload URLs without Microsoft sharing calls", async () => {
    const admin = await login(),
      connectorId = crypto.randomUUID(),
      secret = await encrypt(env, { clientSecret: "secret" });
    await env.DB.prepare(
      "INSERT INTO connectors(id,name,kind,storage_adapter,limit_bytes,retention_days,config,encrypted_credentials,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        connectorId,
        "OneDrive",
        "r2",
        "onedrive",
        100000000,
        30,
        JSON.stringify({
          tenantId,
          clientId,
          driveId: "drive-id",
          folderId: "private-folder",
        }),
        secret,
        Date.now(),
      )
      .run();
    const partSize = 10 * 1024 * 1024,
      size = partSize + 7;
    let final = false;
    const ranges: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      expect(url).not.toMatch(/createLink|\/invite|permissions/);
      if (url.startsWith("https://login.microsoftonline.com"))
        return Response.json({ access_token: "token" });
      if (url.endsWith("/createUploadSession"))
        return Response.json({
          uploadUrl: "https://tenant.sharepoint.com/upload?token=private",
        });
      if (url.includes("/upload?")) {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        const range = new Headers(init?.headers).get("content-range")!;
        ranges.push(range);
        if (range.startsWith(`bytes ${partSize}-`)) final = true;
        return Response.json(
          final
            ? { id: "saved-item", size }
            : { nextExpectedRanges: [`${partSize}-`] },
          { status: final ? 201 : 202 },
        );
      }
      return Response.json({ id: "saved-item", size });
    });
    const response = await request(
      "/uploads",
      "POST",
      { connectorId, name: "report.docx", size, fingerprint: "a".repeat(64) },
      admin.cookie,
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as Row;
    expect(created.partSize).toBe(partSize);
    expect(created.partSize % 327680).toBe(0);
    expect(JSON.stringify(created)).not.toContain("token=private");
    expect(
      (
        await request(
          `/uploads/${created.file.id}/parts/1`,
          "PUT",
          new Uint8Array(partSize),
          admin.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/uploads/${created.file.id}/parts/2`,
          "PUT",
          new Uint8Array(7),
          admin.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/uploads/${created.file.id}/complete`,
          "POST",
          {},
          admin.cookie,
        )
      ).status,
    ).toBe(200);
    expect(ranges).toEqual([
      `bytes 0-${partSize - 1}/${size}`,
      `bytes ${partSize}-${size - 1}/${size}`,
    ]);
  });
});
