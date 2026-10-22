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
    // The singular /users/{id}/drive lookup does not support app-only auth.
    // The drives collection does: https://learn.microsoft.com/graph/api/drive-list.
    const result = await provider.graph(
      `/users/${encodeURIComponent(email(input.userEmail))}/drives?$select=id,name,driveType&$top=100`,
    );
    const drives = Array.isArray(result.value)
      ? result.value.filter(
          (drive: Row) => drive.driveType === "business" && drive.id,
        )
      : [];
    ensure(
      drives.length,
      400,
      "No OneDrive for Business drive was returned. Confirm the owner’s Microsoft 365 sign-in address and open their OneDrive once to provision it. With selected permissions, enter the Drive ID manually.",
    );
    ensure(
      drives.length === 1 && !result["@odata.nextLink"],
      400,
      "More than one drive may be available. Enter the intended Drive ID manually rather than choosing a drive automatically.",
    );
    const drive = drives[0];
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
