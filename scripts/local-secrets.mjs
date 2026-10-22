import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const file = ".dev.vars.local";
if (
  !existsSync(file) ||
  !/^CONNECTOR_ENCRYPTION_KEY=/m.test(readFileSync(file, "utf8"))
)
  appendFileSync(
    file,
    "\nCONNECTOR_ENCRYPTION_KEY=" + randomBytes(32).toString("base64") + "\n",
    { mode: 0o600 },
  );
