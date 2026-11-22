// The page's one way to call the agent service, over the bridge. The bridge resolves with every status the service
// sends, so the status is checked here; a request the bridge refused rejects with main's message as it is.
import type { z } from "zod";

import { ErrorBody } from "@wombat/shared/api";
import type { Problem } from "@wombat/shared/items";
import { type AppRoute, type PathArgs, type PathParams, pathOf, type QueryOf } from "@wombat/shared/routes";

type ErrorDetail = ErrorBody["error"];

/** A non-2xx answer: its status and the service's error (`code: "unknown"` when the body isn't an ErrorBody). */
export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly problems?: readonly Problem[];

  constructor(status: number, { code, message, hint, problems }: ErrorDetail) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    if (hint !== undefined) this.hint = hint;
    if (problems !== undefined) this.problems = problems;
  }
}

/** Sends one request and returns its 2xx body parsed with `schema`; throws ServiceError for any other status. */
export const call = async <S extends z.ZodType>(method: string, path: string, schema: S, body?: unknown): Promise<z.output<S>> => {
  const answer = await window.wombat.service.request(method, path, body);
  if (answer.status >= 200 && answer.status < 300) return schema.parse(answer.body);
  const error = ErrorBody.safeParse(answer.body);
  throw new ServiceError(
    answer.status,
    error.success
      ? error.data.error
      : {
          code: "unknown",
          message: `The service answered ${method} ${path} with status ${String(answer.status)} and no error the app can read. Try again; if it keeps failing, restart the service.`,
        },
  );
};

type JsonRoute = AppRoute & { response: z.ZodType };

export type RouteRequest<R extends JsonRoute> = ([keyof PathParams<R["pattern"]>] extends [never]
  ? { params?: never }
  : { params: PathParams<R["pattern"]> }) &
  ([QueryOf<R>] extends [never] ? { query?: never } : { query?: QueryOf<R> }) &
  (R extends { body: infer B extends z.ZodType } ? { body: z.input<B> } : { body?: never });

/** `call` on `route`, its answer parsed with `schema` rather than the route's own; rejects when pathOf throws. */
export const callRouteWith = async <R extends JsonRoute, S extends z.ZodType>(route: R, request: RouteRequest<R>, schema: S): Promise<z.output<S>> =>
  call(route.method, pathOf(route, ...([request.params, request.query] as unknown as PathArgs<R>)), schema, request.body);

/** `call` on `route`, its answer parsed with the route's response schema; rejects when pathOf throws. */
export const callRoute = <R extends JsonRoute>(
  route: R,
  ...[request]: object extends RouteRequest<R> ? [request?: RouteRequest<R>] : [request: RouteRequest<R>]
): Promise<z.output<R["response"]>> => callRouteWith<R, R["response"]>(route, request ?? ({} as RouteRequest<R>), route.response);
