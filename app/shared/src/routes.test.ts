// The page's allow-list: which method and path main lets through to the service. Everything else is refused before
// it reaches the network, so a path trick must never match.
import { describe, expect, test } from "vitest";

import { APP_ROUTES, appRoute } from "./routes.ts";

describe("appRoute", () => {
  test("every listed route matches, with its parameters filled in", () => {
    for (const route of APP_ROUTES) {
      const path = route.pattern.replace(/:[A-Za-z]+/g, "3f2b9c1e-7a4d-4e1b-9c55-0d6e2a8f4b71");
      expect(appRoute(route.method, path), `${route.method} ${path}`).toBe(route);
    }
  });

  test("a query string passes on the routes that take one, and only there", () => {
    expect(appRoute("GET", "/agents/a1/log?after=12&limit=100")?.pattern).toBe("/agents/:id/log");
    expect(appRoute("GET", "/proposals?status=pending")?.pattern).toBe("/proposals");
    expect(appRoute("GET", "/agents?all=1")).toBeUndefined();
    expect(appRoute("POST", "/agents/a1/stop?now=1")).toBeUndefined();
  });

  test.each([
    ["encoded slash in a parameter", "POST", "/agents/a%2Fb/stop"],
    ["encoded dots in parameters", "POST", "/agents/%2e%2e/%2e%2e/shutdown"],
    ["dot-dot segments", "POST", "/agents/x/../../shutdown"],
    ["a parameter of one dot", "GET", "/agents/./log"],
    ["a parameter of two dots", "DELETE", "/agents/.."],
    ["an empty parameter", "GET", "/agents//log"],
    ["extra segments", "POST", "/agents/x/stop/more"],
    ["a parameter spanning segments", "GET", "/agents/x/y/log"],
    ["a trailing slash", "GET", "/agents/"],
    ["a fragment", "GET", "/agents#x"],
    ["a full URL", "GET", "http://127.0.0.1:4000/version"],
    ["a protocol-relative URL", "GET", "//127.0.0.1:4000/version"],
    ["a path without its leading slash", "GET", "version"],
    ["an empty query", "GET", "/proposals?"],
    ["a query with an encoded character", "GET", "/proposals?status=%70ending"],
    ["a listed path with another method", "GET", "/agents/x/stop"],
    ["a method in lower case", "get", "/version"],
    ["an unlisted method", "PUT", "/agents"],
    ["a main-only route", "POST", "/shutdown"],
    ["the alert stream", "GET", "/events"],
    ["the agents' route", "POST", "/mcp"],
  ])("refuses %s", (_what, method, path) => {
    expect(appRoute(method, path)).toBeUndefined();
  });
});
