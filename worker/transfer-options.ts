import type { Env, Row } from "./model";
import { uploadConcurrency } from "../shared/concurrency";
export async function uploadConnections(env: Env, connectorId: string) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(storage_adapter,adapter,kind) AS kind FROM connectors WHERE id=?",
  )
    .bind(connectorId)
    .first<Row>();
  return row ? uploadConcurrency(row.kind) : 1;
}
