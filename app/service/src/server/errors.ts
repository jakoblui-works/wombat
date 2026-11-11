import type { ErrorBody, ErrorCode } from "@wombat/shared/api";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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
