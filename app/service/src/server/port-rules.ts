import { createHash, timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import { errorResponse } from "./errors.ts";

/** The only Origin a browser-like caller may send: the desktop app's own scheme. */
export const APP_ORIGIN = "app://wombat";

// Hashing first gives both sides one length, so the comparison takes the same time however much of it matches.
const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Refuses, before any route runs, a request without the exact bearer token (no query token: URLs end up in
 * logs and history), one from a web page (any Origin but the app's), and one whose Host isn't the loopback
 * address with the bound port, which is how a DNS-rebound page would arrive.
 */
export const portRules = ({ token, port }: { token: string; port: () => number }): MiddlewareHandler => {
  const expected = digest(`Bearer ${token}`);
  return async (c, next) => {
    const authorization = c.req.header("authorization");
    if (authorization === undefined || !timingSafeEqual(digest(authorization), expected)) {
      return errorResponse(
        c,
        401,
        "unauthorized",
        "The request has no valid token. Send the token from the service's discovery file as `Authorization: Bearer <token>`.",
      );
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== APP_ORIGIN) {
      return errorResponse(
        c,
        403,
        "forbidden_origin",
        "Requests from web pages are refused. Call the service from the Wombat app, or without an Origin header.",
      );
    }
    const host = c.req.header("host")?.toLowerCase();
    if (host !== `127.0.0.1:${port()}` && host !== `localhost:${port()}`) {
      return errorResponse(
        c,
        403,
        "forbidden_host",
        `The Host header must be 127.0.0.1:${port()} or localhost:${port()}. Connect to the service by that address.`,
      );
    }
    await next();
  };
};
