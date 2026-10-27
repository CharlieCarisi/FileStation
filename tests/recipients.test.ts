import { SELF, env as bindings } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env, Row } from "../worker/model";
import { hash, mail } from "../worker/util.js";
import worker from "../worker/main";
import { parseRecipients } from "../shared/recipients";
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
const production = {
  ...env,
  DEV_MODE: "false",
  SMTP2GO_API_KEY: "test-api-key",
  SMTP_FROM: "sender@example.invalid",
};
async function sendApi(path: string, cookie: string, data: Row) {
  const response = await worker.fetch(
    new Request(`${origin}/files/api${path}`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }),
    production,
  );
  return { status: response.status, data: (await response.json()) as Row };
}
const invitationInput = (recipients: unknown) => ({
  title: "Team submissions",
  kind: "submission",
  connectorId: "r2-default",
  recipients,
  expiresDays: 7,
  maxFileBytes: 100000,
  maxFiles: 10,
  sendEmail: true,
});
const accepted = () =>
  Response.json({
    data: { succeeded: 1, failed: 0, failures: [], email_id: "test-message" },
  });

describe("multiple email recipients", () => {
  it("accepts SMTP2GO success for one message addressed to several people, with synchronous acceptance explicitly requested", async () => {
    vi.mocked(fetch).mockResolvedValue(accepted());
    const addresses = ["one@example.com", "two@example.com"];
    await expect(
      mail(production, addresses, "Subject", "Text", "<p>Text</p>"),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.smtp2go.com/v3/email/send");
    expect(JSON.parse(options!.body as string)).toMatchObject({
      to: addresses,
      fastaccept: false,
    });
  });
  it("does not turn provider errors, failures or unconfirmed responses into success merely because HTTP status is 200", async () => {
    for (const data of [
      { succeeded: 0, failed: 1, failures: ["Rejected"] },
      { succeeded: 1, failed: 0, failures: ["Could not process recipient"] },
      { error_code: "DENIED" },
      { email_id: "queued-without-confirmation" },
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data }));
      await expect(
        mail(
          production,
          ["one@example.com", "two@example.com"],
          "Subject",
          "Text",
          "<p>Text</p>",
        ),
      ).rejects.toThrow("The email provider could not deliver");
    }
  });
  it("normalizes common list separators, mixed case and duplicates while rejecting the entire malformed list", () => {
    expect(
      parseRecipients(
        " ONE@example.com;two@example.com\nONE@EXAMPLE.COM，three@example.com；four@example.com、five@example.com six@example.com",
      ),
    ).toEqual([
      "one@example.com",
      "two@example.com",
      "three@example.com",
      "four@example.com",
      "five@example.com",
      "six@example.com",
    ]);
    expect(
      parseRecipients(["ONE@example.com, two@example.com", "one@example.com"]),
    ).toEqual(["one@example.com", "two@example.com"]);
    expect(
      parseRecipients(
        Array.from({ length: 30 }, () => "duplicate@example.com"),
      ),
    ).toEqual(["duplicate@example.com"]);
    for (const value of [
      "",
      [],
      null,
      [null],
      ["valid@example.com", "invalid"],
      Array.from({ length: 21 }, (_, i) => `person${i}@example.com`),
    ])
      expect(() => parseRecipients(value)).toThrow();
  });
  it("creates one emailed request and one shared code for two people, who can both upload while seeing only their own submissions", async () => {
    const admin = await login();
    vi.mocked(fetch).mockResolvedValue(accepted());
    const created = await sendApi(
      "/invitations",
      admin.cookie,
      invitationInput(
        "FIRST@example.com;second@example.com\nfirst@example.com",
      ),
    );
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ recipientCount: 2, emailSent: true });
    expect(created.data.emailError).toBeUndefined();
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) total FROM invitations",
      ).first<Row>())!.total,
    ).toBe(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT email FROM invitation_recipients WHERE invitation_id=? ORDER BY email",
        )
          .bind(created.data.id)
          .all<Row>()
      ).results.map((row) => row.email),
    ).toEqual(["first@example.com", "second@example.com"]);
    const payload = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string,
    );
    expect(payload.to).toEqual(["first@example.com", "second@example.com"]);
    expect(payload.text_body).toContain(created.data.code);
    const first = await verify(created.data, "first@example.com"),
      second = await verify(created.data, "second@example.com");
    const a = await draft(created.data, first.cookie, "First person document"),
      b = await draft(created.data, second.cookie, "Second person document");
    expect(
      (await request(a.path + "/publish", "POST", {}, first.cookie)).status,
    ).toBe(200);
    expect(
      (await request(b.path + "/publish", "POST", {}, second.cookie)).status,
    ).toBe(200);
    const firstView = (await (
      await request(
        `/invitations/${created.data.id}/view`,
        "GET",
        undefined,
        first.cookie,
      )
    ).json()) as Row;
    const secondView = (await (
      await request(
        `/invitations/${created.data.id}/view`,
        "GET",
        undefined,
        second.cookie,
      )
    ).json()) as Row;
    expect(firstView.submitted.map((file: Row) => file.id)).toEqual([
      a.file.id,
    ]);
    expect(secondView.submitted.map((file: Row) => file.id)).toEqual([
      b.file.id,
    ]);
    expect(
      (await request(a.path, "GET", undefined, second.cookie)).status,
    ).toBe(404);
    const owner = (await (
      await request("/invitations", "GET", undefined, admin.cookie)
    ).json()) as Row;
    expect(owner.invitations[0].files).toHaveLength(2);
    expect(owner.invitations[0].code).toBe(created.data.code);
  });
  it("retains the same request and both email authorizations after a real provider rejection, without claiming mail was sent", async () => {
    const admin = await login();
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: { succeeded: 0, failed: 1, failures: ["Rejected"] },
      }),
    );
    const created = await sendApi(
      "/invitations",
      admin.cookie,
      invitationInput(["first@example.com", "second@example.com"]),
    );
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ recipientCount: 2, emailSent: false });
    expect(created.data.emailError).toContain("Invitation created");
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) total FROM invitations",
      ).first<Row>())!.total,
    ).toBe(1);
    await verify(created.data, "first@example.com");
    await verify(created.data, "second@example.com");
  });
  it("applies multi-recipient normalization and correct provider success handling to download shares and collaboration invitations too", async () => {
    const admin = await login(),
      file = await upload(admin.cookie);
    vi.mocked(fetch).mockImplementation(async () => accepted());
    const recipients = [
      "FIRST@example.com; second@example.com",
      "first@example.com",
    ];
    const share = await sendApi(`/files/${file.id}/shares`, admin.cookie, {
      recipients,
      expiresDays: 7,
      sendEmail: true,
    });
    expect(share.status).toBe(201);
    expect(share.data).toMatchObject({ recipientCount: 2, emailSent: true });
    expect(share.data.emailError).toBeUndefined();
    const collaboration = await sendApi("/invitations", admin.cookie, {
      ...invitationInput(recipients),
      kind: "collaboration",
      sourceFileId: file.id,
      targetName: "Working.txt",
    });
    expect(collaboration.status).toBe(201);
    expect(collaboration.data).toMatchObject({
      recipientCount: 2,
      emailSent: true,
    });
    expect(collaboration.data.emailError).toBeUndefined();
    for (const address of ["first@example.com", "second@example.com"]) {
      const guest = await verify(share.data, address);
      expect(
        await (
          await request(
            `/files/${file.id}/download`,
            "GET",
            undefined,
            guest.cookie,
          )
        ).text(),
      ).toBe("original");
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects an invalid multi-recipient list before creating anything, and keeps sign-in and verification challenges bound to one email", async () => {
    const admin = await login();
    const invalid = await sendApi(
      "/invitations",
      admin.cookie,
      invitationInput(["valid@example.com", "invalid"]),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.data.error).toContain("Check this email address");
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) total FROM invitations",
      ).first<Row>())!.total,
    ).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await request("/auth/request", "POST", {
          email: "one@example.com,two@example.com",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/access/request", "POST", {
          email: "one@example.com;two@example.com",
          code: "UAAAAAAAAAAAA",
        })
      ).status,
    ).toBe(400);
  });
});
