import type { AgentErrorCode, ErrorBody, ErrorCode, ItemsErrorCode, ItemWriteErrorCode, ServerErrorCode, WorkspaceErrorCode } from "@wombat/shared/api";
import { Problem } from "@wombat/shared/items";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AgentErrorCodes } from "../agents/errors.ts";
import type { ItemWriteError } from "../items/write.ts";

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
  agent_error: 502,
  unsupported: 409,
};

export const WORKSPACE_STATUS: Record<WorkspaceErrorCode, ContentfulStatusCode> = {
  workspace_not_found: 404,
  invalid_folder: 400,
  workspace_missing: 409,
};

/** A manager call's codes (AgentErrorCodes): the agent ones, `invalid_request`, and its agent's workspace not found or gone. */
export const AGENT_CALL_STATUS: Record<AgentErrorCodes, ContentfulStatusCode> = {
  ...AGENT_STATUS,
  invalid_request: SERVER_STATUS.invalid_request,
  workspace_not_found: WORKSPACE_STATUS.workspace_not_found,
  workspace_missing: WORKSPACE_STATUS.workspace_missing,
};

export const ITEMS_STATUS: Record<ItemsErrorCode, ContentfulStatusCode> = {
  items_not_configured: 409,
  binder_not_found: 404,
  item_not_found: 404,
  items_not_writable: 409,
  proposal_not_found: 404,
  proposal_not_pending: 409,
  proposal_changed: 409,
};

const ITEM_WRITE_STATUS: Record<ItemWriteErrorCode, ContentfulStatusCode> = {
  stale_version: 409,
  invalid_fields: 400,
  item_not_found: ITEMS_STATUS.item_not_found,
  binder_not_found: ITEMS_STATUS.binder_not_found,
  field_not_writable: 400,
  items_not_writable: ITEMS_STATUS.items_not_writable,
};

/** An ErrorBody response: every refusal and failure the service sends has this shape. Problems go out with only the shared Problem's keys. */
export const errorResponse = (
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  hint?: string,
  problems?: readonly Problem[],
) => {
  const body: ErrorBody = {
    error: {
      code,
      message,
      ...(hint === undefined ? {} : { hint }),
      ...(problems === undefined ? {} : { problems: problems.map((problem) => Problem.parse(problem)) }),
    },
  };
  return c.json(body, status);
};

/** The Writer's refusal as a response, its message and problems verbatim: every route that writes items answers with this. */
export const itemWriteResponse = (c: Context, error: ItemWriteError) =>
  errorResponse(c, ITEM_WRITE_STATUS[error.code], error.code, error.message, undefined, error.problems.length > 0 ? error.problems : undefined);
