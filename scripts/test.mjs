import { spawnSync } from "node:child_process";
import { wranglerEnvironment } from "./wrangler.mjs";
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)],
  { stdio: "inherit", env: wranglerEnvironment() },
);
process.exit(result.status ?? 1);
