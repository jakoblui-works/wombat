import { createHash, timingSafeEqual } from "node:crypto";

import { APP_ORIGIN } from "@wombat/shared";
import { ServerErrorCode } from "@wombat/shared/api";
import type { Context, MiddlewareHandler } from "hono";

import { errorResponse, SERVER_STATUS } from "./errors.ts";

// Hashing first gives both sides one length, so the comparison takes the same time however much of it matches.
const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Refuses a request whose Host isn't the loopback address with the bound port, which is how a DNS-rebound page
 * would arrive; undefined when the Host is right.
 */
export const refuseForeignHost = (c: Context, port: number) => {
  const host = c.req.header("host")?.toLowerCase();
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) return undefined;
  return errorResponse(
    c,
    SERVER_STATUS.forbidden_host,
    ServerErrorCode.enum.forbidden_host,
    `The Host header must be 127.0.0.1:${port} or localhost:${port}. Connect to the service by that address.`,
  );
};

/**
 * Refuses, before any route runs, a request without the exact bearer token (no query token: URLs end up in
 * logs and history), one from a web page (any Origin but the app's), and one with a foreign Host. An agent's
 * /mcp token is not this token, so it opens none of these routes.
 */
export const portRules = ({ token, port }: { token: string; port: () => number }): MiddlewareHandler => {
  const expected = digest(`Bearer ${token}`);
  return async (c, next) => {
    const authorization = c.req.header("authorization");
    if (authorization === undefined || !timingSafeEqual(digest(authorization), expected)) {
      return errorResponse(
        c,
        SERVER_STATUS.unauthorized,
        ServerErrorCode.enum.unauthorized,
        "The request has no valid token. Send the token from the service's discovery file as `Authorization: Bearer <token>`.",
      );
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== APP_ORIGIN) {
      return errorResponse(
        c,
        SERVER_STATUS.forbidden_origin,
        ServerErrorCode.enum.forbidden_origin,
        "Requests from web pages are refused. Call the service from the Wombat app, or without an Origin header.",
      );
    }
    const foreignHost = refuseForeignHost(c, port());
    if (foreignHost) return foreignHost;
    await next();
  };
};
