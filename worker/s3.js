// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { HttpError, ensure, body, hash, escapeHtml, decrypt } from "./util.js";
import { Storage } from "./storage.js";
import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";
function validateS3Config(config) {
  const endpoint = config.endpoint.trim();
  const example =
    "https://YOUR_NAMESPACE.compat.objectstorage.YOUR_REGION.oraclecloud.com";
  ensure(
    !/[<>{}]/.test(endpoint),
    400,
    `Replace the namespace and region placeholders with your Oracle account values. Example: ${example}`,
  );
  let url;
  try {
    url = new URL(
      endpoint.startsWith("//")
        ? `https:${endpoint}`
        : /^[a-z][a-z0-9+.-]*:/i.test(endpoint)
          ? endpoint
          : `https://${endpoint}`,
    );
  } catch {
    throw new HttpError(
      400,
      `Enter an S3 HTTPS URL or hostname. For Oracle, use your namespace and region: ${example}`,
    );
  }
  const vendors = [
    "r2.cloudflarestorage.com",
    "amazonaws.com",
    "backblazeb2.com",
    "storjshare.io",
    "digitaloceanspaces.com",
    "wasabisys.com",
  ];
  const oracle = url.hostname.match(
    /^([a-z0-9-]+)\.compat\.objectstorage\.([a-z0-9-]+)\.(?:oraclecloud\.com|oci\.customer-oci\.com)$/,
  );
  if (
    (url.hostname.endsWith(".oraclecloud.com") ||
      url.hostname.endsWith(".oci.customer-oci.com")) &&
    !oracle
  )
    throw new HttpError(
      400,
      `Use Oracle's namespace-based S3 Compatibility endpoint, rather than the native Object Storage or virtual-hosted endpoint. Example: ${example}`,
    );
  ensure(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (vendors.some(
        (s) => url.hostname === s || url.hostname.endsWith("." + s),
      ) ||
        oracle),
    400,
    "Use a root HTTPS S3 endpoint for R2, AWS, B2, Storj, DigitalOcean, Wasabi, or Oracle. Enter the bucket separately; omit credentials, query strings and object paths.",
  );
  const bucket = config.bucket.trim();
  let region = config.region.trim();
  if (oracle) {
    if (!region || region === "auto") region = oracle[2];
    ensure(
      region === oracle[2],
      400,
      `The Oracle region must match the endpoint: ${oracle[2]}.`,
    );
  }
  ensure(
    oracle
      ? /^[a-zA-Z0-9._-]{1,256}$/.test(bucket) &&
          bucket !== "." &&
          bucket !== ".."
      : /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) &&
          !bucket.includes(".."),
    400,
    oracle
      ? "Enter the exact Oracle bucket name, including capitalization (1\u2013256 letters, numbers, hyphens, underscores or periods)."
      : "Enter a valid S3 bucket name.",
  );
  ensure(
    /^[a-z0-9-]{1,64}$/.test(region),
    400,
    "Enter the S3 region (auto for R2).",
  );
  return { endpoint: url.origin, bucket, region };
}
__name(validateS3Config, "validateS3Config");
var S3Storage = class {
  constructor(env, connector) {
    this.env = env;
    this.connector = connector;
    this.config = validateS3Config(JSON.parse(connector.config));
  }
  env;
  connector;
  static {
    __name(this, "S3Storage");
  }
  config;
  async request(file, method, query = {}, body2, headers = {}) {
    ensure(
      this.connector.encrypted_credentials,
      503,
      "S3 credentials are not configured.",
    );
    let credentials;
    try {
      credentials = await decrypt(
        this.env,
        this.connector.encrypted_credentials,
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "Stored S3 credentials could not be decrypted. Re-enter both S3 keys in this connector. Keep the connector encryption key stable.",
      );
    }
    ensure(
      typeof credentials.accessKeyId === "string" &&
        typeof credentials.secretAccessKey === "string" &&
        credentials.accessKeyId &&
        credentials.secretAccessKey,
      503,
      "S3 credentials are incomplete. Re-enter both Customer Secret Key fields.",
    );
    const client = new AwsClient({
      ...credentials,
      service: "s3",
      region: this.config.region,
      retries: 0,
    });
    const url = new URL(this.config.endpoint);
    url.pathname = `/${this.config.bucket}/${file.object_key.split("/").map(encodeURIComponent).join("/")}`;
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let signed;
    try {
      signed = await client.sign(url.toString(), {
        method,
        body: body2,
        headers: {
          ...(body2
            ? {
                "x-amz-content-sha256": await hash(
                  typeof body2 === "string" ? body2 : body2,
                ),
              }
            : {}),
          ...headers,
        },
      });
    } catch (error) {
      console.error(
        "S3 signing failure:",
        error instanceof Error ? error.name : "unknown",
      );
      throw new HttpError(
        502,
        "The S3 request could not be signed. Check the Customer Secret Key pair and region.",
      );
    }
    let response;
    try {
      response = await fetch(signed, { redirect: "manual" });
    } catch (error) {
      console.error(
        "S3 transport failure:",
        error instanceof Error ? error.name : "unknown",
      );
      throw new HttpError(
        502,
        "The S3 endpoint could not be reached over HTTPS. Check the endpoint and try again.",
      );
    }
    ensure(
      response.status < 300 || response.status >= 400,
      502,
      "The S3 endpoint redirected the request. Use the bucket\u2019s regional S3 Compatibility endpoint.",
    );
    return response;
  }
  async create(file) {
    const r = await this.request(file, "POST", { uploads: "" }, void 0, {
      "Content-Type": "application/octet-stream",
    });
    if (!r.ok) {
      let code = "";
      const text = await r.text();
      try {
        const result = new XMLParser({
          processEntities: false,
          ignoreAttributes: true,
        }).parse(text);
        const value = result?.Error?.Code;
        if (typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value))
          code = value;
      } catch {}
      if (!code) {
        try {
          const value = JSON.parse(text)?.code;
          if (typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value))
            code = value;
        } catch {}
      }
      throw new HttpError(
        502,
        `S3 storage could not start the upload (HTTP ${r.status}${code ? `, ${code}` : ""}). ${code === "NoSuchBucket" ? `Bucket \u201C${this.config.bucket}\u201D was not found or is not accessible in region \u201C${this.config.region}\u201D. Check the exact bucket name, namespace, region and the key's bucket permissions.` : "Check the bucket and S3 Customer Secret Key credentials."}`,
      );
    }
    const doc = new XMLParser({
      processEntities: false,
      ignoreAttributes: true,
    }).parse(await r.text());
    ensure(
      doc.InitiateMultipartUploadResult?.UploadId,
      502,
      "S3 returned an invalid multipart session.",
    );
    return {
      uploadId: doc.InitiateMultipartUploadResult.UploadId,
      fileId: null,
    };
  }
  async part(file, part, data) {
    const r = await this.request(
      file,
      "PUT",
      { uploadId: file.provider_upload_id, partNumber: String(part) },
      data,
    );
    ensure(
      r.ok && r.headers.get("etag"),
      502,
      "S3 storage could not save the part. You can retry it.",
    );
    return r.headers.get("etag");
  }
  async complete(file, parts) {
    const exists = await this.request(file, "HEAD");
    if (exists.ok && Number(exists.headers.get("content-length")) === file.size)
      return;
    const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeHtml(p.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
    const r = await this.request(
      file,
      "POST",
      { uploadId: file.provider_upload_id },
      xml,
      {
        "Content-Type": "application/xml",
      },
    );
    const result = await r.text();
    ensure(
      r.ok && !/<(?:\w+:)?Error[\s>]/.test(result),
      502,
      "S3 could not complete the upload. Retry completion.",
    );
    const final = await this.request(file, "HEAD");
    ensure(
      final.ok && Number(final.headers.get("content-length")) === file.size,
      502,
      "S3 returned an unexpected file size.",
    );
  }
  async remove(file) {
    if (!file.completed_at && file.provider_upload_id) {
      const aborted = await this.request(file, "DELETE", {
        uploadId: file.provider_upload_id,
      });
      ensure(
        aborted.ok || aborted.status === 404,
        502,
        "S3 could not cancel the upload. Cleanup will retry.",
      );
    }
    const r = await this.request(file, "DELETE");
    ensure(
      r.ok || r.status === 404,
      502,
      "S3 could not delete the file. Cleanup will retry.",
    );
  }
  async download(file, offset, length) {
    const r = await this.request(file, "GET", {}, void 0, {
      Range: `bytes=${offset}-${offset + length - 1}`,
    });
    ensure(
      r.status === 206 && r.body,
      502,
      "S3 did not return the requested file range.",
    );
    ensure(
      r.headers.get("content-range") ===
        `bytes ${offset}-${offset + length - 1}/${file.size}`,
      502,
      "S3 returned an unexpected file range.",
    );
    return r.body;
  }
};

export { validateS3Config, S3Storage };
