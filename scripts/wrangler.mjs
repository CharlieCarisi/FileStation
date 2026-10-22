import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/.wrangler-logs", { recursive: true });
mkdirSync("/workspace/.config/.wrangler", { recursive: true });
export const wranglerEnvironment = () => ({
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  XDG_CONFIG_HOME: "/workspace/.config",
  WRANGLER_LOG_PATH: "/workspace/.wrangler-logs/wrangler.log",
});
if (process.argv[1]?.endsWith("wrangler.mjs")) {
  const p = spawn(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...process.argv.slice(2)],
    { stdio: "inherit", env: wranglerEnvironment() },
  );
  p.on("exit", (code) => process.exit(code ?? 1));
}
