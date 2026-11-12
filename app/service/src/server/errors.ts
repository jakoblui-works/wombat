import type { AgentErrorCode, ErrorBody, ErrorCode, ItemsErrorCode, ServerErrorCode } from "@wombat/shared/api";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** The HTTP status each code family's codes are sent with; routes look a status up here, never spell one. */
export const SERVER_STATUS: Record<ServerErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden_origin: 403,
  forbidden_host: 403,
  payload_too_large: 413,
  invalid_request: 400,
  not_found: 404,
  method_not_allowed: 405,
  internal_error: 500,
};

export const AGENT_STATUS: Record<AgentErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  busy: 409,
  not_running: 409,
  kind_not_offered: 422,
  unknown_harness: 422,
  repo_not_found: 422,
  repo_outside_workspace: 422,
  auth_required: 502,
  agent_failed: 502,
};

/** No route sends `items_not_writable` yet: a writer failure on approve falls through to `internal_error`. */
export const ITEMS_STATUS: Record<ItemsErrorCode, ContentfulStatusCode> = {
  items_not_configured: 409,
  structure_not_found: 404,
  item_not_found: 404,
  items_not_writable: 500,
  proposal_not_found: 404,
  proposal_not_pending: 409,
};

/** An ErrorBody response: every refusal and failure the service sends has this shape. */
export const errorResponse = (
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  hint?: string,
) => {
  const body: ErrorBody = { error: { code, message, ...(hint === undefined ? {} : { hint }) } };
  return c.json(body, status);
};
