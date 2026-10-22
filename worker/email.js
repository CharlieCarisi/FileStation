// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { body, email } from "./util.js";
var escape = /* @__PURE__ */ __name(
  (value) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  "escape",
);
function emailLayout(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(message.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f3ed;color:#203a30;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;font-size:1px;color:#f4f3ed;max-height:0;overflow:hidden">${escape(message.intro)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3ed"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 8px 24px;font-size:20px;font-weight:bold;color:#234b3d"><span style="display:inline-block;padding:9px 12px;background:#234b3d;color:#fff;border-radius:10px;margin-right:10px">F</span> File Station</td></tr>
<tr><td style="background:#fff;border:1px solid #e2e5da;border-radius:20px;padding:36px 28px">
<p style="font-size:11px;letter-spacing:2px;font-weight:bold;color:#5d7c68;margin:0 0 16px">${escape(message.eyebrow)}</p>
<h1 style="font-size:30px;line-height:1.2;font-weight:normal;margin:0 0 18px;color:#203a30">${escape(message.title)}</h1>
<p style="font-size:15px;line-height:1.7;color:#5b665d;margin:0 0 24px;overflow-wrap:anywhere">${escape(message.intro)}</p>
${message.code ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:22px 10px;background:#edf4eb;border:1px solid #dce8d7;border-radius:12px"><p style="margin:0 0 10px;font-size:11px;letter-spacing:1px;color:#5d7c68">${escape(message.codeLabel || "YOUR VERIFICATION CODE")}</p><div style="font-family:monospace;font-size:${message.code.length > 6 ? "23" : "34"}px;font-weight:bold;letter-spacing:4px;color:#234b3d">${escape(message.code)}</div></td></tr></table>` : ""}
${message.link ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="background:#234b3d;border-radius:10px"><a href="${escape(message.link)}" style="display:inline-block;padding:15px 24px;color:#fff;text-decoration:none;font-weight:bold;font-size:14px">${escape(message.button || "Open File Station")} &rarr;</a></td></tr></table><p style="font-size:12px;line-height:1.7;word-break:break-all;color:#6a756b">Or copy this link:<br><a href="${escape(message.link)}" style="color:#345e48">${escape(message.link)}</a></p>` : ""}
<p style="font-size:13px;line-height:1.7;color:#6a756b;margin:24px 0 0;white-space:pre-line">${escape(message.details)}</p>
</td></tr><tr><td style="padding:24px 8px;font-size:12px;line-height:1.7;color:#7a8276">${escape(message.footer)}<br><span style="color:#345e48">Good files. Great Mission. Easy sharing.</span></td></tr>
</table></td></tr></table></body></html>`;
}
__name(emailLayout, "emailLayout");
function verificationEmail(code, purpose) {
  return emailLayout({
    eyebrow:
      purpose === "login"
        ? "WELCOME TO YOUR STATION"
        : "A FILE IS WAITING FOR YOU",
    title: purpose === "login" ? "Your sign-in code." : "Verify your email.",
    intro:
      purpose === "login"
        ? "Enter this code in File Station to sign in to your account."
        : "Enter this code in File Station to open the file shared with your email address.",
    code,
    details:
      "This code expires in 10 minutes and can be used once. Keep it private.",
    footer:
      "If you did not request this code, you can safely ignore this email.",
  });
}
__name(verificationEmail, "verificationEmail");
function sharingEmail(sender, name, link, code, expiresAt) {
  return emailLayout({
    eyebrow: "FROM THEIR STATION TO YOURS",
    title: "Your file is shared.",
    intro: `${sender} shared ${name} with you.`,
    code,
    codeLabel: "YOUR FILE ACCESS CODE",
    link,
    button: "Retrieve your file",
    details: `Verify your recipient email address to download. You can pause and resume your transfer.
This share expires ${new Date(expiresAt).toUTCString()}. It may expire earlier if the owner deletes the file or storage retention removes it.`,
    footer:
      "This invitation is for the recipient email address. No approved File Station account is needed.",
  });
}
__name(sharingEmail, "sharingEmail");

export { escape, emailLayout, verificationEmail, sharingEmail };
