import type { Row } from "./model";
import { ensure } from "./util.js";
export type Space = "private" | "public";
export function workspaceSpace(value: unknown = "private"): Space {
  ensure(
    value === "private" || value === "public",
    400,
    "Choose Private or Public space.",
  );
  return value as Space;
}
export const ownsFile = (user: Row, file: Row) =>
  file.owner_id === user.id || user.role === "admin";
export const readsFile = (user: Row, file: Row) =>
  ownsFile(user, file) || file.space === "public";
