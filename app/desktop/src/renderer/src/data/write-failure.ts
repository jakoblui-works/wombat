// What a refused write comes to, for the forms that show it.
import { ItemWriteErrorCode } from "@wombat/shared/api";
import type { Problem } from "@wombat/shared/items";

import { asError } from "../lib/errors.ts";
import { ServiceError } from "./client.ts";

/** A failed write's problems as the service gave them, else its message as the one problem. */
export const writeProblems = (error: unknown): Problem[] =>
  error instanceof ServiceError && error.problems !== undefined && error.problems.length > 0 ? [...error.problems] : [{ message: asError(error).message }];

/** What a failed item write comes to: "stale" (the file changed since the version it named), else its problems. */
export const writeFailure = (error: unknown): "stale" | Problem[] =>
  error instanceof ServiceError && error.code === ItemWriteErrorCode.enum.stale_version ? "stale" : writeProblems(error);
