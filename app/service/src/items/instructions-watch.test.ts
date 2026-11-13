// The items-root watcher behind the instructions file: a burst of file changes gives one write after the debounce,
// and the watch recovers when the root itself is replaced.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { INSTRUCTIONS_FILE, openInstructions } from "./instructions.ts";
import { openItems, writeAt, writeRoot } from "../../test/items-fixtures.ts";

const SETTINGS = "version: 1\nid: rules\nname: Rules\nprefix: RUL\naccess: read\ninstructions: full\n";
const rule = (n: number) => `---\nid: 0196f3c2-9e00-7000-8000-${String(n).padStart(12, "0")}\nhandle: RUL-${n}\n---\n# Rule ${n}\n`;

/** Tolerance on top of the debounce for fs.watch to report the changes; not a tuning value. */
const SETTLE_MS = 1_000;
/** Short waits in place of the real ones (seconds); the watcher's behaviour doesn't depend on their length. */
const TIMING = { debounceMs: 20, rootCheckMs: 50, watchRestartMs: 50 };

test("after the items root is removed and put back (a re-clone), hand edits reach the file again", async () => {
  const root = writeRoot({ "rules/_structure.yaml": SETTINGS, "rules/RUL-1-a.md": rule(1) });
  const workspaceRoot = mkdtempSync(join(tmpdir(), "wombat-workspace-"));
  onTestFinished(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const { catalog } = openItems(root);
  const events: string[] = [];
  const instructions = openInstructions({ catalog, workspaceRoot, itemsRoot: root, log: (event) => events.push(event), timing: TIMING });
  onTestFinished(() => instructions.close());
  await instructions.refresh();
  instructions.watch();
  const file = join(workspaceRoot, INSTRUCTIONS_FILE);

  rmSync(root, { recursive: true });
  mkdirSync(root);
  writeAt(root, "rules/_structure.yaml", SETTINGS);
  writeAt(root, "rules/RUL-1-a.md", `${rule(1)}\nFrom the re-clone.\n`);
  // The edit comes once the watch is back and its catch-up write is in the file, so only the new watch can carry it.
  await expect
    .poll(() => events.includes("instructions_watch_restarted"), { timeout: TIMING.rootCheckMs + TIMING.watchRestartMs + SETTLE_MS })
    .toBe(true);
  await expect.poll(() => readFileSync(file, "utf8"), { timeout: TIMING.debounceMs + SETTLE_MS }).toContain("From the re-clone.");

  writeAt(root, "rules/RUL-1-a.md", `${rule(1)}\nAfter the re-clone.\n`);
  await expect.poll(() => readFileSync(file, "utf8"), { timeout: TIMING.debounceMs + SETTLE_MS }).toContain("After the re-clone.");
}, 2 * (TIMING.rootCheckMs + TIMING.watchRestartMs + TIMING.debounceMs + SETTLE_MS) + 5_000);
