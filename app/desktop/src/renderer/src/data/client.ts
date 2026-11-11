// The page's one way to call the agent service, over the bridge. The bridge resolves with every status the service
// sends, so the status is checked here; a request the bridge refused rejects with main's message as it is.
import type { z } from "zod";

import { ErrorBody } from "@wombat/shared/api";

type ErrorDetail = ErrorBody["error"];

/** A non-2xx answer: its status and the service's error (`code: "unknown"` when the body isn't an ErrorBody). */
export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;

  constructor(status: number, { code, message, hint }: ErrorDetail) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    if (hint !== undefined) this.hint = hint;
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
