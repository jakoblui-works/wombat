// The page's allow-list: which method and path main lets through to the service. Everything else is refused before
// it reaches the network, so a path trick must never match.
import { describe, expect, test } from "vitest";

import { APP_ROUTES, appRoute, pathOf, ROUTES, type AppRoute } from "./routes.ts";
import { newWorkspaceId, WorkspaceId } from "./workspace-id.ts";

// The maker's ids and pathOf's parameter rule have different owners and must agree: an id the rule refuses makes every
// `/workspaces/:ws` call throw, and only at runtime.
test("every workspace id the maker makes fills a :ws parameter and parses as a WorkspaceId", () => {
  for (let i = 0; i < 2000; i++) {
    const id = newWorkspaceId();
    expect(WorkspaceId.safeParse(id).success, id).toBe(true);
    const path = pathOf(ROUTES.listBinders, { ws: id });
    expect(appRoute(ROUTES.listBinders.method, path), path).toBe(ROUTES.listBinders);
  }
});

describe("appRoute", () => {
  test("takes every page route's path as pathOf builds it, with a query on the routes that take one", () => {
    // A route from the list has no literal pattern for pathOf's types to check params against.
    const build = pathOf as (route: AppRoute, params: Record<string, string>, query?: Record<string, unknown>) => string;
    // Ids as the service lists them: a UUID, and one with every other character a plain segment may have.
    const samples = ["0196f3c2-1a00-7000-8000-0000000000b1", "Agent_2.v1~x"];
    for (const sample of samples) {
      for (const route of APP_ROUTES) {
        const params = Object.fromEntries(
          route.pattern
            .split("/")
            .filter((part) => part.startsWith(":"))
            .map((part) => [part.slice(1), sample]),
        );
        const query = route.query === undefined ? undefined : { after: 12, limit: 100 };
        const path = build(route, params, query);

        expect(appRoute(route.method, path), `${route.method} ${path}`).toBe(route);
      }
    }
  });

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
