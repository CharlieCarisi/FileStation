import type { Env as FileStationEnv } from "../worker/model";
import "vitest";
declare global {
  namespace Cloudflare {
    interface Env extends FileStationEnv {}
  }
}
declare module "vitest" {
  interface ProvidedContext {
    migrations: { name: string; queries: string[] }[];
  }
}
