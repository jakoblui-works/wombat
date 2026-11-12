// The routes the desktop app's page may call on the service, and the largest body the service takes. The service's
// side is checked by service/src/server/app-routes.test.ts: every route here is served, every app route the
// service serves is here (except the ones only the app's main process calls: /events, /shutdown; and /mcp).

/** One route the app may call; path parameters as `:name`. `query`: the route takes a query string. */
export type AppRoute = { method: "GET" | "POST" | "DELETE"; pattern: string; query?: true };

/** Every route the app's page may call (the bridge's allow-list, checked in main). */
export const APP_ROUTES: readonly AppRoute[] = [
  { method: "GET", pattern: "/version" },
  { method: "GET", pattern: "/harnesses" },
  { method: "GET", pattern: "/repos" },
  { method: "GET", pattern: "/agents" },
  { method: "POST", pattern: "/agents" },
  { method: "GET", pattern: "/agents/:id/log", query: true },
  { method: "POST", pattern: "/agents/:id/messages" },
  { method: "POST", pattern: "/agents/:id/permissions/:requestId" },
  { method: "POST", pattern: "/agents/:id/cancel" },
  { method: "POST", pattern: "/agents/:id/stop" },
  { method: "DELETE", pattern: "/agents/:id" },
  { method: "GET", pattern: "/structures" },
  { method: "GET", pattern: "/structures/:id/items" },
  { method: "GET", pattern: "/items/:handle" },
  { method: "GET", pattern: "/proposals", query: true },
  { method: "POST", pattern: "/proposals/:id/approve" },
  { method: "POST", pattern: "/proposals/:id/reject" },
];

/** The largest request body the service takes, and main lets through. */
export const MAX_BODY_BYTES = 1024 * 1024;

// A path parameter is one plain segment: no percent-encoding (so no encoded `/` or `.`), and never `.` or `..`.
const PARAM = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
// Plain `key=value&…` pairs; the service checks the keys and values themselves.
const QUERY = /^[A-Za-z0-9._~-]+=[A-Za-z0-9._~-]*(&[A-Za-z0-9._~-]+=[A-Za-z0-9._~-]*)*$/;

const matches = (pattern: string, pathname: string): boolean => {
  const want = pattern.split("/");
  const got = pathname.split("/");
  return want.length === got.length && want.every((part, i) => (part.startsWith(":") ? PARAM.test(got[i] ?? "") : part === got[i]));
};

/**
 * The APP_ROUTES entry `method` and `path` (a path with an optional query, as the page sends it) call, or undefined
 * when it's not one: another method, path or origin, extra segments, a parameter that isn't one plain segment, or a
 * query on a route that takes none. A path it accepts is safe to append to the service's origin as is.
 */
export const appRoute = (method: string, path: string): AppRoute | undefined => {
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? undefined : path.slice(queryAt + 1);
  return APP_ROUTES.find(
    (route) =>
      route.method === method && matches(route.pattern, pathname) && (query === undefined || (route.query === true && QUERY.test(query))),
  );
};
