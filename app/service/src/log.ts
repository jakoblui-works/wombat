export type LogFields = Record<string, string | number | boolean>;
/** Service log lines carry ids, states and counts only, never prompts, replies, diffs, tool content or stderr. */
export type Log = (event: string, fields: LogFields) => void;

/** A protocol name (an update kind, a stop reason) fit for a log line; anything else is "unknown". */
export const safeName = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : "unknown");

export const logToStderr: Log = (event, fields) => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
};
