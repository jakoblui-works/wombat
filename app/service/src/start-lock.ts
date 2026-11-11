// One service per runtime dir. Start-up takes `service.lock` beside the discovery file before anything else that
// matters: before the port probe, the store (SQLite refuses a second writer) and the manager (which stops the
// agents' slice). The holder writes the discovery file only once its server listens and keeps the lock until its
// store is closed, so a start that finds the lock held waits for the discovery file naming the holder, and a
// start that takes the lock knows no other service is running or still shutting down.
//
// The lock names its holder by pid and the process's start time (from /proc), so a pid reused by another program
// never passes for a live holder. A lock whose holder is gone (killed, crashed) is taken over; see takeOver for
// why that is race-free when several starts find the same dead holder at once.
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { findRunningService, HOLDER_WAIT_MS, type DiscoveryFile } from "@wombat/shared/discovery";
import { createPrivateFile, writePrivateFile } from "@wombat/shared/private-file";

import { isAlreadyThere, isMissing, isProcessGone } from "./errno.ts";

const LOCK_FILE = "service.lock";
const POLL_MS = 50;

type Holder = { pid: number; start: string };

/** The process's start time in clock ticks since boot; undefined once it's gone or a zombie. */
const startTimeOf = (pid: number): string | undefined => {
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

const ownLine = () => {
  const start = startTimeOf(process.pid);
  if (start === undefined) {
    throw new Error("The service can't read its own start time from /proc. Run it on Linux with /proc mounted.");
  }
  return `${String(process.pid)} ${start}\n`;
};

const parseHolder = (text: string): Holder | undefined => {
  const match = /^(\d+) (\d+)\n$/.exec(text);
  return match?.[1] === undefined || match[2] === undefined ? undefined : { pid: Number(match[1]), start: match[2] };
};

/** An unreadable lock (edited by hand) has no live holder. */
const isAlive = (holder: Holder | undefined) => holder !== undefined && startTimeOf(holder.pid) === holder.start;

type Seen = { ino: number; text: string; holder: Holder | undefined };

/** The lock's content and inode, read through one descriptor so both belong to the same file; undefined when it's gone. */
const readLock = (path: string): Seen | undefined => {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  try {
    const text = readFileSync(fd, "utf8");
    return { ino: fstatSync(fd).ino, text, holder: parseHolder(text) };
  } finally {
    closeSync(fd);
  }
};

/**
 * Replaces the lock `seen` (whose holder is gone) with ours; false when another start is taking it over or it
 * changed since it was read, so the caller looks again.
 *
 * Replacing a file only if it's still the one read can't be done in one step, so the replacement is guarded by a
 * marker named after the dead lock's inode, created exclusively: only the start holding the marker for that lock
 * may replace it. Nothing else replaces a lock that exists (a fresh lock is only ever created with an exclusive
 * link, and a holder removes only its own), so a lock that still has that inode after the marker is taken is
 * still the dead one. A start that died holding a marker is skipped by trying the next number.
 */
const takeOver = (path: string, seen: Seen, line: string): boolean => {
  const prefix = `${basename(path)}.takeover-${String(seen.ino)}-`;
  for (let attempt = 0; ; attempt += 1) {
    const marker = join(dirname(path), `${prefix}${String(attempt)}`);
    try {
      createPrivateFile(marker, line);
    } catch (error) {
      if (!isAlreadyThere(error)) throw error;
      const taker = readLock(marker);
      if (taker === undefined || isAlive(taker.holder)) return false;
      continue;
    }
    let replaced = false;
    try {
      const now = readLock(path);
      if (now?.ino === seen.ino && !isAlive(now.holder)) {
        writePrivateFile(path, line);
        replaced = true;
      }
    } finally {
      // Markers for a replaced lock are spent: a start that makes one later finds another inode and backs off.
      const spent = replaced ? readdirSync(dirname(path)).filter((name) => name.startsWith(prefix)) : [basename(marker)];
      for (const name of spent) rmSync(join(dirname(path), name), { force: true });
    }
    return replaced;
  }
};

export type StartLock =
  /** This process holds the lock; release() removes it (call it once the store is closed). */
  | { held: true; release: () => void }
  /** Another service holds it and is listening. */
  | { held: false; running: DiscoveryFile };

/** The lock is held by a live service that didn't write its discovery file in time (or already removed it to stop). */
export class LockHeld extends Error {
  constructor(lockPath: string, pid: number | undefined, waitMs: number) {
    const who = pid === undefined ? "Another Wombat service" : `Another Wombat service (pid ${String(pid)})`;
    const stop = pid === undefined ? "" : ` (or stop it with kill ${String(pid)} first)`;
    super(
      `${who} holds the start lock ${lockPath} but isn't listening after ${String(waitMs / 1000)} s: it is still ` +
        `starting or stopping. Start the service again once it has finished${stop}.`,
    );
    this.name = "LockHeld";
  }
}

/**
 * Takes `service.lock` beside the discovery file, or, when a live service holds it, waits up to `waitMs` for
 * that service's discovery file and returns it. Throws LockHeld when the holder doesn't write it in time.
 */
export const takeStartLock = async (
  discoveryPath: string,
  { waitMs = HOLDER_WAIT_MS }: { waitMs?: number } = {},
): Promise<StartLock> => {
  const path = join(dirname(discoveryPath), LOCK_FILE);
  const line = ownLine();
  const held: StartLock = {
    held: true,
    // Only while the lock is still ours: no one replaces a live holder's lock, so it can't change in between.
    release: () => {
      if (readLock(path)?.text === line) rmSync(path, { force: true });
    },
  };
  const deadline = Date.now() + waitMs;
  let lastHolder: number | undefined;
  for (;;) {
    try {
      createPrivateFile(path, line);
      return held;
    } catch (error) {
      if (!isAlreadyThere(error)) throw error;
    }
    const seen = readLock(path);
    // Released since the create failed: try again at once.
    if (seen === undefined) continue;
    if (!isAlive(seen.holder)) {
      if (takeOver(path, seen, line)) return held;
    } else if (seen.holder) {
      lastHolder = seen.holder.pid;
      // The file names the holder only once it listens; a file left by a killed service names another pid.
      const running = await findRunningService(discoveryPath, { timeoutMs: Math.max(POLL_MS, deadline - Date.now()) });
      if (running?.pid === seen.holder.pid) return { held: false, running };
    }
    if (Date.now() > deadline) throw new LockHeld(path, lastHolder, waitMs);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
};
