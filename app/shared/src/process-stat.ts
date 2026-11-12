/// <reference types="node" />
// Node-only, Linux-only. Whether a process is alive, and when it started, from /proc/<pid>/stat: the service's start
// lock names its holder by both (so a reused pid never passes for it), and the app waits on them for a stopped
// service to exit.
import { readFileSync } from "node:fs";

import { isProcessGone } from "./errno.ts";

/**
 * The process's start time in clock ticks since boot; undefined once it's gone or a zombie (a zombie has exited: only
 * its parent hasn't collected it yet). Throws when /proc can't be read for another reason.
 */
export const startTimeOf = (pid: number): string | undefined => {
  let text: string;
  try {
    text = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
  } catch (error) {
    if (isProcessGone(error)) return undefined;
    throw error;
  }
  // The command name (field 2) is in parentheses and may hold spaces; the fields after it start with the state
  // (field 3), so the start time (field 22) is the 20th.
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return fields[0] === "Z" ? undefined : fields[19];
};

/** False once `pid` has exited (a zombie counts as exited); throws as startTimeOf does. */
export const isAlive = (pid: number): boolean => startTimeOf(pid) !== undefined;
