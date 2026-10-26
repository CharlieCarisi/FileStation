import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
type Row = Record<string, any>;
async function request(
  path: string,
  method = "GET",
  data?: any,
  cookie = "",
  prefix = "",
  headers: Record<string, string> = {},
) {
  const response = await SELF.fetch(`http://localhost${prefix}/api${path}`, {
    method,
    headers: {
      Origin: "http://localhost",
      Cookie: cookie,
      "Content-Type": "application/json",
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: response.headers,
  });
}
async function login(email = "c@bychx.com") {
  const challenge = (await (
    await request("/auth/request", "POST", { email })
  ).json()) as Row;
  const response = await request("/auth/verify", "POST", {
    challengeId: challenge.challengeId,
    pin: challenge.developmentPin,
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function invitation(cookie: string, options: Row = {}) {
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
    "/files",
  );
  expect(response.status).toBe(201);
  return response.json() as Promise<Row>;
}
async function upload(cookie: string) {
  const created = (await (
    await request(
      "/uploads",
      "POST",
      {
        connectorId: "r2-default",
        name: "source.txt",
        size: 1,
        fingerprint: "a".repeat(64),
      },
      cookie,
    )
  ).json()) as Row;
  const response = await SELF.fetch(
    `http://localhost/api/uploads/${created.file.id}/parts/1`,
    {
      method: "PUT",
      headers: { Origin: "http://localhost", Cookie: cookie },
      body: new Uint8Array([65]).buffer,
    },
  );
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  expect(
    (await request(`/uploads/${created.file.id}/complete`, "POST", {}, cookie))
      .status,
  ).toBe(200);
  return created.file;
}
it("applies the saved address to download, submission and collaboration links across hosts while preserving domains and codes", async () => {
  const admin = await login(),
    file = await upload(admin);
  const initial = (await (
    await request("/admin/settings", "GET", undefined, admin)
  ).json()) as Row;
  expect(initial).toMatchObject({
    shareBaseUrl: "current",
    allowedDomains: ["international.gc.ca"],
  });
  const original = await invitation(admin);
  for (const base of [
    "https://files.bychx.com",
    "https://utils.bychx.com/files",
  ]) {
    expect(
      (await request("/admin/settings", "PUT", { shareBaseUrl: base }, admin))
        .status,
    ).toBe(200);
    expect(
      await (await request("/admin/settings", "GET", undefined, admin)).json(),
    ).toMatchObject({
      shareBaseUrl: base,
      allowedDomains: initial.allowedDomains,
    });
    const response = await request(
      `/files/${file.id}/shares`,
      "POST",
      { recipients: ["partner@example.com"], expiresDays: 7, sendEmail: false },
      admin,
      "/files",
      { "X-FileStation-Language": "fr-CA" },
    );
    const shared = (await response.json()) as Row;
    expect(shared.link).toBe(`${base}/?lang=fr-CA#share=${shared.code}`);
    const submission = await invitation(admin);
    expect(submission.link).toBe(`${base}/#share=${submission.code}`);
    const collaboration = await invitation(admin, {
      kind: "collaboration",
      sourceFileId: file.id,
      targetName: "working.txt",
    });
    expect(collaboration.link).toBe(`${base}/#share=${collaboration.code}`);
    const listing = (await (
      await request("/invitations", "GET", undefined, admin)
    ).json()) as Row;
    expect(
      listing.invitations.find((row: Row) => row.id === original.id),
    ).toMatchObject({
      code: original.code,
      link: `${base}/#share=${original.code}`,
    });
    const challenge = (await (
      await request("/access/request", "POST", {
        code: original.code,
        email: "partner@example.com",
      })
    ).json()) as Row;
    const verified = await request("/access/verify", "POST", {
      kind: challenge.kind,
      challengeId: challenge.challengeId,
      pin: challenge.developmentPin,
    });
    expect(verified.status).toBe(200);
    expect(((await verified.json()) as Row).invitation.id).toBe(original.id);
  }
  await request(
    "/admin/settings",
    "PUT",
    { allowedDomains: ["example.org"] },
    admin,
  );
  expect(
    await (await request("/admin/settings", "GET", undefined, admin)).json(),
  ).toMatchObject({
    shareBaseUrl: "https://utils.bychx.com/files",
    allowedDomains: ["example.org"],
  });
});
it("requires administrator access and rejects unsafe addresses without partially updating settings", async () => {
  const user = await login("user@international.gc.ca");
  expect(
    (
      await request(
        "/admin/settings",
        "PUT",
        { shareBaseUrl: "https://files.bychx.com" },
        user,
      )
    ).status,
  ).toBe(403);
  const admin = await login();
  for (const base of [
    "https://evil.example",
    "https://files.bychx.com.evil.example",
    "https://utils.bychx.com/files/extra",
    "http://files.bychx.com",
    "https://files.bychx.com/?redirect=evil",
  ]) {
    expect(
      (
        await request(
          "/admin/settings",
          "PUT",
          { shareBaseUrl: base, allowedDomains: ["example.org"] },
          admin,
        )
      ).status,
    ).toBe(400);
  }
  expect(
    await (await request("/admin/settings", "GET", undefined, admin)).json(),
  ).toMatchObject({
    shareBaseUrl: "current",
    allowedDomains: ["international.gc.ca"],
  });
});
