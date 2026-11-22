// The service's routes the app calls, each with its schemas, and the page's allow-list among them. The service's
// side is checked by service/src/server/app-routes.test.ts: every route on the allow-list is served, every app route
// the service serves is on it (except MAIN_ROUTES, which only the app's main process calls, and /mcp).
import type { z } from "zod";

import {
  AddWorkspaceRequest,
  AgentSummary,
  AnswerPermissionRequest,
  ContextBreakdown,
  CreateItemRequest,
  DeleteItemQuery,
  GetItemResponse,
  ListAgentsResponse,
  ListBindersResponse,
  ListHarnessesResponse,
  ListItemsResponse,
  ListLogQuery,
  ListLogResponse,
  ListReposResponse,
  ListWorkspacesResponse,
  NewBinderRequest,
  NoContent,
  SendMessageRequest,
  SendMessageResponse,
  SetConfigRequest,
  SetItemsRootRequest,
  ShutdownResponse,
  StartAgentRequest,
  UpdateItemRequest,
  VersionResponse,
  Workspace,
} from "./api.ts";
import { BinderSummary } from "./items.ts";
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
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType | "stream";
};

const PAGE_ROUTES = {
  version: { method: "GET", pattern: "/version", response: VersionResponse },
  listHarnesses: { method: "GET", pattern: "/harnesses", response: ListHarnessesResponse },
  listWorkspaces: { method: "GET", pattern: "/workspaces", response: ListWorkspacesResponse },
  listRepos: { method: "GET", pattern: "/workspaces/:ws/repos", response: ListReposResponse },
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
  listBinders: { method: "GET", pattern: "/workspaces/:ws/binders", response: ListBindersResponse },
  createBinder: { method: "POST", pattern: "/workspaces/:ws/binders", body: NewBinderRequest, response: BinderSummary },
  binderItems: { method: "GET", pattern: "/workspaces/:ws/binders/:id/items", response: ListItemsResponse },
  getItem: { method: "GET", pattern: "/workspaces/:ws/items/:ref", response: GetItemResponse },
  createItem: { method: "POST", pattern: "/workspaces/:ws/binders/:id/items", body: CreateItemRequest, response: GetItemResponse },
  updateItem: { method: "PATCH", pattern: "/workspaces/:ws/items/:ref", body: UpdateItemRequest, response: GetItemResponse },
  deleteItem: { method: "DELETE", pattern: "/workspaces/:ws/items/:ref", query: DeleteItemQuery, response: NoContent },
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
  // They take a folder path, which only main may send: a page script mustn't point an agent at any folder it names.
  addWorkspace: { method: "POST", pattern: "/workspaces", body: AddWorkspaceRequest, response: Workspace },
  setItemsRoot: { method: "PUT", pattern: "/workspaces/:ws/items-root", body: SetItemsRootRequest, response: Workspace },
} as const satisfies Record<string, AppRoute>;

const disjoint = <A extends object, B extends object>(a: A, b: B & Partial<Record<keyof A, never>>): A & B => ({ ...a, ...b });

/** Every route the app calls, by name: build its path with pathOf. */
export const ROUTES = disjoint(PAGE_ROUTES, MAIN_ROUTES);

/** The routes only main calls, never on the page's allow-list. */
export const MAIN_ONLY_ROUTES: readonly AppRoute[] = Object.values(MAIN_ROUTES);

/** Every route the app's page may call (the bridge's allow-list, checked in main). */
export const APP_ROUTES: readonly AppRoute[] = Object.values(PAGE_ROUTES);

type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<Rest>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

export type PathParams<P extends string> = { readonly [Name in ParamNames<P>]: string };

export type QueryOf<R extends AppRoute> = R extends { query: infer Q extends z.ZodType } ? z.input<Q> : never;

export type ResponseOf<R extends AppRoute> = R["response"] extends z.ZodType ? z.output<R["response"]> : never;

export type PathArgs<R extends AppRoute> = [ParamNames<R["pattern"]>] extends [never]
  ? [params?: Record<string, never>, query?: QueryOf<R>]
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
          `${route.method} ${route.pattern} wasn't sent: its ${part.slice(1)} "${value}" isn't one plain path segment (letters, digits, ., _, ~ or -, and not "." or ".."). Use the ${part.slice(1)} as the service listed it.`,
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
