// Reading a request against the API contract, and checking a response against it, for every route module.
import type { Problem } from "@wombat/shared/items";
import type { Context } from "hono";
import type { z } from "zod";

/** Thrown by a route on a request that breaks the contract; answered with invalid_request, with `problems` when given. */
export class InvalidRequest extends Error {
  readonly problems: readonly Problem[] | undefined;

  constructor(message: string, problems?: readonly Problem[]) {
    super(message);
    this.problems = problems;
  }
}

const describeIssues = (error: z.ZodError) =>
  error.issues
    .map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`))
    .join("; ");

/**
 * The request body as JSON, whatever its Content-Type says, checked against `schema`. An empty body reads as `{}`
 * where the schema takes `{}` (every field optional).
 */
export const readBody = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> => {
  const text = await c.req.text();
  let json: unknown;
  try {
    json = text === "" && schema.safeParse({}).success ? {} : JSON.parse(text);
  } catch {
    throw new InvalidRequest("The request body isn't JSON. Send a JSON object as described in the API contract.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidRequest(
      `The request body doesn't match the API contract (${describeIssues(parsed.error)}). Fix it and send it again.`,
    );
  }
  return parsed.data;
};

/** Every value of every query key: a repeated key stays an array, so the strict query schema refuses it. */
const queryValues = (c: Context) =>
  Object.fromEntries(
    Object.entries(c.req.queries()).map(([key, values]) => [key, values.length === 1 ? values[0] : values]),
  );

/** The query checked against `schema`. */
export const readQuery = <T extends z.ZodType>(c: Context, schema: T): z.output<T> => {
  const parsed = schema.safeParse(queryValues(c));
  if (!parsed.success) {
    throw new InvalidRequest(`The query doesn't match the API contract (${describeIssues(parsed.error)}). Fix it and send it again.`);
  }
  return parsed.data;
};

/** Checked against the shared schema before it goes out, so a drift fails here and not in the app. */
export const checked = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => schema.parse(value);
