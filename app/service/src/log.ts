export type LogFields = Record<string, string | number | boolean>;
/** Service log lines carry ids, states and counts only, never prompts, replies, diffs, tool content or stderr. */
export type Log = (event: string, fields: LogFields) => void;

export const logToStderr: Log = (event, fields) => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
};
