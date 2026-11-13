// The page's allow-list: which method and path main lets through to the service. Everything else is refused before
// it reaches the network, so a path trick must never match.
import { describe, expect, test } from "vitest";

import { appRoute } from "./routes.ts";

describe("appRoute", () => {
  test("a query string passes on the routes that take one, and only there", () => {
    expect(appRoute("GET", "/agents/a1/log?after=12&limit=100")?.pattern).toBe("/agents/:id/log");
    expect(appRoute("GET", "/proposals?status=pending")?.pattern).toBe("/proposals");
    expect(appRoute("GET", "/agents?all=1")).toBeUndefined();
    expect(appRoute("POST", "/agents/a1/stop?now=1")).toBeUndefined();
  });

  test.each([
    ["encoded dots in parameters", "POST", "/agents/%2e%2e/%2e%2e/shutdown"],
    ["dot-dot segments", "POST", "/agents/x/../../shutdown"],
    ["a full URL", "GET", "http://127.0.0.1:4000/version"],
    ["a protocol-relative URL", "GET", "//127.0.0.1:4000/version"],
    ["a listed path with another method", "GET", "/agents/x/stop"],
    ["a main-only route", "POST", "/shutdown"],
    ["the alert stream", "GET", "/events"],
    ["the agents' route", "POST", "/mcp"],
  ])("refuses %s", (_what, method, path) => {
    expect(appRoute(method, path)).toBeUndefined();
  });
});
