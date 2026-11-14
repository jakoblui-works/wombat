// Query-string values read against the API contract, for the service's routes and the shared request schemas.
import { z } from "zod";

/** A whole number from `min` to `max`, from a query-string value (digits only) or a number; `""`, `" "` and repeated keys fail with `message`. */
export const queryInt = (message: string, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)], { error: message })
    .pipe(z.int({ error: message }).min(min, { error: message }).max(max, { error: message }));
