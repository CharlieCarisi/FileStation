// Restored from the deployed Worker on 2026-10-22; see docs/recovery.md.
import { __name } from "./runtime.js";
import { id } from "./util.js";
var PART_SIZE = 8 * 1024 * 1024;
var MAX_PARTS = 1e4;
var UPLOAD_TTL = 7 * 864e5;
var CONNECTOR_FIELDS =
  "id,name,COALESCE(storage_adapter,adapter,kind) AS kind,limit_bytes,retention_days,enabled,config,encrypted_credentials,created_at";

export { PART_SIZE, MAX_PARTS, UPLOAD_TTL, CONNECTOR_FIELDS };
