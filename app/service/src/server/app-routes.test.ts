// Contract drift between the app's allow-list and the service (interface-S3, T6): `APP_ROUTES` and `MAX_BODY_BYTES`
// live in @wombat/shared/routes; the desktop app lets the page call only those routes, and only bodies up to that
// size. Types can't see either side of this, so it's checked here, both directions:
// - every APP_ROUTES entry is a route the running server serves (it never answers the unknown-route error);
// - every app route registered in the server's source is in APP_ROUTES, except the ones the page never calls: /mcp
//   (agents' tokens), and /shutdown and /events (main calls them itself), which APP_ROUTES must not list;
// - the server's body limit is MAX_BODY_BYTES exactly.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorBody } from "@wombat/shared/api";
import { APP_ROUTES, appRoute, MAX_BODY_BYTES } from "@wombat/shared/routes";
import { expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { appRoutes, expectError, serve } from "../../test/server-fixtures.ts";

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

test(
  "every APP_ROUTES entry is served: none gets the unknown-route answer",
  async () => {
    const s = await serve();
    expect(APP_ROUTES.length, "APP_ROUTES is empty").toBeGreaterThan(0);
    // The service answers `not_found` both for an unknown route and for an unknown agent, so the agent routes get a
    // real agent: then `not_found` can only mean the route isn't served. (Bodies are left out: a route that reads
    // one answers invalid_request before it looks at any id. The items and proposal routes answer
    // items_not_configured on this server whatever their ids.)
    const started = await s.api("POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started.status, started.text).toBe(201);
    const agentId = (started.json as { id: string }).id;
    const concrete = (pattern: string) =>
      pattern.startsWith("/agents/:")
        ? pattern.replace(/^\/agents\/:[A-Za-z_][A-Za-z0-9_]*/, `/agents/${agentId}`).replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "x1")
        : pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "x1");
    // Main-only routes (/shutdown, /events) aren't listed (checked above), so none of these ends the agents or
    // streams. DELETE last: it removes the agent the others need.
    const ordered = [...APP_ROUTES].sort((a, b) => Number(a.method === "DELETE") - Number(b.method === "DELETE"));
    const unserved: string[] = [];
    for (const { method, pattern } of ordered) {
      const path = concrete(pattern);
      const response = await s.api(method, path);
      const body = ErrorBody.safeParse(response.json);
      if (body.success && body.data.error.code === "not_found") unserved.push(`${method} ${pattern} (as ${path}): ${response.text}`);
    }
    expect(unserved, "APP_ROUTES entries the server answers as unknown routes").toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

test(
  "the server's body limit is MAX_BODY_BYTES: a body of exactly that size is taken, one byte more is refused",
  async () => {
    const s = await serve();
    const body = (size: number) => {
      const shell = '{"text":""}';
      return `{"text":"${"a".repeat(size - shell.length)}"}`;
    };
    const messages = "/agents/no-such-agent/messages";
    const atCap = await s.api("POST", messages, body(MAX_BODY_BYTES), { "content-type": "application/json" });
    expect(atCap.status, `a body of MAX_BODY_BYTES: ${atCap.text.slice(0, 200)}`).not.toBe(413);
    expectError(await s.api("POST", messages, body(MAX_BODY_BYTES + 1), { "content-type": "application/json" }), 413, "payload_too_large", "MAX_BODY_BYTES + 1");
  },
  TEST_TIMEOUT_MS,
);
