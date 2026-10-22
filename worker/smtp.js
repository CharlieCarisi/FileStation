// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { HttpError, ensure, email, mail } from "./util.js";
import { connect } from "cloudflare:sockets";
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(result);
}
__name(base64, "base64");
var folded = /* @__PURE__ */ __name(
  (text) =>
    base64(text)
      .match(/.{1,76}/g)
      ?.join("\r\n") || "",
  "folded",
);
async function smtpMail(env, to, subject, text, html) {
  ensure(
    env.SMTP2GO_USERNAME && env.SMTP2GO_PASSWORD,
    503,
    "Email delivery is not configured.",
  );
  const socket = connect(
    { hostname: "mail.smtp2go.com", port: 465 },
    { secureTransport: "on", allowHalfOpen: false },
  );
  return smtpConversation(env, to, subject, text, socket, html);
}
__name(smtpMail, "smtpMail");
async function smtpConversation(env, to, subject, text, socket, html) {
  const from = env.SMTP_FROM.match(/<([^>]+)>/)?.[1] || env.SMTP_FROM;
  ensure(
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from) &&
      !/[\r\n]/.test(env.SMTP_FROM),
    503,
    "The email sender is not configured correctly.",
  );
  const reader = socket.readable.getReader(),
    writer = socket.writable.getWriter(),
    decoder = new TextDecoder();
  let buffer = "";
  async function line() {
    for (;;) {
      const i = buffer.indexOf("\r\n");
      if (i >= 0) {
        const value = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        return value;
      }
      const r = await reader.read();
      if (r.done)
        throw new HttpError(502, "The email server closed the connection.");
      buffer += decoder.decode(r.value, { stream: true });
      ensure(buffer.length <= 16384, 502, "Unexpected email server response.");
    }
  }
  __name(line, "line");
  async function reply(expected) {
    let value = await line();
    const code = Number(value.slice(0, 3));
    while (value[3] === "-") value = await line();
    ensure(
      code === expected,
      502,
      "The email server rejected the message. Check SMTP credentials and verified sender.",
    );
  }
  __name(reply, "reply");
  async function command(value, expected) {
    await writer.write(new TextEncoder().encode(value + "\r\n"));
    await reply(expected);
  }
  __name(command, "command");
  let timer;
  try {
    await Promise.race([
      (async () => {
        await reply(220);
        await command("EHLO filestation.local", 250);
        await command("AUTH LOGIN", 334);
        await command(base64(env.SMTP2GO_USERNAME), 334);
        await command(base64(env.SMTP2GO_PASSWORD), 235);
        await command(`MAIL FROM:<${from}>`, 250);
        for (const recipient of to)
          await command(`RCPT TO:<${recipient}>`, 250);
        await command("DATA", 354);
        const encodedSubject =
          base64(subject)
            .match(/.{1,60}/g)
            ?.map((p) => `=?UTF-8?B?${p}?=`)
            .join("\r\n ") || "";
        const boundary = `fs_${crypto.randomUUID()}`;
        const content = html
          ? [
              `Content-Type: multipart/alternative; boundary="${boundary}"`,
              "",
              `--${boundary}`,
              "Content-Type: text/plain; charset=UTF-8",
              "Content-Transfer-Encoding: base64",
              "",
              folded(text),
              `--${boundary}`,
              "Content-Type: text/html; charset=UTF-8",
              "Content-Transfer-Encoding: base64",
              "",
              folded(html),
              `--${boundary}--`,
              "",
            ]
          : [
              "Content-Type: text/plain; charset=UTF-8",
              "Content-Transfer-Encoding: base64",
              "",
              folded(text),
              "",
            ];
        const message = [
          `From: ${env.SMTP_FROM}`,
          "To: undisclosed-recipients:;",
          `Subject: ${encodedSubject}`,
          `Date: ${/* @__PURE__ */ new Date().toUTCString()}`,
          `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`,
          "MIME-Version: 1.0",
          ...content,
        ].join("\r\n");
        await writer.write(new TextEncoder().encode(message + "\r\n.\r\n"));
        await reply(250);
        await command("QUIT", 221);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new HttpError(504, "The email server timed out.")),
          2e4,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    writer.releaseLock();
    await socket.close();
  }
}
__name(smtpConversation, "smtpConversation");

export { base64, folded, smtpMail, smtpConversation };
