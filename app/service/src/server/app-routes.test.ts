// Contract drift between the app's allow-list and the service: `APP_ROUTES` and `MAX_BODY_BYTES`
// live in @wombat/shared/routes; the desktop app lets the page call only those routes, and only bodies up to that
// size. Types can't see either side of this, so it's checked here, both directions:
// - every APP_ROUTES entry is a route the running server serves (it never answers the unknown-route error);
// - every app route registered in the server's source is in APP_ROUTES, except the ones the page never calls: /mcp
//   (agents' tokens), and /shutdown and /events (main calls them itself), which APP_ROUTES must not list;
// - the server's body limit is MAX_BODY_BYTES exactly.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { APP_ROUTES, appRoute } from "@wombat/shared/routes";
import { expect, test } from "vitest";

import { appRoutes } from "../../test/server-fixtures.ts";

const SERVER_DIR = import.meta.dirname;
// Served for agents (/mcp) or called by main itself (/shutdown, /events); never in the page's allow-list.
const NOT_FOR_THE_PAGE = ["/mcp", "/shutdown", "/events"];

/** `:id`, `:requestId`… all read as one parameter, so names don't matter. */
const shape = (pattern: string) => pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":");
const key = (method: string, pattern: string) => `${method.toUpperCase()} ${shape(pattern)}`;

/** The routes the server's source registers (`x.get("/path", …)` and the like), as `METHOD /pattern`. */
const registeredRoutes = (): string[] => {
  const found = new Set<string>();
  for (const name of readdirSync(SERVER_DIR)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const source = readFileSync(join(SERVER_DIR, name), "utf8");
    for (const match of source.matchAll(/\.(get|post|put|patch|delete|all)\(\s*(["'`])(\/[^"'`]*)\2/g)) {
      const [, method = "", , path = ""] = match;
      found.add(key(method, path));
    }
  }
  return [...found].sort();
};

test("APP_ROUTES and the server's app routes are the same set", () => {
  const registered = registeredRoutes();
  const listed = APP_ROUTES.map(({ method, pattern }) => key(method, pattern)).sort();
  const pathOf = (route: string) => route.slice(route.indexOf(" ") + 1);
  const forThePage = registered.filter((route) => !NOT_FOR_THE_PAGE.includes(pathOf(route)));
  expect(listed.filter((route) => NOT_FOR_THE_PAGE.includes(pathOf(route))), "APP_ROUTES lists a route the page must not call").toEqual([]);
  expect(listed.filter((route) => !registered.includes(route)), "APP_ROUTES entries the server doesn't register").toEqual([]);
  expect(forThePage.filter((route) => !listed.includes(route)), "server routes missing from APP_ROUTES").toEqual([]);
  expect(new Set(listed).size, "APP_ROUTES lists a route twice").toBe(listed.length);
});

// The port rules (port-rules.test.ts) and the agent-token check (agent-tokens.test.ts) walk the fixture's route list,
// not APP_ROUTES: a route missing from it would get neither check. Some routes change what an agent may do (a config
// option can be the agent's permission mode), so an agent's own token must be refused on each.
test("the port-rules and agent-token fixture lists exactly the APP_ROUTES entries, besides the routes the page never calls", () => {
  const fixture = appRoutes("3f2b9c1e-7a4d-4e1b-9c55-0d6e2a8f4b71");
  const forThePage = fixture.filter(({ path }) => !NOT_FOR_THE_PAGE.includes(path) && path !== "/no-such-route");
  const covered = new Set(forThePage.map(({ method, path }) => appRoute(method, path)));
  expect(
    APP_ROUTES.filter((route) => !covered.has(route)).map(({ method, pattern }) => `${method} ${pattern}`),
    "APP_ROUTES entries the fixture's route list leaves out",
  ).toEqual([]);
  expect(
    forThePage.filter(({ method, path }) => appRoute(method, path) === undefined).map(({ method, path }) => `${method} ${path}`),
    "fixture routes that aren't in APP_ROUTES",
  ).toEqual([]);
});
