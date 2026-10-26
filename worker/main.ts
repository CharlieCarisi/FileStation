import legacy, { routes, securityHeaders } from "./index.js";
import { invitationRoutes } from "./invitations";
import { oneDriveAdminRoutes } from "./onedrive-admin";
import { checkOrigin, errorResponse } from "./util.js";
import type { Env } from "./model";
import { localeFor } from "../shared/i18n";
import { folderRoutes } from "./folders";
export { StorageCoordinator } from "./coordinator.js";

export default {
  async fetch(incoming: Request, bindings: Env): Promise<Response> {
    const url = new URL(incoming.url);
    const prefixed =
      url.pathname === "/files" || url.pathname.startsWith("/files/");
    if (url.hostname === "utils.bychx.com" && !prefixed)
      return bindings.UTILITIES
        ? bindings.UTILITIES.fetch(incoming)
        : new Response("Not found", { status: 404 });
    if (url.pathname === "/files") {
      url.pathname = "/files/";
      return Response.redirect(url.href, 308);
    }
    const env = {
      ...bindings,
      BASE_PATH: prefixed ? "/files" : "",
      LANGUAGE: localeFor(incoming.headers.get("X-FileStation-Language")),
    };
    if (prefixed) url.pathname = url.pathname.slice(6) || "/";
    const request = new Request(url.href, incoming);
    let response: Response;
    try {
      if (url.pathname.startsWith("/api/")) {
        checkOrigin(request, env);
        response =
          (await folderRoutes(request, env, url.pathname)) ||
          (await oneDriveAdminRoutes(request, env, url.pathname)) ||
          (await invitationRoutes(request, env, url.pathname)) ||
          (await routes(request, env));
      } else response = await env.ASSETS.fetch(request);
    } catch (error) {
      response = errorResponse(error);
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(securityHeaders))
      headers.set(key, value as string);
    if (url.pathname.startsWith("/api/"))
      headers.set("Cache-Control", "private, no-store");
    if (env.DEV_MODE !== "true")
      headers.set("Strict-Transport-Security", "max-age=31536000");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  async scheduled(controller: ScheduledController, env: Env) {
    await legacy.scheduled(controller, env);
    await env.DB.prepare("DELETE FROM invitation_sessions WHERE expires_at<?")
      .bind(Date.now())
      .run();
  },
};
