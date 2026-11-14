export type LogFields = Record<string, string | number | boolean>;
/** Service log lines carry ids, states and counts only, never prompts, replies, diffs, tool content or stderr. */
export type Log = (event: string, fields: LogFields) => void;

/** A protocol name (an update kind, a stop reason) fit for a log line; anything else is "unknown". */
export const safeName = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : "unknown");

/** What a log line says of a caught error: its class's name, never its message (which may name files or content). */
export const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

export const logToStderr: Log = (event, fields) => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
};
