import type { Env, Row } from "./model";
import { currentUser } from "./auth.js";
import { body, encrypt, ensure, json, email } from "./util.js";
import { OneDriveStorage, validateOneDrive } from "./onedrive";

export async function oneDriveAdminRoutes(
  request: Request,
  env: Env,
  path: string,
) {
  if (
    !["/api/admin/onedrive/browse", "/api/admin/onedrive/resolve"].includes(
      path,
    ) ||
    request.method !== "POST"
  )
    return null;
  await currentUser(request, env, true, true);
  const input = await body(request);
  let saved: Row | null = null;
  if (input.connectorId) {
    saved = await env.DB.prepare(
      "SELECT id,config,encrypted_credentials FROM connectors WHERE id=? AND COALESCE(storage_adapter,adapter,kind)='onedrive'",
    )
      .bind(input.connectorId)
      .first<Row>();
    ensure(saved, 404, "OneDrive connector not found.");
  }
  const config = validateOneDrive({
    ...(saved ? JSON.parse(saved.config) : {}),
    ...input,
    driveId: input.driveId || "root",
    folderId: input.folderId || "root",
  });
  const encrypted = input.clientSecret
    ? await encrypt(env, { clientSecret: input.clientSecret })
    : saved?.encrypted_credentials;
  ensure(encrypted, 400, "Enter the application secret value to connect.");
  const provider = new OneDriveStorage(env, {
    id: saved?.id || "browse",
    config: JSON.stringify(config),
    encrypted_credentials: encrypted,
  });
  if (path.endsWith("/resolve")) {
    const drive = await provider.graph(
      `/users/${encodeURIComponent(email(input.userEmail))}/drive?$select=id,name,webUrl`,
    );
    return json({ driveId: drive.id, name: drive.name });
  }
  const folder = await provider.test();
  return json({
    folder: {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentReference?.id,
    },
    ...(await provider.browse(config.folderId, input.skip || "")),
  });
}
