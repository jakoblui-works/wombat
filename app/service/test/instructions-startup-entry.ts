// Spawned by instructions-startup.test.ts: instructions-entry.ts (the real `main()` with the recording fake
// harnesses), with two hooks on the filesystem edge installed first. The start-up render's first read of the items
// root is held back a while, so a service that took agents before its render finished would show it every run;
// and when the discovery file is put in place (the moment the app can find the service and start agents), what
// `<workspace>/.wombat/AGENTS.md` holds then is recorded to $WOMBAT_TEST_STARTUP_LOG, one JSON line per event.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { INSTRUCTIONS_FILE } from "../src/items/instructions.ts";

/** How long the start-up render's first read waits: far longer than the rest of start-up takes. Not a tuning value. */
const HOLD_MS = 750;

const { WOMBAT_TEST_STARTUP_LOG: logPath, WOMBAT_ITEMS: itemsRoot, WOMBAT_WORKSPACE: workspace, XDG_RUNTIME_DIR: runtimeDir } = process.env;
if (!logPath || !itemsRoot || !workspace || !runtimeDir) {
  throw new Error("instructions-startup-entry needs WOMBAT_TEST_STARTUP_LOG, WOMBAT_ITEMS, WOMBAT_WORKSPACE and XDG_RUNTIME_DIR");
}
const record = (event: Record<string, unknown>) => appendFileSync(logPath, `${JSON.stringify(event)}\n`);
const instructionsPath = join(workspace, INSTRUCTIONS_FILE);
const discoveryPath = join(runtimeDir, "wombat", "service.json");
const instructionsNow = () => (existsSync(instructionsPath) ? readFileSync(instructionsPath, "utf8") : null);

const require = createRequire(import.meta.url);
const fs = require("node:fs") as typeof import("node:fs");
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

/** Records AGENTS.md as it is when the discovery file lands, by whichever rename puts it there. */
const atDiscovery = (to: unknown) => {
  if (resolve(String(to)) === discoveryPath) record({ event: "discovery_written", instructions: instructionsNow() });
};
const renameSync = fs.renameSync;
fs.renameSync = (from: Parameters<typeof renameSync>[0], to: Parameters<typeof renameSync>[1]) => {
  renameSync(from, to);
  atDiscovery(to);
};
const rename = fsp.rename;
fsp.rename = async (from: Parameters<typeof rename>[0], to: Parameters<typeof rename>[1]) => {
  await rename(from, to);
  atDiscovery(to);
};
syncBuiltinESMExports();

await import("./instructions-entry.ts");
