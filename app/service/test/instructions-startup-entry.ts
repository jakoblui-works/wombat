// Spawned by instructions-startup.test.ts: instructions-entry.ts (the real `main()` with the recording fake
// harnesses), with one hook on the filesystem edge installed first. The first read of the items root (the render when
// the test adds the workspace) is held back a while, so a service that answered the add, or started an agent of that
// workspace, before its render finished would show it every run. The hold is recorded to $WOMBAT_TEST_STARTUP_LOG,
// one JSON line per event.
import { appendFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** How long the render's first read waits: far longer than the rest of the add takes. Not a tuning value. */
const HOLD_MS = 750;

const { WOMBAT_TEST_STARTUP_LOG: logPath, WOMBAT_TEST_HOLD_ITEMS: itemsRoot } = process.env;
if (!logPath || !itemsRoot) throw new Error("instructions-startup-entry needs WOMBAT_TEST_STARTUP_LOG and WOMBAT_TEST_HOLD_ITEMS");
const record = (event: Record<string, unknown>) => appendFileSync(logPath, `${JSON.stringify(event)}\n`);

const require = createRequire(import.meta.url);
const fsp = require("node:fs/promises") as typeof import("node:fs/promises");

const readdir = fsp.readdir;
let held = false;
fsp.readdir = (async (path: Parameters<typeof readdir>[0], ...rest: unknown[]) => {
  if (!held && (resolve(String(path)) === resolve(itemsRoot) || resolve(String(path)).startsWith(resolve(itemsRoot) + sep))) {
    held = true;
    record({ event: "render_held" });
    await delay(HOLD_MS);
  }
  return (readdir as (...args: unknown[]) => unknown)(path, ...rest);
}) as typeof readdir;
syncBuiltinESMExports();

await import("./instructions-entry.ts");
