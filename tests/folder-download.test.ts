import { SELF, env as bindings } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js/index-native.js";
import type { Env, Row } from "../worker/model";
const env = bindings as unknown as Env;
const origin = "http://localhost";
async function request(path: string, cookie = "", method = "GET", value?: any) {
  return SELF.fetch(`${origin}/files/api${path}`, {
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
async function result(response: Response, status = 200): Promise<Row> {
  const data = (await response.json()) as Row;
  expect(response.status, JSON.stringify(data)).toBe(status);
  return data;
}
async function login(email: string) {
  const challenge = await result(
    await request("/auth/request", "", "POST", { email }),
  );
  const response = await request("/auth/verify", "", "POST", {
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
  space = "private",
) {
  return (
    await result(
      await request("/folders", cookie, "POST", { name, parentId, space }),
      201,
    )
  ).folder;
}
async function upload(
  cookie: string,
  folderId: string,
  name: string,
  bytes: Uint8Array,
  space = "private",
  complete = true,
) {
  const created = await result(
    await request("/uploads", cookie, "POST", {
      name,
      folderId,
      space,
      connectorId: "r2-default",
      size: bytes.length,
      fingerprint: "a".repeat(64),
    }),
    201,
  );
  if (complete) {
    for (let start = 0; start < bytes.length; start += created.partSize)
      await result(
        await request(
          `/uploads/${created.file.id}/parts/${start / created.partSize + 1}`,
          cookie,
          "PUT",
          bytes.slice(start, start + created.partSize),
        ),
      );
    await result(
      await request(`/uploads/${created.file.id}/complete`, cookie, "POST", {}),
    );
  }
  return created.file;
}
async function unzip(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("accept-ranges")).toBe("none");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(Number(response.headers.get("content-length"))).toBe(bytes.length);
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    checkSignature: true,
  });
  const contents = new Map<string, Uint8Array | null>();
  for (const entry of await reader.getEntries())
    contents.set(
      entry.filename,
      entry.directory ? null : await entry.getData(new Uint8ArrayWriter()),
    );
  await reader.close();
  return contents;
}

describe("direct folder downloads", () => {
  it("streams a valid ZIP64 with exact bytes across chunks, nested/empty folders, duplicate names and shortcuts, without saving or modifying files", async () => {
    const owner = await login("download-owner@international.gc.ca");
    const root = await folder(owner.cookie, "Reports 合同"),
      child = await folder(owner.cookie, "Documents", root.id);
    await folder(owner.cookie, "Empty", root.id);
    const bytes = Uint8Array.from(
      { length: 3 * 1024 * 1024 + 17 },
      (_, n) => n % 251,
    );
    const large = await upload(owner.cookie, child.id, "data.bin", bytes);
    await upload(
      owner.cookie,
      root.id,
      "same.txt",
      new TextEncoder().encode("first"),
    );
    await upload(
      owner.cookie,
      root.id,
      "same.txt",
      new TextEncoder().encode("second"),
    );
    await result(
      await request("/shortcuts", owner.cookie, "POST", {
        fileId: large.id,
        name: "Alias.bin",
        folderId: root.id,
      }),
      201,
    );
    const pending = await upload(
      owner.cookie,
      child.id,
      "Pending.txt",
      bytes.slice(0, 10),
      "private",
      false,
    );
    const expired = await upload(
      owner.cookie,
      root.id,
      "Expired.txt",
      bytes.slice(0, 10),
    );
    await env.DB.prepare("UPDATE files SET expires_at=1 WHERE id=?")
      .bind(expired.id)
      .run();
    const before = (
      await env.DB.prepare(
        "SELECT id,state,object_key FROM files WHERE owner_id=? ORDER BY id",
      )
        .bind(owner.id)
        .all()
    ).results;
    const response = await request(
      `/folders/${root.id}/download`,
      owner.cookie,
    );
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("Reports 合同.zip"),
    );
    const contents = await unzip(response);
    expect([...contents.keys()].sort()).toEqual(
      [
        "Reports 合同/",
        "Reports 合同/Documents/",
        "Reports 合同/Empty/",
        "Reports 合同/Documents/data.bin",
        "Reports 合同/Alias.bin",
        "Reports 合同/same.txt",
        "Reports 合同/same (2).txt",
      ].sort(),
    );
    expect(contents.get("Reports 合同/Documents/data.bin")).toEqual(bytes);
    expect(contents.get("Reports 合同/Alias.bin")).toEqual(bytes);
    expect(
      new TextDecoder().decode(contents.get("Reports 合同/same.txt")!),
    ).toBe("first");
    expect(
      new TextDecoder().decode(contents.get("Reports 合同/same (2).txt")!),
    ).toBe("second");
    expect(
      (
        await env.DB.prepare(
          "SELECT id,state,object_key FROM files WHERE owner_id=? ORDER BY id",
        )
          .bind(owner.id)
          .all()
      ).results,
    ).toEqual(before);
    expect(before.find((file) => file.id === pending.id)!.state).toBe(
      "uploading",
    );
  });

  it("requires an active signed-in reader, supports Public and admin access, and permits empty or pending-only folders", async () => {
    const owner = await login("download-private@international.gc.ca"),
      teammate = await login("download-team@international.gc.ca"),
      admin = await login("c@bychx.com");
    const privateFolder = await folder(owner.cookie, "Private"),
      publicFolder = await folder(owner.cookie, "Public", null, "public");
    await upload(
      owner.cookie,
      publicFolder.id,
      "Pending.txt",
      new Uint8Array(4),
      "public",
      false,
    );
    await result(await request(`/folders/${publicFolder.id}/download`), 401);
    await result(
      await request(`/folders/${privateFolder.id}/download`, teammate.cookie),
      404,
    );
    for (const cookie of [owner.cookie, admin.cookie]) {
      const head = await request(
        `/folders/${privateFolder.id}/download`,
        cookie,
        "HEAD",
      );
      expect(head.status).toBe(200);
      expect((await head.arrayBuffer()).byteLength).toBe(0);
      expect(Number(head.headers.get("content-length"))).toBeGreaterThan(98);
      expect([
        ...(
          await unzip(
            await request(`/folders/${privateFolder.id}/download`, cookie),
          )
        ).keys(),
      ]).toEqual(["Private/"]);
    }
    expect([
      ...(
        await unzip(
          await request(
            `/folders/${publicFolder.id}/download`,
            teammate.cookie,
          ),
        )
      ).keys(),
    ]).toEqual(["Public/"]);
    await env.DB.prepare("UPDATE users SET status='pending' WHERE id=?")
      .bind(teammate.id)
      .run();
    await result(
      await request(`/folders/${publicFolder.id}/download`, teammate.cookie),
      403,
    );
    await env.DB.prepare("UPDATE users SET status='inactive' WHERE id=?")
      .bind(teammate.id)
      .run();
    await result(
      await request(`/folders/${publicFolder.id}/download`, teammate.cookie),
      401,
    );
  });

  it("reports an unavailable provider file before starting a ZIP response", async () => {
    const owner = await login("download-missing@international.gc.ca"),
      root = await folder(owner.cookie, "Missing");
    const file = await upload(
      owner.cookie,
      root.id,
      "gone.txt",
      new Uint8Array(4),
    );
    const row = await env.DB.prepare("SELECT object_key FROM files WHERE id=?")
      .bind(file.id)
      .first<Row>();
    await env.R2_FILES.delete(row!.object_key);
    const data = await result(
      await request(`/folders/${root.id}/download`, owner.cookie),
      404,
    );
    expect(data.error).toBe("This file is no longer available.");
  });

  it("cancels cleanly and fails a download if a later source disappears instead of completing a truncated ZIP", async () => {
    const owner = await login("download-interrupted@international.gc.ca"),
      root = await folder(owner.cookie, "Interrupted");
    const first = await upload(
      owner.cookie,
      root.id,
      "first.bin",
      new Uint8Array(3 * 1024 * 1024),
    );
    const second = await upload(
      owner.cookie,
      root.id,
      "second.txt",
      new Uint8Array(4),
    );
    const row = await env.DB.prepare("SELECT object_key FROM files WHERE id=?")
      .bind(second.id)
      .first<Row>();
    await env.R2_FILES.delete(row!.object_key);
    const cancelled = await request(
      `/folders/${root.id}/download`,
      owner.cookie,
    );
    const reader = cancelled.body!.getReader();
    expect((await reader.read()).value!.byteLength).toBeGreaterThan(0);
    await reader.cancel();
    const interrupted = await request(
      `/folders/${root.id}/download`,
      owner.cookie,
    );
    expect(interrupted.status).toBe(200);
    await expect(interrupted.arrayBuffer()).rejects.toThrow();
    expect(
      (await env.DB.prepare("SELECT state FROM files WHERE id=?")
        .bind(first.id)
        .first<Row>())!.state,
    ).toBe("ready");
  });
});
