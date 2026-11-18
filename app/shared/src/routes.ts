// The service's routes the app calls, each with its schemas, and the page's allow-list among them. The service's
// side is checked by service/src/server/app-routes.test.ts: every route on the allow-list is served, every app route
// the service serves is on it (except the ones only the app's main process calls: /events, /shutdown; and /mcp).
import type { z } from "zod";

import {
  AgentSummary,
  AnswerPermissionRequest,
  ContextBreakdown,
  GetItemResponse,
  ListAgentsResponse,
  ListBindersResponse,
  ListHarnessesResponse,
  ListItemsResponse,
  ListLogQuery,
  ListLogResponse,
  ListReposResponse,
  NoContent,
  SendMessageRequest,
  SendMessageResponse,
  SetConfigRequest,
  ShutdownResponse,
  StartAgentRequest,
  VersionResponse,
} from "./api.ts";
import {
  ApproveRequest,
  DraftRequest,
  ListProposalsQuery,
  ListProposalsResponse,
  ProposalDetail,
  ProposalDetailQuery,
  Proposal,
  RejectRequest,
} from "./proposals.ts";

export { MAX_BODY_BYTES } from "./api.ts";

/**
 * One route of the service; path parameters as `:name`. `query`, `body`: the schemas of the query string and the
 * request body it takes, if any. `response`: the schema of a 2xx body, or "stream" for an event stream.
 */
export type AppRoute = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: string;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType | "stream";
};

const PAGE_ROUTES = {
  version: { method: "GET", pattern: "/version", response: VersionResponse },
  listHarnesses: { method: "GET", pattern: "/harnesses", response: ListHarnessesResponse },
  listRepos: { method: "GET", pattern: "/repos", response: ListReposResponse },
  listAgents: { method: "GET", pattern: "/agents", response: ListAgentsResponse },
  startAgent: { method: "POST", pattern: "/agents", body: StartAgentRequest, response: AgentSummary },
  agentLog: { method: "GET", pattern: "/agents/:id/log", query: ListLogQuery, response: ListLogResponse },
  sendMessage: { method: "POST", pattern: "/agents/:id/messages", body: SendMessageRequest, response: SendMessageResponse },
  answerPermission: { method: "POST", pattern: "/agents/:id/permissions/:requestId", body: AnswerPermissionRequest, response: NoContent },
  setConfig: { method: "POST", pattern: "/agents/:id/config", body: SetConfigRequest, response: NoContent },
  contextBreakdown: { method: "POST", pattern: "/agents/:id/context", response: ContextBreakdown },
  cancelTurn: { method: "POST", pattern: "/agents/:id/cancel", response: NoContent },
  stopAgent: { method: "POST", pattern: "/agents/:id/stop", response: NoContent },
  deleteAgent: { method: "DELETE", pattern: "/agents/:id", response: NoContent },
  listBinders: { method: "GET", pattern: "/binders", response: ListBindersResponse },
  binderItems: { method: "GET", pattern: "/binders/:id/items", response: ListItemsResponse },
  getItem: { method: "GET", pattern: "/items/:handle", response: GetItemResponse },
  listProposals: { method: "GET", pattern: "/proposals", query: ListProposalsQuery, response: ListProposalsResponse },
  getProposal: { method: "GET", pattern: "/proposals/:id", query: ProposalDetailQuery, response: ProposalDetail },
  saveDraft: { method: "PUT", pattern: "/proposals/:id/draft", body: DraftRequest, response: Proposal },
  clearDraft: { method: "DELETE", pattern: "/proposals/:id/draft", response: Proposal },
  approveProposal: { method: "POST", pattern: "/proposals/:id/approve", body: ApproveRequest, response: Proposal },
  rejectProposal: { method: "POST", pattern: "/proposals/:id/reject", body: RejectRequest, response: Proposal },
} as const satisfies Record<string, AppRoute>;

const MAIN_ROUTES = {
  events: { method: "GET", pattern: "/events", response: "stream" },
  shutdown: { method: "POST", pattern: "/shutdown", response: ShutdownResponse },
} as const satisfies Record<string, AppRoute>;

/** Every route the app calls, by name: build its path with pathOf. */
export const ROUTES = { ...PAGE_ROUTES, ...MAIN_ROUTES };

/** Every route the app's page may call (the bridge's allow-list, checked in main). */
export const APP_ROUTES: readonly AppRoute[] = Object.values(PAGE_ROUTES);

type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<Rest>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

/** The values of a pattern's `:name` segments. */
export type PathParams<P extends string> = { readonly [Name in ParamNames<P>]: string };

/** The query a route takes, as its schema reads it; never for a route that takes none. */
export type QueryOf<R extends AppRoute> = R extends { query: infer Q extends z.ZodType } ? z.input<Q> : never;

/** pathOf's arguments after the route: the params, optional when the pattern has none, then the query. */
export type PathArgs<R extends AppRoute> = [ParamNames<R["pattern"]>] extends [never]
  ? [params?: PathParams<R["pattern"]>, query?: QueryOf<R>]
  : [params: PathParams<R["pattern"]>, query?: QueryOf<R>];

// A path parameter is one plain segment: no percent-encoding (so no encoded `/` or `.`), and never `.` or `..`.
const PARAM = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
// Plain `key=value&…` pairs; the service checks the keys and values themselves.
const QUERY = /^[A-Za-z0-9._~-]+=[A-Za-z0-9._~-]*(&[A-Za-z0-9._~-]+=[A-Za-z0-9._~-]*)*$/;

/**
 * `route`'s path with `params` in its `:name` segments and `query` (its undefined values left out) after it, as
 * appRoute takes it. Throws when a parameter isn't one plain segment or a query value isn't plain: nothing encodes them.
 */
export const pathOf = <R extends AppRoute>(route: R, ...[params, query]: PathArgs<R>): string => {
  const values: Readonly<Record<string, string>> = params ?? {};
  const pathname = route.pattern
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part;
      const value = values[part.slice(1)] ?? "";
      if (!PARAM.test(value)) {
        throw new Error(
          `${route.method} ${route.pattern} can't be called with ${part.slice(1)} "${value}": a path parameter must be letters, digits, ., _, ~ or -, and not "." or "..". Rename it to one that is.`,
        );
      }
      return value;
    })
    .join("/");
  const pairs = Object.entries((query ?? {}) as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
  if (pairs === "") return pathname;
  if (!QUERY.test(pairs)) {
    throw new Error(`${route.method} ${route.pattern} can't be called with the query ${pairs}: its keys and values must be letters, digits, ., _, ~ or -. Send plain values.`);
  }
  return `${pathname}?${pairs}`;
};

/** The method and path of a call to `route`, its path built with pathOf (and throwing as it does). */
export const requestTo = <R extends AppRoute>(route: R, ...args: PathArgs<R>): { method: R["method"]; path: string } => ({
  method: route.method,
  path: pathOf(route, ...args),
});

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
      route.method === method &&
      matches(route.pattern, pathname) &&
      (query === undefined || (route.query !== undefined && QUERY.test(query))),
  );
};
