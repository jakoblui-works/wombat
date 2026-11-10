// The items-root watcher behind the instructions file: a burst of file changes gives one render after the debounce,
// and the watch recovers when the root itself is replaced.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import type { Catalog } from "./catalog.ts";
import { INSTRUCTIONS_DEBOUNCE_MS, INSTRUCTIONS_FILE, openInstructions, ROOT_CHECK_MS, WATCH_RESTART_MS } from "./instructions.ts";
import { openItems, writeAt, writeRoot } from "../../test/items-fixtures.ts";

const SETTINGS = "version: 1\nid: rules\nname: Rules\nprefix: RUL\naccess: read\ninstructions: full\n";
const rule = (n: number) => `---\nid: 0196f3c2-9e00-7000-8000-${String(n).padStart(12, "0")}\nhandle: RUL-${n}\n---\n# Rule ${n}\n`;

/** Tolerance on top of the debounce for fs.watch to report the changes; not a tuning value. */
const SETTLE_MS = 1_000;

test("a burst of file changes gives one render", async () => {
  const root = writeRoot({ "rules/_structure.yaml": SETTINGS, "rules/RUL-1-a.md": rule(1) });
  const workspaceRoot = mkdtempSync(join(tmpdir(), "wombat-workspace-"));
  onTestFinished(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const { catalog } = openItems(root);
  let reads = 0;
  const counted: Catalog = { ...catalog, snapshot: () => ((reads += 1), catalog.snapshot()) };
  const instructions = openInstructions({ catalog: counted, workspaceRoot, itemsRoot: root, log: () => undefined });
  onTestFinished(() => instructions.close());
  instructions.watch();

  for (let n = 2; n <= 11; n += 1) writeAt(root, `rules/RUL-${n}-b.md`, rule(n));
  await new Promise((resolve) => setTimeout(resolve, INSTRUCTIONS_DEBOUNCE_MS + SETTLE_MS));

  expect(reads).toBe(1);
});

test("after the items root is removed and put back (a re-clone), hand edits reach the file again", async () => {
  const root = writeRoot({ "rules/_structure.yaml": SETTINGS, "rules/RUL-1-a.md": rule(1) });
  const workspaceRoot = mkdtempSync(join(tmpdir(), "wombat-workspace-"));
  onTestFinished(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const { catalog } = openItems(root);
  const instructions = openInstructions({ catalog, workspaceRoot, itemsRoot: root, log: () => undefined });
  onTestFinished(() => instructions.close());
  await instructions.refresh();
  instructions.watch();
  const file = join(workspaceRoot, INSTRUCTIONS_FILE);

  rmSync(root, { recursive: true });
  mkdirSync(root);
  writeAt(root, "rules/_structure.yaml", SETTINGS);
  writeAt(root, "rules/RUL-1-a.md", rule(1));
  await new Promise((resolve) => setTimeout(resolve, ROOT_CHECK_MS + WATCH_RESTART_MS + INSTRUCTIONS_DEBOUNCE_MS + SETTLE_MS));

  writeAt(root, "rules/RUL-1-a.md", `${rule(1)}\nAfter the re-clone.\n`);
  await expect.poll(() => readFileSync(file, "utf8"), { timeout: INSTRUCTIONS_DEBOUNCE_MS + SETTLE_MS }).toContain("After the re-clone.");
}, 2 * (ROOT_CHECK_MS + WATCH_RESTART_MS + INSTRUCTIONS_DEBOUNCE_MS + SETTLE_MS) + 5_000);
