export type Row = Record<string, any>;
export interface Env {
  DB: D1Database;
  R2_FILES: R2Bucket;
  STORAGE_COORDINATOR: DurableObjectNamespace;
  ASSETS: Fetcher;
  UTILITIES?: Fetcher;
  CONNECTOR_ENCRYPTION_KEY: string;
  DEV_MODE: string;
  APP_ORIGIN?: string;
  BASE_PATH?: string;
  [key: string]: any;
}
