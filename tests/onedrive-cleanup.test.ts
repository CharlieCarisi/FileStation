import { SELF, env as bindings } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env, Row } from "../worker/model";
import { encrypt } from "../worker/util.js";
import { OneDriveStorage } from "../worker/onedrive";
import { coordinate } from "../worker/coordinator.js";
const env = bindings as unknown as Env;
const origin = "http://localhost";
async function request(path: string, method = "GET", value?: any, cookie = "") {
  return SELF.fetch(origin + "/api" + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(value === undefined
        ? {}
        : {
            "Content-Type":
              value instanceof Uint8Array
                ? "application/octet-stream"
                : "application/json",
          }),
    },
    body:
      value === undefined
        ? undefined
        : value instanceof Uint8Array
          ? value.slice().buffer
          : JSON.stringify(value),
  });
}
async function json(response: Response, status = 200): Promise<Row> {
  const data = (await response.json()) as Row;
  expect(response.status, JSON.stringify(data)).toBe(status);
  return data;
}
async function connector() {
  const row = {
    id: crypto.randomUUID(),
    config: JSON.stringify({
      tenantId: crypto.randomUUID(),
      clientId: crypto.randomUUID(),
      driveId: "drive-id",
      folderId: "private-folder",
    }),
    encrypted_credentials: await encrypt(env, {
      clientSecret: "private-secret",
    }),
  };
  return { row, provider: new OneDriveStorage(env, row) };
}
async function unfinished() {
  return {
    id: crypto.randomUUID(),
    name: "old.txt",
    completed_at: null,
    provider_file_id: null,
    provider_upload_id: await encrypt(env, {
      uploadUrl: "https://tenant.sharepoint.com/old-session?token=private",
    }),
  };
}
describe("OneDrive cancellation and cleanup", () => {
  it.each([401, 403, 404, 410])(
    "treats an unusable session (HTTP %s) as stale only after authenticated item cleanup",
    async (status) => {
      const { provider } = await connector(),
        file = await unfinished();
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input),
          headers = new Headers(init?.headers);
        if (url.startsWith("https://login.microsoftonline.com/"))
          return Response.json({ access_token: "private-token" });
        expect(init?.method).toBe("DELETE");
        if (url.startsWith("https://tenant.sharepoint.com/")) {
          expect(headers.has("authorization")).toBe(false);
          return Response.json(
            {
              error: {
                code: "unauthenticated",
                message: "private-provider-body",
              },
            },
            { status },
          );
        }
        expect(url).toContain(
          "https://graph.microsoft.com/v1.0/drives/drive-id/items/private-folder:/",
        );
        expect(headers.get("authorization")).toBe("Bearer private-token");
        return Response.json(
          { error: { code: "itemNotFound" } },
          { status: 404 },
        );
      });
      await expect(provider.remove(file)).resolves.toBeUndefined();
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([input]) =>
            String(input).startsWith("https://graph.microsoft.com/"),
          ),
      ).toHaveLength(1);
    },
  );
  it("skips an already committed upload session and refreshes a rejected Graph token when deleting its saved item", async () => {
    const { provider } = await connector(),
      file = { ...(await unfinished()), provider_file_id: "committed-item" };
    let tokens = 0,
      deletes = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      expect(url).not.toContain("old-session");
      if (url.startsWith("https://login.microsoftonline.com/"))
        return Response.json({ access_token: `private-token-${++tokens}` });
      expect(url).toBe(
        "https://graph.microsoft.com/v1.0/drives/drive-id/items/committed-item",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer private-token-${tokens}`,
      );
      return ++deletes === 1
        ? Response.json(
            { error: { code: "InvalidAuthenticationToken" } },
            { status: 401 },
          )
        : new Response(null, { status: 204 });
    });
    await provider.remove(file);
    expect(tokens).toBe(2);
    expect(deletes).toBe(2);
  });
  it("removes a committed item by its unique path even if cancellation failed before its final acknowledgement", async () => {
    const { provider } = await connector(),
      file = await unfinished();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://login.microsoftonline.com/"))
        return Response.json({ access_token: "private-token" });
      return url.startsWith("https://tenant.sharepoint.com/")
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 204 });
    });
    await expect(provider.remove(file)).resolves.toBeUndefined();
  });
  it.each(["transient", "network", "permission"])(
    "does not report successful cleanup when the %s failure remains unconfirmed",
    async (failure) => {
      const { provider } = await connector(),
        file = await unfinished();
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith("https://login.microsoftonline.com/"))
          return Response.json({ access_token: "private-token" });
        if (url.startsWith("https://tenant.sharepoint.com/")) {
          if (failure === "network") throw Error("private-provider-detail");
          return new Response(null, {
            status: failure === "permission" ? 403 : 503,
          });
        }
        return Response.json(
          { error: { message: "private-provider-detail" } },
          { status: failure === "permission" ? 403 : 404 },
        );
      });
      await expect(provider.remove(file)).rejects.toThrow(
        failure === "permission" ? "could not delete" : "could not cancel",
      );
    },
  );
  it("lets verified partners submit while another upload awaits cleanup, keeps that capacity charged, and continues other cleanup", async () => {
    const challenge = await json(
      await request("/auth/request", "POST", { email: "c@bychx.com" }),
    );
    const verified = await request("/auth/verify", "POST", {
      challengeId: challenge.challengeId,
      pin: challenge.developmentPin,
    });
    const owner = (await json(verified)).user,
      adminCookie = verified.headers.get("set-cookie")!.split(";")[0];
    const { row } = await connector(),
      old = await unfinished(),
      expired = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO connectors(id,name,kind,storage_adapter,limit_bytes,retention_days,config,encrypted_credentials,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        row.id,
        "OneDrive",
        "r2",
        "onedrive",
        100,
        30,
        row.config,
        row.encrypted_credentials,
        Date.now(),
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO files(id,owner_id,connector_id,name,mime,size,state,object_key,fingerprint,created_at,upload_expires_at,provider_upload_id,delete_reason) VALUES (?,?,?,?,'text/plain',?,?,?,?,?,?,?,?)",
    )
      .bind(
        old.id,
        owner.id,
        row.id,
        old.name,
        60,
        "deleting",
        "old-key",
        "a".repeat(64),
        1,
        Date.now() + 86400000,
        old.provider_upload_id,
        "cancelled",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO files(id,owner_id,connector_id,name,mime,size,state,object_key,fingerprint,created_at,upload_expires_at,completed_at,expires_at,provider_file_id) VALUES (?,?,?,?,'text/plain',?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        expired,
        owner.id,
        row.id,
        "expired.txt",
        8,
        "ready",
        "expired-key",
        "a".repeat(64),
        2,
        1,
        1,
        1,
        "expired-item",
      )
      .run();
    let cancellationStatus = 503,
      session = 0;
    const sessions = new Map<string, { id: string; size: number }>();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      expect(url).not.toMatch(/createLink|\/invite|\/permissions/);
      if (url.startsWith("https://login.microsoftonline.com/"))
        return Response.json({ access_token: "private-token" });
      if (url.includes("old-session"))
        return new Response(null, { status: cancellationStatus });
      if (url.endsWith("/createUploadSession")) {
        const item = JSON.parse(String(init?.body)).item,
          token = String(++session);
        sessions.set(token, { id: item.name, size: 0 });
        return Response.json({
          uploadUrl: `https://tenant.sharepoint.com/new-session?token=${token}`,
        });
      }
      if (url.startsWith("https://tenant.sharepoint.com/new-session")) {
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        const record = sessions.get(new URL(url).searchParams.get("token")!)!;
        record.size = (init?.body as ArrayBuffer).byteLength;
        return Response.json(
          { id: "saved-item", size: record.size },
          { status: 201 },
        );
      }
      if (init?.method === "DELETE")
        return new Response(null, {
          status: url.includes("expired-item") ? 204 : 404,
        });
      const record = [...sessions.values()].find((record) =>
        url.includes(encodeURIComponent(record.id)),
      )!;
      return Response.json({ id: "saved-item", size: record.size });
    });
    const invite = await json(
      await request(
        "/invitations",
        "POST",
        {
          kind: "submission",
          title: "Partner request",
          connectorId: row.id,
          recipients: ["partner@example.com"],
          expiresDays: 7,
          maxFileBytes: 100,
          maxFiles: 10,
          sendEmail: false,
        },
        adminCookie,
      ),
      201,
    );
    const sent = await json(
      await request("/access/request", "POST", {
        code: invite.code,
        email: "partner@example.com",
      }),
    );
    const response = await request("/access/verify", "POST", {
      challengeId: sent.challengeId,
      pin: sent.developmentPin,
      kind: sent.kind,
    });
    await json(response);
    const guestCookie = response.headers.get("set-cookie")!.split(";")[0],
      path = `/invitations/${invite.id}/uploads`;
    const payload = {
      name: "partner.txt",
      size: 5,
      fingerprint: "b".repeat(64),
    };
    await json(await request(path, "POST", payload), 401);
    const created = await json(
      await request(path, "POST", payload, guestCookie),
      201,
    );
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(old.id)
        .first<Row>())!.state,
    ).toBe("deleting");
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(expired)
        .first<Row>())!.state,
    ).toBe("deleted");
    const stats = (
      await json(await request("/connectors", "GET", undefined, adminCookie))
    ).connectors.find((item: Row) => item.id === row.id);
    expect(stats.used_bytes).toBe(60);
    expect(stats.reserved_bytes).toBe(5);
    await json(
      await request(path, "POST", { ...payload, size: 50 }, guestCookie),
      409,
    );
    await json(
      await request(
        `${path}/${created.file.id}/parts/1`,
        "PUT",
        new TextEncoder().encode("hello"),
        guestCookie,
      ),
    );
    await json(
      await request(
        `${path}/${created.file.id}/complete`,
        "POST",
        {},
        guestCookie,
      ),
    );
    await json(
      await request(
        `${path}/${created.file.id}/publish`,
        "POST",
        {},
        guestCookie,
      ),
    );
    const pending = await coordinate(env, row.id, "/cleanup");
    expect(pending.status).toBe(503);
    expect(await pending.json()).toMatchObject({ ok: false, pending: 1 });
    cancellationStatus = 204;
    await json(
      await request(
        path,
        "POST",
        { ...payload, name: "next.txt", size: 1 },
        guestCookie,
      ),
      201,
    );
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(old.id)
        .first<Row>())!.state,
    ).toBe("deleted");
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(created.file.id)
        .first<Row>())!.state,
    ).toBe("ready");
  });
});
